import { eq } from "drizzle-orm";
import { db } from "@/db";
import { youtubeChannels } from "@/db/schema";
import { reclassifyChunk } from "@/lib/moderation/core";
import { reclassifyDeps } from "@/lib/moderation/deps";
import type { ReclassifyChunkResult } from "@/lib/moderation/types";

/** Upper bound on steps per run (25 comments each); the rest wait for the next publish. */
const MAX_RECLASSIFY_CHUNKS = 400;

/**
 * #156 reclassify run, started by `publishRubric` (production only).
 * Re-scores stored comments with the new published `version` at zero YouTube
 * reads and passes never-actioned matches to the chokepoint. Stops at
 * `superseded` as soon as a newer version is published.
 *
 * Every step catches its own errors and returns a status, so a retried step
 * never charges or applies twice.
 */
export async function commentReclassifyWorkflow(youtubeChannelUuid: string, version: number) {
  "use workflow";

  let afterId: string | null = null;
  let chunks = 0;
  let scored = 0;
  let applied = 0;
  let maybeRelease = 0;
  while (chunks < MAX_RECLASSIFY_CHUNKS) {
    const chunk: ReclassifyChunkResult = await reclassifyStep(youtubeChannelUuid, version, afterId);
    chunks++;
    scored += chunk.scored;
    applied += chunk.applied;
    maybeRelease += chunk.maybeRelease.length;
    if (chunk.status !== "continue") {
      return { channelId: youtubeChannelUuid, version, status: chunk.status, reason: chunk.reason, chunks, scored, applied, maybeRelease };
    }
    // No progress means the step could not start a call; stop rather than spin.
    if (chunk.nextAfterId === afterId) {
      return { channelId: youtubeChannelUuid, version, status: "done", reason: "no_progress", chunks, scored, applied, maybeRelease };
    }
    afterId = chunk.nextAfterId;
  }
  return { channelId: youtubeChannelUuid, version, status: "done", reason: "chunk_limit", chunks, scored, applied, maybeRelease };
}

async function reclassifyStep(
  youtubeChannelUuid: string,
  version: number,
  afterId: string | null
): Promise<ReclassifyChunkResult> {
  "use step";

  const zero = { scored: 0, unscored: 0, creditsCharged: 0, decisions: 0, applied: 0 };
  try {
    const [channel] = await db
      .select({
        id: youtubeChannels.id,
        channelId: youtubeChannels.channelId,
        organizationId: youtubeChannels.organizationId,
      })
      .from(youtubeChannels)
      .where(eq(youtubeChannels.id, youtubeChannelUuid));
    if (!channel) return { status: "superseded", reason: "channel_not_found", nextAfterId: afterId, maybeRelease: [], ...zero };
    return await reclassifyChunk(reclassifyDeps(), channel, version, afterId);
  } catch (err) {
    // Never rethrow: a retried step would charge and apply again.
    console.error("[comment-reclassify] step failed", {
      channelId: youtubeChannelUuid,
      version,
      error: err instanceof Error ? err.name : "unknown",
    });
    return { status: "done", reason: "step_error", nextAfterId: afterId, maybeRelease: [], ...zero };
  }
}
