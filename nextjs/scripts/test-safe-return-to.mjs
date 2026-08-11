import assert from "node:assert/strict";
import test from "node:test";

const { firstQueryValue, getSafeReturnTo } = await import(
  "../src/utils/safeReturnTo.ts"
);

test("same-origin paths are preserved, query and hash included", () => {
  assert.equal(getSafeReturnTo("/dashboard"), "/dashboard");
  assert.equal(
    getSafeReturnTo("/dashboard/youtube?tab=channels#top"),
    "/dashboard/youtube?tab=channels#top"
  );
});

test("a value without a literal leading slash is rejected", () => {
  // Next.js has already decoded router.query, so a fully-encoded path here
  // means someone is encoding twice. Reject rather than guess.
  assert.equal(getSafeReturnTo("%2Fdashboard%2Fyoutube"), null);
});

test("protocol-relative URLs are rejected", () => {
  assert.equal(getSafeReturnTo("//evil.com"), null);
  assert.equal(getSafeReturnTo("//evil.com/phish"), null);
  // `/%2fevil.com` only becomes protocol-relative after decoding.
  assert.equal(getSafeReturnTo("/%2fevil.com"), null);
  assert.equal(getSafeReturnTo("/%2F%2Fevil.com"), null);
});

test("backslash variants are rejected", () => {
  assert.equal(getSafeReturnTo("/\\evil.com"), null);
  assert.equal(getSafeReturnTo("/%5Cevil.com"), null);
  assert.equal(getSafeReturnTo("/\\\\evil.com"), null);
});

test("absolute URLs are rejected", () => {
  assert.equal(getSafeReturnTo("https://evil.com"), null);
  assert.equal(getSafeReturnTo("http://evil.com"), null);
  assert.equal(getSafeReturnTo("javascript:alert(1)"), null);
  assert.equal(getSafeReturnTo("data:text/html,<script>"), null);
});

test("missing or malformed values are rejected", () => {
  assert.equal(getSafeReturnTo(undefined), null);
  assert.equal(getSafeReturnTo(""), null);
  assert.equal(getSafeReturnTo("dashboard"), null);
  // An invalid percent-escape must not throw.
  assert.equal(getSafeReturnTo("/%E0%A4%A"), null);
});

test("repeated query params use the first value", () => {
  assert.equal(firstQueryValue(["/dashboard", "//evil.com"]), "/dashboard");
  assert.equal(getSafeReturnTo(["/dashboard", "//evil.com"]), "/dashboard");
  assert.equal(getSafeReturnTo(["//evil.com", "/dashboard"]), null);
});
