import { createNextApiHandler } from "@trpc/server/adapters/next";
import { appRouter } from "@/server/api/root";
import { db } from "@/db";
import { auth } from "@/lib/auth";

/**
 * Explicit duration ceiling for every tRPC procedure (issue #135). The worst
 * case is a 40-item bulk comment batch: 40 phase-0 reads + 40 phase-1 reads +
 * 40 phase-2 writes ≈ 48s of YouTube round-trips. Pinned equal to the MCP
 * handler's budget rather than inherited from a Vercel project default.
 *
 * This is the Pages Router, so the duration is declared through `config`, not
 * an `export const maxDuration`.
 */
export const config = { maxDuration: 60 };

export default createNextApiHandler({
  router: appRouter,
  createContext: async ({ req }) => {
    // Convert Node.js IncomingHttpHeaders to Web API Headers
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }

    const session = await auth.api.getSession({ headers });
    const organizationId =
      headers.get("x-organization-id") ??
      session?.session?.activeOrganizationId ??
      null;

    return {
      db,
      user: session?.user ?? null,
      organizationId,
    };
  },
});
