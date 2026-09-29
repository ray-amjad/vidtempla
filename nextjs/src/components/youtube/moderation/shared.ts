/**
 * Shared pieces of the Moderation tab (#156): router output types, display
 * names, badge variants and the summary of a chokepoint result.
 *
 * Credit figures come from `lib/moderation/core.ts`, which is pure (type-only
 * imports), so the numbers the UI quotes are the numbers the server charges.
 */

import type { RouterOutputs } from '@/utils/api';
import type { BadgeProps } from '@/components/ui/badge';
import { MODERATION_WRITE_CREDITS } from '@/lib/moderation/core';

export type ModerationOverview = RouterOutputs['dashboard']['moderation']['overview'];
export type ModerationComment =
  RouterOutputs['dashboard']['moderation']['comments']['items'][number];
export type ModerationApplyResult = RouterOutputs['dashboard']['moderation']['applyManualAction'];
export type ModerationRubrics = RouterOutputs['dashboard']['moderation']['rubrics'];

export type ModerationAction = 'flag' | 'hold' | 'reject' | 'ban' | 'delete';

export const ACTIONS: readonly ModerationAction[] = ['flag', 'hold', 'reject', 'ban', 'delete'];

export const ACTION_LABELS: Record<string, string> = {
  flag: 'Flag',
  hold: 'Hold for review',
  reject: 'Reject',
  ban: 'Reject + ban author',
  delete: 'Delete',
  release: 'Release',
};

/** Reject, ban and delete cannot be undone on YouTube, so they need a confirm step. */
export const IRREVERSIBLE: ReadonlySet<string> = new Set(['reject', 'ban', 'delete']);

/** Flag is recorded in VidTempla only; every other action is a YouTube write. */
export function creditsFor(action: string, count: number): number {
  return action === 'flag' ? 0 : count * MODERATION_WRITE_CREDITS;
}

/**
 * Mirrors `MAX_MANUAL_COMMENT_IDS` in `lib/moderation/service.ts` so the UI can
 * stop a selection before the request. The router's zod schema enforces it.
 */
export const MAX_MANUAL_COMMENT_IDS = 50;

export const STATE_LABELS: Record<string, string> = {
  none: 'Published',
  flagged: 'Flagged',
  held: 'Held',
  rejected: 'Rejected',
  banned: 'Rejected + banned',
  deleted: 'Deleted',
  released: 'Released',
};

export function stateBadgeVariant(state: string): BadgeProps['variant'] {
  switch (state) {
    case 'none':
    case 'released':
      return 'outline';
    case 'flagged':
    case 'held':
      return 'warning';
    default:
      return 'destructive';
  }
}

export function statusBadgeVariant(status: string): BadgeProps['variant'] {
  switch (status) {
    case 'applied':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'unknown':
      return 'warning';
    default:
      return 'outline';
  }
}

export const REFUSAL_LABELS: Record<string, string> = {
  no_organization: 'the channel has no workspace',
  wrong_channel: 'belongs to another channel',
  own_channel: "is the channel's own comment",
  already_actioned: 'was already actioned',
  release_manual_only: 'can only be released by a person',
  not_held: 'is not held',
  not_stronger: 'is already in the same or a stronger state',
  not_found: 'was not found',
};

export const HALT_LABELS: Record<string, string> = {
  quota: 'The YouTube daily quota ran out. It resets at midnight Pacific.',
  quotaBreaker: 'The YouTube quota breaker is tripped. It resets at midnight Pacific.',
  rateLimit: 'YouTube throttled the request. Try again in about a minute.',
  auth: 'YouTube refused the channel token, or it could not be read. Reconnect the channel.',
  credits: 'This workspace ran out of credits.',
  ledger: 'Credits could not be checked (a temporary error). Nothing more was charged; try again in a moment.',
  timeBudget: 'The request ran out of time. Send the rest again.',
  disabled: 'Automatic moderation is off for this channel.',
};

export function percent(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(p >= 0.995 && p < 1 ? 1 : 0)}%`;
}

/** One toast worth of text for a manual action or release. */
export function summarizeApplyResult(result: ModerationApplyResult): {
  title: string;
  description: string;
  failed: boolean;
} {
  const applied = result.outcomes.filter((o) => o.status === 'applied').length;
  const failed = result.outcomes.filter((o) => o.status === 'failed').length;
  const unknown = result.outcomes.filter((o) => o.status === 'unknown').length;
  const degraded = result.outcomes.filter((o) => o.degradedReason).length;
  const credits = result.outcomes.reduce((sum, o) => sum + o.creditsCharged, 0);
  const total = result.outcomes.length + result.refused.length;

  const parts = [`${credits} credits used.`];
  if (degraded > 0) parts.push(`${degraded} applied as a weaker action.`);
  if (unknown > 0) parts.push(`${unknown} may or may not have reached YouTube.`);
  if (failed > 0) parts.push(`${failed} failed.`);
  const reasons = new Map<string, number>();
  for (const r of result.refused) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  for (const [reason, n] of reasons) {
    parts.push(`${n} skipped: ${REFUSAL_LABELS[reason] ?? reason}.`);
  }
  if (result.halted) parts.push(HALT_LABELS[result.halted] ?? `Stopped: ${result.halted}.`);

  return {
    title: `Applied to ${applied} of ${total} comment(s)`,
    description: parts.join(' '),
    failed: failed > 0 || unknown > 0 || result.halted !== null,
  };
}

/** Labels a correction may name: the draft's and the published rubric's. */
export function correctionLabels(rubrics: ModerationRubrics | undefined): string[] {
  const names = new Set<string>();
  for (const l of rubrics?.published?.labels ?? []) names.add(l.name);
  for (const l of rubrics?.draft?.labels ?? []) names.add(l.name);
  return [...names];
}
