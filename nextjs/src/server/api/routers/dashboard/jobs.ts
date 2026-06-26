/**
 * Jobs tRPC router — read-only view of description-push jobs (one batch of
 * per-video pushes triggered by one user action). Org-isolated via orgProcedure.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "@/server/trpc/init";
import {
  listPushJobsService,
  getPushJobItemsService,
} from "@/lib/services/push-jobs";

function throwServiceError(error: { message: string; status: number }): never {
  throw new TRPCError({
    code:
      error.status === 404
        ? "NOT_FOUND"
        : error.status === 403
          ? "FORBIDDEN"
          : error.status === 500
            ? "INTERNAL_SERVER_ERROR"
            : "BAD_REQUEST",
    message: error.message,
  });
}

export const jobsRouter = router({
  list: orgProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().min(1).max(100).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const result = await listPushJobsService({
        userId: ctx.user.id,
        organizationId: ctx.organizationId,
        cursor: input?.cursor,
        limit: input?.limit,
      });
      if ("error" in result) throwServiceError(result.error);
      return result.data;
    }),

  getItems: orgProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getPushJobItemsService(input.jobId, {
        userId: ctx.user.id,
        organizationId: ctx.organizationId,
      });
      if ("error" in result) throwServiceError(result.error);
      return result.data;
    }),
});
