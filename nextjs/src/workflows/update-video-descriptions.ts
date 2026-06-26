import { db } from "@/db";
import { youtubeVideos, descriptionHistory } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  getChannelAccessToken,
  isYouTubeQuotaError,
  updateVideoDescription,
} from "@/lib/clients/youtube";
import {
  isYouTubeQuotaExhausted,
  markYouTubeQuotaExhausted,
  nextQuotaResetAt,
} from "@/lib/services/quota-guard";
import { setJobItemStatus } from "@/lib/services/push-jobs";

const DESCRIPTION_PUSH_RESERVATION_MS = 2 * 60 * 1000;

// Long-backoff schedule for non-quota lasting failures, indexed by attempt
// number: the 1st lasting failure schedules a retry +3h later, the 2nd +6h, the
// 3rd +12h; only after that 3rd (12h) retry also fails is the video marked
// terminally failed. Measured from each failure. Quota-blocked retries reschedule
// to the known reset and do NOT consume an attempt, so this budget is reserved
// for genuine post-reset errors.
const RETRY_BACKOFF_MS = [3, 6, 12].map((h) => h * 60 * 60 * 1000);

export interface PushPayload {
  videoId: string;
  videoIdYouTube: string;
  channelId: string;
  newDescription: string;
  renderSnapshot: Record<string, Record<string, string>>;
  renderVersion: number;
  userId: string;
  organizationId: string | null;
  // The push job grouping this video's push. null for legacy payloads enqueued
  // before jobs existed (setJobItemStatus no-ops on null).
  jobId: string | null;
  // Creation-time metadata (job label) — carried so callers don't re-query the
  // title; unused by the workflow itself.
  videoTitle: string | null;
}

export async function updateVideoDescriptionsWorkflow(payload: PushPayload) {
  "use workflow";

  try {
    return await runUpdateVideoDescription(payload);
  } catch (err) {
    // A lasting non-quota failure: the step already exhausted its built-in quick
    // retries (transient blips resolve there and never reach this catch), so now
    // we consume a long-backoff attempt (3h → 6h → 12h) or mark terminally
    // failed after the 3rd. Quota failures are handled inside the step without
    // throwing, so they never land here and never burn an attempt.
    const message =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    await recordLastingPushFailure(
      payload.videoId,
      payload.renderVersion,
      message,
      payload.jobId
    );
    return { success: true, videoId: payload.videoId, retryScheduled: true };
  }
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
    // A newer push superseded this one and owns the current status. Guard the
    // idle reset on the payload's render_version so we never clobber the newer
    // push's queued/updating state.
    await resetPushStatusIdle(videoId, renderVersion);
    // This job's render was overtaken by a newer push (which owns its own job
    // item); let this job's item complete cleanly as superseded.
    await setJobItemStatus(payload.jobId, videoId, "superseded");
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
    await resetPushStatusIdle(videoId, renderVersion);
    await setJobItemStatus(payload.jobId, videoId, "succeeded", null);
    return { success: true, videoId, noop: true };
  }

  // Phase 2a: reserve this render with a short CAS before the external PUT.
  // If the row was deleted or modified after the pre-check, skip the side effect.
  const claimRows = await db
    .update(youtubeVideos)
    .set({
      descriptionPushReservedUntil: reservationExpiresAt,
      pushStatus: "updating",
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
    // The claim can fail for three reasons; only one of them is genuinely stale:
    //   1. the row was deleted,
    //   2. a newer push bumped render_version (that push now owns the status), or
    //   3. our render is still current but an *active reservation* left behind by
    //      a sibling attempt that crashed/timed out before clearing it is blocking
    //      us — the dev-kit's quick retries all land inside the 2-min window.
    // In case 3 the row is stuck at queued/updating with no live workflow, so we
    // must hand it to the cron rather than return stale-success and abandon it.
    // No attempt is consumed — this isn't a YouTube failure.
    const [current] = await db
      .select({
        renderVersion: youtubeVideos.renderVersion,
        reservedUntil: youtubeVideos.descriptionPushReservedUntil,
      })
      .from(youtubeVideos)
      .where(eq(youtubeVideos.id, videoId));

    if (
      current &&
      Number(current.renderVersion) === renderVersion &&
      current.reservedUntil &&
      current.reservedUntil.getTime() > Date.now()
    ) {
      // Schedule just past the blocking reservation's expiry so the cron's next
      // pass can actually claim it. Guarded on render_version so a concurrent
      // newer push is never clobbered.
      await db
        .update(youtubeVideos)
        .set({
          pushStatus: "retry_scheduled",
          nextRetryAt: new Date(current.reservedUntil.getTime() + 60 * 1000),
          lastPushError: "reservation held by a previous attempt",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(youtubeVideos.id, videoId),
            eq(youtubeVideos.renderVersion, renderVersion)
          )
        );
      await setJobItemStatus(
        payload.jobId,
        videoId,
        "retry_scheduled",
        "reservation held by a previous attempt"
      );
      console.warn(
        "[update-video-descriptions] claim blocked by an active reservation — handed to retry cron",
        { videoId, renderVersion }
      );
      return { success: true, videoId, retryScheduled: true };
    }

    await setJobItemStatus(payload.jobId, videoId, "superseded");
    console.warn(
      "[update-video-descriptions] CAS claim failed before YouTube PUT — skipping side effect",
      { videoId, renderVersion }
    );
    return { success: true, videoId, stale: true };
  }

  // Claim succeeded: this render now owns the row. Reflect Updating… on the job.
  await setJobItemStatus(payload.jobId, videoId, "updating", null);

  // Pre-empt doomed batches: if the quota breaker is already tripped, skip the
  // PUT entirely (one quota hit would otherwise make all ~232 remaining videos
  // each fire a doomed 403) and defer to the known reset without consuming an
  // attempt — same outcome as hitting quota on the PUT, minus the wasted call.
  if (await isYouTubeQuotaExhausted()) {
    console.log(
      "[update-video-descriptions] quota breaker tripped — deferring push to reset",
      { videoId }
    );
    await scheduleQuotaRetry(videoId, claimedRenderVersion, payload.jobId);
    return { success: true, videoId, retryScheduled: true, quotaDeferred: true };
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
    // Daily quota exhaustion can never succeed before reset — trip the breaker
    // (alerts the operator once), then defer the push to the known reset WITHOUT
    // consuming a long-backoff attempt and WITHOUT throwing (so we don't waste
    // the step's quick retries on an error that can't resolve until midnight).
    // A video is therefore never marked Failed purely because quota was out.
    if (isYouTubeQuotaError(err)) {
      await markYouTubeQuotaExhausted();
      await scheduleQuotaRetry(videoId, claimedRenderVersion, payload.jobId);
      return { success: true, videoId, retryScheduled: true, quotaDeferred: true };
    }
    // Non-quota error: rethrow so the step's built-in quick retries (3x) get a
    // chance to resolve a transient blip. Only if all of those are exhausted
    // does the workflow catch fall through to the long 3h→6h→12h backoff.
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
        pushStatus: "idle",
        pushAttempts: 0,
        nextRetryAt: null,
        lastPushError: null,
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
    // Guarded on claimedRenderVersion, so this no-ops when the concurrent writer
    // already moved the row on — that newer push owns the visible status.
    await resetPushStatusIdle(videoId, claimedRenderVersion);
    await setJobItemStatus(payload.jobId, videoId, "superseded");
    return { success: true, videoId, stale: true };
  }

  await setJobItemStatus(payload.jobId, videoId, "succeeded", null);
  return { success: true, videoId };
}

/**
 * Clear the user-visible push state back to idle for `videoId`, but only while
 * its render_version still matches `renderVersionGuard`. The guard makes every
 * reset path race-safe: if a newer push has since bumped render_version (and set
 * its own queued/updating state), this update matches no row and leaves the
 * newer state intact.
 */
async function resetPushStatusIdle(
  videoId: string,
  renderVersionGuard: number
): Promise<void> {
  await db
    .update(youtubeVideos)
    .set({
      pushStatus: "idle",
      pushAttempts: 0,
      nextRetryAt: null,
      lastPushError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(youtubeVideos.id, videoId),
        eq(youtubeVideos.renderVersion, renderVersionGuard)
      )
    );
}

/**
 * Defer a quota-blocked push to the known quota reset without consuming an
 * attempt. Also restores the short reservation so the cron retry starts clean.
 */
async function scheduleQuotaRetry(
  videoId: string,
  renderVersionGuard: number,
  jobId: string | null
): Promise<void> {
  await db
    .update(youtubeVideos)
    .set({
      pushStatus: "retry_scheduled",
      nextRetryAt: nextQuotaResetAt(),
      lastPushError: "waiting for quota reset",
      descriptionPushReservedUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(youtubeVideos.id, videoId),
        eq(youtubeVideos.renderVersion, renderVersionGuard)
      )
    );
  await setJobItemStatus(
    jobId,
    videoId,
    "retry_scheduled",
    "waiting for quota reset"
  );
}

/**
 * Record a lasting (non-quota) failure after the step's quick retries are
 * exhausted: increment the long-backoff attempt counter and schedule the next
 * retry (3h → 6h → 12h), or mark terminally failed after the 3rd. Guarded on
 * render_version so a newer push that has since superseded this one is never
 * clobbered (the increment matches no row and we bail).
 *
 * `"use step"` so the DB writes are durable within the workflow replay — the
 * workflow body itself must stay side-effect-free.
 */
async function recordLastingPushFailure(
  videoId: string,
  renderVersionGuard: number,
  errorMessage: string,
  jobId: string | null
): Promise<void> {
  "use step";

  const incremented = await db
    .update(youtubeVideos)
    .set({
      pushAttempts: sql`${youtubeVideos.pushAttempts} + 1`,
      descriptionPushReservedUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(youtubeVideos.id, videoId),
        eq(youtubeVideos.renderVersion, renderVersionGuard)
      )
    )
    .returning({ attempts: youtubeVideos.pushAttempts });

  if (incremented.length === 0) {
    // Superseded by a newer push (which owns the visible status now), or the
    // row is gone. The newer push owns its own job item; let this job's item
    // settle as superseded so the old job can complete.
    await setJobItemStatus(jobId, videoId, "superseded");
    return;
  }

  const attempts = Number(incremented[0]!.attempts);
  // attempts 1→3h, 2→6h, 3→12h; the 4th lasting failure (no backoff slot left)
  // is terminal. Using `>` (not `>=`) is what keeps the final 12h retry alive.
  const terminal = attempts > RETRY_BACKOFF_MS.length;
  await db
    .update(youtubeVideos)
    .set({
      pushStatus: terminal ? "failed" : "retry_scheduled",
      nextRetryAt: terminal
        ? null
        : new Date(Date.now() + RETRY_BACKOFF_MS[attempts - 1]!),
      lastPushError: errorMessage.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(youtubeVideos.id, videoId),
        eq(youtubeVideos.renderVersion, renderVersionGuard)
      )
    );
  await setJobItemStatus(
    jobId,
    videoId,
    terminal ? "failed" : "retry_scheduled",
    errorMessage
  );
}
