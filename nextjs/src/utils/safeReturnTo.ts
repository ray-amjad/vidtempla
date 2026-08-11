/**
 * Same-origin validation for post-authentication `returnTo` redirects.
 *
 * A bare `startsWith("/")` check is not enough: browsers read `//evil.com` as a
 * protocol-relative URL to another origin, and `/\evil.com` is normalised the
 * same way. Both pass a single-slash check and both leave the site.
 */

export function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Returns a path-only, same-origin redirect target, or null when the supplied
 * value is missing or points anywhere off-origin.
 */
export function getSafeReturnTo(
  value: string | string[] | undefined
): string | null {
  const rawReturnTo = firstQueryValue(value);
  if (!rawReturnTo || !rawReturnTo.startsWith("/")) return null;

  let decodedReturnTo: string;
  try {
    decodedReturnTo = decodeURIComponent(rawReturnTo);
  } catch {
    return null;
  }

  // Re-check after decoding: `/%2fevil.com` decodes to `//evil.com`.
  if (
    !decodedReturnTo.startsWith("/") ||
    decodedReturnTo.startsWith("//") ||
    decodedReturnTo.includes("\\")
  ) {
    return null;
  }

  // Resolve against a placeholder origin and require the result to stay on it,
  // which rejects anything the checks above did not anticipate.
  const parsedReturnTo = new URL(decodedReturnTo, "https://vidtempla.local");
  if (parsedReturnTo.origin !== "https://vidtempla.local") return null;

  return `${parsedReturnTo.pathname}${parsedReturnTo.search}${parsedReturnTo.hash}`;
}
