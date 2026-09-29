/**
 * Automation status for one channel: the enable switch, the daily-cap pause
 * banner with Resume (I2), the resolved Jev model, the last sweep and today's
 * automatic action counts.
 */

import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime, formatNumber } from '@/lib/format';
import { AlertTriangle } from 'lucide-react';
import { STATE_LABELS, type ModerationOverview } from './shared';

interface OverviewCardProps {
  channelId: string;
  overview: ModerationOverview;
  canManage: boolean;
}

export default function OverviewCard({ channelId, overview, canManage }: OverviewCardProps) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const setAutomation = api.dashboard.moderation.setChannelAutomation.useMutation();
  const resume = api.dashboard.moderation.resumeAutomation.useMutation();

  const handleToggle = async (enabled: boolean) => {
    try {
      const result = await setAutomation.mutateAsync({ channelId, enabled });
      toast({
        title: enabled ? 'Automatic moderation on' : 'Automatic moderation off',
        description: enabled
          ? result.seededRubric
            ? `Rubric v${result.publishedVersion} was published with the default labels and no rules, so new comments are scored but not acted on until you add rules.`
            : 'New comments are scored every 15 minutes. Comments posted before now are not imported.'
          : 'No new comments will be scored or acted on.',
      });
    } catch (error) {
      toast({
        title: 'Could not change automation',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  const handleResume = async () => {
    const classes: ('rejectBan' | 'delete')[] = [];
    if (overview.pausedRejectBan) classes.push('rejectBan');
    if (overview.pausedDelete) classes.push('delete');
    try {
      await resume.mutateAsync({ channelId, classes });
      toast({ title: 'Automation resumed' });
    } catch (error) {
      toast({
        title: 'Could not resume',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  const paused = overview.pausedRejectBan || overview.pausedDelete;
  const pausedClasses = [
    overview.pausedRejectBan ? 'reject and ban' : null,
    overview.pausedDelete ? 'delete' : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Automatic moderation</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Every 15 minutes, new viewer comments are stored and scored with the published rubric
            (1 credit per comment). Matching rules act on them (50 credits per YouTube action).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {setAutomation.isPending && <Spinner className="h-4 w-4" />}
          {canManage ? (
            <>
              <Switch
                id="moderation-enabled"
                checked={overview.enabled}
                disabled={setAutomation.isPending}
                onCheckedChange={(checked) => void handleToggle(checked)}
              />
              <Label htmlFor="moderation-enabled">{overview.enabled ? 'On' : 'Off'}</Label>
            </>
          ) : (
            <Badge variant={overview.enabled ? 'success' : 'outline'}>
              {overview.enabled ? 'On' : 'Off'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {paused && (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                Automatic {pausedClasses.join(' and ')} is paused: today&apos;s cap was reached
                ({overview.today.rejectBanCap} rejects and bans, {overview.today.deleteCap} deletes
                per day). Matching comments are held for review instead until{' '}
                {canManage ? 'you resume' : 'an owner or admin resumes'}.
              </p>
            </div>
            {canManage && (
              <Button size="sm" onClick={handleResume} disabled={resume.isPending}>
                {resume.isPending && <Spinner className="mr-2 h-4 w-4" />}
                Resume
              </Button>
            )}
          </div>
        )}

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Jev model</dt>
            <dd className="font-mono text-xs mt-0.5">{overview.lastModel ?? 'No comment scored yet'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rubric</dt>
            <dd className="mt-0.5">
              {overview.publishedVersion ? `v${overview.publishedVersion} published` : 'None published'}
              {overview.draftVersion ? ` · v${overview.draftVersion} draft` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last run</dt>
            <dd className="mt-0.5">
              {overview.lastRunStatus ?? 'Never run'}
              {overview.lastRunAt ? ` · ${formatDateTime(overview.lastRunAt)}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Automatic today ({overview.today.pacificDay}, Pacific)</dt>
            <dd className="mt-0.5">
              {overview.today.rejectBan}/{overview.today.rejectBanCap} reject or ban ·{' '}
              {overview.today.delete}/{overview.today.deleteCap} delete
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2 text-xs">
          {overview.enabledAt && (
            <span className="text-muted-foreground">
              Enabled since {formatDateTime(overview.enabledAt)}.
            </span>
          )}
          {Object.entries(overview.moderationState).map(([state, n]) => (
            <Badge key={state} variant="outline">
              {STATE_LABELS[state] ?? state}: {formatNumber(n)}
            </Badge>
          ))}
          {(overview.scoreStatus.unscored ?? 0) > 0 && (
            <Badge variant="outline">Unscored: {formatNumber(overview.scoreStatus.unscored ?? 0)}</Badge>
          )}
          {(overview.scoreStatus.pending ?? 0) > 0 && (
            <Badge variant="outline">Waiting to score: {formatNumber(overview.scoreStatus.pending ?? 0)}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
