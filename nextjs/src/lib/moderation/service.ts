/**
 * Moderation service operations (#156) behind the dashboard router.
 *
 * - Role checks are the router's job (I9: orgAdminProcedure on every
 *   mutation except suggestCorrection). Every function here takes the org and
 *   user ids and scopes each query to a channel that belongs to that org.
 * - `channelId` is always `youtube_channels.id` (uuid).
 * - Every hold, reject, ban, delete and release goes through
 *   `applyModerationDecision` (I1). No YouTube write is imported here.
 * - The sweep started by `setChannelAutomation` and the reclassify started by
 *   `publishRubric` start only when VERCEL_ENV === "production"; the
 *   chokepoint's own production gate is the backstop.
 * - Reclassify runs only while automation is enabled. A rubric published on a
 *   disabled channel is reclassified when the owner turns automation back on
 *   (`setChannelAutomation` starts it for the published version).
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { start } from "workflow/api";
import { db } from "@/db";
import {
  commentAutomation,
  commentModerationRules,
  commentRubricExamples,
  commentRubrics,
  youtubeChannels,
  youtubeComments,
} from "@/db/schema";
import type { ServiceResult } from "@/lib/services/types";
import { commentReclassifyWorkflow } from "@/workflows/comment-reclassify";
import { commentSweepChannelWorkflow } from "@/workflows/comment-sweep";
import { applyModerationDecision } from "./apply";
import { DEFAULT_LABELS, DRY_RUN_MAX_COMMENTS, MODERATION_ACTIONS, dryRun, validateRules } from "./core";
import { dryRunDeps } from "./deps";
import { drizzleSweepStore, parseRubricLabels } from "./store";
import type {
  ApplyResult,
  ChannelRef,
  DryRunResult,
  ModerationAction,
  ModerationRule,
  RubricLabel,
  ScoringRubric,
} from "./types";

// ─── Shared ──────────────────────────────────────────────────────────────────

/** Who is calling: the router has already checked the role. */
export interface ModerationCtx {
  organizationId: string;
  userId: string;
}

/** A label set needs at least two choices for Jev to choose between. */
export const MIN_RUBRIC_LABELS = 2;
export const MAX_RUBRIC_LABELS = 20;
export const MAX_LABEL_NAME_CHARS = 40;
export const MAX_LABEL_DESCRIPTION_CHARS = 500;
export const MAX_INSTRUCTIONS_CHARS = 2_000;
export const MAX_RULES = 50;
/** Ids per release / manual action call (one chokepoint batch). */
export const MAX_MANUAL_COMMENT_IDS = 50;

type Err = Extract<ServiceResult<never>, { error: unknown }>;

function fail(code: string, message: string, suggestion: string, status: number): Err {
  return { error: { code, message, suggestion, status } };
}

const channelNotFound = () =>
  fail(
    "NOT_FOUND",
    "Channel not found in this organization.",
    "List the organization's channels and pass a youtube_channels id.",
    404
  );

const isProduction = () => process.env.VERCEL_ENV === "production";

/** The channel, only when it belongs to the caller's org. */
async function resolveChannel(ctx: ModerationCtx, channelId: string): Promise<ChannelRef | null> {
  const [row] = await db
    .select({
      id: youtubeChannels.id,
      channelId: youtubeChannels.channelId,
      organizationId: youtubeChannels.organizationId,
    })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.id, channelId), eq(youtubeChannels.organizationId, ctx.organizationId)));
  return row ?? null;
}

/** An example as frozen into a rubric's `examples` jsonb (id kept for bookkeeping). */
interface StoredRubricExample {
  exampleId: string | null;
  text: string;
  label: string;
}

function parseStoredExamples(value: unknown): StoredRubricExample[] {
  if (!Array.isArray(value)) return [];
  const out: StoredRubricExample[] = [];
  for (const e of value) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.text !== "string" || typeof r.label !== "string") continue;
    out.push({ exampleId: typeof r.exampleId === "string" ? r.exampleId : null, text: r.text, label: r.label });
  }
  return out;
}

/** Validates an owner label set. Returns the clean copy or a message. */
export function validateLabels(input: unknown): { labels: RubricLabel[] } | { message: string } {
  if (!Array.isArray(input) || input.length === 0) return { message: "The rubric needs at least one label." };
  if (input.length < MIN_RUBRIC_LABELS) return { message: `The rubric needs at least ${MIN_RUBRIC_LABELS} labels.` };
  if (input.length > MAX_RUBRIC_LABELS) return { message: `The rubric allows at most ${MAX_RUBRIC_LABELS} labels.` };
  const seen = new Set<string>();
  const labels: RubricLabel[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { message: "Each label must be an object with a name." };
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const description = typeof r.description === "string" ? r.description.trim() : "";
    if (!name) return { message: "Every label needs a name." };
    if (name.length > MAX_LABEL_NAME_CHARS) return { message: `Label names are at most ${MAX_LABEL_NAME_CHARS} characters.` };
    if (description.length > MAX_LABEL_DESCRIPTION_CHARS) {
      return { message: `Label descriptions are at most ${MAX_LABEL_DESCRIPTION_CHARS} characters.` };
    }
    if (seen.has(name)) return { message: `Label "${name}" appears twice.` };
    seen.add(name);
    labels.push({ name, description });
  }
  return { labels };
}

// ─── Automation ──────────────────────────────────────────────────────────────

export interface AutomationSettings {
  enabled: boolean;
  enabledAt: Date | null;
  cursor: Date | null;
  pausedRejectBan: boolean;
  pausedDelete: boolean;
  /** Published rubric version, or null. */
  publishedVersion: number | null;
  /** True when this call seeded and published rubric v1. */
  seededRubric: boolean;
  /** True when this call started a sweep run (production only). */
  sweepStarted: boolean;
}

/**
 * Turns automatic moderation on or off for one channel.
 *
 * Enabling (from off) sets `enabledAt` and `cursor` to now, so comments posted
 * before enable are never imported. On the channel's first enable — no rubric
 * at all — it seeds and PUBLISHES v1 with DEFAULT_LABELS and no rules, so the
 * channel only scores until the owner adds rules.
 */
export async function setChannelAutomation(
  ctx: ModerationCtx,
  input: { channelId: string; enabled: boolean }
): Promise<ServiceResult<AutomationSettings>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ enabled: commentAutomation.enabled })
      .from(commentAutomation)
      .where(eq(commentAutomation.youtubeChannelId, channel.id))
      .for("update");
    const turningOn = input.enabled && !existing?.enabled;

    let seededRubric = false;
    if (turningOn) {
      const [anyRubric] = await tx
        .select({ id: commentRubrics.id })
        .from(commentRubrics)
        .where(eq(commentRubrics.youtubeChannelId, channel.id))
        .limit(1);
      if (!anyRubric) {
        await tx.insert(commentRubrics).values({
          youtubeChannelId: channel.id,
          version: 1,
          status: "published",
          labels: DEFAULT_LABELS.map((l) => ({ name: l.name, description: l.description })),
          instructions: "",
          examples: [],
          publishedAt: now,
          publishedBy: ctx.userId,
          updatedAt: now,
        });
        seededRubric = true;
      }
    }

    const set = turningOn
      ? { enabled: true, enabledAt: now, cursor: now, listingPageToken: null, listingNewest: null, updatedAt: now }
      : { enabled: input.enabled, updatedAt: now };
    const [row] = await tx
      .insert(commentAutomation)
      .values({ youtubeChannelId: channel.id, ...set })
      .onConflictDoUpdate({ target: commentAutomation.youtubeChannelId, set })
      .returning({
        enabled: commentAutomation.enabled,
        enabledAt: commentAutomation.enabledAt,
        cursor: commentAutomation.cursor,
        pausedRejectBan: commentAutomation.pausedRejectBan,
        pausedDelete: commentAutomation.pausedDelete,
      });
    return { row: row!, turningOn, seededRubric };
  });

  const published = await drizzleSweepStore.getPublishedRubric(channel.id);
  let sweepStarted = false;
  if (result.turningOn && isProduction()) {
    try {
      await start(commentSweepChannelWorkflow, [channel.id]);
      sweepStarted = true;
    } catch (err) {
      // The 15-minute cron picks the channel up anyway.
      console.error("moderation: could not start the first sweep", err instanceof Error ? err.name : "unknown");
    }
    // A rubric published while automation was off never reclassified the
    // stored comments. Reclassify only takes comments with no score for this
    // version, so a version already reclassified costs one empty page.
    if (published && !result.seededRubric) {
      try {
        await start(commentReclassifyWorkflow, [channel.id, published.version]);
      } catch (err) {
        console.error("moderation: could not start reclassify", err instanceof Error ? err.name : "unknown");
      }
    }
  }

  return {
    data: {
      ...result.row,
      publishedVersion: published?.version ?? null,
      seededRubric: result.seededRubric,
      sweepStarted,
    },
  };
}

/** Clears the cap pause flags (both by default) so matches act again. */
export async function resumeAutomation(
  ctx: ModerationCtx,
  input: { channelId: string; classes?: ("rejectBan" | "delete")[] }
): Promise<ServiceResult<{ pausedRejectBan: boolean; pausedDelete: boolean }>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const classes = input.classes && input.classes.length > 0 ? input.classes : ["rejectBan", "delete"];
  const [row] = await db
    .update(commentAutomation)
    .set({
      ...(classes.includes("rejectBan") ? { pausedRejectBan: false } : {}),
      ...(classes.includes("delete") ? { pausedDelete: false } : {}),
      updatedAt: new Date(),
    })
    .where(eq(commentAutomation.youtubeChannelId, channel.id))
    .returning({ pausedRejectBan: commentAutomation.pausedRejectBan, pausedDelete: commentAutomation.pausedDelete });
  if (!row) {
    return fail("NOT_ENABLED", "Automation has never been enabled for this channel.", "Enable automation first.", 409);
  }
  return { data: row };
}

// ─── Rules ───────────────────────────────────────────────────────────────────

/**
 * Replaces the channel's rules atomically. Labels are checked against the
 * PUBLISHED rubric (the one the sweep scores with).
 */
export async function setModerationRules(
  ctx: ModerationCtx,
  input: { channelId: string; rules: unknown[] }
): Promise<ServiceResult<{ rules: ModerationRule[]; warnings: string[] }>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  if (!Array.isArray(input.rules) || input.rules.length > MAX_RULES) {
    return fail("INVALID_RULES", `Pass an array of at most ${MAX_RULES} rules.`, "Remove some rules.", 400);
  }
  const rubric = await drizzleSweepStore.getPublishedRubric(channel.id);
  if (!rubric) {
    return fail("NO_PUBLISHED_RUBRIC", "This channel has no published rubric.", "Enable automation or publish a rubric first.", 409);
  }
  const checked = validateRules(input.rules, rubric.labels.map((l) => l.name));
  if (!checked.ok) {
    return {
      error: {
        code: "INVALID_RULES",
        message: checked.errors.map((e) => `Rule ${e.index + 1}: ${e.message}`).join(" "),
        suggestion: `Use a label from the published rubric (${rubric.labels.map((l) => l.name).join(", ")}), a threshold from 0 to 1, and one of ${MODERATION_ACTIONS.join(", ")}.`,
        status: 400,
        meta: { errors: checked.errors.map((e) => ({ index: e.index, field: e.field, message: e.message })) },
      },
    };
  }

  const saved = await db.transaction(async (tx) => {
    await tx.delete(commentModerationRules).where(eq(commentModerationRules.youtubeChannelId, channel.id));
    if (checked.rules.length === 0) return [];
    return tx
      .insert(commentModerationRules)
      .values(checked.rules.map((r) => ({ youtubeChannelId: channel.id, label: r.label, threshold: r.threshold, action: r.action })))
      .returning({
        id: commentModerationRules.id,
        label: commentModerationRules.label,
        threshold: commentModerationRules.threshold,
        action: commentModerationRules.action,
      });
  });
  return {
    data: {
      rules: saved.map((r) => ({ ...r, action: r.action as ModerationAction })),
      warnings: checked.warnings,
    },
  };
}

// ─── Rubric ──────────────────────────────────────────────────────────────────

export interface RubricDraft {
  version: number;
  labels: RubricLabel[];
  instructions: string;
  examples: { exampleId: string | null; text: string; label: string }[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The channel's draft, created from the published version (plus accepted
 * examples not yet published) when there is none. Runs inside `tx`.
 */
async function getOrCreateDraft(tx: Tx, channelId: string): Promise<{ id: string } & RubricDraft> {
  const [draft] = await tx
    .select({
      id: commentRubrics.id,
      version: commentRubrics.version,
      labels: commentRubrics.labels,
      instructions: commentRubrics.instructions,
      examples: commentRubrics.examples,
    })
    .from(commentRubrics)
    .where(and(eq(commentRubrics.youtubeChannelId, channelId), eq(commentRubrics.status, "draft")))
    .for("update");
  if (draft) {
    return {
      id: draft.id,
      version: draft.version,
      labels: parseRubricLabels(draft.labels),
      instructions: draft.instructions,
      examples: parseStoredExamples(draft.examples),
    };
  }

  const [latest] = await tx
    .select({
      version: commentRubrics.version,
      status: commentRubrics.status,
      labels: commentRubrics.labels,
      instructions: commentRubrics.instructions,
      examples: commentRubrics.examples,
    })
    .from(commentRubrics)
    .where(eq(commentRubrics.youtubeChannelId, channelId))
    .orderBy(desc(commentRubrics.version))
    .limit(1);
  const [published] = await tx
    .select({ labels: commentRubrics.labels, instructions: commentRubrics.instructions, examples: commentRubrics.examples })
    .from(commentRubrics)
    .where(and(eq(commentRubrics.youtubeChannelId, channelId), eq(commentRubrics.status, "published")));

  const base = published ?? latest;
  const labels = base ? parseRubricLabels(base.labels) : DEFAULT_LABELS.map((l) => ({ ...l }));
  const examples = base ? parseStoredExamples(base.examples) : [];
  const known = new Set(examples.map((e) => e.exampleId).filter(Boolean));
  const accepted = await tx
    .select({ id: commentRubricExamples.id, text: commentRubricExamples.text, label: commentRubricExamples.label })
    .from(commentRubricExamples)
    .where(
      and(
        eq(commentRubricExamples.youtubeChannelId, channelId),
        eq(commentRubricExamples.status, "accepted"),
        isNull(commentRubricExamples.includedInVersion)
      )
    )
    .orderBy(commentRubricExamples.createdAt);
  for (const a of accepted) {
    if (!known.has(a.id)) examples.push({ exampleId: a.id, text: a.text, label: a.label });
  }

  const version = (latest?.version ?? 0) + 1;
  const [row] = await tx
    .insert(commentRubrics)
    .values({
      youtubeChannelId: channelId,
      version,
      status: "draft",
      labels,
      instructions: base?.instructions ?? "",
      examples,
      updatedAt: new Date(),
    })
    .returning({ id: commentRubrics.id });
  return { id: row!.id, version, labels, instructions: base?.instructions ?? "", examples };
}

/**
 * Saves the draft's labels and instructions (creating the draft from the
 * published version when needed). Examples are managed by accept/reject;
 * pass `removeExampleIds` to drop accepted examples from this draft.
 */
export async function saveRubricDraft(
  ctx: ModerationCtx,
  input: { channelId: string; labels: unknown; instructions: string; removeExampleIds?: string[] }
): Promise<ServiceResult<RubricDraft>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const checked = validateLabels(input.labels);
  if ("message" in checked) {
    return fail("INVALID_RUBRIC", checked.message, "Give each label a unique name and a short description.", 400);
  }
  const instructions = (input.instructions ?? "").trim();
  if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return fail("INVALID_RUBRIC", `Instructions are at most ${MAX_INSTRUCTIONS_CHARS} characters.`, "Shorten the instructions.", 400);
  }
  const remove = new Set(input.removeExampleIds ?? []);

  const draft = await db.transaction(async (tx) => {
    const d = await getOrCreateDraft(tx, channel.id);
    const examples = d.examples.filter((e) => !(e.exampleId && remove.has(e.exampleId)));
    await tx
      .update(commentRubrics)
      .set({ labels: checked.labels, instructions, examples, updatedAt: new Date() })
      .where(eq(commentRubrics.id, d.id));
    // An accepted example that was never published is re-added to every new
    // draft (getOrCreateDraft) until something records that it was dropped.
    // Removing it from the draft is that record: it becomes `rejected`.
    const removed = d.examples
      .map((e) => e.exampleId)
      .filter((id): id is string => Boolean(id && remove.has(id)));
    if (removed.length > 0) {
      await tx
        .update(commentRubricExamples)
        .set({ status: "rejected", reviewedBy: ctx.userId, reviewedAt: new Date() })
        .where(
          and(
            eq(commentRubricExamples.youtubeChannelId, channel.id),
            inArray(commentRubricExamples.id, removed),
            eq(commentRubricExamples.status, "accepted"),
            isNull(commentRubricExamples.includedInVersion)
          )
        );
    }
    return { version: d.version, labels: checked.labels, instructions, examples };
  });
  return { data: draft };
}

/**
 * Makes the draft the live version, in one transaction: the old published
 * row becomes `superseded` BEFORE the draft flips (the partial unique
 * indexes allow one published and one draft per channel). Refuses when there
 * is no draft, an invalid label set, or a rule on a label the draft drops.
 * Accepted examples frozen into it get `includedInVersion`.
 */
export async function publishRubric(
  ctx: ModerationCtx,
  input: { channelId: string }
): Promise<ServiceResult<{ version: number; reclassifyStarted: boolean }>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const now = new Date();

  const outcome = await db.transaction(async (tx): Promise<Err | { version: number }> => {
    const [draft] = await tx
      .select({ id: commentRubrics.id, version: commentRubrics.version, labels: commentRubrics.labels, examples: commentRubrics.examples })
      .from(commentRubrics)
      .where(and(eq(commentRubrics.youtubeChannelId, channel.id), eq(commentRubrics.status, "draft")))
      .for("update");
    if (!draft) return fail("NO_DRAFT", "There is no draft rubric to publish.", "Save a draft first.", 409);
    const checked = validateLabels(draft.labels);
    if ("message" in checked) {
      return fail("INVALID_RUBRIC", checked.message, "Fix the draft's labels and save it again.", 400);
    }
    const names = new Set(checked.labels.map((l) => l.name));
    const rules = await tx
      .select({ label: commentModerationRules.label })
      .from(commentModerationRules)
      .where(eq(commentModerationRules.youtubeChannelId, channel.id));
    const orphaned = [...new Set(rules.map((r) => r.label).filter((l) => !names.has(l)))];
    if (orphaned.length > 0) {
      return fail(
        "RULES_USE_REMOVED_LABEL",
        `Rules use labels the draft removes: ${orphaned.join(", ")}.`,
        "Remove or change those rules, or keep the labels in the draft.",
        409
      );
    }

    await tx
      .update(commentRubrics)
      .set({ status: "superseded", updatedAt: now })
      .where(and(eq(commentRubrics.youtubeChannelId, channel.id), eq(commentRubrics.status, "published")));
    await tx
      .update(commentRubrics)
      .set({ status: "published", publishedAt: now, publishedBy: ctx.userId, updatedAt: now })
      .where(eq(commentRubrics.id, draft.id));

    const exampleIds = parseStoredExamples(draft.examples)
      .map((e) => e.exampleId)
      .filter((id): id is string => Boolean(id));
    if (exampleIds.length > 0) {
      await tx
        .update(commentRubricExamples)
        .set({ includedInVersion: draft.version })
        .where(
          and(
            eq(commentRubricExamples.youtubeChannelId, channel.id),
            inArray(commentRubricExamples.id, exampleIds),
            isNull(commentRubricExamples.includedInVersion)
          )
        );
    }
    return { version: draft.version };
  });
  if ("error" in outcome) return outcome;

  // Reclassify is automatic moderation: not on a disabled channel. Turning
  // automation on starts it for the published version (setChannelAutomation).
  const [automation] = await db
    .select({ enabled: commentAutomation.enabled })
    .from(commentAutomation)
    .where(eq(commentAutomation.youtubeChannelId, channel.id));
  let reclassifyStarted = false;
  if (automation?.enabled && isProduction()) {
    try {
      await start(commentReclassifyWorkflow, [channel.id, outcome.version]);
      reclassifyStarted = true;
    } catch (err) {
      console.error("moderation: could not start reclassify", err instanceof Error ? err.name : "unknown");
    }
  }
  return { data: { version: outcome.version, reclassifyStarted } };
}

/**
 * Scores up to DRY_RUN_MAX_COMMENTS recent stored comments with the draft
 * (or the published rubric when there is no draft) and returns would-fire
 * counts. 1 credit per comment scored; no YouTube call; no stored score.
 * `rules` defaults to the channel's current rules; rules on labels the rubric
 * lacks are refused.
 */
export async function dryRunRubric(
  ctx: ModerationCtx,
  input: { channelId: string; rules?: unknown[]; limit?: number }
): Promise<ServiceResult<DryRunResult & { rubricVersion: number; rubricStatus: "draft" | "published" }>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();

  const rows = await db
    .select({
      version: commentRubrics.version,
      status: commentRubrics.status,
      labels: commentRubrics.labels,
      instructions: commentRubrics.instructions,
      examples: commentRubrics.examples,
    })
    .from(commentRubrics)
    .where(and(eq(commentRubrics.youtubeChannelId, channel.id), inArray(commentRubrics.status, ["draft", "published"])));
  const row = rows.find((r) => r.status === "draft") ?? rows.find((r) => r.status === "published");
  if (!row) return fail("NO_RUBRIC", "This channel has no rubric yet.", "Enable automation or save a draft first.", 409);
  const checked = validateLabels(row.labels);
  if ("message" in checked) return fail("INVALID_RUBRIC", checked.message, "Fix the draft's labels first.", 400);
  const rubric: ScoringRubric = {
    version: row.version,
    labels: checked.labels,
    instructions: row.instructions,
    examples: parseStoredExamples(row.examples).map(({ text, label }) => ({ text, label })),
  };

  let rules: ModerationRule[];
  if (input.rules !== undefined) {
    const v = validateRules(input.rules, rubric.labels.map((l) => l.name));
    if (!v.ok) {
      return fail("INVALID_RULES", v.errors.map((e) => `Rule ${e.index + 1}: ${e.message}`).join(" "), "Fix the rules and retry.", 400);
    }
    rules = v.rules;
  } else {
    const names = new Set(rubric.labels.map((l) => l.name));
    rules = (await drizzleSweepStore.getRules(channel.id)).filter((r) => names.has(r.label));
  }

  const limit = Math.max(1, Math.min(input.limit ?? DRY_RUN_MAX_COMMENTS, DRY_RUN_MAX_COMMENTS));
  const result = await dryRun(dryRunDeps(), channel, rubric, rules, { limit });
  return { data: { ...result, rubricVersion: row.version, rubricStatus: row.status === "draft" ? "draft" : "published" } };
}

// ─── Examples ────────────────────────────────────────────────────────────────

export interface RubricExampleRow {
  id: string;
  commentId: string | null;
  text: string;
  label: string;
  status: "suggested" | "accepted" | "rejected";
  includedInVersion: number | null;
}

/**
 * A member suggests the right label for a stored comment. The text is copied
 * (the example outlives the comment). The label must be in the draft or the
 * published rubric. A repeat suggestion of the same label returns the open one.
 */
export async function suggestCorrection(
  ctx: ModerationCtx,
  input: { channelId: string; commentId: string; label: string }
): Promise<ServiceResult<RubricExampleRow>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const [comment] = await db
    .select({ id: youtubeComments.id, text: youtubeComments.text })
    .from(youtubeComments)
    .where(and(eq(youtubeComments.youtubeChannelId, channel.id), eq(youtubeComments.id, input.commentId)));
  if (!comment) return fail("NOT_FOUND", "Comment not found on this channel.", "Pass a stored comment id.", 404);

  const rubrics = await db
    .select({ labels: commentRubrics.labels })
    .from(commentRubrics)
    .where(and(eq(commentRubrics.youtubeChannelId, channel.id), inArray(commentRubrics.status, ["draft", "published"])));
  const names = new Set(rubrics.flatMap((r) => parseRubricLabels(r.labels).map((l) => l.name)));
  if (!names.has(input.label)) {
    return fail("INVALID_LABEL", `Label "${input.label}" is not in the rubric.`, `Use one of: ${[...names].join(", ")}.`, 400);
  }

  const columns = {
    id: commentRubricExamples.id,
    commentId: commentRubricExamples.commentId,
    text: commentRubricExamples.text,
    label: commentRubricExamples.label,
    status: commentRubricExamples.status,
    includedInVersion: commentRubricExamples.includedInVersion,
  };
  const [open] = await db
    .select(columns)
    .from(commentRubricExamples)
    .where(
      and(
        eq(commentRubricExamples.youtubeChannelId, channel.id),
        eq(commentRubricExamples.commentId, comment.id),
        eq(commentRubricExamples.label, input.label),
        eq(commentRubricExamples.status, "suggested")
      )
    );
  if (open) return { data: open as RubricExampleRow };

  const [row] = await db
    .insert(commentRubricExamples)
    .values({
      youtubeChannelId: channel.id,
      commentId: comment.id,
      text: comment.text,
      label: input.label,
      status: "suggested",
      suggestedBy: ctx.userId,
    })
    .returning(columns);
  return { data: row as RubricExampleRow };
}

/** Accepts a suggestion and appends it to the next draft (never the live rubric). */
export async function acceptExample(
  ctx: ModerationCtx,
  input: { channelId: string; exampleId: string }
): Promise<ServiceResult<{ exampleId: string; draftVersion: number }>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const now = new Date();
  const outcome = await db.transaction(async (tx): Promise<Err | { exampleId: string; draftVersion: number }> => {
    const [example] = await tx
      .select({ id: commentRubricExamples.id, text: commentRubricExamples.text, label: commentRubricExamples.label, status: commentRubricExamples.status })
      .from(commentRubricExamples)
      .where(and(eq(commentRubricExamples.youtubeChannelId, channel.id), eq(commentRubricExamples.id, input.exampleId)))
      .for("update");
    if (!example) return fail("NOT_FOUND", "Example not found on this channel.", "List the channel's examples.", 404);
    if (example.status !== "suggested") {
      return fail("NOT_SUGGESTED", `The example is already ${example.status}.`, "Only a suggested example can be accepted.", 409);
    }
    await tx
      .update(commentRubricExamples)
      .set({ status: "accepted", reviewedBy: ctx.userId, reviewedAt: now })
      .where(eq(commentRubricExamples.id, example.id));
    const draft = await getOrCreateDraft(tx, channel.id);
    if (!draft.examples.some((e) => e.exampleId === example.id)) {
      await tx
        .update(commentRubrics)
        .set({ examples: [...draft.examples, { exampleId: example.id, text: example.text, label: example.label }], updatedAt: now })
        .where(eq(commentRubrics.id, draft.id));
    }
    return { exampleId: example.id, draftVersion: draft.version };
  });
  if ("error" in outcome) return outcome;
  return { data: outcome };
}

export async function rejectExample(
  ctx: ModerationCtx,
  input: { channelId: string; exampleId: string }
): Promise<ServiceResult<{ exampleId: string }>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const [row] = await db
    .update(commentRubricExamples)
    .set({ status: "rejected", reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(
      and(
        eq(commentRubricExamples.youtubeChannelId, channel.id),
        eq(commentRubricExamples.id, input.exampleId),
        eq(commentRubricExamples.status, "suggested")
      )
    )
    .returning({ id: commentRubricExamples.id });
  if (!row) {
    return fail("NOT_SUGGESTED", "No suggested example with that id on this channel.", "Only a suggested example can be rejected.", 409);
  }
  return { data: { exampleId: row.id } };
}

// ─── Manual actions (through the chokepoint) ─────────────────────────────────

function checkIds(ids: unknown): Err | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_MANUAL_COMMENT_IDS) {
    return fail("INVALID_COMMENT_IDS", `Pass 1 to ${MAX_MANUAL_COMMENT_IDS} comment ids.`, "Split the request.", 400);
  }
  return null;
}

/** Held comments back to published. Manual only; logged with the user id. */
export async function releaseHeldComment(
  ctx: ModerationCtx,
  input: { channelId: string; commentIds: string[] }
): Promise<ServiceResult<ApplyResult>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const bad = checkIds(input.commentIds);
  if (bad) return bad;
  const result = await applyModerationDecision(
    channel.id,
    input.commentIds.map((commentId) => ({ commentId, action: "release" as const })),
    { source: "dashboard", userId: ctx.userId }
  );
  return { data: result };
}

/** A person's flag / hold / reject / ban / delete from the review queue. */
export async function applyManualAction(
  ctx: ModerationCtx,
  input: { channelId: string; commentIds: string[]; action: ModerationAction }
): Promise<ServiceResult<ApplyResult>> {
  const channel = await resolveChannel(ctx, input.channelId);
  if (!channel) return channelNotFound();
  const bad = checkIds(input.commentIds);
  if (bad) return bad;
  if (!MODERATION_ACTIONS.includes(input.action)) {
    return fail("INVALID_ACTION", "Unknown action.", `Use one of: ${MODERATION_ACTIONS.join(", ")}.`, 400);
  }
  const result = await applyModerationDecision(
    channel.id,
    input.commentIds.map((commentId) => ({ commentId, action: input.action })),
    { source: "dashboard", userId: ctx.userId }
  );
  return { data: result };
}
