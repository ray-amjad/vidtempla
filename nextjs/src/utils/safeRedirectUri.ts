/**
 * Scheme validation for OAuth redirect URIs before they are used as a browser
 * navigation target.
 *
 * Better Auth already rejects `javascript:`, `data:` and `vbscript:` at client
 * registration, but `window.location.href = value` is a script-execution sink
 * and should not depend on validation that happens in a different layer, in a
 * different package, at a different time.
 */

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Returns the URI when it is safe to navigate to, otherwise null.
 *
 * Relative URIs resolve against the current origin. Absolute URIs must use
 * http(s); `http:` stays allowed because local MCP clients register loopback
 * redirect URIs, which OAuth 2.1 permits.
 */
export function getSafeRedirectUri(
  value: unknown,
  base?: string
): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  const origin =
    base ?? (typeof window !== "undefined" ? window.location.origin : undefined);

  let parsed: URL;
  try {
    parsed = origin ? new URL(value, origin) : new URL(value);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

  return parsed.toString();
}
