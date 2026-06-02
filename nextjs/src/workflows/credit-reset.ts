import { db } from "@/db";
import { userCredits } from "@/db/schema";
import { lte } from "drizzle-orm";
import { getUserPlanTier, upsertCredits } from "@/lib/plan-limits";
import { PLAN_CONFIG } from "@/lib/stripe";

export async function creditResetWorkflow() {
  "use workflow";

  return await resetExpiredCredits();
}

async function resetExpiredCredits() {
  "use step";

  const expiredRows = await db
    .select({ organizationId: userCredits.organizationId, userId: userCredits.userId })
    .from(userCredits)
    .where(lte(userCredits.periodEnd, new Date()));

  for (const row of expiredRows) {
    const orgId = row.organizationId ?? row.userId;
    const tier = await getUserPlanTier(orgId, db);
    const allocation = PLAN_CONFIG[tier].monthlyCredits;
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    await upsertCredits(orgId, allocation, now, periodEnd);
  }

  console.log("[credit-reset] complete", { orgsReset: expiredRows.length });

  return {
    success: true,
    orgsReset: expiredRows.length,
    timestamp: new Date().toISOString(),
  };
}
