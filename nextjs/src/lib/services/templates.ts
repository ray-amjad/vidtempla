import { eq, and, or, desc, lt, count, inArray, asc, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { templates, containers, youtubeVideos } from "@/db/schema";
import { parseVariables } from "@/utils/templateParser";
import type { ServiceResult, PaginationOpts, PaginationMeta } from "./types";
import { assertNoDrift } from "./drift";
import { pushVideoDescriptions } from "./videos";
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isEncodedCompositeCursor,
  isValidCursorId,
} from "./cursors";

// ── list_templates ───────────────────────────────────────────

export async function listTemplates(
  organizationId: string,
  opts: PaginationOpts
): Promise<ServiceResult<{ data: unknown[]; meta: PaginationMeta }>> {
  try {
    const limit = Math.min(opts.limit ?? 50, 100);
    const filters: SQL[] = [eq(templates.organizationId, organizationId)];
    if (opts.cursor) {
      if (isEncodedCompositeCursor(opts.cursor)) {
        const cursor = decodeCompositeCursor(opts.cursor);
        if (!cursor || cursor.scope !== "templates" || !isValidCursorId(cursor.id)) {
          return invalidCursor();
        }
        const parsedDate = parseCursorDate(cursor.key);
        if (!parsedDate) {
          return invalidCursor();
        }
        filters.push(
          or(
            lt(templates.createdAt, parsedDate),
            and(eq(templates.createdAt, parsedDate), lt(templates.id, cursor.id))
          )!
        );
      } else if (opts.cursor.includes("|")) {
        // Pre-versioned composite cursor from this PR: `${createdAt}|${id}`.
        const [cursorDate, cursorId, extra] = opts.cursor.split("|");
        if (!cursorDate || !cursorId || extra !== undefined || !isValidCursorId(cursorId)) {
          return invalidCursor();
        }
        const parsedDate = parseCursorDate(cursorDate);
        if (!parsedDate) {
          return invalidCursor();
        }
        filters.push(
          or(
            lt(templates.createdAt, parsedDate),
            and(eq(templates.createdAt, parsedDate), lt(templates.id, cursorId))
          )!
        );
      } else {
        // Legacy single-column cursor in flight: bare createdAt ISO string.
        const parsedDate = parseCursorDate(opts.cursor);
        if (!parsedDate) {
          return invalidCursor();
        }
        filters.push(lt(templates.createdAt, parsedDate));
      }
    }

    const results = await db
      .select()
      .from(templates)
      .where(and(...filters))
      .orderBy(desc(templates.createdAt), desc(templates.id))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCompositeCursor({
            scope: "templates",
            key: last.createdAt.toISOString(),
            id: last.id,
          })
        : undefined;

    const templatesWithVars = items.map((t) => ({
      ...t,
      variables: parseVariables(t.content),
    }));

    const [totalResult] = await db
      .select({ total: count() })
      .from(templates)
      .where(eq(templates.organizationId, organizationId));

    return {
      data: {
        data: templatesWithVars,
        meta: { cursor: nextCursor, hasMore, total: totalResult?.total ?? 0 },
      },
    };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to fetch templates", suggestion: "Try again later", status: 500 } };
  }
}

function invalidCursor(): ServiceResult<{ data: unknown[]; meta: PaginationMeta }> {
  return {
    error: {
      code: "INVALID_CURSOR",
      message: "Invalid cursor format",
      suggestion: "Omit the cursor to start from the first page",
      status: 400,
    },
  };
}

function parseCursorDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

// ── get_template ─────────────────────────────────────────────

export async function getTemplate(
  id: string,
  organizationId: string
): Promise<ServiceResult<unknown>> {
  try {
    const [template] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.organizationId, organizationId)));

    if (!template) {
      return { error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found", suggestion: "Check the template ID", status: 404 } };
    }

    return { data: { ...template, variables: parseVariables(template.content) } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to fetch template", suggestion: "Try again later", status: 500 } };
  }
}

// ── create_template ──────────────────────────────────────────

export async function createTemplate(
  userId: string,
  organizationId: string,
  name: string,
  content: string
): Promise<ServiceResult<unknown>> {
  try {
    if (!name.trim()) {
      return { error: { code: "INVALID_NAME", message: "name is required", suggestion: "Provide a non-empty name", status: 400 } };
    }

    const [template] = await db
      .insert(templates)
      .values({ userId, organizationId, name: name.trim(), content })
      .returning();

    return { data: { ...template, variables: parseVariables(content) } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to create template", suggestion: "Try again later", status: 500 } };
  }
}

// ── update_template ──────────────────────────────────────────

export async function updateTemplate(
  id: string,
  userId: string,
  organizationId: string,
  data: { name?: string; content?: string; force?: boolean }
): Promise<ServiceResult<unknown>> {
  try {
    const updateData: { name?: string; content?: string } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.content !== undefined) updateData.content = data.content;

    if (Object.keys(updateData).length === 0) {
      return { error: { code: "EMPTY_UPDATE", message: "At least one field (name or content) must be provided", suggestion: "Provide name and/or content", status: 400 } };
    }

    let videoIdsToPush: string[] = [];
    if (data.content !== undefined) {
      const allContainers = await db
        .select({ id: containers.id, templateOrder: containers.templateOrder })
        .from(containers)
        .where(eq(containers.userId, userId));

      const affectedContainers = allContainers.filter(
        (c) => Array.isArray(c.templateOrder) && c.templateOrder.includes(id)
      );

      if (affectedContainers.length > 0) {
        const containerIds = affectedContainers.map((c) => c.id);
        const videos = await db
          .select({ id: youtubeVideos.id })
          .from(youtubeVideos)
          .where(inArray(youtubeVideos.containerId, containerIds));
        videoIdsToPush = videos.map((v) => v.id);

        if (videoIdsToPush.length > 0) {
          const blocked = await assertNoDrift(videoIdsToPush, { force: data.force });
          if (blocked) {
            return {
              error: {
                code: "VIDEO_HAS_DRIFT",
                message: `${blocked.blocked.driftedVideoIds.length} video(s) using this template were edited on YouTube`,
                suggestion:
                  "Review drifted videos with list_videos?hasDrift=true, then retry with force: true to overwrite, or resolve_drift per video",
                status: 409,
                meta: {
                  driftedVideoIds: blocked.blocked.driftedVideoIds,
                  driftDetectedAt: blocked.blocked.driftDetectedAt,
                  latestManualEditHistoryId: blocked.blocked.latestManualEditHistoryId,
                },
              },
            };
          }
        }
      }
    }

    const [template] = await db
      .update(templates)
      .set(updateData)
      .where(and(eq(templates.id, id), eq(templates.organizationId, organizationId)))
      .returning();

    if (!template) {
      return { error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found", suggestion: "Check the template ID", status: 404 } };
    }

    if (videoIdsToPush.length > 0) {
      await pushVideoDescriptions(videoIdsToPush, userId, {
        force: data.force,
        jobContext: { create: { trigger: "template_update", label: template.name } },
      });
    }

    return { data: { ...template, variables: parseVariables(template.content) } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to update template", suggestion: "Try again later", status: 500 } };
  }
}

// ── delete_template ──────────────────────────────────────────

export async function deleteTemplate(
  id: string,
  organizationId: string
): Promise<ServiceResult<{ success: true }>> {
  try {
    const result = await db
      .delete(templates)
      .where(and(eq(templates.id, id), eq(templates.organizationId, organizationId)))
      .returning({ id: templates.id });

    if (result.length === 0) {
      return { error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found", suggestion: "Check the template ID", status: 404 } };
    }

    return { data: { success: true } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to delete template", suggestion: "Try again later", status: 500 } };
  }
}

// ── get_template_impact ──────────────────────────────────────

export async function getTemplateImpact(
  id: string,
  userId: string,
  organizationId: string
): Promise<ServiceResult<unknown>> {
  try {
    const [template] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.organizationId, organizationId)));

    if (!template) {
      return { error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found", suggestion: "Check the template ID", status: 404 } };
    }

    const allContainers = await db
      .select({ id: containers.id, name: containers.name, templateOrder: containers.templateOrder })
      .from(containers)
      .where(eq(containers.userId, userId));

    const affectedContainers = allContainers.filter(
      (c) => Array.isArray(c.templateOrder) && c.templateOrder.includes(id)
    );

    if (affectedContainers.length === 0) {
      return { data: { containers: [], videos: [], count: 0 } };
    }

    const containerIds = affectedContainers.map((c) => c.id);
    const videos = await db
      .select({
        id: youtubeVideos.id,
        title: youtubeVideos.title,
        videoId: youtubeVideos.videoId,
        containerId: youtubeVideos.containerId,
      })
      .from(youtubeVideos)
      .where(inArray(youtubeVideos.containerId, containerIds))
      .orderBy(asc(youtubeVideos.title));

    const containerInfo = affectedContainers.map((c) => ({
      id: c.id,
      name: c.name,
      videoCount: videos.filter((v) => v.containerId === c.id).length,
    }));

    return { data: { containers: containerInfo, videos, count: videos.length } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to fetch template impact", suggestion: "Try again later", status: 500 } };
  }
}
