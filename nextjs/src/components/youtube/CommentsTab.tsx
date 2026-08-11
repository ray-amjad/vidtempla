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

  const search = api.dashboard.comments.search.useInfiniteQuery(
    {
      channelId: query?.channelId ?? '',
      searchTerms: query?.searchTerms || undefined,
      maxResults: 50,
    },
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

  const runSearch = () => {
    if (!activeChannelId) return;
    setSelected(new Set());
    setRemoved(new Set());
    setBatch(null);
    setQuery({ channelId: activeChannelId, searchTerms: searchInput.trim() });
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
    setSelected(new Set(threads.slice(0, MAX_BULK_ITEMS).map((t) => t.snippet.topLevelComment.id)));
  };

  const handleBulkUpdate = async () => {
    if (!query) return;
    const items = threads
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
                  if (event.key === 'Enter') runSearch();
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
              .{' '}
              {batch.resetsAt
                ? `The YouTube quota ran out — the skipped comments were not attempted. Quota resets ${formatDate(batch.resetsAt)}.`
                : ''}
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
          {canManage && threads.length > 0 && (
            <Button variant="outline" size="sm" onClick={selectFirstBatch}>
              Select first {Math.min(threads.length, MAX_BULK_ITEMS)}
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
                return (
                  <div key={commentId} className="flex gap-3 rounded-lg border border-border p-4">
                    {canManage && (
                      <Checkbox
                        className="mt-1"
                        checked={selected.has(commentId)}
                        onCheckedChange={() => toggle(commentId)}
                        aria-label="Select comment"
                      />
                    )}
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
                        <a
                          href={youtubeWatchUrl(thread.snippet.videoId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          Open video
                        </a>
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
