/**
 * CSRF state for the YouTube OAuth connect flow
 *
 * The initiation endpoint mints a random nonce, hands it to Google as the
 * `state` parameter, and stores a signed copy in an HttpOnly cookie. The
 * callback only exchanges the authorization code when the returned `state`
 * matches the signed cookie, so an attacker cannot make a signed-in victim
 * complete an authorization response the attacker started.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const YOUTUBE_OAUTH_STATE_COOKIE = 'vidtempla.youtube_oauth_state';

/** Google's consent screen is interactive, so give it a generous but finite window. */
const STATE_TTL_SECONDS = 10 * 60;

function sign(nonce: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not configured; cannot sign the YouTube OAuth state'
    );
  }

  return createHmac('sha256', secret).update(nonce).digest('hex');
}

function safeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf-8');
  const bBuffer = Buffer.from(b, 'utf-8');

  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Mints a state nonce plus the signed value to store in the cookie.
 */
export function createOAuthState(): { state: string; cookieValue: string } {
  const nonce = randomBytes(32).toString('hex');

  return { state: nonce, cookieValue: `${nonce}.${sign(nonce)}` };
}

/**
 * Returns true only when the callback's `state` matches the signed cookie.
 */
export function verifyOAuthState(
  state: string | undefined | null,
  cookieValue: string | undefined | null
): boolean {
  if (!state || !cookieValue) {
    return false;
  }

  const separator = cookieValue.lastIndexOf('.');
  if (separator <= 0) {
    return false;
  }

  const nonce = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);

  if (!safeEquals(nonce, state)) {
    return false;
  }

  try {
    return safeEquals(signature, sign(nonce));
  } catch {
    return false;
  }
}

function baseCookieAttributes(): string {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax'];

  // Dev runs on http://localhost, where a Secure cookie would never be stored.
  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function serializeStateCookie(cookieValue: string): string {
  return `${YOUTUBE_OAUTH_STATE_COOKIE}=${cookieValue}; ${baseCookieAttributes()}; Max-Age=${STATE_TTL_SECONDS}`;
}

export function clearStateCookie(): string {
  return `${YOUTUBE_OAUTH_STATE_COOKIE}=; ${baseCookieAttributes()}; Max-Age=0`;
}
