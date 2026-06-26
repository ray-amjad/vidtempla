/**
 * Org-scoped Settings Page
 * User account settings and preferences
 */

import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/useUser';
import { Spinner } from '@/components/ui/spinner';
import { ExternalLink } from 'lucide-react';
import { api } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function OrgSettingsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const [portalLoading, setPortalLoading] = useState(false);

  // Fetch current subscription
  const { data: currentPlan, isLoading: planLoading } =
    api.dashboard.billing.getCurrentPlan.useQuery();

  // Fetch usage stats
  const { data: usageStats, isLoading: usageLoading } =
    api.dashboard.billing.getUsageStats.useQuery();

  // Get customer portal URL
  const getPortalUrl = api.dashboard.billing.getCustomerPortalUrl.useQuery(
    undefined,
    {
      enabled: false, // Don't fetch automatically
    }
  );

  // Check for checkout success
  const handledRef = useRef(false);
  useEffect(() => {
    if (!router.isReady || handledRef.current) return;
    if (router.query.checkout === 'success') {
      handledRef.current = true;
      toast({
        title: 'Subscription activated!',
        description: 'Your subscription has been successfully activated.',
      });
      // Clear the query parameter (preserve dynamic slug segment)
      const slug = router.query.slug as string;
      router.replace(
        { pathname: router.pathname, query: { slug } },
        undefined,
        { shallow: true },
      );
    }
  }, [router.isReady, router.query.checkout]);

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const result = await getPortalUrl.refetch();
      if (result.data?.portalUrl) {
        window.open(result.data.portalUrl, '_blank');
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to open customer portal',
        description: error instanceof Error ? error.message : 'Please try again later',
      });
    } finally {
      setPortalLoading(false);
    }
  };

  const formatDate = (dateString: string | Date) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <OrganizationProvider>
      <Head>
        <title>Settings | VidTempla</title>
      </Head>
      <DashboardLayout>
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>
                Your account details and contact information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                {userLoading ? (
                  <div className="flex items-center gap-2 p-2">
                    <Spinner className="h-4 w-4" />
                    <span className="text-sm text-muted-foreground">Loading...</span>
                  </div>
                ) : (
                  <Input
                    id="email"
                    type="email"
                    value={user?.email ?? ''}
                    disabled
                    className="bg-muted"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  This is the email address associated with your account.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan Information</CardTitle>
              <CardDescription>
                Your current subscription plan and usage
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {planLoading ? (
                <div className="flex items-center gap-2 p-2">
                  <Spinner className="h-4 w-4" />
                  <span className="text-sm text-muted-foreground">Loading plan details...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between py-2">
                    <span className="font-medium">Current Plan</span>
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium capitalize">
                      {currentPlan?.planTier || 'Free'}
                    </span>
                  </div>

                  {currentPlan?.status && (
                    <div className="flex items-center justify-between py-2">
                      <span className="font-medium">Status</span>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${
                        currentPlan.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        currentPlan.status === 'canceled' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {currentPlan.status}
                      </span>
                    </div>
                  )}

                  {currentPlan?.currentPeriodStart && currentPlan?.currentPeriodEnd && (
                    <div className="flex items-center justify-between py-2">
                      <span className="font-medium">Billing Period</span>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(currentPlan.currentPeriodStart)} - {formatDate(currentPlan.currentPeriodEnd)}
                      </span>
                    </div>
                  )}

                  {currentPlan?.cancelAtPeriodEnd && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-800">
                        Your subscription will be canceled at the end of the current billing period.
                      </p>
                    </div>
                  )}

                  {!usageLoading && usageStats && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium mb-3">Usage</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Videos</span>
                          <span>
                            {usageStats.videos.current} / {usageStats.videos.limit === Infinity ? '\u221E' : usageStats.videos.limit}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Channels</span>
                          <span>
                            {usageStats.channels.current} / {usageStats.channels.limit === Infinity ? '\u221E' : usageStats.channels.limit}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Link href={`/org/${router.query.slug}/pricing`} className="flex-1">
                <Button variant="outline" className="w-full">
                  View All Plans
                </Button>
              </Link>
              {currentPlan?.planTier !== 'free' && currentPlan?.stripeCustomerId && (
                <Button
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500"
                >
                  {portalLoading ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Manage Subscription
                    </>
                  )}
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      </DashboardLayout>
    </OrganizationProvider>
  );
}
