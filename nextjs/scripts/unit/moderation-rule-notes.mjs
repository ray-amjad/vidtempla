// #156 spec boundary rows, dashboard side: threshold 0 must warn, threshold 1
// is noted as "exactly 1.0 only", and out-of-range input is refused before the
// request (the server's validateRules is the enforcement).
import assert from "node:assert/strict";
import test from "node:test";

const { parseThreshold, thresholdNote } = await import(
  "../../src/components/youtube/moderation/rule-notes.ts"
);

test("threshold 0 warns that it matches every comment", () => {
  for (const raw of ["0", "0.0", "0.00"]) {
    const note = thresholdNote(raw);
    assert.equal(note?.tone, "warning", raw);
    assert.match(note.text, /every comment/);
  }
});

test("threshold 1 notes that only exactly 1.0 matches", () => {
  const note = thresholdNote("1");
  assert.equal(note?.tone, "info");
  assert.match(note.text, /exactly 1\.0/);
});

test("ordinary thresholds, including the 0.90 boundary, get no note", () => {
  for (const raw of ["0.9", "0.90", "0.01", "0.99", "0.5"]) {
    assert.equal(thresholdNote(raw), null, raw);
    assert.equal(parseThreshold(raw), Number(raw));
  }
});

test("empty, non-numeric and out-of-range thresholds are errors", () => {
  for (const raw of ["", " ", "abc", "-0.1", "1.01", "2", "NaN", "Infinity"]) {
    assert.equal(parseThreshold(raw), null, raw);
    assert.equal(thresholdNote(raw)?.tone, "error", raw);
  }
});
