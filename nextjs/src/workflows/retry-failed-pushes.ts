import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { youtubeChannels, youtubeVideos } from "@/db/schema";
import { pushVideoDescriptions } from "@/lib/services/videos";

/**
 * Hourly retry sweep for pushes that failed and scheduled a retry.
 *
 * `nextRetryAt` holds the exact due time (3h→6h→12h backoff, or the quota reset
 * for quota-blocked videos); this cron only needs to be frequent enough to fire
 * it within the hour, so an eligible retry lands within ≤1h of its target. Each
 * eligible video is re-enqueued via the normal push path, which re-renders the
 * current desired state — so retries always push the latest template/variables.
 *
 * A retry that finds the quota breaker still tripped takes the quota branch in
 * the push workflow (reschedule to reset, no attempt consumed), so a persistent
 * quota outage never burns the 3/6/12h budget.
 */
export async function retryFailedPushesWorkflow() {
  "use workflow";

  const due = await loadDueRetries();

  for (const video of due) {
    await enqueueRetry(video.id, video.userId);
  }

  console.log("[retry-failed-pushes] complete", { retriesQueued: due.length });

  return {
    success: true,
    retriesQueued: due.length,
    timestamp: new Date().toISOString(),
  };
}

async function loadDueRetries() {
  "use step";

  // Newest-first so the most relevant videos retry (and start) first. userId is
  // needed to re-render under the right ownership; it comes from the channel.
  return await db
    .select({ id: youtubeVideos.id, userId: youtubeChannels.userId })
    .from(youtubeVideos)
    .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
    .where(
      and(
        eq(youtubeVideos.pushStatus, "retry_scheduled"),
        lte(youtubeVideos.nextRetryAt, new Date())
      )
    )
    .orderBy(desc(youtubeVideos.publishedAt), desc(youtubeVideos.createdAt));
}

async function enqueueRetry(videoId: string, userId: string) {
  "use step";

  try {
    // No force: re-render the current desired state but still respect the drift
    // gate, so a YouTube edit made between the failure and this retry is never
    // silently overwritten (the user resolves the drift first).
    const result = await pushVideoDescriptions([videoId], userId);
    if ("error" in result) {
      // The only returned (non-thrown) error is VIDEO_HAS_DRIFT: the user edited
      // this video on YouTube, so re-pushing on the same schedule would loop
      // forever and never resolve. Terminalize it so the cron stops re-selecting
      // it and the user sees why — they resolve the drift, then use "Retry now".
      // (A successful or no-op push already moved the row off retry_scheduled in
      // buildPushPayload, so we only ever terminalize rows still pending retry.)
      await markRetryTerminal(videoId, result.error.message);
    }
  } catch (err) {
    // Unexpected throw (e.g. a workflow-enqueue infra hiccup). pushVideoDescriptions
    // already reschedules any half-enqueued video to retry next hour, so just log
    // and move on — one bad video must not abort the rest of this serial batch,
    // and a transient error must not be mistaken for a terminal failure.
    console.error("[retry-failed-pushes] retry enqueue failed — will retry next run", {
      videoId,
      err,
    });
  }
}

/**
 * Mark a still-pending retry as terminally failed so the hourly cron stops
 * re-selecting it. Guarded on `retry_scheduled` so a concurrent push that has
 * since moved the row to queued/updating/idle is never clobbered.
 */
async function markRetryTerminal(videoId: string, message: string) {
  await db
    .update(youtubeVideos)
    .set({
      pushStatus: "failed",
      nextRetryAt: null,
      lastPushError: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(youtubeVideos.id, videoId),
        eq(youtubeVideos.pushStatus, "retry_scheduled")
      )
    );
}
