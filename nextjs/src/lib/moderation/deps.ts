/**
 * The real ports behind the sweep, reclassify and dry run (#156).
 *
 * core.ts stays pure; this file wires it to the database (store.ts), the
 * credit ledger, the quota breaker, TypeSafe Jev (jev.ts), the read-only
 * YouTube listing call and the moderation chokepoint (apply.ts).
 *
 * I1: no YouTube comment write is imported here. Every hold, reject, ban and
 * delete goes through `applyModerationDecision`.
 */

import {
  getChannelAccessToken,
  isYouTubeInvalidGrantError,
  isYouTubeQuotaError,
  isYouTubeRateLimitError,
  searchChannelCommentThreads,
} from "@/lib/clients/youtube";
import { getCredits } from "@/lib/plan-limits";
import { chargeCommentCredits, refundCommentCharge } from "@/lib/services/comments";
import { isYouTubeQuotaExhausted, markYouTubeQuotaExhausted } from "@/lib/services/quota-guard";
import { youTubeErrorDetail } from "@/lib/youtube-errors";
import { applyModerationDecision } from "./apply";
import { jevPort } from "./jev";
import { drizzleSweepStore } from "./store";
import type {
  ApplyPort,
  ChannelRef,
  CreditLedger,
  DryRunDeps,
  QuotaBreaker,
  ReclassifyDeps,
  ScoringDeps,
  SweepDeps,
  YouTubeCommentReader,
} from "./types";

/** commentThreads.list page size (the API maximum; 1 quota unit per page). */
const LIST_PAGE_SIZE = 100;

const clock = { now: () => new Date() };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

const credits: CreditLedger = {
  charge: (organizationId, amount) => chargeCommentCredits(organizationId, amount),
  async refund(organizationId, charge) {
    try {
      await refundCommentCharge(organizationId, charge);
    } catch (err) {
      console.error("moderation: refund failed", err);
    }
  },
};

/** Read fail-closed, as apply.ts: a breaker we cannot read counts as tripped. */
const quota: QuotaBreaker = {
  async isTripped() {
    try {
      return await isYouTubeQuotaExhausted();
    } catch (err) {
      console.error("moderation: could not read the quota breaker", err);
      return true;
    }
  },
  trip: () => markYouTubeQuotaExhausted(),
};

async function creditBalance(organizationId: string): Promise<number | null> {
  try {
    const row = await getCredits(organizationId);
    return row ? row.balance : null;
  } catch (err) {
    console.error("moderation: could not read the credit balance", err);
    return null;
  }
}

const apply: ApplyPort = {
  apply: (channel, decisions, opts) =>
    applyModerationDecision(
      channel.id,
      decisions.map((d) => ({
        commentId: d.commentId,
        action: d.action,
        ruleId: d.ruleId,
        rubricVersion: d.rubricVersion,
      })),
      { source: "auto", userId: null },
      { deadlineMs: opts.deadlineMs }
    ),
};

/** Read-only listing; the token is resolved once per step, lazily. */
function youtubeReader(channel: ChannelRef): YouTubeCommentReader {
  let token: Promise<string> | null = null;
  return {
    async listThreads(channelId, pageToken) {
      token ??= getChannelAccessToken(channel.id);
      return searchChannelCommentThreads(await token, channelId, {
        maxResults: LIST_PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      });
    },
  };
}

function classifyListError(err: unknown): { quota: boolean; reason: string } {
  if (isYouTubeQuotaError(err)) return { quota: true, reason: "youtube_quota" };
  if (isYouTubeInvalidGrantError(err)) return { quota: false, reason: "youtube_auth" };
  if (isYouTubeRateLimitError(err)) return { quota: false, reason: "youtube_rate_limited" };
  const detail = youTubeErrorDetail(err);
  // Ids and YouTube's reason only — never comment text or a token.
  console.error("moderation: comment listing failed", {
    upstreamStatus: detail.upstreamStatus,
    reasons: detail.reasons,
  });
  return {
    quota: false,
    reason: detail.upstreamStatus ? `youtube_http_${detail.upstreamStatus}` : "youtube_unreachable",
  };
}

function scoringDeps(): ScoringDeps {
  return { clock, sleep, credits, jev: jevPort };
}

export function sweepDeps(channel: ChannelRef): SweepDeps {
  return {
    ...scoringDeps(),
    creditBalance,
    quota,
    youtube: youtubeReader(channel),
    classifyListError,
    store: drizzleSweepStore,
    apply,
  };
}

export function reclassifyDeps(): ReclassifyDeps {
  return { ...scoringDeps(), creditBalance, quota, apply, store: drizzleSweepStore };
}

export function dryRunDeps(): DryRunDeps {
  return { ...scoringDeps(), store: drizzleSweepStore };
}
