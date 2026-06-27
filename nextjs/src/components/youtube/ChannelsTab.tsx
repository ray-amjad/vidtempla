/**
 * Channels Tab Component
 * Manage connected YouTube channels
 */

import { useState, useEffect } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from "@/components/ui/spinner";
import { Unplug, RefreshCw, Plus, ArrowUpRight, AlertTriangle, Link2 } from 'lucide-react';
import DisconnectConfirmDialog from './DisconnectConfirmDialog';
import Image from 'next/image';
import { formatDateTime, formatNumber } from '@/lib/format';
import Link from 'next/link';
export default function ChannelsTab() {
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [channelToDisconnect, setChannelToDisconnect] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const { data: channels, isLoading, refetch } = api.dashboard.youtube.channels.list.useQuery();
  const { data: limitCheck } = api.dashboard.youtube.channels.checkLimit.useQuery();
  const disconnectMutation = api.dashboard.youtube.channels.disconnect.useMutation();
  const syncMutation = api.dashboard.youtube.channels.syncVideos.useMutation();

  // Auto-refresh when any channel is syncing
  useEffect(() => {
    const hasSyncingChannels = channels?.some(
      (channel) => channel.syncStatus === 'syncing'
    );

    if (hasSyncingChannels) {
      // Refresh every 15 seconds while syncing
      const interval = setInterval(() => {
        refetch();
      }, 15000);

      return () => clearInterval(interval);
    }
  }, [channels, refetch]);

  const formatTimestamp = (timestamp: string | Date | null) => {
    if (!timestamp) return 'Never';
    return formatDateTime(timestamp);
  };

  const handleConnect = () => {
    if (limitCheck && !limitCheck.canAddChannel) {
      toast({
        variant: 'destructive',
        title: 'Channel limit reached',
        description: `You've reached your limit of ${limitCheck.limit} ${limitCheck.limit === 1 ? 'channel' : 'channels'} on the ${limitCheck.planTier} plan. Please upgrade to add more channels.`,
      });
      return;
    }
    window.location.href = '/api/auth/youtube/initiate';
  };

  const openDisconnectDialog = (channel: { id: string; title: string | null }) => {
    setChannelToDisconnect({ id: channel.id, title: channel.title || 'Unknown Channel' });
    setDisconnectDialogOpen(true);
  };

  const handleDisconnect = async () => {
    if (!channelToDisconnect) return;

    setDeletingId(channelToDisconnect.id);
    try {
      await disconnectMutation.mutateAsync({ channelId: channelToDisconnect.id });
      toast({
        title: 'Channel disconnected',
        description: 'The channel has been removed successfully.',
      });
      setDisconnectDialogOpen(false);
      setChannelToDisconnect(null);
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to disconnect channel',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleReconnect = () => {
    // Redirect to OAuth flow - will update existing channel tokens
    window.location.href = '/api/auth/youtube/initiate';
  };

  const handleSync = async (channelId: string) => {
    setSyncingId(channelId);
    try {
      await syncMutation.mutateAsync({ channelId });
      toast({
        title: 'Sync started',
        description: 'Videos are being synced in the background. This may take a few minutes.',
      });
      // Immediately refetch to show syncing status
      await refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to sync videos',
        variant: 'destructive',
      });
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg">YouTube Channels</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your YouTube channels to manage video descriptions
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : !channels || channels.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              No channels connected yet
            </p>
            <Button onClick={handleConnect} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Connect Your First Channel
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Subscribers</TableHead>
                <TableHead>Last Synced</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels?.map((channel) => {
                const isTokenInvalid = channel.tokenStatus === 'invalid';

                return (
                  <TableRow key={channel.id} className={isTokenInvalid ? 'bg-destructive/5' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {channel.thumbnailUrl && channel.channelId && (
                          <a
                            href={`https://youtube.com/channel/${channel.channelId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block transition-opacity hover:opacity-80"
                          >
                            <Image
                              src={channel.thumbnailUrl}
                              alt={channel.title || 'Channel'}
                              width={40}
                              height={40}
                              className="rounded-full"
                            />
                          </a>
                        )}
                        {channel.thumbnailUrl && !channel.channelId && (
                          <Image
                            src={channel.thumbnailUrl}
                            alt={channel.title || 'Channel'}
                            width={40}
                            height={40}
                            className="rounded-full"
                          />
                        )}
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            {channel.channelId ? (
                              <a
                                href={`https://youtube.com/channel/${channel.channelId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium hover:underline"
                              >
                                {channel.title}
                              </a>
                            ) : (
                              <span className="font-medium">{channel.title}</span>
                            )}
                            {isTokenInvalid && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                                <AlertTriangle className="h-3 w-3" />
                                Reconnect Required
                              </span>
                            )}
                          </div>
                          {isTokenInvalid && (
                            <span className="text-xs text-muted-foreground">
                              Authorization expired. Click Reconnect to restore access.
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {channel.subscriberCount != null ? formatNumber(channel.subscriberCount) : '—'}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {formatTimestamp(channel.lastSyncedAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isTokenInvalid ? (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={handleReconnect}
                            className="gap-1"
                          >
                            <Link2 className="h-4 w-4" />
                            Reconnect
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSync(channel.id)}
                            disabled={syncingId === channel.id || channel.syncStatus === 'syncing'}
                          >
                            {syncingId === channel.id || channel.syncStatus === 'syncing' ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDisconnectDialog(channel)}
                          disabled={deletingId === channel.id}
                        >
                          {deletingId === channel.id ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <Unplug className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Connect New Channel Button (shown when channels exist) */}
        {!isLoading && channels && channels.length > 0 && (
          <div className="p-6 border-t bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Connected Channels: {limitCheck?.currentCount || channels.length} / {limitCheck?.limit || '∞'}
                </p>
                {limitCheck && !limitCheck.canAddChannel && (
                  <p className="text-sm text-muted-foreground mt-1">
                    You've reached your channel limit on the {limitCheck.planTier} plan.{' '}
                    <Link href="/dashboard/pricing" className="text-primary hover:underline inline-flex items-center">
                      Upgrade to add more
                      <ArrowUpRight className="h-3 w-3 ml-1" />
                    </Link>
                  </p>
                )}
              </div>
              <Button
                onClick={handleConnect}
                variant={limitCheck?.canAddChannel ? "default" : "outline"}
              >
                <Plus className="mr-2 h-4 w-4" />
                Connect New Channel
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <DisconnectConfirmDialog
        open={disconnectDialogOpen}
        onOpenChange={setDisconnectDialogOpen}
        channelTitle={channelToDisconnect?.title || ''}
        onConfirm={handleDisconnect}
        isDeleting={deletingId !== null}
      />
    </Card>
  );
}
