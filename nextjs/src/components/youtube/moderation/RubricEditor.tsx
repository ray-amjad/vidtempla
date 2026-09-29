/**
 * The rubric: labels with descriptions, instructions and accepted examples
 * (Goal 3). Owners and admins edit a draft, dry-run the SAVED draft (the
 * server scores what is stored, not the form), then publish it as the next
 * version, which re-scores stored comments. Members see the live rubric
 * read-only.
 */

import { useEffect, useState } from 'react';
import { api } from '@/utils/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/format';
import { Plus, Trash2 } from 'lucide-react';
import DryRunPanel from './DryRunPanel';
import ExamplesReview from './ExamplesReview';
import type { ModerationOverview } from './shared';

interface LabelDraft {
  key: number;
  name: string;
  description: string;
}

let nextKey = 1;

export default function RubricEditor({
  channelId,
  overview,
  canManage,
}: {
  channelId: string;
  overview: ModerationOverview;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const rubrics = api.dashboard.moderation.rubrics.useQuery({ channelId, history: 0 });
  const saveDraft = api.dashboard.moderation.saveRubricDraft.useMutation();
  const publish = api.dashboard.moderation.publishRubric.useMutation();

  const draft = rubrics.data?.draft ?? null;
  const published = rubrics.data?.published ?? null;
  const base = draft ?? published;
  const baseKey = base ? `${base.status}:${base.version}:${new Date(base.updatedAt).getTime()}` : 'none';

  const [labels, setLabels] = useState<LabelDraft[]>([]);
  const [instructions, setInstructions] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const resetForm = () => {
    if (!base) return;
    setLabels(base.labels.map((l) => ({ key: nextKey++, name: l.name, description: l.description })));
    setInstructions(base.instructions);
    setRemoved(new Set());
    setDirty(false);
  };

  // Reset the form whenever the stored rubric it was loaded from changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetForm, [baseKey]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const names = labels.map((l) => l.name.trim());
  const duplicate = names.some((n, i) => n !== '' && names.indexOf(n) !== i);
  const labelsInvalid = labels.length < 2 || names.some((n) => n === '') || duplicate;

  const handleSave = async () => {
    try {
      const saved = await saveDraft.mutateAsync({
        channelId,
        labels: labels.map((l) => ({ name: l.name.trim(), description: l.description.trim() })),
        instructions,
        removeExampleIds: [...removed],
      });
      toast({ title: `Draft v${saved.version} saved`, description: 'Dry-run it, then publish when it looks right.' });
    } catch (error) {
      toast({
        title: 'Could not save the draft',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  const handlePublish = async () => {
    try {
      const r = await publish.mutateAsync({ channelId });
      toast({
        title: `Rubric v${r.version} published`,
        description: r.reclassifyStarted
          ? 'Stored comments are being re-scored with it.'
          : 'Re-scoring of stored comments was not started (it runs in production only).',
      });
    } catch (error) {
      toast({
        title: 'Could not publish',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      await utils.dashboard.moderation.invalidate();
    }
  };

  const examples = (base?.examples ?? []).filter((e) => !(e.exampleId && removed.has(e.exampleId)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Rubric</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          {published
            ? `v${published.version} is live${published.publishedAt ? `, published ${formatDateTime(published.publishedAt)}` : ''}.`
            : 'No rubric is published yet. Turning on automatic moderation publishes v1 with the default labels.'}
          {draft ? ` Draft v${draft.version} is not live yet.` : ''} Comment text is sent to Jev as data
          only; labels and instructions are the question.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {rubrics.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-muted-foreground" />
          </div>
        ) : !base ? null : (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Labels</p>
                <Badge variant="outline">{draft ? `draft v${draft.version}` : `published v${base.version}`}</Badge>
              </div>
              {labels.map((l) => (
                <div key={l.key} className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="sm:w-44"
                    value={l.name}
                    maxLength={40}
                    placeholder="label"
                    aria-label="Label name"
                    readOnly={!canManage}
                    onChange={(e) =>
                      edit(setLabels)(labels.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="flex-1"
                    value={l.description}
                    maxLength={500}
                    placeholder="What this label means"
                    aria-label="Label description"
                    readOnly={!canManage}
                    onChange={(e) =>
                      edit(setLabels)(
                        labels.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x))
                      )
                    }
                  />
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      title="Remove label"
                      onClick={() => edit(setLabels)(labels.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {canManage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={labels.length >= 20}
                    onClick={() => edit(setLabels)([...labels, { key: nextKey++, name: '', description: '' }])}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add label
                  </Button>
                  {labelsInvalid && (
                    <p className="text-xs text-destructive">
                      A rubric needs 2 to 20 labels, each with a unique, non-empty name.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="rubric-instructions">Instructions</Label>
              <Textarea
                id="rubric-instructions"
                rows={4}
                maxLength={2000}
                value={instructions}
                readOnly={!canManage}
                placeholder="Optional guidance for the classifier, e.g. what counts as self-promotion on this channel."
                onChange={(e) => edit(setInstructions)(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Examples in this version ({examples.length})</p>
              {examples.length === 0 ? (
                <p className="text-sm text-muted-foreground">No examples yet. Accept a suggested one below.</p>
              ) : (
                examples.map((ex, i) => (
                  <div key={ex.exampleId ?? `ex-${i}`} className="flex items-start gap-2 text-sm">
                    <Badge variant="secondary">{ex.label}</Badge>
                    <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{ex.text}</p>
                    {canManage && ex.exampleId && (
                      <Button
                        variant="outline"
                        size="sm"
                        title="Remove from the draft"
                        onClick={() => edit(setRemoved)(new Set(removed).add(ex.exampleId!))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleSave} disabled={!dirty || labelsInvalid || saveDraft.isPending}>
                  {saveDraft.isPending && <Spinner className="mr-2 h-4 w-4" />}
                  Save draft
                </Button>
                {dirty && (
                  <Button variant="ghost" onClick={resetForm} disabled={saveDraft.isPending}>
                    Discard changes
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={!draft || dirty || publish.isPending}>
                      {publish.isPending && <Spinner className="mr-2 h-4 w-4" />}
                      {draft ? `Publish v${draft.version}` : 'Publish'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Publish draft v{draft?.version}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        New comments are scored with it from now on. Stored comments are re-scored
                        with it at 1 credit each and no YouTube reads. Your rules then act on
                        re-scored comments that were never actioned (50 credits per YouTube
                        action), and held comments that no longer match a rule appear under
                        &quot;Maybe release&quot;.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handlePublish}>Publish</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {!draft && !dirty && (
                  <span className="text-xs text-muted-foreground">Save a draft to publish a new version.</span>
                )}
              </div>
            )}

            {canManage && (
              <DryRunPanel
                channelId={channelId}
                candidates={overview.dryRunCandidates}
                targetLabel={draft ? `draft v${draft.version}` : `published v${base.version}`}
                blockedReason={dirty ? 'Save the draft first: a dry run scores the saved draft.' : null}
              />
            )}
          </>
        )}

        <ExamplesReview
          channelId={channelId}
          canManage={canManage}
          blockedReason={dirty ? 'Save or discard your rubric edits before you review examples.' : null}
        />
      </CardContent>
    </Card>
  );
}
