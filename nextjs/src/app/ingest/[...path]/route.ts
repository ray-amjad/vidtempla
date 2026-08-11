/**
 * PostHog reverse proxy.
 *
 * This used to be a pair of `rewrites()` entries in next.config.mjs. Next
 * forwards inbound headers verbatim through an external rewrite, and /ingest is
 * same-origin, so the browser attached every cookie for the app domain -
 * including the HttpOnly `better-auth.session_token` - and Next handed them to
 * PostHog. An explicit handler builds the outbound headers from an allowlist
 * instead, so credentials never leave the origin.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildResponseHeaders,
  buildUpstreamHeaders,
  buildUpstreamUrl,
} from "@/lib/posthog-proxy";

async function proxy(request: NextRequest): Promise<NextResponse> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(
      buildUpstreamUrl(request.nextUrl.pathname, request.nextUrl.search),
      {
        method: request.method,
        headers: buildUpstreamHeaders(request.headers),
        body: hasBody ? await request.arrayBuffer() : undefined,
        redirect: "manual",
      }
    );
  } catch {
    // Analytics must never take the page down with it.
    return new NextResponse(null, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream.headers),
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
