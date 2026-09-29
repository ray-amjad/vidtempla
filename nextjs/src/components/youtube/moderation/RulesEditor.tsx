/**
 * Per-label rules `{label, threshold, action}` (Goal 2). A rule matches when
 * the label's probability is >= its threshold; when several match, the most
 * severe action wins (delete > ban > reject > hold > flag). Saving replaces
 * every rule at once. Labels come from the PUBLISHED rubric, which is what the
 * server validates against.
 *
 * Boundary rows from the spec: threshold 0 matches every comment, so it warns;
 * threshold 1 matches only a probability of exactly 1.0.
 */

import { useEffect, useState } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2 } from 'lucide-react';
import { ACTIONS, ACTION_LABELS, percent, type ModerationAction } from './shared';
import { parseThreshold, thresholdNote } from './rule-notes';

interface RuleDraft {
  key: number;
  label: string;
  threshold: string;
  action: ModerationAction;
}

let nextKey = 1;

export default function RulesEditor({
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
  const rules = api.dashboard.moderation.rules.useQuery({ channelId });
  const save = api.dashboard.moderation.setModerationRules.useMutation();
  const [draft, setDraft] = useState<RuleDraft[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!rules.data) return;
    setDraft(
      rules.data.map((r) => ({
        key: nextKey++,
        label: r.label,
        threshold: String(r.threshold),
        action: r.action,
      }))
    );
    setDirty(false);
  }, [rules.data]);

  const update = (key: number, patch: Partial<RuleDraft>) => {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const invalid = draft.some((r) => parseThreshold(r.threshold) === null || !labels.includes(r.label));

  const handleSave = async () => {
    try {
      const result = await save.mutateAsync({
        channelId,
        rules: draft.map((r) => ({
          label: r.label,
          threshold: parseThreshold(r.threshold) ?? -1,
          action: r.action,
        })),
      });
      toast({
        title: `Saved ${result.rules.length} rule(s)`,
        description: result.warnings.length > 0 ? result.warnings.join(' ') : 'New comments are checked against these rules.',
        ...(result.warnings.length > 0 ? { variant: 'destructive' as const } : {}),
      });
      await utils.dashboard.moderation.invalidate();
    } catch (error) {
      toast({
        title: 'Could not save rules',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Rules</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          If a label&apos;s probability is at least the threshold, the action is taken. When several
          rules match, the most severe action wins: delete, then ban, reject, hold, flag. Automatic
          rejects and bans stop at 100 a day and deletes at 10 a day; after that, matches are held.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-muted-foreground" />
          </div>
        ) : labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Rules need a published rubric. Turn on automatic moderation to publish the first one.
          </p>
        ) : !canManage ? (
          draft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules: comments are scored only.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {draft.map((r) => (
                <li key={r.key}>
                  {r.label} ≥ {percent(parseThreshold(r.threshold))} → {ACTION_LABELS[r.action]}
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {draft.length === 0 && (
              <p className="text-sm text-muted-foreground">No rules: comments are scored only.</p>
            )}
            {draft.map((r) => {
              const note = thresholdNote(r.threshold);
              return (
                <div key={r.key} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={r.label} onValueChange={(v) => update(r.key, { label: v })}>
                      <SelectTrigger className="w-40" aria-label="Label">
                        <SelectValue placeholder="Label" />
                      </SelectTrigger>
                      <SelectContent>
                        {labels.map((l) => (
                          <SelectItem key={l} value={l}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">≥</span>
                    <Input
                      className="w-24"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={r.threshold}
                      aria-label="Threshold"
                      onChange={(e) => update(r.key, { threshold: e.target.value })}
                    />
                    <span className="text-sm text-muted-foreground">→</span>
                    <Select value={r.action} onValueChange={(v) => update(r.key, { action: v as ModerationAction })}>
                      <SelectTrigger className="w-48" aria-label="Action">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIONS.map((a) => (
                          <SelectItem key={a} value={a}>
                            {ACTION_LABELS[a]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Remove rule"
                      onClick={() => {
                        setDraft((prev) => prev.filter((x) => x.key !== r.key));
                        setDirty(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {note && (
                    <p
                      className={
                        note.tone === 'error'
                          ? 'text-xs text-destructive'
                          : note.tone === 'warning'
                            ? 'text-xs text-warning'
                            : 'text-xs text-muted-foreground'
                      }
                    >
                      {note.text}
                    </p>
                  )}
                  {!labels.includes(r.label) && (
                    <p className="text-xs text-destructive">
                      &quot;{r.label}&quot; is not a label of the published rubric.
                    </p>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft((prev) => [
                    ...prev,
                    { key: nextKey++, label: labels[0] ?? '', threshold: '0.9', action: 'hold' },
                  ]);
                  setDirty(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add rule
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!dirty || invalid || save.isPending}>
                {save.isPending && <Spinner className="mr-2 h-4 w-4" />}
                Save rules
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
