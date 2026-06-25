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

  // No force: re-render the current desired state but still respect the drift
  // gate, so a YouTube edit made between the failure and this retry is never
  // silently overwritten (the user resolves the drift first).
  await pushVideoDescriptions([videoId], userId);
}
