import assert from "node:assert/strict";
import test from "node:test";

const {
  POSTHOG_API_HOST,
  POSTHOG_ASSET_HOST,
  buildResponseHeaders,
  buildUpstreamHeaders,
  buildUpstreamUrl,
} = await import("../src/lib/posthog-proxy.ts");

test("API paths map to the ingestion host", () => {
  assert.equal(buildUpstreamUrl("/ingest/decide", "?v=3"), `${POSTHOG_API_HOST}/decide?v=3`);
  assert.equal(buildUpstreamUrl("/ingest/e"), `${POSTHOG_API_HOST}/e`);
  assert.equal(buildUpstreamUrl("/ingest/flags", "?v=2"), `${POSTHOG_API_HOST}/flags?v=2`);
});

test("static paths map to the asset host", () => {
  assert.equal(
    buildUpstreamUrl("/ingest/static/array.js"),
    `${POSTHOG_ASSET_HOST}/static/array.js`
  );
});

test("a trailing slash is preserved", () => {
  assert.equal(buildUpstreamUrl("/ingest/decide/"), `${POSTHOG_API_HOST}/decide/`);
  assert.equal(buildUpstreamUrl("/ingest/e/", "?ip=1"), `${POSTHOG_API_HOST}/e/?ip=1`);
});

test("credential headers are never forwarded upstream", () => {
  const source = new Headers({
    cookie: "better-auth.session_token=super-secret",
    authorization: "Bearer super-secret",
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0",
    "x-forwarded-for": "203.0.113.7",
    "x-api-key": "super-secret",
    "proxy-authorization": "Basic super-secret",
  });

  const headers = buildUpstreamHeaders(source);

  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("x-api-key"), null);
  assert.equal(headers.get("proxy-authorization"), null);

  // ...while what PostHog legitimately needs still gets through.
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("user-agent"), "Mozilla/5.0");
  assert.equal(headers.get("x-forwarded-for"), "203.0.113.7");

  const forwarded = [...headers.keys()].sort();
  assert.deepEqual(forwarded, ["content-type", "user-agent", "x-forwarded-for"]);
});

test("the allowlist is closed, not a deny list", () => {
  const source = new Headers({ "x-some-future-credential": "super-secret" });

  assert.equal([...buildUpstreamHeaders(source).keys()].length, 0);
});

test("upstream cannot set cookies on the app origin", () => {
  const source = new Headers({
    "set-cookie": "ph_session=1; Domain=vidtempla.com",
    "content-type": "application/json",
    "cache-control": "max-age=60",
  });

  const headers = buildResponseHeaders(source);

  assert.equal(headers.get("set-cookie"), null);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("cache-control"), "max-age=60");
});

test("encoding headers are not copied back onto a decoded body", () => {
  const source = new Headers({
    "content-encoding": "gzip",
    "content-length": "1234",
    "transfer-encoding": "chunked",
    connection: "keep-alive",
    "content-type": "application/json",
  });

  const headers = buildResponseHeaders(source);

  assert.equal(headers.get("content-encoding"), null);
  assert.equal(headers.get("content-length"), null);
  assert.equal(headers.get("transfer-encoding"), null);
  assert.equal(headers.get("connection"), null);
  assert.equal(headers.get("content-type"), "application/json");
});
