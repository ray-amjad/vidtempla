import { start } from "workflow/api";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { commentAutomation, youtubeChannels } from "@/db/schema";
import { MAX_SWEEP_CHUNKS, STALE_SCORING_MS, sweepBegin, sweepScoreChunk } from "@/lib/moderation/core";
import { sweepDeps } from "@/lib/moderation/deps";
import { drizzleSweepStore } from "@/lib/moderation/store";
import type { ChannelRef, SweepBeginResult, SweepChunkResult } from "@/lib/moderation/types";

/**
 * #156 comment sweep, every 15 minutes (vercel.json). Fans out one
 * `commentSweepChannelWorkflow` per enabled channel that belongs to an org.
 *
 * Each channel run is: one ingest step (`sweepBegin`), then score + apply
 * steps (`sweepScoreChunk`) until a terminal state. Every step catches its own
 * errors and returns a status, so the runtime never retries a step that has
 * already charged credits, stored scores or called YouTube. A step killed
 * mid-way leaves its claimed rows in `scoring`; the next run's ingest step
 * turns rows older than STALE_SCORING_MS into `unscored`.
 */
export async function commentSweepWorkflow() {
  "use workflow";

  const channelIds = await loadEnabledChannels();
  for (const id of channelIds) {
    await enqueueChannelSweep(id);
  }

  console.log("[comment-sweep] complete", { channelsQueued: channelIds.length });
  return { success: true, channelsQueued: channelIds.length, timestamp: new Date().toISOString() };
}

export async function commentSweepChannelWorkflow(youtubeChannelUuid: string) {
  "use workflow";

  const begin = await sweepBeginStep(youtubeChannelUuid);
  if (begin.status !== "continue") {
    return { channelId: youtubeChannelUuid, status: begin.status, reason: begin.reason, chunks: 0 };
  }

  let chunks = 0;
  let scored = 0;
  let applied = 0;
  while (chunks < MAX_SWEEP_CHUNKS) {
    const chunk = await sweepChunkStep(youtubeChannelUuid);
    chunks++;
    scored += chunk.scored;
    applied += chunk.applied;
    if (chunk.status !== "continue") {
      return { channelId: youtubeChannelUuid, status: chunk.status, reason: chunk.reason, chunks, scored, applied };
    }
  }

  // The rest stay pending for the next run.
  await finishChunkLimitStep(youtubeChannelUuid);
  return { channelId: youtubeChannelUuid, status: "done", reason: "chunk_limit", chunks, scored, applied };
}

async function loadEnabledChannels(): Promise<string[]> {
  "use step";

  const rows = await db
    .select({ id: youtubeChannels.id })
    .from(commentAutomation)
    .innerJoin(youtubeChannels, eq(youtubeChannels.id, commentAutomation.youtubeChannelId))
    .where(and(eq(commentAutomation.enabled, true), isNotNull(youtubeChannels.organizationId)));
  return rows.map((r) => r.id);
}

async function enqueueChannelSweep(youtubeChannelUuid: string) {
  "use step";

  await start(commentSweepChannelWorkflow, [youtubeChannelUuid]);
}

async function loadChannel(youtubeChannelUuid: string): Promise<ChannelRef | null> {
  const [row] = await db
    .select({
      id: youtubeChannels.id,
      channelId: youtubeChannels.channelId,
      organizationId: youtubeChannels.organizationId,
    })
    .from(youtubeChannels)
    .where(eq(youtubeChannels.id, youtubeChannelUuid));
  return row ?? null;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

async function sweepBeginStep(youtubeChannelUuid: string): Promise<SweepBeginResult> {
  "use step";

  try {
    const channel = await loadChannel(youtubeChannelUuid);
    if (!channel) return { status: "skipped: disabled", reason: "channel_not_found", ingested: 0, pagesRead: 0 };
    return await sweepBegin(sweepDeps(channel), channel);
  } catch (err) {
    // Never rethrow: a retried ingest could list YouTube again.
    console.error("[comment-sweep] ingest step failed", { channelId: youtubeChannelUuid, error: errorName(err) });
    await recordStatus(youtubeChannelUuid, "skipped: youtube error");
    return { status: "skipped: youtube error", reason: "step_error", ingested: 0, pagesRead: 0 };
  }
}

async function sweepChunkStep(youtubeChannelUuid: string): Promise<SweepChunkResult> {
  "use step";

  const zero = { scored: 0, unscored: 0, creditsCharged: 0, decisions: 0, applied: 0 };
  try {
    const channel = await loadChannel(youtubeChannelUuid);
    if (!channel) return { status: "skipped: disabled", reason: "channel_not_found", ...zero };
    return await sweepScoreChunk(sweepDeps(channel), channel);
  } catch (err) {
    // Never rethrow: a retried chunk would charge and apply again. Rows this
    // step claimed stay `scoring` and become `unscored` after STALE_SCORING_MS.
    console.error("[comment-sweep] chunk step failed", {
      channelId: youtubeChannelUuid,
      error: errorName(err),
      staleAfterMs: STALE_SCORING_MS,
    });
    await recordStatus(youtubeChannelUuid, "done");
    return { status: "done", reason: "step_error", ...zero };
  }
}

async function finishChunkLimitStep(youtubeChannelUuid: string) {
  "use step";

  await recordStatus(youtubeChannelUuid, "done");
}

async function recordStatus(youtubeChannelUuid: string, status: "done" | "skipped: youtube error") {
  try {
    await drizzleSweepStore.setRunStatus(youtubeChannelUuid, status, new Date());
  } catch (err) {
    console.error("[comment-sweep] could not record run status", { channelId: youtubeChannelUuid, error: errorName(err) });
  }
}
