import { createMcpHandler } from "mcp-handler";
import { withMcpAuth } from "better-auth/plugins";
import { auth } from "@/lib/auth";
import { registerAllTools } from "@/lib/mcp/tools/register";
import { sessionStore } from "@/lib/mcp/helpers";
import { db } from "@/db";
import { member, session as sessionTable } from "@/db/schema";
import { and, eq, asc, desc } from "drizzle-orm";

// Create MCP handler once at module level (not per-request)
const mcpRouteHandler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  { serverInfo: { name: "VidTempla", version: "1.0.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true }
);

// Wrap with better-auth MCP OAuth, passing session via AsyncLocalStorage
const mcpHandler = withMcpAuth(auth, async (req, session) => {
  console.log("[MCP] Auth succeeded, userId:", session.userId);

  // Resolve user's organization for MCP context
  // Prefer activeOrganizationId from the user's most recent session, fallback to oldest membership
  // The role rides along with the organization it belongs to: `requireOrgAdmin`
  // gates the destructive tools on it, and both queries below already read the
  // membership row, so selecting it costs no extra query.
  let organizationId: string | undefined;
  let orgRole: string | undefined;

  const [latestSession] = await db
    .select({ activeOrganizationId: sessionTable.activeOrganizationId })
    .from(sessionTable)
    .where(eq(sessionTable.userId, session.userId))
    .orderBy(desc(sessionTable.updatedAt))
    .limit(1);

  if (latestSession?.activeOrganizationId) {
    // Verify the user is still a current member of that organization.
    // If they were removed but their session row still has the stale
    // activeOrganizationId, fall through to the membership-based fallback.
    const [activeMembership] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, session.userId),
          eq(member.organizationId, latestSession.activeOrganizationId)
        )
      )
      .limit(1);
    if (activeMembership) {
      organizationId = latestSession.activeOrganizationId;
      orgRole = activeMembership.role;
    }
  }

  if (!organizationId) {
    const [membership] = await db
      .select({ organizationId: member.organizationId, role: member.role })
      .from(member)
      .where(eq(member.userId, session.userId))
      .orderBy(asc(member.createdAt))
      .limit(1);
    organizationId = membership?.organizationId;
    orgRole = membership?.role;
  }

  if (!organizationId) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "No organization found for user" }, id: null },
      { status: 403 }
    );
  }

  return sessionStore.run(
    // `orgRole` comes from the same row that resolved `organizationId`, so it
    // is only ever undefined if that row carried no role at all; treat that as
    // the least privilege rather than as admin.
    { userId: session.userId, organizationId, orgRole: orgRole ?? "member" },
    () => mcpRouteHandler(req)
  );
});

const HANDLER_TIMEOUT_MS = 55_000;

async function getJsonRpcRequestId(req: Request): Promise<string | number | undefined> {
  const body = await req.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || !("id" in body)) return undefined;

  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

async function strictJsonRpcResponse(
  response: Response,
  requestId: string | number | undefined
): Promise<Response> {
  if (response.status !== 401) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || !("error" in body)) return response;

  const jsonRpcBody = body as {
    error?: { ["www-authenticate"]?: unknown };
  };
  if (!jsonRpcBody.error?.["www-authenticate"]) return response;

  delete jsonRpcBody.error["www-authenticate"];
  if (requestId !== undefined) {
    (jsonRpcBody as { id?: string | number }).id = requestId;
  }
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");

  return new Response(JSON.stringify(jsonRpcBody), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handler(req: Request): Promise<Response> {
  try {
    const requestId = await getJsonRpcRequestId(req);
    const response = await Promise.race([
      mcpHandler(req),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MCP handler timed out")), HANDLER_TIMEOUT_MS)
      ),
    ]);
    if (!response) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32603, message: "No response from handler" }, id: null },
        { status: 500 }
      );
    }
    return strictJsonRpcResponse(response, requestId);
  } catch (error) {
    console.error("[MCP] Handler error:", error);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" }, id: null },
      { status: 500 }
    );
  }
}

export { handler as GET, handler as POST, handler as DELETE };
