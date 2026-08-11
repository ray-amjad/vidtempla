/**
 * Comments drawer — the threads on one managed video.
 *
 * Reads live from YouTube when the drawer opens (1 credit) and never again on
 * its own. Members can reply; deleting is admin-only and is enforced by
 * `orgAdminProcedure` on the server, not by the button below.
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useOptionalOrganization } from '@/contexts/OrganizationContext';
import { formatDate, formatNumber } from '@/lib/format';
import { MessageSquare, Trash2 } from 'lucide-react';

interface CommentsDrawerProps {
  /** `youtube_videos.id` — the drawer resolves the YouTube ids server-side. */
  videoId: string;
  videoTitle: string;
  /** `UC…` id of the channel that owns the video, used for replies and deletes. */
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Queries that spend credits must never re-read on their own. */
const PAID_QUERY_OPTIONS = {
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  staleTime: Infinity,
  retry: false,
} as const;

/** YouTube's per-page ceiling. Every page after the first is a credit the user asks for. */
const PAGE_SIZE = 50;

/** The cache key of one thread's replies — must match what `ThreadReplies` queries. */
const repliesInput = (channelId: string, parentId: string) => ({
  channelId,
  parentId,
  maxResults: PAGE_SIZE,
});

/** Replies live behind their own paid read — `commentThreads.list` inlines only a subset. */
function ThreadReplies({ channelId, parentId }: { channelId: string; parentId: string }) {
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    api.dashboard.comments.getReplies.useInfiniteQuery(repliesInput(channelId, parentId), {
      getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
      ...PAID_QUERY_OPTIONS,
    });

  const replies = data?.pages.flatMap((page) => page.items) ?? [];

  if (isLoading) return <Spinner className="h-4 w-4 text-muted-foreground" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (replies.length === 0) return <p className="text-sm text-muted-foreground">No replies.</p>;

  return (
    <div className="space-y-2">
      {replies.map((reply) => (
        <div key={reply.id} className="rounded border border-border p-2">
          <div className="text-sm font-medium">{reply.snippet.authorDisplayName}</div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
            {reply.snippet.textOriginal ?? reply.snippet.textDisplay}
          </p>
        </div>
      ))}
      {hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage && <Spinner className="mr-2 h-4 w-4" />}
          Load more replies (1 credit)
        </Button>
      )}
    </div>
  );
}

export default function CommentsDrawer({
  videoId,
  videoTitle,
  channelId,
  open,
  onOpenChange,
}: CommentsDrawerProps) {
  const { toast } = useToast();
  const org = useOptionalOrganization();
  /** Cosmetic only — `orgAdminProcedure` is the enforcement. */
  const canManage = org ? org.isAdmin : true;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const utils = api.useUtils();

  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    api.dashboard.comments.listForVideo.useInfiniteQuery(
      { videoId, maxResults: PAGE_SIZE },
      {
        enabled: open,
        getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
        ...PAID_QUERY_OPTIONS,
      }
    );

  const replyMutation = api.dashboard.comments.reply.useMutation();
  const deleteMutation = api.dashboard.comments.delete.useMutation();

  const threads = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (thread) => !removed.has(thread.snippet.topLevelComment.id)
  );

  const toggleReplies = (threadId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const handleReply = async (parentId: string) => {
    try {
      const { comment } = await replyMutation.mutateAsync({
        channelId,
        parentId,
        text: replyText,
      });
      // The reply list is a paid read that never refetches on its own, so the
      // new reply has to be put into the cache by hand — otherwise it stays
      // invisible until the user pays to load the page again. When the replies
      // were never expanded there is no cache to seed, and seeding one would
      // pass off a single reply as the whole thread, so leave it untouched.
      utils.dashboard.comments.getReplies.setInfiniteData(
        repliesInput(channelId, parentId),
        (previous) => {
          if (!previous || previous.pages.length === 0) return previous;
          const lastIndex = previous.pages.length - 1;
          return {
            ...previous,
            pages: previous.pages.map((page, index) =>
              index === lastIndex ? { ...page, items: [...page.items, comment] } : page
            ),
          };
        }
      );
      toast({ title: 'Reply posted', description: '50 credits used.' });
      setReplyingTo(null);
      setReplyText('');
    } catch (err) {
      toast({
        title: 'Reply failed',
        description: err instanceof Error ? err.message : 'Failed to post the reply',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (commentId: string, ytVideoId: string) => {
    try {
      await deleteMutation.mutateAsync({ channelId, commentId, videoId: ytVideoId });
      setRemoved((prev) => new Set(prev).add(commentId));
      toast({ title: 'Comment deleted', description: '51 credits used.' });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Failed to delete the comment',
        variant: 'destructive',
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Comments</SheetTitle>
          <p className="text-sm text-muted-foreground">{videoTitle}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-8 w-8 text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive">{error.message}</p>
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No comments on this video.</p>
            </div>
          ) : (
            threads.map((thread) => {
              const comment = thread.snippet.topLevelComment;
              const isExpanded = expanded.has(thread.id);
              return (
                <div key={thread.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{comment.snippet.authorDisplayName}</span>
                    <span className="text-muted-foreground">
                      {formatDate(comment.snippet.publishedAt)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatNumber(comment.snippet.likeCount)} like(s)
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {comment.snippet.textOriginal ?? comment.snippet.textDisplay}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReplyingTo(replyingTo === comment.id ? null : comment.id);
                        setReplyText('');
                      }}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Reply
                    </Button>
                    {thread.snippet.totalReplyCount > 0 && (
                      <Button size="sm" variant="outline" onClick={() => toggleReplies(thread.id)}>
                        {isExpanded
                          ? 'Hide replies'
                          : `Show ${formatNumber(thread.snippet.totalReplyCount)} repl(ies) (1 credit)`}
                      </Button>
                    )}
                    {canManage && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            title="Delete comment"
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Deletion is permanent and costs 51 credits. YouTube keeps no copy —
                              the record VidTempla writes first is the only one that remains.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(comment.id, thread.snippet.videoId)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>

                  {replyingTo === comment.id && (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={replyText}
                        onChange={(event) => setReplyText(event.target.value)}
                        placeholder="Your reply"
                        rows={3}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={!replyText.trim() || replyMutation.isPending}
                          onClick={() => handleReply(comment.id)}
                        >
                          {replyMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                          Post reply (50 credits)
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setReplyingTo(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 border-l-2 border-border pl-3">
                      <ThreadReplies channelId={channelId} parentId={comment.id} />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage && <Spinner className="mr-2 h-4 w-4" />}
                Load more comments (1 credit)
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
