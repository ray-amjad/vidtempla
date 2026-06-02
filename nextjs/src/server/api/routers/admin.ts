import { superAdminProcedure } from "../../trpc/init";
import { router } from "../../trpc/init";
import { db } from "@/db";
import { user, subscriptions, youtubeChannels } from "@/db/schema";
import { count, desc, eq, gte, ne } from "drizzle-orm";

export const siteAdminRouter = router({
  stats: superAdminProcedure.query(async () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalUsers, recentUsers, paidUsers, totalChannels] =
      await Promise.all([
        db.select({ count: count() }).from(user),
        db
          .select({ count: count() })
          .from(user)
          .where(gte(user.createdAt, sevenDaysAgo)),
        db
          .select({ count: count() })
          .from(subscriptions)
          .where(ne(subscriptions.planTier, "free")),
        db.select({ count: count() }).from(youtubeChannels),
      ]);

    return {
      totalUsers: totalUsers[0]!.count,
      recentUsers: recentUsers[0]!.count,
      paidUsers: paidUsers[0]!.count,
      totalChannels: totalChannels[0]!.count,
    };
  }),

  recentUsers: superAdminProcedure.query(async () => {
    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        planTier: subscriptions.planTier,
      })
      .from(user)
      .leftJoin(subscriptions, eq(user.id, subscriptions.userId))
      .orderBy(desc(user.createdAt))
      .limit(50);

    return users;
  }),
});
