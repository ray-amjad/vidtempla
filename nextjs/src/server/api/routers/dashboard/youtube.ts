/**
 * YouTube tRPC router
 * Handles all YouTube-related API procedures
 */

import { z } from 'zod';
import { orgProcedure } from '@/server/trpc/init';
import { TRPCError } from '@trpc/server';
import { getOAuthUrl } from '@/lib/clients/youtube';
import { decrypt, encrypt } from '@/utils/encryption';
import { refreshAccessToken, fetchChannelVideos } from '@/lib/clients/youtube';
import {
  parseVariables,
  buildDescription,
  findMissingVariables,
} from '@/utils/templateParser';
import { start } from 'workflow/api';
import { syncChannelVideosWorkflow } from '@/workflows/sync-channel-videos';
import { db } from '@/db';
import { youtubeChannels, containers, templates, youtubeVideos, videoVariables, descriptionHistory } from '@/db/schema';
import { eq, and, desc, asc, count, isNull, ilike, inArray, getTableColumns, sql } from 'drizzle-orm';
import { checkChannelLimit } from '@/lib/plan-limits';
import { router } from '@/server/trpc/init';
import {
  assignVideo,
  listVideos as listVideosService,
  getVideo as getVideoService,
  updateVideoVariables as updateVideoVariablesService,
  revertDescription as revertDescriptionService,
  pushVideoDescriptions,
  checkDrift as checkDriftService,
  resolveDrift as resolveDriftService,
} from '@/lib/services/videos';
import { assertNoDrift } from '@/lib/services/drift';

/** Verify a video belongs to the given org (via its channel). Throws NOT_FOUND if not. */
async function verifyVideoOwnership(videoId: string, organizationId: string) {
  const [video] = await db
    .select({ id: youtubeVideos.id })
    .from(youtubeVideos)
    .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
    .where(and(eq(youtubeVideos.id, videoId), eq(youtubeChannels.organizationId, organizationId)));
  if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  return video;
}

/** Verify a channel belongs to the given org. Throws NOT_FOUND if not. */
async function verifyChannelOwnership(channelId: string, organizationId: string) {
  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.id, channelId), eq(youtubeChannels.organizationId, organizationId)));
  if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
  return channel;
}

function throwServiceError(error: { code: string; message: string; status: number; meta?: Record<string, unknown> }): never {
  const driftMeta =
    error.code === 'VIDEO_HAS_DRIFT' && error.meta
      ? {
          driftedVideoIds: error.meta.driftedVideoIds,
          driftDetectedAt: error.meta.driftDetectedAt,
          latestManualEditHistoryId: error.meta.latestManualEditHistoryId,
        }
      : undefined;
  throw new TRPCError({
    code:
      error.status === 404
        ? 'NOT_FOUND'
        : error.status === 403
          ? 'FORBIDDEN'
          : error.status === 409
            ? 'CONFLICT'
            : error.status === 500
              ? 'INTERNAL_SERVER_ERROR'
              : 'BAD_REQUEST',
    message: error.message,
    ...(driftMeta ? { cause: { driftMeta } } : {}),
  });
}

export const youtubeRouter = router({
  // ==================== Channel Management ====================

  channels: router({
    list: orgProcedure.query(async ({ ctx }) => {
      const data = await db
        .select()
        .from(youtubeChannels)
        .where(eq(youtubeChannels.organizationId, ctx.organizationId))
        .orderBy(desc(youtubeChannels.createdAt));

      return data;
    }),

    checkLimit: orgProcedure.query(async ({ ctx }) => {
      const result = await checkChannelLimit(ctx.organizationId, db);
      return result;
    }),

    initiateOAuth: orgProcedure.mutation(async () => {
      return { url: getOAuthUrl() };
    }),

    disconnect: orgProcedure
      .input(z.object({ channelId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.transaction(async (tx) => {
          const videoRows = (await tx.execute(sql<{
            videoId: string;
            descriptionPushReservedUntil: Date | string | null;
          }>`
            select v.video_id as "videoId",
                   v.description_push_reserved_until as "descriptionPushReservedUntil"
            from youtube_videos v
            inner join youtube_channels c on c.id = v.channel_id
            where c.id = ${input.channelId}
              and c.organization_id = ${ctx.organizationId}
            for update of v
          `)) as Array<{
            videoId: string;
            descriptionPushReservedUntil: Date | string | null;
          }>;

          const now = Date.now();
          const reservedVideo = videoRows.find((video) => {
            if (!video.descriptionPushReservedUntil) return false;
            return new Date(video.descriptionPushReservedUntil).getTime() > now;
          });

          if (reservedVideo) {
            return {
              reserved: true as const,
              videoId: reservedVideo.videoId,
              reservedUntil: reservedVideo.descriptionPushReservedUntil,
            };
          }

          await tx
            .delete(youtubeChannels)
            .where(
              and(
                eq(youtubeChannels.id, input.channelId),
                eq(youtubeChannels.organizationId, ctx.organizationId)
              )
            );

          return { reserved: false as const };
        });

        if (result.reserved) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A YouTube description push is in progress for this channel. Try disconnecting again shortly.',
          });
        }

        return { success: true };
      }),

    syncVideos: orgProcedure
      .input(z.object({ channelId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await verifyChannelOwnership(input.channelId, ctx.organizationId);
        await start(syncChannelVideosWorkflow, [input.channelId, ctx.user.id]);

        return { success: true, jobId: `sync-${input.channelId}-${Date.now()}` };
      }),
  }),

  // ==================== Container Management ====================

  containers: router({
    list: orgProcedure.query(async ({ ctx }) => {
      const data = await db
        .select({
          ...getTableColumns(containers),
          videoCount: count(youtubeVideos.id),
        })
        .from(containers)
        .leftJoin(youtubeVideos, eq(youtubeVideos.containerId, containers.id))
        .where(eq(containers.organizationId, ctx.organizationId))
        .groupBy(containers.id)
        .orderBy(desc(containers.createdAt));

      return data;
    }),

    create: orgProcedure
      .input(
        z.object({
          name: z.string().min(1),
          templateIds: z.array(z.string().uuid()),
          separator: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [data] = await db
          .insert(containers)
          .values({
            userId: ctx.user.id,
            organizationId: ctx.organizationId,
            name: input.name,
            templateOrder: input.templateIds,
            separator: input.separator ?? '\n\n',
          })
          .returning();

        return data;
      }),

    update: orgProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          templateIds: z.array(z.string().uuid()).optional(),
          separator: z.string().optional(),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const updateData: {
          name?: string;
          templateOrder?: string[];
          separator?: string;
        } = {};
        if (input.name) updateData.name = input.name;
        if (input.templateIds) updateData.templateOrder = input.templateIds;
        if (input.separator !== undefined) updateData.separator = input.separator;

        // Drift gate: check affected videos BEFORE mutating
        let videoIdsToPush: string[] = [];
        if (input.templateIds !== undefined || input.separator !== undefined) {
          const videos = await db
            .select({ id: youtubeVideos.id })
            .from(youtubeVideos)
            .innerJoin(containers, eq(youtubeVideos.containerId, containers.id))
            .where(and(eq(containers.id, input.id), eq(containers.organizationId, ctx.organizationId)));
          // Newest-first enqueue ordering is applied centrally in
          // pushVideoDescriptions, so no ORDER BY is needed here.
          videoIdsToPush = videos.map((v) => v.id);

          if (videoIdsToPush.length > 0) {
            const blocked = await assertNoDrift(videoIdsToPush, { force: input.force });
            if (blocked) {
              throwServiceError({
                code: 'VIDEO_HAS_DRIFT',
                message: `${blocked.blocked.driftedVideoIds.length} video(s) in this container were edited on YouTube`,
                status: 409,
                meta: {
                  driftedVideoIds: blocked.blocked.driftedVideoIds,
                  driftDetectedAt: blocked.blocked.driftDetectedAt,
                  latestManualEditHistoryId: blocked.blocked.latestManualEditHistoryId,
                },
              });
            }
          }
        }

        const [data] = await db
          .update(containers)
          .set(updateData)
          .where(and(eq(containers.id, input.id), eq(containers.organizationId, ctx.organizationId)))
          .returning();

        if (videoIdsToPush.length > 0) {
          await pushVideoDescriptions(videoIdsToPush, ctx.user.id, {
            jobContext: {
              create: { trigger: "container_update", label: data?.name ?? "Container update" },
            },
          });
        }

        return data;
      }),

    delete: orgProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await db
          .delete(containers)
          .where(and(eq(containers.id, input.id), eq(containers.organizationId, ctx.organizationId)));

        return { success: true };
      }),

    getAffectedVideos: orgProcedure
      .input(z.object({ containerId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const videos = await db
          .select({
            id: youtubeVideos.id,
            title: youtubeVideos.title,
            videoId: youtubeVideos.videoId,
          })
          .from(youtubeVideos)
          .innerJoin(containers, eq(containers.id, youtubeVideos.containerId))
          .where(
            and(
              eq(youtubeVideos.containerId, input.containerId),
              eq(containers.organizationId, ctx.organizationId)
            )
          )
          .orderBy(asc(youtubeVideos.title));

        return {
          videos: videos || [],
          count: videos?.length || 0,
        };
      }),
  }),

  // ==================== Template Management ====================

  templates: router({
    list: orgProcedure.query(async ({ ctx }) => {
      const data = await db
        .select()
        .from(templates)
        .where(eq(templates.organizationId, ctx.organizationId))
        .orderBy(desc(templates.createdAt));

      // Add variable count to each template
      return data.map((template) => ({
        ...template,
        variables: parseVariables(template.content),
      }));
    }),

    create: orgProcedure
      .input(
        z.object({
          name: z.string().min(1),
          content: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [data] = await db
          .insert(templates)
          .values({
            userId: ctx.user.id,
            organizationId: ctx.organizationId,
            name: input.name,
            content: input.content,
          })
          .returning();

        return data;
      }),

    update: orgProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          content: z.string().optional(),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const updateData: {
          name?: string;
          content?: string;
        } = {};
        if (input.name) updateData.name = input.name;
        if (input.content !== undefined) updateData.content = input.content;

        // Drift gate: check affected videos BEFORE mutating
        let videoIdsToPush: string[] = [];
        if (input.content !== undefined) {
          const allContainers = await db
            .select({ id: containers.id, templateOrder: containers.templateOrder })
            .from(containers)
            .where(eq(containers.organizationId, ctx.organizationId));
          const containersData = allContainers.filter((c) =>
            Array.isArray(c.templateOrder) && c.templateOrder.includes(input.id)
          );

          if (containersData.length > 0) {
            const containerIds = containersData.map((c) => c.id);
            const videos = await db
              .select({ id: youtubeVideos.id })
              .from(youtubeVideos)
              .where(inArray(youtubeVideos.containerId, containerIds));
            // Newest-first enqueue ordering is applied centrally in
            // pushVideoDescriptions, so no ORDER BY is needed here.
            videoIdsToPush = videos.map((v) => v.id);

            if (videoIdsToPush.length > 0) {
              const blocked = await assertNoDrift(videoIdsToPush, { force: input.force });
              if (blocked) {
                throwServiceError({
                  code: 'VIDEO_HAS_DRIFT',
                  message: `${blocked.blocked.driftedVideoIds.length} video(s) using this template were edited on YouTube`,
                  status: 409,
                  meta: {
                    driftedVideoIds: blocked.blocked.driftedVideoIds,
                    driftDetectedAt: blocked.blocked.driftDetectedAt,
                    latestManualEditHistoryId: blocked.blocked.latestManualEditHistoryId,
                  },
                });
              }
            }
          }
        }

        const [data] = await db
          .update(templates)
          .set(updateData)
          .where(and(eq(templates.id, input.id), eq(templates.organizationId, ctx.organizationId)))
          .returning();

        if (videoIdsToPush.length > 0) {
          await pushVideoDescriptions(videoIdsToPush, ctx.user.id, {
            jobContext: {
              create: { trigger: "template_update", label: data?.name ?? "Template update" },
            },
          });
        }

        return data;
      }),

    delete: orgProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await db
          .delete(templates)
          .where(and(eq(templates.id, input.id), eq(templates.organizationId, ctx.organizationId)));

        return { success: true };
      }),

    parseVariables: orgProcedure
      .input(z.object({ content: z.string() }))
      .query(({ input }) => {
        return { variables: parseVariables(input.content) };
      }),

    getAffectedVideos: orgProcedure
      .input(z.object({ templateId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // First, find all containers that use this template
        const allContainers = await db
          .select({
            id: containers.id,
            name: containers.name,
            templateOrder: containers.templateOrder,
          })
          .from(containers)
          .where(eq(containers.organizationId, ctx.organizationId));
        const containersData = allContainers.filter((c) =>
          Array.isArray(c.templateOrder) && c.templateOrder.includes(input.templateId)
        );

        if (!containersData || containersData.length === 0) {
          return {
            videos: [],
            count: 0,
            containers: [],
          };
        }

        // Get all videos from these containers
        const containerIds = containersData.map((c) => c.id);
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

        // Build container info with video counts
        const containerInfo = containersData.map((container) => ({
          id: container.id,
          name: container.name,
          videoCount: videos?.filter((v) => v.containerId === container.id).length || 0,
        }));

        return {
          videos: videos || [],
          count: videos?.length || 0,
          containers: containerInfo,
        };
      }),
  }),

  // ==================== Video Management ====================

  videos: router({
    list: orgProcedure
      .input(
        z.object({
          channelId: z.string().optional(),
          containerId: z.union([z.string().uuid(), z.literal('')]).optional(),
          search: z.string().optional(),
          hasDrift: z.boolean().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        let channelYoutubeId: string | undefined;
        if (input.channelId && input.channelId !== '') {
          const [channel] = await db
            .select({ channelId: youtubeChannels.channelId })
            .from(youtubeChannels)
            .where(and(eq(youtubeChannels.id, input.channelId), eq(youtubeChannels.organizationId, ctx.organizationId)));
          channelYoutubeId = channel?.channelId;
        }

        const result = await listVideosService(
          ctx.user.id,
          {
            channelId: channelYoutubeId,
            containerId: input.containerId === '' ? undefined : input.containerId,
            search: input.search,
            hasDrift: input.hasDrift,
          },
          ctx.organizationId
        );
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data.data;
      }),

    get: orgProcedure
      .input(z.object({ videoId: z.string() }))
      .query(async ({ ctx, input }) => {
        const result = await getVideoService(input.videoId, ctx.user.id, ctx.organizationId);
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    unassigned: orgProcedure.query(async ({ ctx }) => {
      const data = await db
        .select({
          ...getTableColumns(youtubeVideos),
          channel: {
            id: youtubeChannels.id,
            title: youtubeChannels.title,
            userId: youtubeChannels.userId,
            channelId: youtubeChannels.channelId,
          },
        })
        .from(youtubeVideos)
        .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
        .where(and(eq(youtubeChannels.organizationId, ctx.organizationId), isNull(youtubeVideos.containerId)))
        .orderBy(desc(youtubeVideos.publishedAt));

      return data;
    }),

    assignToContainer: orgProcedure
      .input(
        z.object({
          videoId: z.string().uuid(),
          containerId: z.string().uuid(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await assignVideo(
          input.videoId,
          input.containerId,
          ctx.user.id,
          ctx.organizationId
        );
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    getVariables: orgProcedure
      .input(z.object({ videoId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await verifyVideoOwnership(input.videoId, ctx.organizationId);
        const data = await db
          .select({
            ...getTableColumns(videoVariables),
            template: {
              id: templates.id,
              name: templates.name,
              content: templates.content,
            },
          })
          .from(videoVariables)
          .leftJoin(templates, eq(videoVariables.templateId, templates.id))
          .where(eq(videoVariables.videoId, input.videoId));

        // Get video and container info for preview
        const [videoData] = await db
          .select({
            videoId: youtubeVideos.videoId,
            container: {
              id: containers.id,
              templateOrder: containers.templateOrder,
              separator: containers.separator,
            },
          })
          .from(youtubeVideos)
          .leftJoin(containers, eq(youtubeVideos.containerId, containers.id))
          .where(eq(youtubeVideos.id, input.videoId));

        return {
          variables: data,
          video: videoData || null,
        };
      }),

    updateVariables: orgProcedure
      .input(
        z.object({
          videoId: z.string().uuid(),
          variables: z.array(
            z.object({
              templateId: z.string().uuid(),
              name: z.string(),
              value: z.string(),
            })
          ),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await updateVideoVariablesService(
          input.videoId,
          input.variables,
          ctx.user.id,
          ctx.organizationId,
          { force: input.force }
        );
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    getHistory: orgProcedure
      .input(z.object({ videoId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await verifyVideoOwnership(input.videoId, ctx.organizationId);
        const data = await db
          .select()
          .from(descriptionHistory)
          .where(eq(descriptionHistory.videoId, input.videoId))
          .orderBy(desc(descriptionHistory.versionNumber));

        return data;
      }),

    rollback: orgProcedure
      .input(
        z.object({
          videoId: z.string().uuid(),
          historyId: z.string().uuid(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await revertDescriptionService(
          input.videoId,
          input.historyId,
          ctx.user.id,
          ctx.organizationId
        );
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    checkDrift: orgProcedure
      .input(z.object({ videoId: z.string() }))
      .query(async ({ ctx, input }) => {
        const result = await checkDriftService(input.videoId, ctx.user.id, ctx.organizationId);
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    resolveDrift: orgProcedure
      .input(
        z.object({
          videoId: z.string(),
          strategy: z.enum(['keep_youtube_edit', 'reapply_template', 'revert_to_version']),
          historyId: z.string().uuid().optional(),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await resolveDriftService(input.videoId, ctx.user.id, ctx.organizationId, {
          strategy: input.strategy,
          historyId: input.historyId,
          force: input.force,
        });
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    updateToYouTube: orgProcedure
      .input(
        z.object({
          videoIds: z.array(z.string().uuid()),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        for (const videoId of input.videoIds) {
          await verifyVideoOwnership(videoId, ctx.organizationId);
        }
        const result = await pushVideoDescriptions(input.videoIds, ctx.user.id, {
          force: input.force,
          jobContext: { create: { trigger: 'manual_push', label: 'Manual update' } },
        });
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),

    // Manual "Retry now" for a video whose push failed. Resets the attempt
    // budget so the retry gets the full 3h→6h→12h schedule again, then
    // re-enqueues via the normal push path (buildPushPayload flips it back to
    // queued → Updating…). Respects the drift gate like the other push paths.
    retryPush: orgProcedure
      .input(z.object({ videoId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await verifyVideoOwnership(input.videoId, ctx.organizationId);

        const [video] = await db
          .update(youtubeVideos)
          .set({ pushAttempts: 0, nextRetryAt: null, lastPushError: null })
          .where(eq(youtubeVideos.id, input.videoId))
          .returning({
            currentPushJobId: youtubeVideos.currentPushJobId,
            title: youtubeVideos.title,
          });

        // Continue the original job when known; otherwise track this manual
        // retry as a fresh job.
        const jobContext = video?.currentPushJobId
          ? { jobId: video.currentPushJobId }
          : { create: { trigger: 'retry' as const, label: video?.title ?? 'Retry' } };

        const result = await pushVideoDescriptions([input.videoId], ctx.user.id, {
          jobContext,
        });
        if ('error' in result) {
          throwServiceError(result.error);
        }
        return result.data;
      }),
  }),
});
