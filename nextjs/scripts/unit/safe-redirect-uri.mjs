import assert from "node:assert/strict";
import test from "node:test";

const { getSafeRedirectUri } = await import("../../src/utils/safeRedirectUri.ts");

const BASE = "https://www.vidtempla.com";

test("https and http redirect URIs are allowed", () => {
  assert.equal(
    getSafeRedirectUri("https://client.example/cb?code=1", BASE),
    "https://client.example/cb?code=1"
  );
  // Loopback http is how local MCP clients receive the code.
  assert.equal(
    getSafeRedirectUri("http://127.0.0.1:8976/callback", BASE),
    "http://127.0.0.1:8976/callback"
  );
});

test("script-executing schemes are rejected", () => {
  assert.equal(getSafeRedirectUri("javascript:alert(document.domain)", BASE), null);
  assert.equal(getSafeRedirectUri("JavaScript:alert(1)", BASE), null);
  assert.equal(getSafeRedirectUri("  javascript:alert(1)", BASE), null);
  assert.equal(getSafeRedirectUri("data:text/html,<script>alert(1)</script>", BASE), null);
  assert.equal(getSafeRedirectUri("vbscript:msgbox(1)", BASE), null);
});

test("other non-http schemes are rejected", () => {
  assert.equal(getSafeRedirectUri("file:///etc/passwd", BASE), null);
  assert.equal(getSafeRedirectUri("ftp://example.com", BASE), null);
  assert.equal(getSafeRedirectUri("myapp://callback", BASE), null);
});

test("relative URIs resolve against the app origin", () => {
  assert.equal(getSafeRedirectUri("/dashboard", BASE), `${BASE}/dashboard`);
});

test("missing or non-string values are rejected", () => {
  assert.equal(getSafeRedirectUri(undefined, BASE), null);
  assert.equal(getSafeRedirectUri(null, BASE), null);
  assert.equal(getSafeRedirectUri("", BASE), null);
  assert.equal(getSafeRedirectUri(42, BASE), null);
  assert.equal(getSafeRedirectUri({ toString: () => "https://evil.com" }, BASE), null);
});

test("unparseable values are rejected rather than thrown", () => {
  assert.equal(getSafeRedirectUri("http://", BASE), null);
});

test("a garbled value that resolves relatively stays on the app origin", () => {
  // "://nope" is not a URL, so it resolves as a path against the base.
  assert.equal(getSafeRedirectUri("://nope", BASE), `${BASE}/://nope`);
});
