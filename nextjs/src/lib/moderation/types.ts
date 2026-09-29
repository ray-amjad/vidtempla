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

/**
 * `comment_moderation_actions.status`. `unknown` = the YouTube call failed
 * ambiguously (timeout, 5xx), so it may have landed — the same line
 * `comment_edits` draws. `skipped_non_production` = an automatic decision
 * recorded as would-be outside production (no YouTube call, no credits).
 */
export type ActionStatus =
  | "pending"
  | "applied"
  | "failed"
  | "unknown"
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
  /** Null for automatic actions (I6); the acting user for dashboard actions. */
  userId: string | null;
}

/** What a decision asks for. `release` (held → published) is manual only. */
export type RequestedAction = ModerationAction | "release";

export interface ModerationDecision {
  comment: StoredComment;
  action: RequestedAction;
  ruleId: string | null;
  rubricVersion: number | null;
}

// ─── applyDecisions (phase 2) ────────────────────────────────────────────────

/** Why a decision was refused outright (nothing recorded, nothing charged). */
export type RefusalReason =
  | "no_organization"
  | "wrong_channel"
  | "own_channel"
  | "already_actioned"
  | "release_manual_only"
  | "not_held"
  | "not_stronger"
  | "not_found";

/** Why an action was applied as something weaker than requested. */
export type DegradedReason =
  /** I2: today's cap for the class was reached; the rest degrade to hold. */
  | "cap_reached"
  /** I2: the class was already paused (until an owner or admin resumes). */
  | "paused"
  /** A reject/ban batch failed; its comments were retried one by one as hold. */
  | "batch_failed"
  /** Ban needs an author channel; with none, it degrades to reject. */
  | "no_author";

/**
 * Why a batch stopped before it reached the end. Everything not yet sent is
 * recorded `failed` with this as its error and is not charged.
 * - `quota`: YouTube's daily quota (the breaker is tripped).
 * - `quotaBreaker`: the breaker was already tripped (automatic actor only).
 * - `rateLimit`: a transient throttle.
 * - `auth`: the channel token could not be resolved.
 * - `credits`: the org's balance (or the ledger) refused a charge.
 * - `timeBudget`: the next call could not finish inside the deadline.
 */
export type ApplyHaltReason =
  | "quota"
  | "quotaBreaker"
  | "rateLimit"
  | "auth"
  | "credits"
  | "timeBudget";

export interface ApplyOutcome {
  /** youtube_comments.id */
  commentId: string;
  /** YouTube comment id. */
  youtubeCommentId: string;
  requestedAction: RequestedAction;
  appliedAction: RequestedAction;
  degradedReason: DegradedReason | null;
  status: ActionStatus;
  /** Short machine reason for failed/unknown, e.g. `quota`, `youtube_rejected`. */
  error: string | null;
  ruleId: string | null;
  rubricVersion: number | null;
  /** comment_edits row written before the call (reject, ban, delete only). */
  editId: string | null;
  /** Net credits billed for this comment (0 after a refund). */
  creditsCharged: number;
}

export interface ApplyRefusal {
  commentId: string;
  action: RequestedAction;
  reason: RefusalReason;
}

export interface ApplyResult {
  outcomes: ApplyOutcome[];
  refused: ApplyRefusal[];
  halted: ApplyHaltReason | null;
  /** Classes this call paused because their cap overflowed. */
  paused: CapClass[];
  /** YouTube write calls made (one per batch or single delete). */
  youtubeCalls: number;
}

export interface ApplyInput {
  channel: ChannelRef;
  actor: ModerationActor;
  decisions: readonly ModerationDecision[];
  /**
   * Epoch ms after which no new YouTube call starts. Defaults to
   * now + APPLY_BUDGET_MS; a workflow step passes its own step deadline.
   */
  deadlineMs?: number;
}

/** A comment_edits row as the chokepoint writes it (I6), before the call. */
export interface SnapshotInsert {
  organizationId: string;
  /** Null for automatic actions. */
  userId: string | null;
  /** UC… id of the channel whose token signs the write. */
  channelId: string;
  /** YouTube comment id. */
  commentId: string;
  videoId: string | null;
  verb: "reject" | "ban" | "delete";
  textSource: TextSource;
  /** The stored text that was acted on. */
  beforeText: string;
  source: ActionSource;
}

/** How a thrown YouTube error should be treated. */
export interface YouTubeErrorClass {
  /** YouTube answered 4xx: the write provably did not take effect. */
  definitive: boolean;
  /** A condition that must stop the whole call, or null. */
  halt: "quota" | "rateLimit" | "auth" | null;
}

export interface ApplyDeps {
  clock: Clock;
  /** Automatic YouTube actions run only in production (I10). */
  isProduction(): boolean;
  credits: CreditLedger;
  quota: QuotaBreaker;
  youtube: YouTubeModerationPort;
  counters: ModerationCounters;
  store: ModerationStore;
  classifyError(err: unknown): YouTubeErrorClass;
  /** Wall-clock ceiling of one YouTube call; defaults to 15 000 ms. */
  callTimeoutMs?: number;
}

// ─── Ports (implemented by adapters, faked in tests) ─────────────────────────

export interface Clock {
  now(): Date;
}

/**
 * What one charge did (as services/comments.ts). `refundable` is what may be
 * given back — 0 when nothing was really deducted (the ledger fails open), so
 * a refund can never invent credits.
 */
export interface CreditCharge {
  outcome: "ok" | "insufficient" | "error";
  refundable: number;
}

export interface CreditLedger {
  charge(organizationId: string, amount: number): Promise<CreditCharge>;
  /** Gives back `charge.refundable`; a no-op when it is 0. Never throws. */
  refund(organizationId: string, charge: CreditCharge): Promise<void>;
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

/** YouTube `comments.setModerationStatus` values. */
export type YouTubeModerationStatus = "heldForReview" | "published" | "rejected";

/** Only `apply.ts` implements this (I1); everything else goes through it. */
export interface YouTubeModerationPort {
  /** 1–50 YouTube comment ids; `banAuthor` only with `rejected`. */
  setModerationStatus(
    commentIds: string[],
    status: YouTubeModerationStatus,
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
  /** Gives back slots whose action provably never reached YouTube. */
  release(
    youtubeChannelId: string,
    pacificDay: string,
    capClass: CapClass,
    count: number
  ): Promise<void>;
}

/** The chokepoint's database side (Drizzle adapter in apply.ts). */
export interface ModerationStore {
  /** The I2 pause flags on comment_automation (false when there is no row). */
  getPauseFlags(youtubeChannelId: string): Promise<Record<CapClass, boolean>>;
  setPaused(youtubeChannelId: string, capClass: CapClass): Promise<void>;
  /** Inserts a `pending` comment_edits row; returns its id. Throws on failure. */
  insertSnapshot(row: SnapshotInsert): Promise<string>;
  /** Status-only transition of a snapshot row. Never throws. */
  settleSnapshot(editId: string, status: "applied" | "failed" | "unknown"): Promise<void>;
  /**
   * Appends action-log rows and, for `applied` outcomes, moves
   * youtube_comments.moderation_state (and actioned_at on the first
   * hold/reject/ban/delete). Never throws.
   */
  recordOutcomes(
    channel: ChannelRef,
    actor: ModerationActor,
    outcomes: readonly ApplyOutcome[],
    at: Date
  ): Promise<void>;
}
