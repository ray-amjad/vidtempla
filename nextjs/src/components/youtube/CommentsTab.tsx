/**
 * Comments tab — channel-wide comment search and the admin bulk workbench.
 *
 * The primary job: find one comment that repeats across many videos (a pinned
 * course link), select the matches, and rewrite them all in one batch.
 *
 * Comments are never stored (I1), so every search reads YouTube live and costs
 * a credit per page. Nothing here re-reads on its own — window focus, remount
 * and a finished batch all leave the results as they are, because an automatic
 * refetch would spend credits the user did not ask to spend.
 */

import { useMemo, useState } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { youtubeWatchUrl } from '@/utils/youtubeUrls';
import { formatDate, formatNumber } from '@/lib/format';
import { Search, Trash2 } from 'lucide-react';

type CommentThread = RouterOutputs['dashboard']['comments']['search']['items'][number];
type BulkResult = RouterOutputs['dashboard']['comments']['bulkUpdate'];

/**
 * Mirrors `BULK_MAX_ITEMS` in `services/comments.ts` (I5) so the UI can stop the
 * user before the request. The server schema is the enforcement.
 */
const MAX_BULK_ITEMS = 40;

/** Credits per rewritten or deleted comment: 1 snapshot read + 50 write. */
const CREDITS_PER_WRITE = 51;

/** YouTube's per-page ceiling. Every page after the first is a credit the user asks for. */
const PAGE_SIZE = 50;

/**
 * What stopped a batch early, in the user's terms. The three reasons need three
 * different next actions, so they must not be collapsed into one message: only
 * the daily quota is worth waiting until tomorrow for.
 */
function haltMessage(batch: BulkResult): string {
  const skipped = 'The skipped comments were not attempted, so they cost nothing.';
  switch (batch.halted) {
    case 'quota':
      return `The YouTube daily quota ran out. ${skipped} Quota resets ${
        batch.resetsAt ? formatDate(batch.resetsAt) : 'at midnight Pacific'
      }.`;
    case 'rateLimit':
      return `YouTube throttled the batch — a short-term limit, not the daily quota. ${skipped} Search again and rewrite them in about a minute.`;
    case 'credits':
      return `This workspace ran out of credits. ${skipped} Add credits, then search again and rewrite the rest.`;
    case 'timeBudget':
      return `The batch ran out of time before it reached every comment. ${skipped} Search again and rewrite the rest in a smaller batch.`;
    default:
      return '';
  }
}

/** The exact input the search query runs with — the cache key has to match it. */
const searchInputFor = (query: { channelId: string; searchTerms: string } | null) => ({
  channelId: query?.channelId ?? '',
  searchTerms: query?.searchTerms || undefined,
  maxResults: PAGE_SIZE,
});

export default function CommentsTab() {
  const { toast } = useToast();
  const org = useOptionalOrganization();
  /**
   * Cosmetic only. Outside an org-scoped route there is no role in the client
   * context, so the destructive controls stay visible and `orgAdminProcedure`
   * rejects a member who presses them. The server is the gate, never this.
   */
  const canManage = org ? org.isAdmin : true;

  const { data: channels, isLoading: channelsLoading } =
    api.dashboard.youtube.channels.list.useQuery();

  const [channelId, setChannelId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState<{ channelId: string; searchTerms: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [replacementText, setReplacementText] = useState('');
  const [batch, setBatch] = useState<BulkResult | null>(null);

  const activeChannelId = channelId || channels?.[0]?.channelId || '';

  const utils = api.useUtils();

  const search = api.dashboard.comments.search.useInfiniteQuery(
    searchInputFor(query),
    {
      enabled: query !== null,
      getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
      // Each page is a paid YouTube read — only an explicit action fetches one.
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      retry: false,
      onError: (error) =>
        toast({ title: 'Search failed', description: error.message, variant: 'destructive' }),
    }
  );

  const bulkUpdateMutation = api.dashboard.comments.bulkUpdate.useMutation();
  const deleteMutation = api.dashboard.comments.delete.useMutation();

  const threads = useMemo(
    () =>
      (search.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (thread) => !removed.has(thread.snippet.topLevelComment.id)
      ),
    [search.data, removed]
  );

  /**
   * The channel the search ran as. Comments it did not write cannot be
   * rewritten — a batch containing one aborts on the server with nothing
   * written, naming a single ID, so the admin would deselect them one at a time
   * and re-pay a read per item on every retry.
   *
   * The search deliberately still shows them: `allThreadsRelatedToChannelId`
   * returns viewer comments alongside the channel's own, and deleting a
   * third-party comment from your video is a supported action. Only the rewrite
   * selection is restricted.
   */
  const isOwnComment = (thread: CommentThread) =>
    query !== null &&
    thread.snippet.topLevelComment.snippet.authorChannelId?.value === query.channelId;

  const ownThreads = useMemo(
    () => threads.filter(isOwnComment),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, query]
  );

  const runSearch = async () => {
    if (!activeChannelId) return;
    const next = { channelId: activeChannelId, searchTerms: searchInput.trim() };
    setSelected(new Set());
    setRemoved(new Set());
    setBatch(null);
    setQuery(next);
    // Re-running the same search produces a structurally identical query key,
    // and `staleTime: Infinity` would answer it straight from the cache — but
    // this is the one path where the cached text is known to be out of date,
    // because a bulk rewrite just changed it. Drop the cached pages so the
    // button always re-reads page one (1 credit). A different search has no
    // cache under its key, so this is a no-op there.
    await utils.dashboard.comments.search.reset(searchInputFor(next));
  };

  const toggle = (commentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const selectFirstBatch = () => {
    setSelected(
      new Set(ownThreads.slice(0, MAX_BULK_ITEMS).map((t) => t.snippet.topLevelComment.id))
    );
  };

  const handleBulkUpdate = async () => {
    if (!query) return;
    // Filtered again here, not only at the checkbox: a selection made before a
    // later page arrived must never smuggle a foreign comment into the batch.
    const items = ownThreads
      .filter((thread) => selected.has(thread.snippet.topLevelComment.id))
      .slice(0, MAX_BULK_ITEMS)
      .map((thread) => ({
        id: thread.snippet.topLevelComment.id,
        videoId: thread.snippet.videoId,
        text: replacementText,
      }));

    try {
      const result = await bulkUpdateMutation.mutateAsync({ channelId: query.channelId, items });
      setBatch(result);
      setSelected(new Set());
      const failed = result.results.filter((item) => item.status === 'error').length;
      const skipped = result.results.filter((item) => item.status === 'skipped').length;
      toast({
        title: `Rewrote ${result.results.length - failed - skipped} of ${result.results.length} comments`,
        description: `${formatNumber(result.creditsConsumed)} credits used. Search again to see the new text.`,
        ...(failed > 0 ? { variant: 'destructive' as const } : {}),
      });
    } catch (error) {
      toast({
        title: 'Bulk update failed',
        description: error instanceof Error ? error.message : 'Failed to rewrite comments',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (thread: CommentThread) => {
    if (!query) return;
    const commentId = thread.snippet.topLevelComment.id;
    try {
      await deleteMutation.mutateAsync({
        channelId: query.channelId,
        commentId,
        videoId: thread.snippet.videoId,
      });
      setRemoved((prev) => new Set(prev).add(commentId));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
      toast({ title: 'Comment deleted', description: `${CREDITS_PER_WRITE} credits used.` });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Failed to delete comment',
        variant: 'destructive',
      });
    }
  };

  const tooManySelected = selected.size > MAX_BULK_ITEMS;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Search comments</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Reads comments live from YouTube across a whole channel. Each page of results costs 1
            credit.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-64">
              <Label htmlFor="comments-channel">Channel</Label>
              <Select value={activeChannelId} onValueChange={setChannelId}>
                <SelectTrigger id="comments-channel" className="mt-1.5">
                  <SelectValue placeholder={channelsLoading ? 'Loading…' : 'Select a channel'} />
                </SelectTrigger>
                <SelectContent>
                  {channels?.map((channel) => (
                    <SelectItem key={channel.id} value={channel.channelId}>
                      {channel.title ?? channel.channelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label htmlFor="comments-search">Search text</Label>
              <Input
                id="comments-search"
                className="mt-1.5"
                value={searchInput}
                placeholder="e.g. the old course URL"
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch();
                }}
              />
            </div>
            <Button onClick={runSearch} disabled={!activeChannelId || search.isFetching}>
              {search.isFetching ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {canManage && selected.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rewrite {selected.size} selected</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Every comment is rewritten in place with this text. The previous text is recorded
              first. {CREDITS_PER_WRITE} credits per comment —{' '}
              {formatNumber(Math.min(selected.size, MAX_BULK_ITEMS) * CREDITS_PER_WRITE)} for this
              batch.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={replacementText}
              onChange={(event) => setReplacementText(event.target.value)}
              placeholder="New comment text"
              rows={4}
            />
            {tooManySelected && (
              <p className="text-sm text-warning">
                A batch holds at most {MAX_BULK_ITEMS} comments. Only the first {MAX_BULK_ITEMS}{' '}
                selected will be rewritten.
              </p>
            )}
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!replacementText.trim() || bulkUpdateMutation.isPending}>
                    {bulkUpdateMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                    Rewrite {Math.min(selected.size, MAX_BULK_ITEMS)} comments
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rewrite these comments?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This replaces the text of {Math.min(selected.size, MAX_BULK_ITEMS)} comments on
                      YouTube and costs{' '}
                      {formatNumber(Math.min(selected.size, MAX_BULK_ITEMS) * CREDITS_PER_WRITE)}{' '}
                      credits. The previous text of each comment is recorded before the change.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkUpdate}>Rewrite</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="outline" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {batch && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Last batch</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {formatNumber(batch.creditsConsumed)} credits used
              {batch.reconciled.scanned > 0
                ? `, including ${batch.reconciled.scanned} recovered record(s) from an interrupted batch`
                : ''}
              . {batch.halted ? haltMessage(batch) : ''}
            </p>
          </CardHeader>
          <CardContent className="space-y-1">
            {batch.results.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <Badge
                  variant={
                    item.status === 'ok'
                      ? 'success'
                      : item.status === 'skipped'
                        ? 'outline'
                        : 'destructive'
                  }
                >
                  {item.status}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{item.id}</span>
                {item.error && <span className="text-muted-foreground">{item.error.message}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Results</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {query ? `${threads.length} comment(s)` : 'Run a search to see comments.'}
            </p>
          </div>
          {canManage && ownThreads.length > 0 && (
            <Button variant="outline" size="sm" onClick={selectFirstBatch}>
              Select first {Math.min(ownThreads.length, MAX_BULK_ITEMS)}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {search.isLoading && query ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-8 w-8 text-muted-foreground" />
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {query ? 'No comments matched this search.' : 'No search has been run yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {threads.map((thread) => {
                const comment = thread.snippet.topLevelComment;
                const commentId = comment.id;
                const ownComment = isOwnComment(thread);
                return (
                  <div key={commentId} className="flex gap-3 rounded-lg border border-border p-4">
                    {canManage &&
                      (ownComment ? (
                        <Checkbox
                          className="mt-1"
                          checked={selected.has(commentId)}
                          onCheckedChange={() => toggle(commentId)}
                          aria-label="Select comment"
                        />
                      ) : (
                        // Placeholder keeps the rows aligned with the selectable ones.
                        <span className="mt-1 block h-4 w-4 shrink-0" aria-hidden="true" />
                      ))}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{comment.snippet.authorDisplayName}</span>
                        <span className="text-muted-foreground">
                          {formatDate(comment.snippet.publishedAt)}
                        </span>
                        <span className="text-muted-foreground">
                          {formatNumber(comment.snippet.likeCount)} like(s)
                        </span>
                        {thread.snippet.totalReplyCount > 0 && (
                          <span className="text-muted-foreground">
                            {formatNumber(thread.snippet.totalReplyCount)} repl(ies)
                          </span>
                        )}
                        {/* A channel-level thread sits on no video, so there is
                            nothing to link to. */}
                        {thread.snippet.videoId && (
                          <a
                            href={youtubeWatchUrl(thread.snippet.videoId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            Open video
                          </a>
                        )}
                        {canManage && !ownComment && (
                          <span className="text-muted-foreground">
                            Written by someone else — can be deleted, not rewritten
                          </span>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                        {comment.snippet.textOriginal ?? comment.snippet.textDisplay}
                      </p>
                    </div>
                    {canManage && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
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
                              Deletion is permanent and costs {CREDITS_PER_WRITE} credits. YouTube
                              keeps no copy — the record VidTempla writes first is the only one that
                              remains.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(thread)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                );
              })}
              {search.hasNextPage && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => search.fetchNextPage()}
                    disabled={search.isFetchingNextPage}
                  >
                    {search.isFetchingNextPage && <Spinner className="mr-2 h-4 w-4" />}
                    Load more (1 credit)
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
