/**
 * Moderation tab (#156, Goal 4) — automatic comment classification with Jev.
 *
 * Pick a channel, then: the automation switch, the daily-cap pause banner with
 * Resume, the resolved model and last run (OverviewCard); the review queue and
 * "maybe release" list; every stored score; the action log; and the rules and
 * rubric editors with the dry run.
 *
 * Unlike the Comments tab, everything here reads comments VidTempla stored
 * during the sweep, so reads are free and refetch normally. The only paid
 * calls are explicit button presses (manual actions, release, dry run).
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOptionalOrganization } from '@/contexts/OrganizationContext';
import OverviewCard from './moderation/OverviewCard';
import ReviewQueueCard from './moderation/ReviewQueueCard';
import MaybeReleaseCard from './moderation/MaybeReleaseCard';
import ScoresCard from './moderation/ScoresCard';
import ActionLogCard from './moderation/ActionLogCard';
import RulesEditor from './moderation/RulesEditor';
import RubricEditor from './moderation/RubricEditor';
import { correctionLabels } from './moderation/shared';

function ChannelModeration({ channelId, canManage }: { channelId: string; canManage: boolean }) {
  const [section, setSection] = useState('review');
  const overview = api.dashboard.moderation.overview.useQuery({ channelId });
  const rubrics = api.dashboard.moderation.rubrics.useQuery({ channelId, history: 0 });

  if (overview.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return <p className="text-sm text-destructive">{overview.error?.message ?? 'Could not load moderation.'}</p>;
  }

  const publishedLabels = rubrics.data?.published?.labels.map((l) => l.name) ?? [];
  const suggestLabels = correctionLabels(rubrics.data);

  return (
    <div className="space-y-6">
      <OverviewCard channelId={channelId} overview={overview.data} canManage={canManage} />
      <Tabs value={section} onValueChange={setSection}>
        <TabsList>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="log">Action log</TabsTrigger>
          <TabsTrigger value="setup">Rules and rubric</TabsTrigger>
        </TabsList>
        <TabsContent value="review" className="mt-4 space-y-6">
          <ReviewQueueCard channelId={channelId} labels={suggestLabels} canManage={canManage} />
          <MaybeReleaseCard channelId={channelId} labels={suggestLabels} canManage={canManage} />
        </TabsContent>
        <TabsContent value="scores" className="mt-4">
          <ScoresCard channelId={channelId} labels={suggestLabels} />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <ActionLogCard channelId={channelId} />
        </TabsContent>
        <TabsContent value="setup" className="mt-4 space-y-6">
          <RulesEditor channelId={channelId} labels={publishedLabels} canManage={canManage} />
          <RubricEditor channelId={channelId} overview={overview.data} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ModerationTab() {
  const org = useOptionalOrganization();
  /**
   * Cosmetic only, as in CommentsTab. Outside an org-scoped route there is no
   * role in the client context, so the admin controls stay visible and
   * `orgAdminProcedure` rejects a member who presses them.
   */
  const canManage = org ? org.isAdmin : true;

  const { data: channels, isLoading } = api.dashboard.youtube.channels.list.useQuery();
  const [picked, setPicked] = useState('');
  // `youtube_channels.id` (uuid) — what every moderation procedure takes.
  const channelId = picked || channels?.[0]?.id || '';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="sm:w-64">
            <Label htmlFor="moderation-channel">Channel</Label>
            <Select value={channelId} onValueChange={setPicked}>
              <SelectTrigger id="moderation-channel" className="mt-1.5">
                <SelectValue placeholder={isLoading ? 'Loading…' : 'Select a channel'} />
              </SelectTrigger>
              <SelectContent>
                {channels?.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.title ?? channel.channelId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {channelId ? (
        <ChannelModeration key={channelId} channelId={channelId} canManage={canManage} />
      ) : (
        !isLoading && (
          <p className="py-8 text-center text-muted-foreground">
            Connect a YouTube channel to moderate its comments.
          </p>
        )
      )}
    </div>
  );
}
