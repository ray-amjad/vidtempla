/**
 * Held and flagged comments waiting for a person. Owners and admins select
 * comments and hold, reject, ban, delete or release them — every one goes
 * through `applyModerationDecision` on the server (I1). Reject, ban and delete
 * are irreversible on YouTube, so they ask for confirmation with the credit
 * cost first.
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatNumber } from '@/lib/format';
import CommentRow from './CommentRow';
import {
  ACTION_LABELS,
  IRREVERSIBLE,
  MAX_MANUAL_COMMENT_IDS,
  creditsFor,
  summarizeApplyResult,
  type ModerationAction,
} from './shared';

type QueueAction = Exclude<ModerationAction, 'flag'> | 'release';

const QUEUE_ACTIONS: QueueAction[] = ['release', 'hold', 'reject', 'ban', 'delete'];

export default function ReviewQueueCard({
  channelId,
  labels,
  canManage,
}: {
  channelId: string;
  labels: string[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<QueueAction | null>(null);

  const queue = api.dashboard.moderation.reviewQueue.useInfiniteQuery(
    { channelId, limit: 25 },
    { getNextPageParam: (last) => last.cursor ?? undefined }
  );
  const manual = api.dashboard.moderation.applyManualAction.useMutation();
  const release = api.dashboard.moderation.releaseHeldComment.useMutation();
  const busy = manual.isPending || release.isPending;

  const items = queue.data?.pages.flatMap((p) => p.items) ?? [];
  const chosen = items.filter((c) => selected.has(c.id)).slice(0, MAX_MANUAL_COMMENT_IDS);
  const heldChosen = chosen.filter((c) => c.moderationState === 'held').length;
  const flaggedChosen = chosen.filter((c) => c.moderationState === 'flagged').length;

  /** How many selected comments the action can apply to (the rest the server refuses). */
  const eligible = (action: QueueAction) =>
    action === 'release' ? heldChosen : action === 'hold' ? flaggedChosen : chosen.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (action: QueueAction) => {
    const ids = chosen
      .filter((c) =>
        action === 'release' ? c.moderationState === 'held' : action === 'hold' ? c.moderationState === 'flagged' : true
      )
      .map((c) => c.id);
    if (ids.length === 0) return;
    try {
      const result =
        action === 'release'
          ? await release.mutateAsync({ channelId, commentIds: ids })
          : await manual.mutateAsync({ channelId, commentIds: ids, action });
      const summary = summarizeApplyResult(result);
      toast({
        title: summary.title,
        description: summary.description,
        ...(summary.failed ? { variant: 'destructive' as const } : {}),
      });
      setSelected(new Set());
    } catch (error) {
      toast({
        title: `${ACTION_LABELS[action]} failed`,
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  const onAction = (action: QueueAction) => {
    if (IRREVERSIBLE.has(action)) setConfirming(action);
    else void run(action);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Review queue</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Held and flagged comments. Held comments are hidden on YouTube until someone releases,
          rejects or deletes them.{' '}
          {canManage
            ? `Every action except flag is a YouTube write and costs ${creditsFor('hold', 1)} credits per comment.`
            : 'Only owners and admins can act on these; you can suggest a correction.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
            <span className="text-sm">
              {chosen.length} selected
              {selected.size > MAX_MANUAL_COMMENT_IDS ? ` (at most ${MAX_MANUAL_COMMENT_IDS} per action)` : ''}
            </span>
            {QUEUE_ACTIONS.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={IRREVERSIBLE.has(action) ? 'destructive' : 'outline'}
                disabled={busy || eligible(action) === 0}
                onClick={() => onAction(action)}
              >
                {ACTION_LABELS[action]}
                {eligible(action) > 0 ? ` (${eligible(action)})` : ''}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            {busy && <Spinner className="h-4 w-4" />}
          </div>
        )}

        {queue.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : queue.isError ? (
          <p className="text-sm text-destructive">{queue.error.message}</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nothing is waiting for review.</p>
        ) : (
          <div className="space-y-3">
            {items.map((c) => (
              <CommentRow
                key={c.id}
                channelId={channelId}
                comment={c}
                labels={labels}
                selectable={canManage}
                selected={selected.has(c.id)}
                onToggle={() => toggle(c.id)}
              />
            ))}
            {queue.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => queue.fetchNextPage()}
                  disabled={queue.isFetchingNextPage}
                >
                  {queue.isFetchingNextPage && <Spinner className="mr-2 h-4 w-4" />}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? `${ACTION_LABELS[confirming]} ${eligible(confirming)} comment(s)?` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === 'delete'
                ? 'Deletion is permanent. YouTube keeps no copy — the record VidTempla writes first is the only one that remains.'
                : confirming === 'ban'
                  ? 'The comments are rejected and their authors are banned from commenting on this channel. This cannot be undone from VidTempla.'
                  : 'Rejected comments cannot be restored from VidTempla.'}{' '}
              The text of each comment is recorded before the change. This costs{' '}
              {formatNumber(confirming ? creditsFor(confirming, eligible(confirming)) : 0)} credits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                if (action) void run(action);
              }}
            >
              {confirming ? ACTION_LABELS[confirming] : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
