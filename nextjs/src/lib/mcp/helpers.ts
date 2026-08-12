import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/db";
import { apiRequestLog } from "@/db/schema";
import type { JsonValue } from "@/lib/services/types";

const sessionStore = new AsyncLocalStorage<{
  userId: string;
  organizationId: string;
  /** The caller's `member.role` in that organization — see `requireOrgAdmin`. */
  orgRole: string;
}>();

export { sessionStore };

export function getSessionUserId(): string {
  const session = sessionStore.getStore();
  if (!session) throw new Error("No MCP session available");
  return session.userId;
}

export function getSessionOrgId(): string {
  const session = sessionStore.getStore();
  if (!session) throw new Error("No MCP session available");
  return session.organizationId;
}

export function getSessionOrgRole(): string {
  const session = sessionStore.getStore();
  if (!session) throw new Error("No MCP session available");
  return session.orgRole;
}

/**
 * Wraps data as MCP tool result content.
 *
 * Unindented on purpose: comment threads nest six levels deep, so pretty
 * printing spent 8-12 leading spaces on most lines of the largest responses.
 * This is transport, not a document — no consumer reads it unparsed.
 */
export function mcpJson<T>(data: T) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data) },
    ],
  };
}

/** Tool annotations for Claude Desktop permission grouping. */
export const READ = { readOnlyHint: true, destructiveHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

/**
 * Logs an MCP tool request to the apiRequestLog table (fire-and-forget).
 */
export function logMcpRequest(
  userId: string,
  toolName: string,
  quotaUnits: number,
  statusCode: number
): void {
  const session = sessionStore.getStore();
  db.insert(apiRequestLog)
    .values({
      apiKeyId: null,
      userId,
      organizationId: session?.organizationId ?? null,
      endpoint: toolName,
      method: "MCP",
      statusCode,
      quotaUnits,
      source: "mcp",
    })
    .then(() => {})
    .catch((err) => console.error("Failed to log MCP request:", err));
}

/**
 * Converts a service result (data or error) to MCP tool result format.
 */
export function toMcp<T>(result: { data: T } | { error: { code: string; message: string; suggestion: string; meta?: Record<string, JsonValue> } }) {
  if ("error" in result) return mcpError(result.error.code, result.error.message, result.error.suggestion, result.error.meta);
  return mcpJson(result.data);
}

/**
 * Refuses a destructive tool to anyone below admin, and returns the refusal to
 * hand straight back — `const denied = requireOrgAdmin(userId, tool); if
 * (denied) return denied;`. Returns null when the call may proceed.
 *
 * The predicate is the one `orgAdminProcedure` applies to the dashboard
 * (`src/server/trpc/init.ts`): owner and admin, nobody else. tRPC used to be
 * the only surface that checked, which left every destructive operation
 * reachable by any member through MCP.
 *
 * The refusal is logged like any other call, so a blocked attempt still shows
 * up in usage — a 403 with no YouTube call and no credits.
 */
export function requireOrgAdmin(userId: string, toolName: string) {
  const role = getSessionOrgRole();
  if (role === "owner" || role === "admin") return null;
  logMcpRequest(userId, toolName, 0, 403);
  return mcpError(
    "FORBIDDEN_ROLE",
    "This operation requires the owner or admin role in this workspace",
    `Your role is '${role}'. Ask an owner or admin of the workspace to run it, or to raise your role.`
  );
}

/**
 * Standard quota-exceeded response for MCP tools.
 */
export function mcpQuotaExceeded(userId: string, toolName: string) {
  logMcpRequest(userId, toolName, 0, 429);
  return mcpError("QUOTA_EXCEEDED", "Insufficient credits", "Upgrade your plan or wait for the next billing cycle");
}

export function mcpError(code: string, message: string, suggestion?: string, meta?: Record<string, JsonValue>) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { error: { code, message, suggestion, ...(meta ? { meta } : {}) } },
          null,
          2
        ),
      },
    ],
  };
}
