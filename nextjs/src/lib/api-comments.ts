import { NextResponse } from "next/server";
import { apiError, logRequest, type ApiContext } from "@/lib/api-auth";
import { creditsConsumedOf, type CommentContext } from "@/lib/services/comments";
import type { ServiceResult } from "@/lib/services/types";

/**
 * Glue between the v1 REST comment routes and `services/comments.ts`.
 *
 * The service owns credits and `comment_edits` snapshots (issue #135, I9/I10),
 * so routes never call `consumeCredits` — they only shape the request, log the
 * credits the service reports, and render the envelope.
 */

/** A REST call acts as the key's user and org; snapshot rows record `source: 'rest'`. */
export function commentContext(auth: ApiContext): CommentContext {
  return {
    userId: auth.userId,
    organizationId: auth.organizationId,
    source: "rest",
  };
}

type ServiceFailure = Extract<ServiceResult<unknown>, { error: unknown }>;

/**
 * Renders a service failure. The credits logged are the ones actually consumed,
 * which can be non-zero on an error: a snapshotted write bills for its read
 * before the write fails, and an aborted batch bills for everything it attempted.
 */
export function serviceErrorResponse(
  auth: ApiContext,
  endpoint: string,
  method: string,
  result: ServiceFailure
): NextResponse {
  const { code, message, suggestion, status, meta } = result.error;
  logRequest(auth, endpoint, method, status, creditsConsumedOf(result));
  return NextResponse.json(apiError(code, message, suggestion, status, meta), {
    status,
  });
}
