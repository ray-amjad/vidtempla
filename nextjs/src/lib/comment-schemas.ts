import { z } from "zod";
import { BULK_MAX_ITEMS } from "@/lib/services/comments";

/**
 * The one bulk-update input schema, shared by MCP, REST and the dashboard.
 *
 * The three surfaces differ only in transport: a length cap or a `min(1)` that
 * exists on one of them and not the others is a hole, not a policy. MCP needs
 * the raw shape (`server.tool` takes a `ZodRawShape`), the other two need the
 * object — both are built from the same fields.
 */

/** Upper bound on a replacement comment's length; YouTube's own limit is lower. */
export const COMMENT_TEXT_MAX = 10_000;

export const bulkUpdateInputShape = {
  channelId: z
    .string()
    .min(1)
    .describe("YouTube channel ID that authored every comment in the batch (UC...)"),
  items: z
    .array(
      z.object({
        id: z.string().min(1).describe("Comment ID to edit"),
        videoId: z
          .string()
          .min(1)
          .optional()
          .describe("Video the comment sits on, recorded on the snapshot row"),
        text: z.string().min(1).max(COMMENT_TEXT_MAX).describe("Replacement comment text"),
      })
    )
    .min(1)
    .max(BULK_MAX_ITEMS)
    .describe(`Comments to edit, at most ${BULK_MAX_ITEMS} per call`),
};

export const bulkUpdateInputSchema = z.object(bulkUpdateInputShape);
