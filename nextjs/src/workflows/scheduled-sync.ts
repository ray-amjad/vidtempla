import { start } from "workflow/api";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { youtubeChannels } from "@/db/schema";
import { isYouTubeQuotaExhausted } from "@/lib/services/quota-guard";
import { syncChannelVideosWorkflow } from "./sync-channel-videos";

export async function scheduledSyncWorkflow() {
  "use workflow";

  // If the quota is already known-exhausted, don't fan out dozens of child
  // syncs that would each just re-discover the 403. Resume next reset.
  if (await quotaExhausted()) {
    console.log("[scheduled-sync] YouTube quota exhausted — skipping run");
    return {
      success: true,
      skipped: true,
      reason: "quota_exhausted",
      channelsQueued: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const channels = await loadChannels();

  for (const channel of channels) {
    await enqueueChannelSync(channel.id, channel.userId);
  }

  console.log("[scheduled-sync] complete", { channelsQueued: channels.length });

  return {
    success: true,
    channelsQueued: channels.length,
    timestamp: new Date().toISOString(),
  };
}

async function quotaExhausted() {
  "use step";

  return await isYouTubeQuotaExhausted();
}

async function loadChannels() {
  "use step";

  // Only sync channels with a valid OAuth grant. Channels marked invalid will
  // just fail (and previously still burned a quota call every run).
  return await db
    .select({ id: youtubeChannels.id, userId: youtubeChannels.userId })
    .from(youtubeChannels)
    .where(eq(youtubeChannels.tokenStatus, "valid"));
}

async function enqueueChannelSync(channelId: string, userId: string) {
  "use step";

  await start(syncChannelVideosWorkflow, [channelId, userId]);
}
