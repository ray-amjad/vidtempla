// #156 Proof #1 (Goal 2, I3): the rule evaluator.
// The reclassify case (Proof #3) is added to this file in phase 3.
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
