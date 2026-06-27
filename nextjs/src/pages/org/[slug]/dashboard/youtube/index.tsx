import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ChannelsTab from '@/components/youtube/ChannelsTab';
import TemplatesTab from '@/components/youtube/TemplatesTab';
import ContainersTab from '@/components/youtube/ContainersTab';
import VideosTab from '@/components/youtube/VideosTab';
import { useToast } from '@/hooks/use-toast';

export default function OrgYouTubePage() {
  const [activeTab, setActiveTab] = useState('channels');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const { error } = router.query;
    if (error && typeof error === 'string') {
      toast({ variant: 'destructive', title: 'Error', description: error });
      const { error: _, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.query, toast]);

  return (
    <OrganizationProvider>
      <Head>
        <title>YouTube Manager | VidTempla</title>
      </Head>
      <DashboardLayout
        title="YouTube Manager"
        description="Manage your channels, videos, containers, and templates."
      >
        <div className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="channels">Channels</TabsTrigger>
              <TabsTrigger value="videos">Videos</TabsTrigger>
              <TabsTrigger value="containers">Containers</TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
            </TabsList>
            <TabsContent value="channels" className="mt-6"><ChannelsTab /></TabsContent>
            <TabsContent value="videos" className="mt-6"><VideosTab /></TabsContent>
            <TabsContent value="containers" className="mt-6"><ContainersTab /></TabsContent>
            <TabsContent value="templates" className="mt-6"><TemplatesTab /></TabsContent>
          </Tabs>
        </div>
      </DashboardLayout>
    </OrganizationProvider>
  );
}
