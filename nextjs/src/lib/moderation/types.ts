/**
 * Domain and port types for automatic comment moderation (#156).
 *
 * Types only. `core.ts` imports this file with `import type`, which
 * `node --experimental-strip-types` erases, so the unit tests can load
 * `core.ts` directly. Keep runtime values (constants, enums) out of here —
 * they live in `core.ts`.
 *
 * The port interfaces at the bottom are the seams later phases inject into
 * `core.ts` (applyDecisions, sweepChannel, reclassifyChunk). Adapters —
 * Drizzle, the YouTube client, the TypeSafe SDK — implement them outside
 * `core.ts` and are free to import anything.
 */

import type { YouTubeCommentThread } from "@/lib/clients/youtube";

// ─── Enumerations (mirrored by the text columns in db/schema.ts) ─────────────

/** Rule actions, least to most severe. Severity order lives in core.SEVERITY. */
export type ModerationAction = "flag" | "hold" | "reject" | "ban" | "delete";

/** `youtube_comments.score_status` */
export type ScoreStatus = "pending" | "scoring" | "scored" | "unscored";

/** `youtube_comments.moderation_state` */
export type ModerationState =
  | "none"
  | "flagged"
  | "held"
  | "rejected"
  | "banned"
  | "deleted"
  | "released";

/** `comment_rubrics.status` */
export type RubricStatus = "draft" | "published" | "superseded";

/** `comment_rubric_examples.status` */
export type ExampleStatus = "suggested" | "accepted" | "rejected";

/** Who asked for a moderation action. `auto` = sweep or reclassify. */
export type ActionSource = "auto" | "dashboard";

/** `comment_moderation_actions.status` */
export type ActionStatus =
  | "pending"
  | "applied"
  | "failed"
  | "skipped_non_production";

/** The two capped action classes (I2). `hold` and `flag` are uncapped. */
export type CapClass = "rejectBan" | "delete";

/** Which YouTube text field the stored text came from (as comment_edits). */
export type TextSource = "original" | "display";

// ─── Rules ───────────────────────────────────────────────────────────────────

export interface ModerationRule {
  /** Row id once stored; absent on a rule that is being validated. */
  id?: string;
  label: string;
  /** Inclusive: a probability >= threshold matches. 0..1. */
  threshold: number;
  action: ModerationAction;
}

/** Per-label probabilities as Jev returns them. */
export type LabelProbabilities = Record<string, number>;

export interface RuleMatch {
  rule: ModerationRule;
  probability: number;
}

export interface RuleEvaluation {
  /** The most severe matching action (I3), or null when nothing matched. */
  action: ModerationAction | null;
  /** The rule that produced `action`; null when nothing matched. */
  rule: ModerationRule | null;
  /** Every matching rule, most severe first. */
  matches: RuleMatch[];
}

export interface RuleValidationError {
  index: number;
  field: "label" | "threshold" | "action";
  message: string;
}

export type RuleValidationResult =
  | { ok: true; rules: ModerationRule[]; warnings: string[] }
  | { ok: false; errors: RuleValidationError[] };

// ─── Rubric and Jev ──────────────────────────────────────────────────────────

export interface RubricLabel {
  name: string;
  /** Owner-written description. Goes in the question, never comment text. */
  description: string;
}

/** An accepted example as frozen into a rubric version. */
export interface RubricExample {
  text: string;
  label: string;
}

export interface Rubric {
  version: number;
  labels: RubricLabel[];
  /** Owner-written guidance appended to the question. Never comment text. */
  instructions: string;
}

/**
 * The Choice request core builds. It is VidTempla's own literal, not the
 * SDK's type: the phase-3 adapter (`jev.ts`) translates it to the TypeSafe
 * call. I7: every piece of viewer-authored text (the comment, the video
 * title, the accepted examples) is only inside `state`.
 */
export interface JevChoiceRequest {
  model: string;
  question: string;
  choices: RubricLabel[];
  state: {
    comment: string;
    /** True when `comment` was cut to fit the state limit. */
    commentTruncated: boolean;
    videoTitle: string | null;
    examples: RubricExample[];
  };
}

export interface JevChoiceResult {
  /** The resolved model string (`jev-latest` resolves to a concrete version). */
  model: string;
  choice: string;
  probabilities: LabelProbabilities;
  confidence: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

/** A YouTube comment thread as the listing returns it. */
export type RawCommentThread = YouTubeCommentThread;

/** A viewer comment that passed the ingest filter, ready to store. */
export interface IngestComment {
  commentId: string;
  /** Top-level comment id for a reply; null for a top-level comment. */
  parentId: string | null;
  videoId: string;
  /** Null when YouTube sends no author channel (rare, e.g. removed accounts). */
  authorChannelId: string | null;
  authorDisplayName: string;
  /** Whole text as received; truncation happens only for scoring. */
  text: string;
  textSource: TextSource;
  publishedAt: Date;
}

export interface IngestFilterOptions {
  /** The connected channel's UC… id (I5). */
  ownChannelId: string;
  /** Comments published at or before this instant are dropped. Null = no cursor. */
  cursor: Date | null;
  /** Comment ids already stored; dropped as duplicates. */
  knownCommentIds?: ReadonlySet<string>;
}

export interface IngestFilterResult {
  comments: IngestComment[];
  dropped: {
    ownChannel: number;
    aboutChannel: number;
    beforeCursor: number;
    duplicate: number;
    malformed: number;
  };
}

// ─── Stored rows as core sees them (phase 2/3) ───────────────────────────────

export interface StoredComment {
  /** youtube_comments.id (uuid) */
  id: string;
  youtubeChannelId: string;
  commentId: string;
  parentId: string | null;
  videoId: string;
  authorChannelId: string | null;
  text: string;
  textSource: TextSource;
  scoreStatus: ScoreStatus;
  moderationState: ModerationState;
}

export interface ChannelRef {
  /** youtube_channels.id (uuid) */
  id: string;
  /** UC… id */
  channelId: string;
  organizationId: string | null;
}

export interface ModerationActor {
  source: ActionSource;
  /** Null for automatic actions (I6). */
  userId: string | null;
}

export interface ModerationDecision {
  comment: StoredComment;
  action: ModerationAction | "release";
  ruleId: string | null;
  rubricVersion: number | null;
}

// ─── Ports (implemented by adapters, faked in tests) ─────────────────────────

export interface Clock {
  now(): Date;
}

export interface CreditMeter {
  /** Charge `amount` credits; false when the balance cannot cover it. */
  charge(organizationId: string, amount: number, reason: string): Promise<boolean>;
  refund(organizationId: string, amount: number, reason: string): Promise<void>;
}

export interface QuotaBreaker {
  isTripped(): Promise<boolean>;
  trip(): Promise<void>;
}

export interface JevPort {
  choose(request: JevChoiceRequest): Promise<JevChoiceResult>;
}

export interface YouTubeCommentReader {
  listThreads(
    channelId: string,
    pageToken?: string
  ): Promise<{ items: RawCommentThread[]; nextPageToken?: string }>;
}

/** Only `apply.ts` implements this (I1); everything else goes through it. */
export interface YouTubeModerationPort {
  setModerationStatus(
    commentIds: string[],
    status: "heldForReview" | "published" | "rejected",
    opts: { banAuthor: boolean }
  ): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
}

export interface ModerationCounters {
  /**
   * Atomically reserve up to `requested` slots of today's cap for `capClass`.
   * Returns how many were granted (0..requested).
   */
  reserve(
    youtubeChannelId: string,
    pacificDay: string,
    capClass: CapClass,
    requested: number,
    cap: number
  ): Promise<number>;
}
