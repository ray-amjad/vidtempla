import assert from "node:assert/strict";
import test from "node:test";

process.env.BETTER_AUTH_SECRET = "test-secret-for-oauth-state-0123456789";

const {
  YOUTUBE_OAUTH_STATE_COOKIE,
  clearStateCookie,
  createOAuthState,
  serializeStateCookie,
  verifyOAuthState,
} = await import("../../src/lib/youtube-oauth-state.ts");

test("a freshly minted state verifies against its own cookie", () => {
  const { state, cookieValue } = createOAuthState();

  assert.equal(verifyOAuthState(state, cookieValue), true);
});

test("each state is unique", () => {
  const first = createOAuthState();
  const second = createOAuthState();

  assert.notEqual(first.state, second.state);
  assert.equal(verifyOAuthState(first.state, second.cookieValue), false);
});

test("a missing state or cookie is rejected", () => {
  const { state, cookieValue } = createOAuthState();

  assert.equal(verifyOAuthState(undefined, cookieValue), false);
  assert.equal(verifyOAuthState(state, undefined), false);
  assert.equal(verifyOAuthState("", ""), false);
  assert.equal(verifyOAuthState(null, null), false);
});

test("an attacker-chosen state without a valid signature is rejected", () => {
  const forgedNonce = "a".repeat(64);

  assert.equal(
    verifyOAuthState(forgedNonce, `${forgedNonce}.deadbeef`),
    false
  );
  assert.equal(verifyOAuthState(forgedNonce, forgedNonce), false);
  assert.equal(verifyOAuthState(forgedNonce, `.${forgedNonce}`), false);
});

test("a tampered nonce invalidates the signature", () => {
  const { state, cookieValue } = createOAuthState();
  const signature = cookieValue.slice(cookieValue.lastIndexOf(".") + 1);
  const tampered = `${state.slice(0, -1)}b.${signature}`;

  assert.equal(verifyOAuthState(state, tampered), false);
});

test("the cookie is HttpOnly, SameSite=Lax and scoped to the whole site", () => {
  const cookie = serializeStateCookie("value");

  assert.ok(cookie.startsWith(`${YOUTUBE_OAUTH_STATE_COOKIE}=value;`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=600/);
});

test("clearing the cookie expires it immediately", () => {
  assert.match(clearStateCookie(), /Max-Age=0/);
});
