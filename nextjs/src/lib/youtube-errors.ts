import axios from "axios";
import { apiError } from "./api-auth";

/**
 * Shape of the YouTube Data API JSON error envelope.
 * Documented at: https://developers.google.com/youtube/v3/docs/errors
 */
interface YouTubeErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      reason?: string;
      domain?: string;
      message?: string;
    }>;
  };
}

/**
 * Result returned by mapYouTubeError. Both fields can be passed straight
 * into `NextResponse.json(body, { status })`.
 */
export interface MappedYouTubeError {
  body: ReturnType<typeof apiError>;
  status: number;
}

export interface YouTubeServiceError {
  code: string;
  message: string;
  suggestion: string;
  status: number;
  meta?: {
    upstreamStatus?: number;
    reasons?: string[];
  };
}

const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceededUnreg",
  "dailyLimitExceeded",
  "insufficientTokens",
  "limitExceeded",
  "rateLimitExceeded",
  "rateLimitExceededUnreg",
  "servingLimitExceeded",
  "uploadLimitExceeded",
  "uploadRateLimitExceeded",
  "userRateLimitExceeded",
  "userRateLimitExceededUnreg",
  "variableTermExpiredDailyExceeded",
  "variableTermLimitExceeded",
]);

/**
 * Translates an upstream YouTube Data API failure into VidTempla's standard
 * REST envelope, inspecting every `error.response.data.error.errors[].reason` so
 * agents can distinguish quota exhaustion from permission failures.
 *
 * Mapping:
 *  - quota/rate-limit reason, or upstream HTTP 429 -> `QUOTA_EXCEEDED` / 429
 *  - upstream HTTP 404 -> `NOT_FOUND` / 404
 *  - upstream HTTP 403 -> `FORBIDDEN` / 403
 *  - everything else   -> `YOUTUBE_API_ERROR` / upstream status (or 500)
 */
/**
 * What an upstream failure says about itself, before any mapping decision.
 *
 * Separate from `mapYouTubeError` because the mapper attaches `reasons` to the
 * quota envelope only, while a caller that wants to *log* the cause needs them
 * on every status — `reason` is the single field that names why YouTube
 * refused, and a 403 is exactly the case where the mapper drops it.
 */
export interface YouTubeErrorDetail {
  /** Upstream HTTP status, or undefined when the call never got a response. */
  upstreamStatus?: number;
  /** Every `error.errors[].reason` YouTube returned, in order. */
  reasons: string[];
  /** YouTube's own message, falling back to the thrown error's. */
  message: string;
}

/** Reads an upstream failure's status, reasons and message. Pure. */
export function youTubeErrorDetail(err: unknown): YouTubeErrorDetail {
  const axiosErr = axios.isAxiosError<YouTubeErrorPayload>(err) ? err : null;
  const payload = axiosErr?.response?.data;
  return {
    upstreamStatus: axiosErr?.response?.status,
    reasons:
      payload?.error?.errors
        ?.map((entry) => entry.reason)
        .filter((reason): reason is string => Boolean(reason)) ?? [],
    message:
      payload?.error?.message ??
      (err instanceof Error ? err.message : undefined) ??
      "YouTube API error",
  };
}

export function mapYouTubeError(err: unknown): MappedYouTubeError {
  // Falls back gracefully for non-axios errors (e.g. network failures,
  // programmer errors): no response means no reasons and a 500.
  const axiosErr = axios.isAxiosError<YouTubeErrorPayload>(err) ? err : null;
  const detail = youTubeErrorDetail(err);
  const reasons = detail.reasons;
  const status = detail.upstreamStatus ?? 500;
  const message = detail.message;
  const meta =
    axiosErr?.response || reasons.length > 0
      ? {
          upstreamStatus: status,
          ...(reasons.length > 0 ? { reasons } : {}),
        }
      : undefined;

  if (status === 429 || reasons.some((reason) => QUOTA_REASONS.has(reason))) {
    return {
      body: apiError(
        "QUOTA_EXCEEDED",
        "YouTube API quota exhausted",
        "Retry with backoff. If daily quota is exhausted, wait for the Pacific midnight reset or contact support.",
        429,
        meta
      ),
      status: 429,
    };
  }

  if (status === 404) {
    return {
      body: apiError(
        "NOT_FOUND",
        message,
        "Verify the resource ID exists.",
        404
      ),
      status: 404,
    };
  }

  if (status === 403) {
    return {
      body: apiError(
        "FORBIDDEN",
        message,
        "Verify your channel has permission for this action.",
        403
      ),
      status: 403,
    };
  }

  return {
    body: apiError(
      "YOUTUBE_API_ERROR",
      message,
      "Check YouTube API status at status.cloud.google.com.",
      status
    ),
    status,
  };
}

export function mapYouTubeServiceError(err: unknown): YouTubeServiceError {
  const mapped = mapYouTubeError(err);
  const { code, message, suggestion, status, meta } = mapped.body.error;

  return {
    code,
    message,
    suggestion: suggestion ?? "",
    status,
    ...(meta ? { meta: meta as YouTubeServiceError["meta"] } : {}),
  };
}
