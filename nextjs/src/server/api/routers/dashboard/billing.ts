/**
 * Billing tRPC router
 * Handles all billing and subscription-related API procedures
 */

import { z } from "zod";
import { orgProcedure, orgAdminProcedure } from "@/server/trpc/init";
import { TRPCError } from "@trpc/server";
import { stripe } from "@/lib/stripe-server";
import {
  PLAN_CONFIG,
  type PlanTier,
  calculateProratedAmount,
  isUpgrade,
  getFeatureDifference,
  formatCents,
} from "@/lib/stripe";
import { db } from "@/db";
import { subscriptions, youtubeChannels, youtubeVideos } from "@/db/schema";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import { router } from "@/server/trpc/init";

async function getPreferredOrgSubscription(organizationId: string) {
  const orgSubscriptions = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .orderBy(desc(subscriptions.createdAt));

  return (
    orgSubscriptions.find((subscription) => subscription.stripeCustomerId) ??
    orgSubscriptions[0]
  );
}

async function createFreeSubscriptionForOrg(
  userId: string,
  organizationId: string,
) {
  const [newSubscription] = await db
    .insert(subscriptions)
    .values({
      userId,
      organizationId,
      planTier: "free",
      status: "active",
    })
    .onConflictDoNothing({
      target: subscriptions.organizationId,
      where: isNotNull(subscriptions.organizationId),
    })
    .returning();

  if (newSubscription) {
    return newSubscription;
  }

  const [existingSubscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);

  if (!existingSubscription) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create subscription",
    });
  }

  return existingSubscription;
}

export const billingRouter = router({
  /**
   * Get the current org's subscription plan
   */
  getCurrentPlan: orgProcedure.query(async ({ ctx }) => {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, ctx.organizationId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    // If no subscription exists, create a free tier subscription
    if (!subscription) {
      return createFreeSubscriptionForOrg(ctx.user.id, ctx.organizationId);
    }

    return subscription;
  }),

  /**
   * Create a checkout session for upgrading to a paid plan
   */
  createCheckoutSession: orgAdminProcedure
    .input(
      z.object({
        planTier: z.enum(["pro", "business"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Get plan configuration
        const planConfig = PLAN_CONFIG[input.planTier];
        if (!planConfig.priceId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid plan tier or price ID not configured",
          });
        }

        // Get or create subscription record
        let subscription = await getPreferredOrgSubscription(ctx.organizationId);

        // Create subscription record if it doesn't exist
        if (!subscription) {
          subscription = await createFreeSubscriptionForOrg(
            ctx.user.id,
            ctx.organizationId,
          );
        }

        // Create Stripe Checkout session
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          line_items: [
            {
              price: planConfig.priceId,
              quantity: 1,
            },
          ],
          success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?checkout=success`,
          cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/pricing`,
          ...(subscription?.stripeCustomerId
            ? { customer: subscription.stripeCustomerId }
            : { customer_email: ctx.user.email }),
          allow_promotion_codes: true,
          metadata: {
            userId: ctx.user.id,
            organizationId: ctx.organizationId,
            planTier: input.planTier,
          },
          subscription_data: {
            metadata: {
              userId: ctx.user.id,
              organizationId: ctx.organizationId,
              planTier: input.planTier,
            },
          },
        });

        return {
          checkoutUrl: session.url!,
          checkoutId: session.id,
        };
      } catch (error) {
        console.error("Checkout session creation error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create checkout session",
        });
      }
    }),

  /**
   * Get the customer portal URL for managing subscriptions
   */
  getCustomerPortalUrl: orgAdminProcedure.query(async ({ ctx }) => {
    try {
      const subscription = await getPreferredOrgSubscription(ctx.organizationId);
      const stripeCustomerId = subscription?.stripeCustomerId;

      if (!stripeCustomerId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No active subscription found",
        });
      }

      // Create Stripe Customer Portal session
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings`,
      });

      return {
        portalUrl: portalSession.url,
      };
    } catch (error) {
      console.error("Customer portal URL error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to get customer portal URL",
      });
    }
  }),

  /**
   * Get current usage statistics
   */
  getUsageStats: orgProcedure.query(async ({ ctx }) => {
    // Get channel count
    const channels = await db
      .select({ id: youtubeChannels.id })
      .from(youtubeChannels)
      .where(eq(youtubeChannels.organizationId, ctx.organizationId));

    // Get video count across all org's channels
    const channelIds = channels.map((c) => c.id);
    let videos: { id: string }[] = [];

    if (channelIds.length > 0) {
      videos = await db
        .select({ id: youtubeVideos.id })
        .from(youtubeVideos)
        .where(inArray(youtubeVideos.channelId, channelIds));
    }

    // Get current plan
    const [subscription] = await db
      .select({ planTier: subscriptions.planTier })
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, ctx.organizationId));

    const planTier = (subscription?.planTier as PlanTier) || "free";
    const limits = PLAN_CONFIG[planTier].features;

    return {
      channels: {
        current: channels.length,
        limit: limits.channelLimit,
      },
      videos: {
        current: videos.length,
        limit: limits.videoLimit,
      },
      planTier,
    };
  }),


  /**
   * Get upgrade preview with prorated amount calculation
   */
  getUpgradePreview: orgProcedure
    .input(
      z.object({
        targetPlanTier: z.enum(["pro", "business"]),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get current subscription
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, ctx.organizationId));

      if (!subscription) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No subscription found",
        });
      }

      const currentTier = subscription.planTier as PlanTier;
      const targetTier = input.targetPlanTier;

      // Get plan configurations
      const currentConfig = PLAN_CONFIG[currentTier];
      const targetConfig = PLAN_CONFIG[targetTier];

      // Check if this is actually an upgrade
      const isUpgrading = isUpgrade(currentTier, targetTier);

      // Calculate prorated amount if upgrading and has billing period
      let proratedAmount = 0;
      if (isUpgrading && subscription.currentPeriodEnd) {
        proratedAmount = calculateProratedAmount(
          currentConfig.priceMonthly,
          targetConfig.priceMonthly,
          new Date(subscription.currentPeriodEnd)
        );
      }

      // Get feature differences
      const featureDiff = getFeatureDifference(currentTier, targetTier);

      return {
        currentPlan: {
          tier: currentTier,
          name: currentConfig.name,
          priceMonthly: currentConfig.priceMonthly,
        },
        targetPlan: {
          tier: targetTier,
          name: targetConfig.name,
          priceMonthly: targetConfig.priceMonthly,
        },
        isUpgrade: isUpgrading,
        proratedAmount,
        proratedAmountFormatted: formatCents(proratedAmount),
        newMonthlyPriceFormatted: formatCents(targetConfig.priceMonthly),
        currentPeriodEnd: subscription.currentPeriodEnd,
        featuresGaining: featureDiff.gaining,
        featuresLosing: featureDiff.losing,
      };
    }),

  /**
   * Update subscription to a different plan
   */
  updateSubscription: orgAdminProcedure
    .input(
      z.object({
        targetPlanTier: z.enum(["free", "pro", "business"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get current subscription
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, ctx.organizationId));

      if (!subscription) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No subscription found. Please subscribe first.",
        });
      }

      // Check if subscription has a Stripe subscription ID
      if (!subscription.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active paid subscription found. Please subscribe first.",
        });
      }

      // Check subscription status
      if (subscription.status !== "active") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot change plan while subscription is ${subscription.status}. Please contact support.`,
        });
      }

      const currentTier = subscription.planTier as PlanTier;
      const targetTier = input.targetPlanTier;

      // Check if same plan
      if (currentTier === targetTier) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already on this plan",
        });
      }

      const isUpgrading = isUpgrade(currentTier, targetTier);

      try {
        // Handle downgrade to free (cancel subscription)
        if (targetTier === "free") {
          await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true,
          });

          // Update local subscription to reflect pending cancellation
          await db
            .update(subscriptions)
            .set({
              cancelAtPeriodEnd: true,
            })
            .where(eq(subscriptions.id, subscription.id));

          return {
            success: true,
            message: `Your subscription will be canceled at the end of the current billing period`,
            effectiveDate: subscription.currentPeriodEnd,
            isImmediate: false,
          };
        }

        // Get target price ID
        const targetConfig = PLAN_CONFIG[targetTier];
        if (!targetConfig.priceId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Target plan price ID not configured",
          });
        }

        // Get current subscription from Stripe
        const stripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );

        const firstItem = stripeSubscription.items.data[0];
        if (!firstItem) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Subscription has no items",
          });
        }

        // Update subscription with Stripe
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [
            {
              id: firstItem.id,
              price: targetConfig.priceId,
            },
          ],
          // Proration behavior:
          // - For upgrades: charge immediately (create_prorations + always_invoice)
          // - For downgrades: apply credit at next invoice (create_prorations)
          proration_behavior: "create_prorations",
          billing_cycle_anchor: isUpgrading ? "now" : "unchanged",
          ...(isUpgrading && {
            // For upgrades, invoice immediately
            payment_behavior: "default_incomplete",
          }),
        });

        // Note: The actual plan tier update will happen via webhook
        // when Stripe sends subscription.updated event

        if (isUpgrading) {
          return {
            success: true,
            message: `Successfully upgraded to ${targetConfig.name}! Your new features are available now.`,
            effectiveDate: new Date().toISOString(),
            isImmediate: true,
          };
        } else {
          return {
            success: true,
            message: `Your plan will change to ${targetConfig.name} at the end of your billing period`,
            effectiveDate: subscription.currentPeriodEnd,
            isImmediate: false,
          };
        }
      } catch (error) {
        console.error("Subscription update error:", error);

        // Handle specific Stripe errors
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("locked")) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Your subscription is currently being modified. Please try again in a few moments.",
          });
        }

        if (errorMessage.includes("payment")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Payment failed. Please update your payment method and try again.",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update subscription. Please try again later.",
        });
      }
    }),
});
