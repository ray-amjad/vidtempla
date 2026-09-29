/**
 * Dry run of the saved rubric draft against stored comments (Goal 3). It costs
 * 1 credit per comment scored (Ray answer 5), so the count is shown before the
 * button is pressed. No YouTube call, no stored score, no action.
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import { formatNumber } from '@/lib/format';
import { DRY_RUN_MAX_COMMENTS, SCORE_CREDITS } from '@/lib/moderation/core';
import { ACTION_LABELS, ACTIONS, percent } from './shared';

type DryRunResult = RouterOutputs['dashboard']['moderation']['dryRunRubric'];

export default function DryRunPanel({
  channelId,
  candidates,
  targetLabel,
  blockedReason,
}: {
  channelId: string;
  /** Stored comments a dry run may score (overview.dryRunCandidates). */
  candidates: number;
  /** e.g. "draft v3" — what the server will score. */
  targetLabel: string;
  /** Why the run cannot start now (unsaved edits), or null. */
  blockedReason: string | null;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const dryRun = api.dashboard.moderation.dryRunRubric.useMutation();
  const [result, setResult] = useState<DryRunResult | null>(null);

  const count = Math.min(candidates, DRY_RUN_MAX_COMMENTS);
  const credits = count * SCORE_CREDITS;

  const handleRun = async () => {
    try {
      const r = await dryRun.mutateAsync({ channelId, limit: Math.max(1, count) });
      setResult(r);
    } catch (error) {
      toast({
        title: 'Dry run failed',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.overview.invalidate();
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">Dry run</p>
          <p className="text-muted-foreground">
            {count === 0
              ? 'There are no scored comments to test against yet.'
              : `Scores the ${formatNumber(count)} most recent stored comment(s) with ${targetLabel} and your current rules. Costs ${formatNumber(credits)} credit(s), 1 per comment scored; a failed call is refunded. Nothing is changed on YouTube.`}
          </p>
          {blockedReason && <p className="text-warning mt-1">{blockedReason}</p>}
        </div>
        <Button
          variant="outline"
          onClick={handleRun}
          disabled={count === 0 || blockedReason !== null || dryRun.isPending}
        >
          {dryRun.isPending && <Spinner className="mr-2 h-4 w-4" />}
          Run dry run ({formatNumber(credits)} credits)
        </Button>
      </div>

      {result && (
        <div className="space-y-2 text-sm">
          <p>
            v{result.rubricVersion} ({result.rubricStatus}): scored {result.scored} of {result.sampled}
            {result.unscored > 0 ? `, ${result.unscored} failed` : ''} · {formatNumber(result.creditsCharged)} credits
            used{result.model ? ` · model ${result.model}` : ''}
            {result.stoppedReason ? ` · stopped early: ${result.stoppedReason}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(result.choices).map(([label, n]) => (
              <Badge key={label} variant="secondary">
                {label}: {n}
              </Badge>
            ))}
          </div>
          <p className="text-muted-foreground">
            Would do:{' '}
            {ACTIONS.map((a) => `${ACTION_LABELS[a]} ${result.byAction[a] ?? 0}`).join(' · ')}
          </p>
          {result.perRule.length > 0 && (
            <ul className="text-muted-foreground">
              {result.perRule.map((r, i) => (
                <li key={`${r.ruleId ?? i}`}>
                  {r.label} ≥ {percent(r.threshold)} → {ACTION_LABELS[r.action]}: matches {r.wouldFire}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
