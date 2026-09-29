// #156 Proof #7 (I8): disconnecting a channel deletes all its stored comments,
// scores, rules, rubrics and examples — every new table must reference
// youtube_channels with ON DELETE CASCADE.
import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

const schema = await import("../../src/db/schema.ts");

// Every table #156 adds. Keep in step with the schema; the completeness test
// below fails if a new comment table appears without being listed here.
const NEW_TABLES = [
  "commentAutomation",
  "youtubeComments",
  "commentScores",
  "commentModerationRules",
  "commentRubrics",
  "commentRubricExamples",
  "commentModerationCounters",
  "commentModerationActions",
];

// Comment tables that predate #156 and are deliberately NOT channel-scoped
// (snapshots survive disconnect; they go only with the org).
const PRE_EXISTING = new Set(["comment_edits"]);

function channelFk(table) {
  const { foreignKeys } = getTableConfig(table);
  return foreignKeys
    .map((fk) => ({ fk, ref: fk.reference() }))
    .filter(({ ref }) => getTableName(ref.foreignTable) === "youtube_channels");
}

test("the list of new tables is not empty and every entry exists", () => {
  assert.ok(NEW_TABLES.length > 0);
  for (const name of NEW_TABLES) {
    assert.ok(schema[name], `schema.${name} is missing`);
  }
});

for (const name of NEW_TABLES) {
  test(`I8: ${name} references youtube_channels.id with onDelete cascade`, () => {
    const table = schema[name];
    assert.ok(table, `schema.${name} is missing`);
    const fks = channelFk(table);
    assert.equal(fks.length, 1, `${name}: expected exactly one FK to youtube_channels`);
    const [{ fk, ref }] = fks;
    assert.equal(fk.onDelete, "cascade", `${name}: onDelete is ${fk.onDelete}`);
    assert.deepEqual(ref.foreignColumns.map((c) => c.name), ["id"]);
    assert.deepEqual(ref.columns.map((c) => c.name), ["youtube_channel_id"]);
    assert.equal(ref.columns[0].notNull, true, `${name}: youtube_channel_id must be NOT NULL`);
  });
}

test("every comment table in the schema is either listed above or pre-existing", () => {
  const listed = new Set(NEW_TABLES.map((n) => schema[n] && getTableName(schema[n])));
  const commentTables = Object.values(schema)
    .filter((v) => v && typeof v === "object" && (() => { try { getTableName(v); return true; } catch { return false; } })())
    .map((t) => getTableName(t))
    .filter((n) => typeof n === "string" && /(^|_)comment/.test(n));
  for (const n of commentTables) {
    assert.ok(listed.has(n) || PRE_EXISTING.has(n), `table ${n} is not covered by this test`);
  }
});

test("other FKs inside the new tables never outlive the channel (cascade or set null)", () => {
  for (const name of NEW_TABLES) {
    const table = schema[name];
    if (!table) assert.fail(`schema.${name} is missing`);
    for (const fk of getTableConfig(table).foreignKeys) {
      assert.ok(
        fk.onDelete === "cascade" || fk.onDelete === "set null",
        `${name}: FK to ${getTableName(fk.reference().foreignTable)} has onDelete ${fk.onDelete}`
      );
    }
  }
});
