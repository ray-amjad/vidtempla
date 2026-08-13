import type { YouTubeComment, YouTubeCommentThread } from "@/lib/clients/youtube";

/**
 * Trims YouTube's comment payload to what an agent reads.
 *
 * `YouTubeCommentThread` is a structural claim on the wire format, not a
 * projection — TypeScript strips nothing at runtime, so `kind`, `etag`, the
 * two author image/URL fields, `canRate`, `viewerRating` and a `textDisplay`
 * that duplicates `textOriginal` byte for byte all reach the caller. Twenty
 * threads came to ~63,000 characters that way and blew the MCP tool-result
 * cap.
 *
 * Everything here is pure and total: no throws, no I/O, no defaults invented
 * for missing fields. Field *paths* are unchanged — this only removes keys —
 * except `authorChannelId`, which flattens from `{ value }` to the string.
 *
 * The tool layer applies this; the service layer and the REST surface still
 * return YouTube's payload. `verbose: true` opts back out.
 */

/** A comment with the noise removed. Every field is optional-if-absent upstream. */
export interface LeanCommentSnippet {
  textOriginal?: string;
  textDisplay?: string;
  authorDisplayName: string;
  authorChannelId?: string;
  likeCount?: number;
  publishedAt: string;
  updatedAt?: string;
  parentId?: string;
}

export interface LeanComment {
  id: string;
  snippet: LeanCommentSnippet;
}

export interface LeanThread {
  id: string;
  snippet: {
    videoId?: string;
    canReply?: boolean;
    totalReplyCount: number;
    isPublic: boolean;
    topLevelComment: LeanComment;
  };
  replies?: { comments: LeanComment[] };
}

/** The comment snippet shape both the thread and the standalone resource share. */
type RawCommentSnippet = {
  textDisplay?: string;
  textOriginal?: string;
  authorDisplayName: string;
  authorChannelId?: { value: string };
  likeCount?: number;
  publishedAt: string;
  updatedAt?: string;
  parentId?: string;
};

/**
 * Picks the text fields to emit.
 *
 * `textOriginal` is author-only — YouTube returns it solely to the comment's
 * author, so it is absent on third-party comments. Dropping `textDisplay`
 * unconditionally would leave a viewer's comment with no text at all, so it
 * survives whenever it is the only copy or it actually differs (HTML markup,
 * a link YouTube rewrote). On the channel's own comments the two are usually
 * identical, which is where most of the duplication came from.
 */
function textFields(snippet: RawCommentSnippet): {
  textOriginal?: string;
  textDisplay?: string;
} {
  const { textOriginal, textDisplay } = snippet;
  if (textOriginal === undefined) {
    return textDisplay === undefined ? {} : { textDisplay };
  }
  return textDisplay !== undefined && textDisplay !== textOriginal
    ? { textOriginal, textDisplay }
    : { textOriginal };
}

function leanSnippet(snippet: RawCommentSnippet): LeanCommentSnippet {
  return {
    ...textFields(snippet),
    authorDisplayName: snippet.authorDisplayName,
    ...(snippet.authorChannelId ? { authorChannelId: snippet.authorChannelId.value } : {}),
    ...(snippet.likeCount === undefined ? {} : { likeCount: snippet.likeCount }),
    publishedAt: snippet.publishedAt,
    ...(snippet.updatedAt === undefined ? {} : { updatedAt: snippet.updatedAt }),
    ...(snippet.parentId === undefined ? {} : { parentId: snippet.parentId }),
  };
}

/** Projects a standalone comment resource (`get_comment_replies`). */
export function leanComment(comment: YouTubeComment): LeanComment {
  return { id: comment.id, snippet: leanSnippet(comment.snippet) };
}

/** Projects a comment thread and its inlined replies. */
export function leanThread(thread: YouTubeCommentThread): LeanThread {
  const { snippet } = thread;
  // `canReply` is on the wire but not on the declared interface, so read it
  // structurally rather than widen a type this module does not own.
  const { canReply } = snippet as { canReply?: boolean };
  return {
    id: thread.id,
    snippet: {
      ...(snippet.videoId === undefined ? {} : { videoId: snippet.videoId }),
      ...(canReply === undefined ? {} : { canReply }),
      totalReplyCount: snippet.totalReplyCount,
      isPublic: snippet.isPublic,
      topLevelComment: {
        id: snippet.topLevelComment.id,
        // The inner snippet's own `channelId` and `videoId` duplicate the
        // thread-level fields, so `leanSnippet` never carries them through.
        snippet: leanSnippet(snippet.topLevelComment.snippet),
      },
    },
    ...(thread.replies
      ? { replies: { comments: thread.replies.comments.map(leanComment) } }
      : {}),
  };
}

/**
 * True when `channelId` authored the top-level comment or any inlined reply.
 *
 * The reply clause is not incidental: a channel-wide sweep routinely includes
 * replies the channel wrote inside viewers' threads, and a top-level-only test
 * would hide them and silently under-report the sweep.
 *
 * Runs on the raw thread, before projection, so it behaves the same under
 * `verbose`. YouTube inlines only a partial subset of replies, so a reply-only
 * match can still be missed — `get_comment_replies` is the complete read.
 */
export function threadAuthoredByChannel(
  thread: YouTubeCommentThread,
  channelId: string
): boolean {
  if (thread.snippet.topLevelComment.snippet.authorChannelId?.value === channelId) return true;
  return (thread.replies?.comments ?? []).some(
    (reply) => reply.snippet.authorChannelId?.value === channelId
  );
}
