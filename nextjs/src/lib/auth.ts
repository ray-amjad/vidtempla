import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, mcp, organization } from "better-auth/plugins";
import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { subscriptions, userCredits, member as memberTable } from "@/db/schema";
import { PLAN_CONFIG } from "@/lib/stripe";
import { sendMagicLinkEmail } from "@/lib/email/senders/sendMagicLinkEmail";
import { sendOrgInviteEmail } from "@/lib/email/senders/sendOrgInviteEmail";

// Fail loudly rather than letting Better Auth fall back to the request Host
// header. auth.ts reads process.env directly, so this check does not depend on
// the env module having been imported first.
const baseURL = process.env.BETTER_AUTH_URL;

if (!baseURL) {
  throw new Error(
    "BETTER_AUTH_URL is not set. It is required so auth URLs and trusted origins are never derived from the request Host header."
  );
}

export const auth = betterAuth({
  baseURL,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db.transaction(async (tx) => {
            // Auto-create a personal organization for new users
            const orgId = crypto.randomUUID();
            const slug = (user.email.split("@")[0] ?? "user")
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, "-")
              .replace(/-+/g, "-")
              .slice(0, 30) + "-" + orgId.slice(0, 6);

            await tx.insert(schema.organization).values({
              id: orgId,
              name: user.name || user.email.split("@")[0] || "My Organization",
              slug,
              createdAt: new Date(),
            });

            await tx.insert(memberTable).values({
              id: crypto.randomUUID(),
              organizationId: orgId,
              userId: user.id,
              role: "owner",
              createdAt: new Date(),
            });

            // Create free-tier subscription for the org.
            // Idempotent against retries via the partial unique index on
            // organization_id (subscriptions_org_id_unique). The `where`
            // predicate must match the index predicate for Postgres to use it.
            await tx
              .insert(subscriptions)
              .values({
                organizationId: orgId,
                userId: user.id,
                planTier: "free",
                status: "active",
              })
              .onConflictDoNothing({
                target: subscriptions.organizationId,
                where: isNotNull(subscriptions.organizationId),
              });

            // Create credit allocation for the org
            const allocation = PLAN_CONFIG.free.monthlyCredits;
            const now = new Date();
            const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            await tx.insert(userCredits).values({
              organizationId: orgId,
              userId: user.id,
              balance: allocation,
              monthlyAllocation: allocation,
              periodStart: now,
              periodEnd,
            });
          });
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ email, url });
      },
    }),
    organization({
      sendInvitationEmail: async ({ email, id, organization: org, inviter }) => {
        const inviteUrl = `${baseURL}/invite/${id}`;
        await sendOrgInviteEmail({
          email,
          inviteUrl,
          inviterName: inviter.user.name || inviter.user.email,
          orgName: org.name,
        });
      },
    }),
    mcp({
      loginPage: "/sign-in",
      oidcConfig: {
        loginPage: "/sign-in",
        consentPage: "/auth/consent",
        // Kept on deliberately: MCP clients self-register at
        // /api/auth/mcp/register (RFC 7591), so turning this off would mean
        // hand-registering every client that wants to use the MCP server.
        // The trade-off is that anyone can create an oauthApplication row.
        // Nothing is granted by registration alone - a client still needs a
        // signed-in user to complete consent, and the consent page validates
        // the redirect URI scheme before navigating (see safeRedirectUri.ts).
        allowDynamicClientRegistration: true,
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
