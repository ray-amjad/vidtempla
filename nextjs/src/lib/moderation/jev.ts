/**
 * TypeSafe Jev adapter (#156): implements `JevPort` on `@typesafe-ai/sdk`.
 *
 * - The client is built lazily on the first call, never at import: the SDK
 *   constructor throws without `TYPESAFE_API_KEY`, and a missing key must not
 *   break every module that imports this one. A missing key comes back as a
 *   `not_configured` failure.
 * - I7: the comment, video title and examples travel only in `state`. The
 *   question's instructions and criteria are VidTempla's wording and the
 *   owner's label descriptions (`buildJevRequest` in core.ts).
 * - Tight timeout and retry, so one call cannot eat a 60 s workflow step:
 *   3 attempts of ≤ 6 s with ≤ 1.5 s backoff (≤ 2 s honoured Retry-After),
 *   about 22 s at worst (core.JEV_CALL_BUDGET_MS), and the step deadline
 *   aborts everything via an AbortSignal.
 * - Never throws: every failure maps to `{ ok: false, reason, status }`.
 * - Logs never carry the request body (it holds viewer text): the SDK's level
 *   is pinned to `error` and its extra arguments are dropped.
 *
 * Type-only local imports, so `scripts/unit/comment-sweep.mjs` can load this
 * file under `node --experimental-strip-types` with a fake `fetch`.
 */

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  choice,
  type EntryType,
  type Fetch,
  type RetryPolicy,
} from "@typesafe-ai/sdk";
import type { JevCallResult, JevChoiceRequest, JevFailureReason, JevPort } from "./types";

/** Per-attempt timeout. */
export const JEV_ATTEMPT_TIMEOUT_MS = 6_000;

const JEV_RETRY: Partial<RetryPolicy> = {
  maxRetries: 2,
  backoffInitialMs: 500,
  backoffMaxMs: 1_500,
  maxRetryAfterMs: 2_000,
};

/** The single question name in every request; its answer is the Choice. */
const QUESTION = "label";

export interface JevAdapterConfig {
  /** Defaults to `process.env.TYPESAFE_API_KEY`, read at the first call. */
  apiKey?: string;
  /** Test seam: a fake transport. */
  fetch?: Fetch;
  retry?: Partial<RetryPolicy>;
  timeoutMs?: number;
}

const quietLogger = {
  debug() {},
  info() {},
  warn(message: string) {
    console.warn(`[jev] ${message}`);
  },
  error(message: string) {
    console.error(`[jev] ${message}`);
  },
};

function failure(reason: JevFailureReason, status: number | null = null): JevCallResult {
  return { ok: false, reason, status };
}

/** Maps an SDK throw onto a failure reason (after the SDK's own retries). */
export function classifyJevError(err: unknown): JevCallResult {
  if (err instanceof APIUserAbortError) return failure("aborted");
  if (err instanceof APITimeoutError) return failure("timeout");
  if (err instanceof APIConnectionError) return failure("connection");
  if (err instanceof APIError) {
    const status = err.status;
    if (status === 429) return failure("rate_limited", status);
    if (status === 401 || status === 403) return failure("auth", status);
    if (status === 529 || status === 503) return failure("overloaded", status);
    if (status >= 500) return failure("server_error", status);
    return failure("bad_request", status);
  }
  if (err instanceof Error && err.name === "AbortError") return failure("aborted");
  // TypeSafeError for a malformed request, or anything unexpected.
  return failure("bad_request");
}

export function createJevPort(config: JevAdapterConfig = {}): JevPort {
  let client: TypeSafeClient | null = null;

  const getClient = (model: string): TypeSafeClient | null => {
    if (client) return client;
    const apiKey = config.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey || !apiKey.trim()) return null;
    try {
      client = new TypeSafeClient({
        apiKey,
        defaultModel: model,
        timeout: config.timeoutMs ?? JEV_ATTEMPT_TIMEOUT_MS,
        retry: { ...JEV_RETRY, ...(config.retry ?? {}) },
        logLevel: "error",
        logger: quietLogger,
        ...(config.fetch ? { fetch: config.fetch } : {}),
      });
    } catch {
      return null;
    }
    return client;
  };

  return {
    async choose(request: JevChoiceRequest, opts = {}): Promise<JevCallResult> {
      const c = getClient(request.model);
      if (!c) return failure("not_configured");

      let signal: AbortSignal | undefined;
      if (opts.deadlineMs !== undefined) {
        const remaining = opts.deadlineMs - Date.now();
        if (remaining <= 0) return failure("aborted");
        signal = AbortSignal.timeout(remaining);
      }

      const criteria: Record<string, string> = {};
      for (const label of request.choices) criteria[label.name] = label.description;

      try {
        const res = await c.systemOne(
          {
            model: request.model,
            // I7: the only place viewer-authored text goes.
            state: request.state as unknown as EntryType,
            questions: { [QUESTION]: choice(request.question, criteria) },
          },
          signal ? { signal } : undefined
        );
        const answer = res.answers[QUESTION];
        if (!answer || answer.type !== "choice" || typeof res.model !== "string") {
          return failure("invalid_response");
        }
        const probabilities: Record<string, number> = {};
        for (const [label, p] of Object.entries(answer.probabilities ?? {})) {
          probabilities[label] = p as number;
        }
        return {
          ok: true,
          result: {
            model: res.model,
            choice: answer.choice,
            probabilities,
            confidence: typeof answer.confidence === "number" ? answer.confidence : null,
            inputTokens: typeof res.usage?.input_tokens === "number" ? res.usage.input_tokens : null,
            outputTokens: typeof res.usage?.output_tokens === "number" ? res.usage.output_tokens : null,
          },
        };
      } catch (err) {
        return classifyJevError(err);
      }
    },
  };
}

/** The app's Jev port. Building it reads no env and makes no client. */
export const jevPort: JevPort = createJevPort();
