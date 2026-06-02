/**
 * Plan limits utility
 * Provides functions to check and enforce subscription plan limits
 * All limits are scoped to organizations, not individual users.
 */

import { TRPCError } from "@trpc/server";
import { PLAN_CONFIG, type PlanTier } from "./stripe";
import type { Database } from "@/db";
import { db as defaultDb } from "@/db";
import { subscriptions, youtubeChannels, youtubeVideos, userCredits } from "@/db/schema";
import { eq, and, count, inArray, sql } from "drizzle-orm";

/**
 * Get the organization's current plan tier
 */
export async function getUserPlanTier(
  organizationId: string,
  db: Database
): Promise<PlanTier> {
  const [subscription] = await db
    .select({ planTier: subscriptions.planTier })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));

  return (subscription?.planTier as PlanTier) || "free";
}

/**
 * Get plan features for a given tier
 */
export function getPlanFeatures(planTier: PlanTier) {
  return PLAN_CONFIG[planTier].features;
}

/**
 * Check if org has reached their video limit
 */
export async function checkVideoLimit(
  organizationId: string,
  db: Database
): Promise<{
  canAddVideo: boolean;
  currentCount: number;
  limit: number;
  planTier: PlanTier;
}> {
  const planTier = await getUserPlanTier(organizationId, db);
  const features = getPlanFeatures(planTier);

  const channels = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(eq(youtubeChannels.organizationId, organizationId));

  const channelIds = channels.map((c) => c.id);

  if (channelIds.length === 0) {
    return {
      canAddVideo: true,
      currentCount: 0,
      limit: features.videoLimit,
      planTier,
    };
  }

  const [result] = await db
    .select({ count: count() })
    .from(youtubeVideos)
    .where(inArray(youtubeVideos.channelId, channelIds));

  const currentCount = result?.count || 0;
  const limit = features.videoLimit;

  return {
    canAddVideo: currentCount < limit,
    currentCount,
    limit,
    planTier,
  };
}

/**
 * Check if org has reached their channel limit
 */
export async function checkChannelLimit(
  organizationId: string,
  db: Database
): Promise<{
  canAddChannel: boolean;
  currentCount: number;
  limit: number;
  planTier: PlanTier;
}> {
  const planTier = await getUserPlanTier(organizationId, db);
  const features = getPlanFeatures(planTier);

  const [result] = await db
    .select({ count: count() })
    .from(youtubeChannels)
    .where(eq(youtubeChannels.organizationId, organizationId));

  const currentCount = result?.count || 0;
  const limit = features.channelLimit;

  return {
    canAddChannel: currentCount < limit,
    currentCount,
    limit,
    planTier,
  };
}

/**
 * Enforce video limit - throws error if limit is reached
 */
export async function enforceVideoLimit(
  organizationId: string,
  db: Database
): Promise<void> {
  const result = await checkVideoLimit(organizationId, db);

  if (!result.canAddVideo) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You have reached your video limit (${result.limit} videos on the ${result.planTier} plan). Please upgrade your plan to add more videos.`,
    });
  }
}

/**
 * Enforce channel limit - throws error if limit is reached
 */
export async function enforceChannelLimit(
  organizationId: string,
  db: Database
): Promise<void> {
  const result = await checkChannelLimit(organizationId, db);

  if (!result.canAddChannel) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You have reached your channel limit (${result.limit} ${result.limit === 1 ? "channel" : "channels"} on the ${result.planTier} plan). Please upgrade your plan to add more channels.`,
    });
  }
}

/**
 * Check if org has access to auto-update feature
 */
export async function hasAutoUpdateAccess(
  organizationId: string,
  db: Database
): Promise<boolean> {
  const planTier = await getUserPlanTier(organizationId, db);
  const features = getPlanFeatures(planTier);
  return features.autoUpdate;
}

/**
 * Check if org has access to team features
 */
export async function hasTeamFeaturesAccess(
  organizationId: string,
  db: Database
): Promise<boolean> {
  const planTier = await getUserPlanTier(organizationId, db);
  const features = getPlanFeatures(planTier);
  return 'teamFeatures' in features ? features.teamFeatures : false;
}

/**
 * Consume credits atomically. Returns { success, remaining }.
 * If no userCredits row exists (transition period), lazily provisions free-tier credits.
 */
export async function consumeCredits(
  organizationId: string,
  quotaUnits: number
): Promise<{ success: boolean; remaining: number }> {
  if (quotaUnits <= 0) return { success: true, remaining: Infinity };

  try {
    // Check if period has expired and replenish if needed
    const [currentRow] = await defaultDb
      .select({ id: userCredits.id, periodEnd: userCredits.periodEnd })
      .from(userCredits)
      .where(eq(userCredits.organizationId, organizationId));

    if (currentRow && currentRow.periodEnd <= new Date()) {
      const planTier = await getUserPlanTier(organizationId, defaultDb);
      const allocation = PLAN_CONFIG[planTier].monthlyCredits;
      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await upsertCredits(organizationId, allocation, now, periodEnd);
    }

    // Try atomic decrement
    const rows = await defaultDb.execute<{ balance: number }>(
      sql`UPDATE user_credits SET balance = balance - ${quotaUnits}, updated_at = NOW() WHERE organization_id = ${organizationId} AND balance >= ${quotaUnits} RETURNING balance`
    );

    if (rows.length > 0) {
      return { success: true, remaining: rows[0]!.balance };
    }

    // No row — lazy provision
    if (!currentRow) {
      const planTier = await getUserPlanTier(organizationId, defaultDb);
      const allocation = PLAN_CONFIG[planTier].monthlyCredits;
      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await upsertCredits(organizationId, allocation, now, periodEnd);

      const retryRows = await defaultDb.execute<{ balance: number }>(
        sql`UPDATE user_credits SET balance = balance - ${quotaUnits}, updated_at = NOW() WHERE organization_id = ${organizationId} AND balance >= ${quotaUnits} RETURNING balance`
      );
      if (retryRows.length > 0) {
        return { success: true, remaining: retryRows[0]!.balance };
      }
      return { success: false, remaining: 0 };
    }

    // Row exists but insufficient balance
    return { success: false, remaining: 0 };
  } catch (err) {
    // Fail open: surface the underlying cause and allow the request through so a
    // metering bug never takes down API/MCP access. Drizzle wraps the postgres
    // error in DrizzleQueryError; .cause carries the real PostgresError.
    const cause = (err as { cause?: unknown })?.cause;
    console.error("[consumeCredits] DB error — failing open", {
      organizationId,
      quotaUnits,
      error: err instanceof Error ? err.message : String(err),
      cause: cause instanceof Error
        ? { message: cause.message, ...(cause as unknown as Record<string, unknown>) }
        : cause,
    });
    return { success: true, remaining: Infinity };
  }
}

/**
 * Get current credit balance and period info for an organization.
 */
export async function getCredits(
  organizationId: string
): Promise<{
  balance: number;
  monthlyAllocation: number;
  periodStart: Date;
  periodEnd: Date;
} | null> {
  const [row] = await defaultDb
    .select()
    .from(userCredits)
    .where(eq(userCredits.organizationId, organizationId));

  if (!row) return null;

  return {
    balance: row.balance,
    monthlyAllocation: row.monthlyAllocation,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

/**
 * Insert or update an organization's credit allocation.
 */
export async function upsertCredits(organizationId: string, allocation: number, periodStart: Date, periodEnd: Date, userId?: string) {
  // Resolve a valid userId for the FK: use provided userId, or look up the org owner
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { member } = await import("@/db/schema");
    const [owner] = await defaultDb
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.role, "owner")))
      .limit(1);
    resolvedUserId = owner?.userId ?? undefined;
    if (!resolvedUserId) {
      // Fallback: any member
      const [anyMember] = await defaultDb
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, organizationId))
        .limit(1);
      resolvedUserId = anyMember?.userId;
    }
    if (!resolvedUserId) {
      console.error(`upsertCredits: no members found for org ${organizationId}`);
      return;
    }
  }

  // Cast the Date to an ISO string with an explicit ::timestamptz. Drizzle's
  // tagged `sql` template does not apply column type encoders to interpolated
  // values, so passing a Date directly serializes it as JS .toString()
  // ("Tue Jun 02 2026 00:00:45 GMT+0000"), which Postgres cannot cast to
  // timestamptz — the upsert then fails for every credit reset/consume.
  const periodStartIso = periodStart.toISOString();
  await defaultDb.insert(userCredits).values({
    organizationId, userId: resolvedUserId, balance: allocation, monthlyAllocation: allocation, periodStart, periodEnd,
  }).onConflictDoUpdate({
    target: userCredits.organizationId,
    set: {
      // Only reset balance to allocation when the period rolls over (periodStart changes).
      // Mid-period updates (card change, proration, metadata edit) preserve consumed credits.
      balance: sql`CASE WHEN ${userCredits.periodStart} = ${periodStartIso}::timestamptz THEN ${userCredits.balance} ELSE ${allocation} END`,
      monthlyAllocation: allocation,
      periodStart,
      periodEnd,
      updatedAt: new Date(),
    },
  });
}
