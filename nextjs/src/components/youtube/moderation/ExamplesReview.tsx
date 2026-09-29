/**
 * Suggested examples from corrections. An owner or admin accepts one into the
 * next draft or rejects it; nothing is published automatically.
 */

import { api } from '@/utils/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/format';

export default function ExamplesReview({
  channelId,
  canManage,
  blockedReason,
}: {
  channelId: string;
  canManage: boolean;
  /**
   * Accepting an example rewrites the stored draft, which reloads the rubric
   * form; while the form has unsaved edits, review is blocked so they are not lost.
   */
  blockedReason: string | null;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const suggested = api.dashboard.moderation.examples.useQuery({ channelId, status: 'suggested', limit: 50 });
  const accept = api.dashboard.moderation.acceptExample.useMutation();
  const reject = api.dashboard.moderation.rejectExample.useMutation();
  const busy = accept.isPending || reject.isPending || blockedReason !== null;

  const review = async (exampleId: string, verdict: 'accept' | 'reject') => {
    try {
      if (verdict === 'accept') {
        const r = await accept.mutateAsync({ channelId, exampleId });
        toast({ title: 'Example accepted', description: `Added to draft v${r.draftVersion}. Publish the draft to use it.` });
      } else {
        await reject.mutateAsync({ channelId, exampleId });
        toast({ title: 'Example rejected' });
      }
    } catch (error) {
      toast({
        title: `Could not ${verdict} the example`,
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  const items = suggested.data ?? [];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Suggested examples</p>
      {canManage && blockedReason && <p className="text-xs text-warning">{blockedReason}</p>}
      {suggested.isLoading ? (
        <Spinner className="h-5 w-5 text-muted-foreground" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No suggestions. Use &quot;Suggest correction&quot; on a comment to propose one.
        </p>
      ) : (
        items.map((ex) => (
          <div key={ex.id} className="flex gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{ex.label}</Badge>
                <span className="text-xs text-muted-foreground">{formatDateTime(ex.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{ex.text}</p>
            </div>
            {canManage && (
              <div className="flex shrink-0 flex-col gap-2">
                <Button size="sm" disabled={busy} onClick={() => void review(ex.id, 'accept')}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void review(ex.id, 'reject')}>
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
