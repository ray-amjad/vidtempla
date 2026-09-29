// #156 Proof #1 (Goal 2, I3): the rule evaluator, and Proof #3 (I4, Goal 3):
// reclassify never acts on an actioned comment, and held comments that now
// score clean land on the maybe-release list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  MODERATION_ACTIONS,
  SEVERITY,
  mostSevere,
  evaluateRules,
  validateRules,
  pacificDayKey,
  reclassifyChunk,
  isMaybeRelease,
} = await import("../../src/lib/moderation/core.ts");

// ─── spam-comments.txt at the repo root: entries separated by a `---` line ──

const spamFile = new URL("../../../spam-comments.txt", import.meta.url);
const SPAM = readFileSync(spamFile, "utf8")
  .split(/^---$/m)
  .map((s) => s.trim())
  .filter(Boolean);

/** Fake Jev: the known book-promo pattern scores as spam, anything else is normal. */
function fakeScore(text) {
  return /FastScale by Mark Voss/.test(text)
    ? { spam: 0.96, "self-promotion": 0.02, scam: 0.01, abusive: 0, normal: 0.01 }
    : { spam: 0.02, "self-promotion": 0.0, scam: 0.0, abusive: 0.01, normal: 0.97 };
}

// The worked-case rules from the spec.
const WORKED_RULES = [
  { id: "r-hold", label: "spam", threshold: 0.7, action: "hold" },
  { id: "r-delete", label: "spam", threshold: 0.9, action: "delete" },
];

test("spam-comments.txt parses into its entries", () => {
  assert.ok(SPAM.length >= 2, `expected >= 2 entries, got ${SPAM.length}`);
  for (const entry of SPAM) assert.match(entry, /AI Millionaire FastScale/);
});

test("every spam-comments.txt example resolves to delete (most severe of hold + delete)", () => {
  for (const text of SPAM) {
    const r = evaluateRules(WORKED_RULES, fakeScore(text));
    assert.equal(r.action, "delete", text.slice(0, 40));
    assert.equal(r.rule?.id, "r-delete");
    assert.deepEqual(
      r.matches.map((m) => m.rule.action),
      ["delete", "hold"]
    );
  }
});

test('worked case: "Great video!" (normal 0.97, spam 0.02) takes no action', () => {
  const r = evaluateRules(WORKED_RULES, fakeScore("Great video!"));
  assert.equal(r.action, null);
  assert.equal(r.rule, null);
  assert.deepEqual(r.matches, []);
});

test("threshold boundary: exactly 0.90 matches a 0.90 rule", () => {
  assert.equal(evaluateRules(WORKED_RULES, { spam: 0.9 }).action, "delete");
  assert.equal(evaluateRules(WORKED_RULES, { spam: 0.8999 }).action, "hold");
  assert.equal(evaluateRules(WORKED_RULES, { spam: 0.7 }).action, "hold");
  assert.equal(evaluateRules(WORKED_RULES, { spam: 0.6999 }).action, null);
});

test("threshold 0 matches everything, threshold 1 only exactly 1", () => {
  const zero = [{ label: "spam", threshold: 0, action: "flag" }];
  assert.equal(evaluateRules(zero, { spam: 0 }).action, "flag");
  const one = [{ label: "spam", threshold: 1, action: "reject" }];
  assert.equal(evaluateRules(one, { spam: 1 }).action, "reject");
  assert.equal(evaluateRules(one, { spam: 0.9999999 }).action, null);
});

test("I3: most severe action wins across labels, independent of rule order", () => {
  const rules = [
    { id: "a", label: "spam", threshold: 0.5, action: "hold" },
    { id: "b", label: "scam", threshold: 0.5, action: "ban" },
    { id: "c", label: "abusive", threshold: 0.5, action: "reject" },
    { id: "d", label: "self-promotion", threshold: 0.5, action: "flag" },
  ];
  const probs = { spam: 0.8, scam: 0.6, abusive: 0.7, "self-promotion": 0.9 };
  for (const order of [rules, [...rules].reverse(), [rules[2], rules[0], rules[3], rules[1]]]) {
    const r = evaluateRules(order, probs);
    assert.equal(r.action, "ban");
    assert.equal(r.rule.id, "b");
    assert.deepEqual(
      r.matches.map((m) => m.rule.action),
      ["ban", "reject", "hold", "flag"]
    );
  }
  const withDelete = [...rules, { id: "e", label: "spam", threshold: 0.75, action: "delete" }];
  assert.equal(evaluateRules(withDelete, probs).action, "delete");
});

test("the same action from two rules keeps the higher-probability match", () => {
  const rules = [
    { id: "low", label: "spam", threshold: 0.5, action: "hold" },
    { id: "high", label: "scam", threshold: 0.5, action: "hold" },
  ];
  const r = evaluateRules(rules, { spam: 0.6, scam: 0.9 });
  assert.equal(r.action, "hold");
  assert.equal(r.rule.id, "high");
});

test("severity order is delete > ban > reject > hold > flag", () => {
  assert.deepEqual(
    [...MODERATION_ACTIONS].sort((a, b) => SEVERITY[b] - SEVERITY[a]),
    ["delete", "ban", "reject", "hold", "flag"]
  );
  assert.equal(mostSevere(["flag", "hold", "reject"]), "reject");
  assert.equal(mostSevere(["hold", "delete", "ban"]), "delete");
  assert.equal(mostSevere([null, "flag", undefined]), "flag");
  assert.equal(mostSevere([]), null);
});

test("a label Jev returns but no rule names is ignored; a rule whose label is absent never matches", () => {
  const rules = [{ label: "spam", threshold: 0.5, action: "hold" }];
  assert.equal(evaluateRules(rules, { "brand-new-label": 0.99, spam: 0.1 }).action, null);
  assert.equal(evaluateRules(rules, { normal: 1 }).action, null);
  assert.equal(evaluateRules(rules, { spam: Number.NaN }).action, null);
  assert.equal(evaluateRules(rules, {}).action, null);
  assert.equal(evaluateRules([], { spam: 1 }).action, null);
});

// ─── setModerationRules validation ──────────────────────────────────────────

const LABELS = ["spam", "self-promotion", "scam", "abusive", "normal"];

test("validateRules accepts a well-formed set and warns on threshold 0", () => {
  const res = validateRules(
    [
      { label: "spam", threshold: 0.9, action: "delete" },
      { label: "scam", threshold: 0, action: "flag" },
      { label: "abusive", threshold: 1, action: "ban" },
    ],
    LABELS
  );
  assert.equal(res.ok, true);
  assert.equal(res.rules.length, 3);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /threshold 0/i);
});

test("validateRules accepts an empty rule set (new channels start with no rules)", () => {
  const res = validateRules([], LABELS);
  assert.equal(res.ok, true);
  assert.deepEqual(res.rules, []);
});

test("validateRules refuses thresholds outside 0..1, unknown labels and unknown actions", () => {
  const bad = [
    { label: "spam", threshold: -0.01, action: "hold" },
    { label: "spam", threshold: 1.01, action: "hold" },
    { label: "spam", threshold: Number.NaN, action: "hold" },
    { label: "spam", threshold: "0.5", action: "hold" },
    { label: "not-in-rubric", threshold: 0.5, action: "hold" },
    { label: "spam", threshold: 0.5, action: "approve" },
    { label: "spam", threshold: 0.5, action: "ban_author" },
    null,
  ];
  const res = validateRules(bad, LABELS);
  assert.equal(res.ok, false);
  const byIndex = new Map();
  for (const e of res.errors) byIndex.set(e.index, [...(byIndex.get(e.index) ?? []), e.field]);
  assert.deepEqual(byIndex.get(0), ["threshold"]);
  assert.deepEqual(byIndex.get(1), ["threshold"]);
  assert.deepEqual(byIndex.get(2), ["threshold"]);
  assert.deepEqual(byIndex.get(3), ["threshold"]);
  assert.deepEqual(byIndex.get(4), ["label"]);
  assert.deepEqual(byIndex.get(5), ["action"]);
  assert.deepEqual(byIndex.get(6), ["action"]);
  assert.ok(byIndex.has(7), "a non-object rule is refused");
});

test("validateRules returns clean copies, not the caller's objects", () => {
  const input = [{ label: "spam", threshold: 0.9, action: "delete", extra: "x" }];
  const res = validateRules(input, LABELS);
  assert.equal(res.ok, true);
  assert.deepEqual(res.rules, [{ label: "spam", threshold: 0.9, action: "delete" }]);
  assert.notEqual(res.rules[0], input[0]);
});

// ─── Cap day key (I2: the day boundary is midnight Pacific) ─────────────────

test("pacificDayKey rolls over at midnight Pacific, DST-correct", () => {
  // PDT (UTC-7): midnight Pacific is 07:00Z.
  assert.equal(pacificDayKey(new Date("2026-09-29T06:59:59.999Z")), "2026-09-28");
  assert.equal(pacificDayKey(new Date("2026-09-29T07:00:00.000Z")), "2026-09-29");
  // PST (UTC-8): midnight Pacific is 08:00Z.
  assert.equal(pacificDayKey(new Date("2026-01-15T07:59:59.999Z")), "2026-01-14");
  assert.equal(pacificDayKey(new Date("2026-01-15T08:00:00.000Z")), "2026-01-15");
  // Fall-back day 2026-11-01 is 25 hours long: 07:00Z .. 08:00Z next day.
  assert.equal(pacificDayKey(new Date("2026-11-01T07:00:00Z")), "2026-11-01");
  assert.equal(pacificDayKey(new Date("2026-11-02T07:59:59Z")), "2026-11-01");
  assert.equal(pacificDayKey(new Date("2026-11-02T08:00:00Z")), "2026-11-02");
});

// ─── Proof #3: reclassify (I4) ───────────────────────────────────────────────

const RC_CHANNEL = { id: "ch-uuid", channelId: "UCownchannel0000000000000", organizationId: "org-1" };
const RC_LABELS = ["spam", "self-promotion", "scam", "abusive", "normal"].map((name) => ({
  name,
  description: `${name} description`,
}));

/**
 * Fakes for reclassifyChunk. The store deliberately returns every comment,
 * whatever its state, so the test proves core's own I4 input filter rather
 * than the SQL. `v2` is what the new rubric scores each comment as.
 */
function reclassifyHarness({ rows, v2, published = 2, balance = 1_000, tripped = false, rules, outcomeFor, halted = null, enabled = true } = {}) {
  const decided = [];
  let nowMs = Date.parse("2026-09-29T18:00:00Z");
  const events = [];
  const applyCalls = [];
  const scores = [];
  const jevCalls = [];
  const youtubeReads = [];
  const deps = {
    clock: { now: () => new Date(nowMs) },
    sleep: async (ms) => {
      nowMs += Math.max(0, ms);
    },
    credits: {
      async charge(_org, amount) {
        if (balance < amount) return { outcome: "insufficient", refundable: 0 };
        balance -= amount;
        events.push(["charge", amount]);
        return { outcome: "ok", refundable: amount };
      },
      async refund(_org, c) {
        balance += c.refundable;
        events.push(["refund", c.refundable]);
      },
    },
    creditBalance: async () => balance,
    quota: { isTripped: async () => tripped, trip: async () => {} },
    youtube: {
      async listThreads(...args) {
        youtubeReads.push(args);
        return { items: [] };
      },
    },
    classifyListError: () => ({ quota: false, reason: "x" }),
    jev: {
      async choose(req) {
        jevCalls.push(req);
        const row = rows.find((r) => r.text === req.state.comment);
        const probs = v2[row.id];
        return {
          ok: true,
          result: { model: "jev-1.14", choice: "x", probabilities: probs, confidence: 0.9, inputTokens: 50, outputTokens: 1 },
        };
      },
    },
    store: {
      getAutomation: async () => ({ enabled, enabledAt: null, cursor: null }),
      getPublishedRubric: async () => ({ version: published, labels: RC_LABELS, instructions: "", examples: [] }),
      getRules: async () =>
        rules ?? [
          { id: "r-hold", label: "spam", threshold: 0.7, action: "hold" },
          { id: "r-del", label: "spam", threshold: 0.9, action: "delete" },
        ],
      async listForReclassify(_ch, version, afterId, limit) {
        return rows
          .filter((r) => afterId === null || r.id > afterId)
          .filter((r) => !scores.some((s) => s.commentId === r.id && s.rubricVersion === version))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, limit)
          .map((r) => ({ ...r, videoTitle: null }));
      },
      async saveScore(_ch, score) {
        scores.push(score);
      },
      async markDecided(_ch, ids, version) {
        for (const id of ids) decided.push([id, version]);
      },
      async setRunStatus() {},
    },
    apply: {
      async apply(_channel, decisions) {
        applyCalls.push(decisions);
        return {
          outcomes: decisions.map(
            (d) => outcomeFor?.(d) ?? { commentId: d.commentId, status: "applied", appliedAction: d.action, youtubeAttempted: true }
          ),
          refused: [],
          halted,
          paused: [],
          youtubeCalls: decisions.length,
        };
      },
    },
  };
  return { deps, events, applyCalls, scores, jevCalls, youtubeReads, decided, balance: () => balance };
}

const SPAMMY = { spam: 0.96, normal: 0.02 };
const CLEAN = { spam: 0.2, normal: 0.8 };

function rcRow(id, moderationState, over = {}) {
  return {
    id,
    youtubeChannelId: RC_CHANNEL.id,
    commentId: `yt-${id}`,
    parentId: null,
    videoId: "vid-1",
    authorChannelId: `UCviewer-${id}`,
    text: `text of ${id}`,
    textSource: "display",
    scoreStatus: "scored",
    moderationState,
    ...over,
  };
}

test("Proof #3: reclassify decides only for never-actioned comments; held + now clean → maybe release", async () => {
  const rows = [
    rcRow("a-none-spam", "none"),
    rcRow("b-held-clean", "held"),
    rcRow("c-rejected-spam", "rejected"),
    rcRow("d-flagged-spam", "flagged"),
    rcRow("e-held-spam", "held"),
    rcRow("f-deleted-spam", "deleted"),
    rcRow("g-released-clean", "released"),
    rcRow("h-banned-clean", "banned"),
    rcRow("i-none-clean", "none"),
  ];
  const v2 = {
    "a-none-spam": SPAMMY,
    "b-held-clean": CLEAN,
    "c-rejected-spam": SPAMMY,
    "d-flagged-spam": SPAMMY,
    "e-held-spam": SPAMMY,
    "f-deleted-spam": SPAMMY,
    "g-released-clean": CLEAN,
    "h-banned-clean": CLEAN,
    "i-none-clean": CLEAN,
  };
  const h = reclassifyHarness({ rows, v2 });
  const res = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);

  const decided = h.applyCalls.flat();
  // Only the never-actioned spam comments get a decision (flag is not actioned).
  assert.deepEqual(
    decided.map((d) => [d.commentId, d.action, d.rubricVersion]).sort(),
    [
      ["a-none-spam", "delete", 2],
      ["d-flagged-spam", "delete", 2],
    ]
  );
  // Actioned comments get no decision, whatever they now score.
  for (const id of ["b-held-clean", "c-rejected-spam", "e-held-spam", "f-deleted-spam", "g-released-clean", "h-banned-clean"]) {
    assert.ok(!decided.some((d) => d.commentId === id), `${id} must not be acted on`);
  }
  // Held and now clean → maybe release. Held and still spam → not listed.
  assert.deepEqual(res.maybeRelease, ["b-held-clean"]);
  assert.equal(res.decisions, 2);
  assert.equal(h.youtubeReads.length, 0, "reclassify makes zero YouTube reads");
  assert.ok(["continue", "done"].includes(res.status));
});

test("Proof #3: reclassify stores a new score per comment and charges 1 credit each", async () => {
  const rows = [rcRow("a", "none"), rcRow("b", "held")];
  const h = reclassifyHarness({ rows, v2: { a: CLEAN, b: CLEAN } });
  let res = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  let guard = 0;
  while (res.status === "continue" && guard++ < 5) res = await reclassifyChunk(h.deps, RC_CHANNEL, 2, res.nextAfterId);
  assert.equal(res.status, "done");
  assert.deepEqual(h.scores.map((s) => [s.commentId, s.rubricVersion, s.model]), [
    ["a", 2, "jev-1.14"],
    ["b", 2, "jev-1.14"],
  ]);
  assert.deepEqual(h.events, [["charge", 1], ["charge", 1]]);
});

test("reclassify stops `superseded` when a newer version is published, before any call", async () => {
  const h = reclassifyHarness({ rows: [rcRow("a", "none")], v2: { a: SPAMMY }, published: 3 });
  const res = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  assert.equal(res.status, "superseded");
  assert.equal(h.jevCalls.length, 0);
  assert.deepEqual(h.events, []);
  assert.equal(h.applyCalls.length, 0);
});

test("reclassify ends `out of credits` and `quota breaker` without acting", async () => {
  const broke = reclassifyHarness({ rows: [rcRow("a", "none")], v2: { a: SPAMMY }, balance: 0 });
  assert.equal((await reclassifyChunk(broke.deps, RC_CHANNEL, 2, null)).status, "out of credits");
  assert.equal(broke.jevCalls.length, 0);

  const tripped = reclassifyHarness({ rows: [rcRow("a", "none")], v2: { a: SPAMMY }, tripped: true });
  assert.equal((await reclassifyChunk(tripped.deps, RC_CHANNEL, 2, null)).status, "quota breaker");
  assert.equal(tripped.jevCalls.length, 0);
  assert.equal(tripped.applyCalls.length, 0);
});

// ─── Review round 1 #5: maybe release ────────────────────────────────────────

test("R1 #5: isMaybeRelease — held and no hold-or-stronger rule wins (null or flag)", () => {
  const rules = [
    { id: "r-flag", label: "normal", threshold: 0.5, action: "flag" },
    { id: "r-hold", label: "spam", threshold: 0.7, action: "hold" },
    { id: "r-del", label: "spam", threshold: 0.9, action: "delete" },
  ];
  // No rule matches → maybe release.
  assert.equal(isMaybeRelease("held", rules, { spam: 0.2, normal: 0.4 }), true);
  // Only a flag rule wins → maybe release (a flag is not a hold).
  assert.equal(isMaybeRelease("held", rules, { spam: 0.2, normal: 0.8 }), true);
  // Hold or stronger still wins → stays held.
  assert.equal(isMaybeRelease("held", rules, { spam: 0.75, normal: 0.2 }), false);
  assert.equal(isMaybeRelease("held", rules, { spam: 0.95, normal: 0.9 }), false);
  // No rules at all → maybe release.
  assert.equal(isMaybeRelease("held", [], { spam: 0.99 }), true);
  // Only held comments belong there.
  for (const state of ["none", "flagged", "rejected", "banned", "deleted", "released"]) {
    assert.equal(isMaybeRelease(state, rules, { spam: 0.2, normal: 0.4 }), false, state);
  }
});

test("R1 #5: reclassify lists a held comment whose only match is a flag rule as maybe release", async () => {
  const rows = [rcRow("a-held-flag", "held"), rcRow("b-held-hold", "held")];
  const h = reclassifyHarness({
    rows,
    v2: { "a-held-flag": { spam: 0.2, normal: 0.8 }, "b-held-hold": { spam: 0.75, normal: 0.2 } },
    rules: [
      { id: "r-flag", label: "normal", threshold: 0.5, action: "flag" },
      { id: "r-hold", label: "spam", threshold: 0.7, action: "hold" },
    ],
  });
  const res = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  assert.deepEqual(res.maybeRelease, ["a-held-flag"]);
  assert.equal(h.applyCalls.flat().length, 0, "I4: held comments get no decision");
});

test("R1 #4: reclassify marks a score decided only once its decision was attempted", async () => {
  const rows = [rcRow("a-started", "none"), rcRow("b-not-started", "none"), rcRow("c-clean", "none"), rcRow("d-held", "held")];
  const h = reclassifyHarness({
    rows,
    v2: { "a-started": SPAMMY, "b-not-started": SPAMMY, "c-clean": CLEAN, "d-held": CLEAN },
    outcomeFor: (d) =>
      d.commentId === "b-not-started"
        ? { commentId: d.commentId, status: "failed", error: "timeBudget", appliedAction: d.action, youtubeAttempted: false, retryable: true }
        : undefined,
  });
  await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  assert.deepEqual(
    h.decided.map(([id, v]) => `${id}@${v}`).sort(),
    ["a-started@2", "c-clean@2", "d-held@2"],
    "the unstarted decision stays open for the next sweep"
  );
});

test("R2 #6: reclassify treats a fail-open scoring charge as a ledger error: no unmetered Jev call", async () => {
  const rows = [rcRow("a", "none")];
  const h = reclassifyHarness({ rows, v2: { a: SPAMMY } });
  h.deps.credits.charge = async () => ({ outcome: "ok", refundable: 0 });
  const r = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  assert.equal(r.status, "done");
  assert.equal(r.reason, "credit_ledger_error");
  assert.equal(h.jevCalls.length, 0);
  assert.equal(h.applyCalls.length, 0);
});

test("R2 #1: reclassify stops on an auth halt and leaves the halted decision owed", async () => {
  const rows = [rcRow("a", "none"), rcRow("b", "none")];
  const h = reclassifyHarness({
    rows,
    v2: { a: SPAMMY, b: SPAMMY },
    halted: "auth",
    outcomeFor: (d) => ({
      commentId: d.commentId,
      status: "failed",
      error: "auth",
      appliedAction: d.action,
      youtubeAttempted: d.commentId === "a",
      retryable: true,
    }),
  });
  const r = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  assert.equal(r.status, "done");
  assert.equal(r.reason, "youtube_auth");
  assert.deepEqual(h.decided, [], "neither halted decision is stamped decided");
});

test("R2 #4: reclassify on a disabled channel ends without scoring, charging or acting", async () => {
  const h = reclassifyHarness({ rows: [rcRow("a", "none")], v2: { a: SPAMMY }, enabled: false });
  const r = await reclassifyChunk(h.deps, RC_CHANNEL, 2, null);
  assert.equal(r.status, "done");
  assert.equal(r.reason, "automation_disabled");
  assert.equal(h.jevCalls.length, 0);
  assert.equal(h.applyCalls.length, 0);
  assert.deepEqual(h.events, []);
});
