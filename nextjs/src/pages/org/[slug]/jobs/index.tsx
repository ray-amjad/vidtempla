/**
 * Org-scoped Jobs Page
 * Lists description-push jobs with live progress; drill into per-video outcomes.
 */

import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import JobsView from '@/components/jobs/JobsView';

export default function OrgJobsPage() {
  return (
    <OrganizationProvider>
      <Head>
        <title>Jobs | VidTempla</title>
      </Head>
      <DashboardLayout>
        <JobsView />
      </DashboardLayout>
    </OrganizationProvider>
  );
}
