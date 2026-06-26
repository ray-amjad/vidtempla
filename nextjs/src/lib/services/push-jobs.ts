import { and, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  descriptionPushJobs,
  descriptionPushJobItems,
  youtubeVideos,
} from "@/db/schema";
import type { ServiceResult, PaginationMeta } from "./types";
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isValidCursorId,
} from "./cursors";

export type PushJobTrigger =
  | "template_update"
  | "container_update"
  | "manual_push"
  | "variable_edit"
  | "drift_resolve"
  | "retry";

// Item lifecycle: active = queued|updating|retry_scheduled; terminal =
// succeeded (push committed or already-current) | failed (after 3 retries) |
// superseded (this job's render was overtaken by a newer push).
export type JobItemStatus =
  | "queued"
  | "updating"
  | "succeeded"
  | "retry_scheduled"
  | "failed"
  | "superseded";

const ACTIVE_STATUSES: JobItemStatus[] = [
  "queued",
  "updating",
  "retry_scheduled",
];

/**
 * Describes how a push call should be grouped into a job:
 * - `create`: start a fresh job with the given trigger + display label.
 * - `jobId`: continue an existing job (retries re-enqueue under the original).
 */
export type JobContext =
  | { create: { trigger: PushJobTrigger; label: string } }
  | { jobId: string };

// Accepts the shared `db` or a transaction handle — both expose insert/update.
type Executor = Pick<typeof db, "insert" | "update">;

export interface JobItemCounts {
  queued: number;
  updating: number;
  succeeded: number;
  retry_scheduled: number;
  failed: number;
  superseded: number;
}

function emptyCounts(): JobItemCounts {
  return {
    queued: 0,
    updating: 0,
    succeeded: 0,
    retry_scheduled: 0,
    failed: 0,
    superseded: 0,
  };
}

export type JobStatus = "running" | "completed" | "failed";

// Derived from items: running if any item is still active; once all settle,
// `failed` if any push failed (so an all/partly-failed job is never painted as
// a clean success), else `completed`.
function deriveStatus(counts: JobItemCounts): JobStatus {
  if (counts.queued + counts.updating + counts.retry_scheduled > 0) {
    return "running";
  }
  return counts.failed > 0 ? "failed" : "completed";
}

/**
 * Create a job + one `queued` item per videoId, and point every video's
 * `currentPushJobId` at the new job (so the retry cron re-enqueues under it).
 * Returns the new jobId. Runs against `db` or a transaction.
 */
export async function createPushJob(
  executor: Executor,
  args: {
    organizationId: string | null;
    userId: string;
    trigger: PushJobTrigger;
    label: string;
    videoIds: string[];
  }
): Promise<string> {
  const [job] = await executor
    .insert(descriptionPushJobs)
    .values({
      organizationId: args.organizationId,
      userId: args.userId,
      trigger: args.trigger,
      label: args.label.slice(0, 500),
      totalVideos: args.videoIds.length,
    })
    .returning({ id: descriptionPushJobs.id });

  const jobId = job!.id;

  await executor.insert(descriptionPushJobItems).values(
    args.videoIds.map((videoId) => ({
      jobId,
      videoId,
      status: "queued" as const,
    }))
  );

  // This push overtakes any earlier job that still had one of these videos
  // active (e.g. an item awaiting its retry backoff). Reassigning
  // currentPushJobId below means the retry cron will continue THIS job and
  // never re-touch the old item, so settle those orphaned items as superseded
  // — otherwise the old job would show 'Running' forever.
  await executor
    .update(descriptionPushJobItems)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(
      and(
        inArray(descriptionPushJobItems.videoId, args.videoIds),
        ne(descriptionPushJobItems.jobId, jobId),
        inArray(descriptionPushJobItems.status, ACTIVE_STATUSES)
      )
    );

  await executor
    .update(youtubeVideos)
    .set({ currentPushJobId: jobId, updatedAt: new Date() })
    .where(inArray(youtubeVideos.id, args.videoIds));

  return jobId;
}

/**
 * Reset the given videos' items back to `queued` on an existing job — used when
 * a retry re-enqueues a video under its original job rather than spawning a new
 * one.
 */
export async function resetPushJobItems(
  jobId: string,
  videoIds: string[]
): Promise<void> {
  if (videoIds.length === 0) return;
  await db
    .update(descriptionPushJobItems)
    .set({ status: "queued", lastError: null, updatedAt: new Date() })
    .where(
      and(
        eq(descriptionPushJobItems.jobId, jobId),
        inArray(descriptionPushJobItems.videoId, videoIds)
      )
    );
}

/**
 * Update one `(job, video)` item. No-op when `jobId` is null (legacy push
 * payloads enqueued before jobs existed carry no jobId). Passing `error`
 * (string or null) sets `lastError`; omitting it leaves the column unchanged.
 */
export async function setJobItemStatus(
  jobId: string | null | undefined,
  videoId: string,
  status: JobItemStatus,
  error?: string | null
): Promise<void> {
  if (!jobId) return;
  await db
    .update(descriptionPushJobItems)
    .set({
      status,
      ...(error === undefined
        ? {}
        : { lastError: error ? error.slice(0, 500) : null }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(descriptionPushJobItems.jobId, jobId),
        eq(descriptionPushJobItems.videoId, videoId)
      )
    );
}

/** Owner isolation: org context filters by org; personal by user + null org. */
function jobOwnerFilter(userId: string, organizationId?: string | null) {
  return organizationId
    ? eq(descriptionPushJobs.organizationId, organizationId)
    : and(
        eq(descriptionPushJobs.userId, userId),
        isNull(descriptionPushJobs.organizationId)
      );
}

function invalidCursor(): ServiceResult<never> {
  return {
    error: {
      code: "INVALID_CURSOR",
      message: "Invalid cursor format",
      suggestion: "Omit the cursor to start from the first page",
      status: 400,
    },
  };
}

export interface PushJobSummary {
  id: string;
  trigger: string;
  label: string;
  totalVideos: number;
  createdAt: Date;
  counts: JobItemCounts;
  status: JobStatus;
}

export async function listPushJobsService(params: {
  userId: string;
  organizationId?: string | null;
  cursor?: string;
  limit?: number;
}): Promise<ServiceResult<{ data: PushJobSummary[]; meta: PaginationMeta }>> {
  try {
    const limit = Math.min(params.limit ?? 20, 100);
    const filters = [jobOwnerFilter(params.userId, params.organizationId)] as any[];

    if (params.cursor) {
      const cursor = decodeCompositeCursor(params.cursor);
      if (!cursor || cursor.scope !== "jobs" || !isValidCursorId(cursor.id)) {
        return invalidCursor();
      }
      const cursorDate = cursor.key ? new Date(cursor.key) : null;
      if (!cursorDate || Number.isNaN(cursorDate.getTime())) {
        return invalidCursor();
      }
      // The cursor key is a millisecond-precision ISO string (node-postgres
      // truncates the µs-precision timestamptz when it reads it), so an exact
      // `created_at = cursorDate` tiebreaker would never match a row whose real
      // value is e.g. T.123456 — dropping same-millisecond jobs at the page
      // boundary. Use a half-open millisecond window [cursorDate, cursorDate+1ms)
      // for the id tiebreaker instead, which stays index-friendly.
      const cursorDateNextMs = new Date(cursorDate.getTime() + 1);
      filters.push(
        or(
          lt(descriptionPushJobs.createdAt, cursorDate),
          and(
            gte(descriptionPushJobs.createdAt, cursorDate),
            lt(descriptionPushJobs.createdAt, cursorDateNextMs),
            lt(descriptionPushJobs.id, cursor.id)
          )
        )!
      );
    }

    const rows = await db
      .select()
      .from(descriptionPushJobs)
      .where(and(...filters))
      .orderBy(desc(descriptionPushJobs.createdAt), desc(descriptionPushJobs.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCompositeCursor({
            scope: "jobs",
            key: last.createdAt.toISOString(),
            id: last.id,
          })
        : undefined;

    const jobIds = items.map((j) => j.id);
    const countsByJob = new Map<string, JobItemCounts>();
    if (jobIds.length > 0) {
      const grouped = await db
        .select({
          jobId: descriptionPushJobItems.jobId,
          status: descriptionPushJobItems.status,
          n: count(),
        })
        .from(descriptionPushJobItems)
        .where(inArray(descriptionPushJobItems.jobId, jobIds))
        .groupBy(descriptionPushJobItems.jobId, descriptionPushJobItems.status);

      for (const g of grouped) {
        const rec = countsByJob.get(g.jobId) ?? emptyCounts();
        rec[g.status as JobItemStatus] = Number(g.n);
        countsByJob.set(g.jobId, rec);
      }
    }

    const data: PushJobSummary[] = items.map((job) => {
      const counts = countsByJob.get(job.id) ?? emptyCounts();
      return {
        id: job.id,
        trigger: job.trigger,
        label: job.label,
        totalVideos: job.totalVideos,
        createdAt: job.createdAt,
        counts,
        status: deriveStatus(counts),
      };
    });

    return { data: { data, meta: { cursor: nextCursor, hasMore, total: null } } };
  } catch (err) {
    console.error("[push-jobs] listPushJobsService failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch jobs",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export interface PushJobItemDetail {
  id: string;
  videoId: string;
  videoTitle: string | null;
  videoYoutubeId: string;
  status: string;
  lastError: string | null;
  updatedAt: Date;
}

// Cap the per-video rows returned (and re-fetched every 15s while running) for
// a whole-channel job that can span hundreds of videos. The failed->active->done
// ordering keeps the rows that need attention within the cap.
const JOB_ITEMS_LIMIT = 200;

export async function getPushJobItemsService(
  jobId: string,
  owner: { userId: string; organizationId?: string | null }
): Promise<
  ServiceResult<{
    job: PushJobSummary;
    items: PushJobItemDetail[];
  }>
> {
  try {
    const [job] = await db
      .select()
      .from(descriptionPushJobs)
      .where(
        and(
          eq(descriptionPushJobs.id, jobId),
          jobOwnerFilter(owner.userId, owner.organizationId)
        )
      );

    if (!job) {
      return {
        error: {
          code: "JOB_NOT_FOUND",
          message: "Job not found",
          suggestion: "Check the job ID",
          status: 404,
        },
      };
    }

    // Counts come from a grouped query over ALL items so the derived status and
    // progress summary stay accurate even though the item list below is capped.
    const grouped = await db
      .select({ status: descriptionPushJobItems.status, n: count() })
      .from(descriptionPushJobItems)
      .where(eq(descriptionPushJobItems.jobId, jobId))
      .groupBy(descriptionPushJobItems.status);

    const counts = emptyCounts();
    for (const g of grouped) {
      if (g.status in counts) {
        counts[g.status as JobItemStatus] = Number(g.n);
      }
    }

    // Order failed -> active -> done so the rows needing attention surface first.
    const items = await db
      .select({
        id: descriptionPushJobItems.id,
        videoId: descriptionPushJobItems.videoId,
        videoTitle: youtubeVideos.title,
        videoYoutubeId: youtubeVideos.videoId,
        status: descriptionPushJobItems.status,
        lastError: descriptionPushJobItems.lastError,
        updatedAt: descriptionPushJobItems.updatedAt,
      })
      .from(descriptionPushJobItems)
      .innerJoin(
        youtubeVideos,
        eq(descriptionPushJobItems.videoId, youtubeVideos.id)
      )
      .where(eq(descriptionPushJobItems.jobId, jobId))
      .orderBy(
        sql`case
          when ${descriptionPushJobItems.status} = 'failed' then 0
          when ${descriptionPushJobItems.status} in ('queued', 'updating', 'retry_scheduled') then 1
          else 2 end`,
        desc(descriptionPushJobItems.updatedAt)
      )
      .limit(JOB_ITEMS_LIMIT);

    return {
      data: {
        job: {
          id: job.id,
          trigger: job.trigger,
          label: job.label,
          totalVideos: job.totalVideos,
          createdAt: job.createdAt,
          counts,
          status: deriveStatus(counts),
        },
        items,
      },
    };
  } catch (err) {
    console.error("[push-jobs] getPushJobItemsService failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch job details",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export { ACTIVE_STATUSES };
