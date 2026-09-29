/**
 * One stored comment with its published-version score, shared by the scores
 * list, the review queue and the "maybe release" list. "Suggest correction"
 * is open to every member: it creates a suggested example that an owner or
 * admin accepts or rejects in the rubric editor.
 */

import type { ReactNode } from 'react';
import { api } from '@/utils/api';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/format';
import { youtubeWatchUrl } from '@/utils/youtubeUrls';
import { STATE_LABELS, percent, stateBadgeVariant, type ModerationComment } from './shared';

interface CommentRowProps {
  channelId: string;
  comment: ModerationComment;
  labels: string[];
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
}

export function SuggestCorrection({
  channelId,
  comment,
  labels,
}: {
  channelId: string;
  comment: ModerationComment;
  labels: string[];
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const suggest = api.dashboard.moderation.suggestCorrection.useMutation();

  const handleSuggest = async (label: string) => {
    try {
      await suggest.mutateAsync({ channelId, commentId: comment.id, label });
      toast({
        title: 'Correction suggested',
        description: `An owner or admin can accept "${label}" as an example for the next rubric version.`,
      });
      await utils.dashboard.moderation.examples.invalidate();
    } catch (error) {
      toast({
        title: 'Could not suggest a correction',
        description: error instanceof Error ? error.message : 'Request failed',
        variant: 'destructive',
      });
    }
  };

  if (labels.length === 0) return null;
  return (
    <Select value="" onValueChange={(v) => void handleSuggest(v)} disabled={suggest.isPending}>
      <SelectTrigger className="h-8 w-44 text-xs" aria-label="Suggest the right label">
        <SelectValue placeholder="Suggest correction" />
      </SelectTrigger>
      <SelectContent>
        {labels.map((label) => (
          <SelectItem key={label} value={label} disabled={label === comment.score?.choice}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function CommentRow({
  channelId,
  comment,
  labels,
  selectable = false,
  selected = false,
  onToggle,
  actions,
}: CommentRowProps) {
  const score = comment.score;
  const top = score
    ? Object.entries(score.probabilities)
        .filter(([, p]) => Number.isFinite(p))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    : [];

  return (
    <div className="flex gap-3 rounded-lg border border-border p-4">
      {selectable ? (
        <Checkbox
          className="mt-1"
          checked={selected}
          onCheckedChange={() => onToggle?.()}
          aria-label="Select comment"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{comment.authorDisplayName}</span>
          <span className="text-muted-foreground">{formatDateTime(comment.publishedAt)}</span>
          {comment.parentId && <span className="text-muted-foreground">Reply</span>}
          <a
            href={youtubeWatchUrl(comment.videoId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Open video
          </a>
          <Badge variant={stateBadgeVariant(comment.moderationState)}>
            {STATE_LABELS[comment.moderationState] ?? comment.moderationState}
          </Badge>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {score ? (
            <>
              <Badge variant="secondary">
                {score.choice} {percent(score.probabilities[score.choice])}
              </Badge>
              {top
                .filter(([label]) => label !== score.choice)
                .map(([label, p]) => (
                  <span key={label} className="text-muted-foreground">
                    {label} {percent(p)}
                  </span>
                ))}
              <span className="text-muted-foreground">
                v{score.rubricVersion} · <span className="font-mono">{score.model}</span>
              </span>
            </>
          ) : (
            <Badge variant="outline">
              {comment.scoreStatus === 'scored' ? 'Not scored by the published version' : comment.scoreStatus}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {actions}
        <SuggestCorrection channelId={channelId} comment={comment} labels={labels} />
      </div>
    </div>
  );
}
