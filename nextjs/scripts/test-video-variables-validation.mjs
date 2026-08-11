import assert from "node:assert/strict";
import test from "node:test";

const {
  MAX_VARIABLES_PER_REQUEST,
  MAX_VARIABLE_NAME_LENGTH,
  MAX_VARIABLE_VALUE_LENGTH,
  formatVariableIssues,
  videoVariableUpdatesSchema,
} = await import("../src/lib/validation/videoVariables.ts");

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

function entry(overrides = {}) {
  return { templateId: VALID_UUID, name: "cta", value: "Subscribe", ...overrides };
}

test("a well-formed payload is accepted", () => {
  const result = videoVariableUpdatesSchema.safeParse([entry()]);

  assert.equal(result.success, true);
  assert.deepEqual(result.data, [entry()]);
});

test("an empty array is accepted", () => {
  assert.equal(videoVariableUpdatesSchema.safeParse([]).success, true);
});

test("a non-UUID templateId is rejected", () => {
  const cases = ["not-a-uuid", "", "1; DROP TABLE video_variables", 42, null];

  for (const templateId of cases) {
    assert.equal(
      videoVariableUpdatesSchema.safeParse([entry({ templateId })]).success,
      false,
      `expected templateId ${JSON.stringify(templateId)} to be rejected`
    );
  }
});

test("names must be non-empty, brace-free and bounded", () => {
  assert.equal(videoVariableUpdatesSchema.safeParse([entry({ name: "" })]).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse([entry({ name: "   " })]).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse([entry({ name: "{{cta}}" })]).success, false);
  assert.equal(
    videoVariableUpdatesSchema.safeParse([
      entry({ name: "a".repeat(MAX_VARIABLE_NAME_LENGTH + 1) }),
    ]).success,
    false
  );
  assert.equal(
    videoVariableUpdatesSchema.safeParse([
      entry({ name: "a".repeat(MAX_VARIABLE_NAME_LENGTH) }),
    ]).success,
    true
  );
});

test("values are bounded at the YouTube description limit", () => {
  assert.equal(
    videoVariableUpdatesSchema.safeParse([
      entry({ value: "a".repeat(MAX_VARIABLE_VALUE_LENGTH) }),
    ]).success,
    true
  );
  assert.equal(
    videoVariableUpdatesSchema.safeParse([
      entry({ value: "a".repeat(MAX_VARIABLE_VALUE_LENGTH + 1) }),
    ]).success,
    false
  );
  // An empty value clears the variable, which is legitimate.
  assert.equal(videoVariableUpdatesSchema.safeParse([entry({ value: "" })]).success, true);
});

test("missing fields and wrong types are rejected", () => {
  assert.equal(videoVariableUpdatesSchema.safeParse([{}]).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse([{ templateId: VALID_UUID }]).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse([entry({ value: 1 })]).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse(["not-an-object"]).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse([null]).success, false);
});

test("the collection size is capped", () => {
  const oversized = Array.from({ length: MAX_VARIABLES_PER_REQUEST + 1 }, () => entry());
  const atLimit = Array.from({ length: MAX_VARIABLES_PER_REQUEST }, () => entry());

  assert.equal(videoVariableUpdatesSchema.safeParse(oversized).success, false);
  assert.equal(videoVariableUpdatesSchema.safeParse(atLimit).success, true);
});

test("issues are formatted with an indexed path", () => {
  const result = videoVariableUpdatesSchema.safeParse([
    entry(),
    entry({ templateId: "nope" }),
  ]);

  assert.equal(result.success, false);
  assert.match(formatVariableIssues(result.error), /variables\.1\.templateId/);
});
