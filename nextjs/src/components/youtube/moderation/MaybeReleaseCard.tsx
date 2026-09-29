/**
 * "Maybe release" (I4): held comments whose current score matches no rule,
 * usually after a new rubric version re-scored them. Nothing releases them
 * automatically; an owner or admin presses Release.
 */

import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import CommentRow from './CommentRow';
import { MAX_MANUAL_COMMENT_IDS, creditsFor, summarizeApplyResult } from './shared';

export default function MaybeReleaseCard({
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
  const list = api.dashboard.moderation.maybeRelease.useQuery({ channelId, limit: 50 });
  const release = api.dashboard.moderation.releaseHeldComment.useMutation();
  const items = list.data?.items ?? [];

  const handleRelease = async (ids: string[]) => {
    try {
      const result = await release.mutateAsync({ channelId, commentIds: ids.slice(0, MAX_MANUAL_COMMENT_IDS) });
      const summary = summarizeApplyResult(result);
      toast({
        title: summary.title,
        description: summary.description,
        ...(summary.failed ? { variant: 'destructive' as const } : {}),
      });
    } catch (error) {
      toast({
        title: 'Release failed',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Maybe release</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Held comments that no rule matches any more. They stay hidden until released.
            {canManage ? ` Releasing publishes them on YouTube for ${creditsFor('release', 1)} credits each.` : ''}
          </p>
        </div>
        {canManage && items.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            disabled={release.isPending}
            onClick={() => void handleRelease(items.map((c) => c.id))}
          >
            Release all {Math.min(items.length, MAX_MANUAL_COMMENT_IDS)}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : list.isError ? (
          <p className="text-sm text-destructive">{list.error.message}</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No held comment is a release candidate.</p>
        ) : (
          <div className="space-y-3">
            {items.map((c) => (
              <CommentRow
                key={c.id}
                channelId={channelId}
                comment={c}
                labels={labels}
                actions={
                  canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={release.isPending}
                      onClick={() => void handleRelease([c.id])}
                    >
                      Release
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
