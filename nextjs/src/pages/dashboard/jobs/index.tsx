/**
 * Jobs Page
 * Lists description-push jobs with live progress; drill into per-video outcomes.
 */

import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import JobsView from '@/components/jobs/JobsView';

export default function JobsPage() {
  return (
    <>
      <Head>
        <title>Jobs | VidTempla</title>
      </Head>
      <DashboardLayout>
        <JobsView />
      </DashboardLayout>
    </>
  );
}
