/**
 * Header and URL construction for the PostHog reverse proxy.
 *
 * Kept out of the route file because Next rejects non-handler exports from a
 * route module, and these are the parts worth testing directly.
 */

export const POSTHOG_API_HOST = "https://us.i.posthog.com";
export const POSTHOG_ASSET_HOST = "https://us-assets.i.posthog.com";

/**
 * The only request headers PostHog needs. Everything else - `cookie`,
 * `authorization`, and any future header carrying credentials - is dropped by
 * omission rather than by remembering to deny it.
 *
 * `x-forwarded-for` is kept so PostHog still resolves the visitor's geography;
 * without it every event would be attributed to the serverless function.
 */
export const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "referer",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
];

/**
 * Hop-by-hop and encoding headers must not be copied back: fetch has already
 * decoded the body, so passing the upstream's `content-encoding` or
 * `content-length` through would describe the response incorrectly.
 *
 * `set-cookie` is dropped so PostHog cannot set cookies on the app's own
 * origin, which the rewrite previously allowed.
 */
export const BLOCKED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "transfer-encoding",
]);

/**
 * Maps an /ingest request path onto the matching PostHog host.
 *
 * The path is taken from the URL rather than from route params so a trailing
 * slash survives - PostHog's API is sensitive to it, which is why
 * skipTrailingSlashRedirect is set in next.config.mjs.
 */
export function buildUpstreamUrl(pathname: string, search = ""): string {
  const path = pathname.replace(/^\/ingest/, "");
  const host = path.startsWith("/static/")
    ? POSTHOG_ASSET_HOST
    : POSTHOG_API_HOST;

  return `${host}${path}${search}`;
}

export function buildUpstreamHeaders(source: Headers): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }

  return headers;
}

export function buildResponseHeaders(source: Headers): Headers {
  const headers = new Headers();

  source.forEach((value, name) => {
    if (!BLOCKED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });

  return headers;
}
