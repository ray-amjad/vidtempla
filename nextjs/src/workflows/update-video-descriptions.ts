import { FatalError } from "workflow";
import { db } from "@/db";
import { youtubeVideos, descriptionHistory } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  getChannelAccessToken,
  isYouTubeQuotaError,
  updateVideoDescription,
} from "@/lib/clients/youtube";
import { markYouTubeQuotaExhausted } from "@/lib/services/quota-guard";

const DESCRIPTION_PUSH_RESERVATION_MS = 2 * 60 * 1000;

export interface PushPayload {
  videoId: string;
  videoIdYouTube: string;
  channelId: string;
  newDescription: string;
  renderSnapshot: Record<string, Record<string, string>>;
  renderVersion: number;
  userId: string;
  organizationId: string | null;
}

export async function updateVideoDescriptionsWorkflow(payload: PushPayload) {
  "use workflow";

  return await runUpdateVideoDescription(payload);
}

async function runUpdateVideoDescription(payload: PushPayload) {
  "use step";

  const {
    videoId,
    videoIdYouTube,
    channelId,
    newDescription,
    renderSnapshot,
    renderVersion,
    userId,
  } = payload;

  const canonical = newDescription.replace(/\s+$/, "");
  const accessToken = await getChannelAccessToken(channelId);
  const reservationExpiresAt = new Date(
    Date.now() + DESCRIPTION_PUSH_RESERVATION_MS
  );

  // Phase 1: validate state in a short read-only txn (no FOR UPDATE — we use CAS
  // on render_version in phase 3 to detect concurrent modifications).
  const preCheckRows = await db.execute(sql<{
    renderVersion: number;
    driftDetectedAt: Date | null;
    currentDescription: string | null;
  }>`
    select render_version as "renderVersion",
           drift_detected_at as "driftDetectedAt",
           current_description as "currentDescription"
    from youtube_videos
    where id = ${videoId}
  `);
  const preCheck = preCheckRows[0];

  if (!preCheck) {
    console.warn("[update-video-descriptions] video no longer exists — skipping push", {
      videoId,
    });
    return { success: true, videoId, stale: true };
  }

  if (Number(preCheck.renderVersion) !== renderVersion) {
    console.log("[update-video-descriptions] stale push discarded", {
      videoId,
      payloadRenderVersion: renderVersion,
      currentRenderVersion: Number(preCheck.renderVersion),
    });
    return { success: true, videoId, stale: true };
  }

  if (preCheck.driftDetectedAt) {
    console.warn("[update-video-descriptions] overwriting drifted description via template push", {
      videoId,
      driftDetectedAt: preCheck.driftDetectedAt,
    });
  } else if (String(preCheck.currentDescription ?? "").replace(/\s+$/, "") === canonical) {
    // No drift and YouTube already holds this exact description (currentDescription
    // mirrors YouTube after our last push/sync). Skip the 50-unit videos.update —
    // the single biggest avoidable quota cost.
    console.log("[update-video-descriptions] description already current — skipping no-op YouTube write", {
      videoId,
    });
    return { success: true, videoId, noop: true };
  }

  // Phase 2a: reserve this render with a short CAS before the external PUT.
  // If the row was deleted or modified after the pre-check, skip the side effect.
  const claimRows = await db
    .update(youtubeVideos)
    .set({
      descriptionPushReservedUntil: reservationExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(youtubeVideos.id, videoId),
        eq(youtubeVideos.renderVersion, renderVersion),
        sql`(${youtubeVideos.descriptionPushReservedUntil} is null or ${youtubeVideos.descriptionPushReservedUntil} <= now())`
      )
    )
    .returning({ renderVersion: youtubeVideos.renderVersion });

  const claimedRenderVersion = Number(claimRows[0]?.renderVersion ?? 0);

  if (!claimedRenderVersion) {
    console.warn(
      "[update-video-descriptions] CAS claim failed before YouTube PUT — skipping side effect",
      { videoId, renderVersion }
    );
    return { success: true, videoId, stale: true };
  }

  // Phase 2b: external HTTP PUT — performed OUTSIDE any transaction so we never
  // hold a row lock across the YouTube round-trip. If this throws, best-effort
  // restore the reservation so the workflow retry can use the original stamp.
  try {
    await updateVideoDescription(videoIdYouTube, canonical, accessToken);
  } catch (err) {
    await db
      .update(youtubeVideos)
      .set({
        descriptionPushReservedUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(youtubeVideos.id, videoId),
          eq(youtubeVideos.renderVersion, claimedRenderVersion)
        )
      );
    // Daily quota exhaustion can never succeed on retry — trip the breaker
    // (alerts the operator once) and stop the 3x workflow retries. The
    // reservation was already restored above, so a post-reset retry is clean.
    if (isYouTubeQuotaError(err)) {
      await markYouTubeQuotaExhausted();
      throw new FatalError(
        "YouTube Data API daily quota exhausted — not retrying until reset"
      );
    }
    throw err;
  }

  // Phase 3: short write txn with CAS on render_version. If a concurrent writer
  // bumped render_version between phase 1 and phase 3, we abort the local write
  // (YouTube is already updated — the next sync's drift detection will surface
  // any remaining divergence rather than overwriting concurrent intent here).
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '30s'`);

    const updated = await tx
      .update(youtubeVideos)
      .set({
        currentDescription: canonical,
        driftDetectedAt: null,
        renderVersion: sql`${youtubeVideos.renderVersion} + 1`,
        descriptionPushReservedUntil: null,
      })
      .where(
        and(
          eq(youtubeVideos.id, videoId),
          eq(youtubeVideos.renderVersion, claimedRenderVersion)
        )
      )
      .returning({ id: youtubeVideos.id });

    if (updated.length === 0) {
      return { casFailed: true as const };
    }

    const nextVersionRows = await tx.execute(sql<{ next: number }>`
      select coalesce(max(version_number), 0) + 1 as next
      from description_history where video_id = ${videoId}
    `);
    const nextVersion = Number(nextVersionRows[0]?.next ?? 1);

    await tx.insert(descriptionHistory).values({
      videoId,
      description: canonical,
      versionNumber: nextVersion,
      renderSnapshot,
      createdBy: userId,
      source: "template_push",
    });

    return { casFailed: false as const };
  });

  if (result.casFailed) {
    console.warn(
      "[update-video-descriptions] CAS failed after YouTube PUT — concurrent writer changed render_version; YouTube has new description but DB write skipped (drift detection will reconcile)",
      { videoId, renderVersion, claimedRenderVersion }
    );
    return { success: true, videoId, stale: true };
  }

  return { success: true, videoId };
}
