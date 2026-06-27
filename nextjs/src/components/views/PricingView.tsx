/**
 * Pricing View
 * Shared body for the dashboard and org-scoped Pricing pages.
 * Subscription tiers and pricing information
 */

import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/utils/api';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import PlanChangeConfirmDialog from '@/components/billing/PlanChangeConfirmDialog';
import { type PlanTier, isUpgrade as checkIsUpgrade, PLAN_CONFIG } from '@/lib/stripe';

const pricingTiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for trying out VidTempla',
    features: [
      'Up to 5 videos',
      '1 YouTube channel',
      '10,000 API credits / month',
      'Templates & containers',
      'MCP server & REST API access',
    ],
    limitations: [
      'Limited to 5 videos',
      'Single channel only',
      'No automatic description updates',
    ],
    buttonText: 'Current Plan',
    buttonVariant: 'outline' as const,
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$20',
    period: 'per month',
    description: 'For content creators managing one channel',
    features: [
      'Unlimited videos',
      '1 YouTube channel',
      '100,000 API credits / month',
      'Templates & containers',
      'Automatic description updates',
      'Version history & rollback',
    ],
    buttonText: 'Upgrade to Pro',
    buttonVariant: 'default' as const,
    highlighted: true,
  },
  {
    name: 'Business',
    price: '$100',
    period: 'per month',
    description: 'For agencies and businesses with multiple channels',
    features: [
      'Everything in Pro',
      'Unlimited YouTube channels',
      '500,000 API credits / month',
      'Team members',
      'Dedicated support',
    ],
    buttonText: 'Upgrade to Business',
    buttonVariant: 'default' as const,
    highlighted: false,
  },
];

export default function PricingView() {
  const { toast } = useToast();
  const utils = api.useUtils();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [planChangeDialog, setPlanChangeDialog] = useState<{
    open: boolean;
    targetPlan: PlanTier | null;
  }>({ open: false, targetPlan: null });

  // Fetch current subscription
  const { data: currentPlan, isLoading: planLoading } =
    api.dashboard.billing.getCurrentPlan.useQuery();

  // Fetch upgrade preview when dialog is open
  const { data: upgradePreview, isLoading: previewLoading } =
    api.dashboard.billing.getUpgradePreview.useQuery(
      { targetPlanTier: planChangeDialog.targetPlan as 'pro' | 'business' },
      {
        enabled: planChangeDialog.open && planChangeDialog.targetPlan !== null && planChangeDialog.targetPlan !== 'free',
      }
    );

  // Create checkout session mutation (for free users or resubscribing)
  const createCheckout = api.dashboard.billing.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      // Redirect to Stripe checkout
      window.location.href = data.checkoutUrl;
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create checkout session',
        description: error.message,
      });
      setCheckoutLoading(null);
    },
  });

  // Update subscription mutation (for existing subscribers)
  const updateSubscription = api.dashboard.billing.updateSubscription.useMutation({
    onSuccess: (data) => {
      toast({ title: data.message });
      setPlanChangeDialog({ open: false, targetPlan: null });
      // Invalidate queries to refresh data
      utils.dashboard.billing.getCurrentPlan.invalidate();
      utils.dashboard.billing.getUsageStats.invalidate();
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update subscription',
        description: error.message,
      });
    },
  });

  // Handle checkout for new subscriptions (free users or canceled users)
  const handleCheckout = async (planTier: 'pro' | 'business') => {
    setCheckoutLoading(planTier);
    createCheckout.mutate({ planTier });
  };

  // Handle plan change for existing subscribers
  const handlePlanChange = (targetTier: PlanTier) => {
    // If user doesn't have a Stripe subscription, use checkout flow
    if (!currentPlan?.stripeSubscriptionId || currentPlan?.status === 'canceled') {
      if (targetTier !== 'free') {
        handleCheckout(targetTier as 'pro' | 'business');
      }
      return;
    }

    // Open confirmation dialog for in-app plan change
    setPlanChangeDialog({ open: true, targetPlan: targetTier });
  };

  // Confirm plan change
  const handleConfirmPlanChange = () => {
    if (planChangeDialog.targetPlan) {
      updateSubscription.mutate({ targetPlanTier: planChangeDialog.targetPlan });
    }
  };

  const currentPlanTier = (currentPlan?.planTier?.toLowerCase() || 'free') as PlanTier;
  const hasActiveSubscription = currentPlan?.stripeSubscriptionId && currentPlan?.status === 'active';
  const isCanceled = currentPlan?.status === 'canceled' || currentPlan?.cancelAtPeriodEnd;

  return (
    <>
      <Head>
        <title>Pricing | VidTempla</title>
      </Head>
      <DashboardLayout title="Pricing Plans">
        <div className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            {pricingTiers.map((tier) => {
              const tierName = tier.name.toLowerCase() as PlanTier;
              const isCurrentPlan = tierName === currentPlanTier;
              const isLoading = checkoutLoading === tierName;
              const isUpgrading = checkIsUpgrade(currentPlanTier, tierName);

              // Determine button text and state based on current plan and subscription status
              let buttonText = tier.buttonText;
              let buttonDisabled = false;
              let buttonVariant: 'default' | 'outline' | 'destructive' = tier.buttonVariant;

              if (isCurrentPlan) {
                buttonText = 'Current Plan';
                buttonDisabled = true;
                buttonVariant = 'outline';
              } else if (tierName === 'free') {
                // Can only downgrade to free if on a paid plan with active subscription
                if (hasActiveSubscription && currentPlanTier !== 'free') {
                  buttonText = 'Downgrade to Free';
                  buttonVariant = 'outline';
                } else {
                  buttonDisabled = true;
                  buttonText = 'Free Plan';
                }
              } else if (isCanceled) {
                // Canceled users need to resubscribe
                buttonText = `Subscribe to ${tier.name}`;
              } else if (!hasActiveSubscription) {
                // Free users upgrading
                buttonText = `Upgrade to ${tier.name}`;
              } else if (isUpgrading) {
                // Active subscribers upgrading
                buttonText = `Upgrade to ${tier.name}`;
              } else {
                // Active subscribers downgrading
                buttonText = `Downgrade to ${tier.name}`;
                buttonVariant = 'outline';
              }

              return (
                <Card
                  key={tier.name}
                  className={`relative flex flex-col ${
                    tier.highlighted
                      ? 'border-primary shadow-lg scale-105'
                      : 'border-border'
                  } ${isCurrentPlan ? 'border-primary border-2' : ''}`}
                >
                  {tier.highlighted && !isCurrentPlan && (
                    <div className="absolute -top-3 left-0 right-0 flex justify-center">
                      <Badge>Most Popular</Badge>
                    </div>
                  )}

                  {isCurrentPlan && (
                    <div className="absolute -top-3 left-0 right-0 flex justify-center">
                      <Badge>Current Plan</Badge>
                    </div>
                  )}

                  <CardHeader className="text-center pb-6">
                    <CardTitle className="text-lg">{tier.name}</CardTitle>
                    <CardDescription>{tier.description}</CardDescription>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{tier.price}</span>
                      <span className="text-muted-foreground ml-2">/ {tier.period}</span>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-4">
                    <ul className="space-y-3">
                      {tier.features.map((feature, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <Check className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {tier.limitations && tier.limitations.length > 0 && (
                      <div className="pt-4 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Limitations:
                        </p>
                        <ul className="space-y-1">
                          {tier.limitations.map((limitation, index) => (
                            <li key={index} className="text-xs text-muted-foreground">
                              &bull; {limitation}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>

                  <CardFooter>
                    <Button
                      className="w-full"
                      variant={buttonVariant}
                      size="lg"
                      disabled={buttonDisabled || isLoading || planLoading}
                      onClick={() => handlePlanChange(tierName)}
                    >
                      {isLoading ? (
                        <>
                          <Spinner className="mr-2 h-4 w-4" />
                          Processing...
                        </>
                      ) : (
                        buttonText
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Plan Change Confirmation Dialog */}
        {planChangeDialog.targetPlan && (
          <PlanChangeConfirmDialog
            open={planChangeDialog.open}
            onOpenChange={(open) => {
              if (!open) {
                setPlanChangeDialog({ open: false, targetPlan: null });
              }
            }}
            currentPlan={{
              tier: currentPlanTier,
              name: PLAN_CONFIG[currentPlanTier].name,
            }}
            targetPlan={{
              tier: planChangeDialog.targetPlan,
              name: PLAN_CONFIG[planChangeDialog.targetPlan].name,
            }}
            isUpgrade={upgradePreview?.isUpgrade ?? checkIsUpgrade(currentPlanTier, planChangeDialog.targetPlan)}
            proratedAmountFormatted={upgradePreview?.proratedAmountFormatted ?? '$0.00'}
            newMonthlyPriceFormatted={upgradePreview?.newMonthlyPriceFormatted ?? PLAN_CONFIG[planChangeDialog.targetPlan].priceMonthly === 0 ? '$0.00' : `$${(PLAN_CONFIG[planChangeDialog.targetPlan].priceMonthly / 100).toFixed(2)}`}
            currentPeriodEnd={currentPlan?.currentPeriodEnd?.toISOString() ?? null}
            featuresGaining={upgradePreview?.featuresGaining ?? []}
            featuresLosing={upgradePreview?.featuresLosing ?? []}
            onConfirm={handleConfirmPlanChange}
            isLoading={updateSubscription.isPending || previewLoading}
          />
        )}
      </DashboardLayout>
    </>
  );
}
