/**
 * Videos Tab Component
 * Manage videos and assign to containers
 */

import { useState, useEffect } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Play, Edit, History, AlertTriangle, RotateCw } from 'lucide-react';
import EditVariablesSheet from './EditVariablesSheet';
import HistoryDrawer from './HistoryDrawer';

type VideoWithRelations = RouterOutputs['dashboard']['youtube']['videos']['list'][number];

type DriftFilter = 'all' | 'drifted' | 'clean';

/** Whole hours from now until `when`, floored at 1 (so we never show "0h"). */
function hoursUntil(when: string | Date | null): number {
  if (!when) return 1;
  const ms = (when instanceof Date ? when : new Date(when)).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
}

export default function VideosTab() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<{ channelId: string; containerId: string; search: string; drift: DriftFilter }>({
    channelId: 'all',
    containerId: 'all',
    search: '',
    drift: 'all',
  });
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [editVariablesOpen, setEditVariablesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoWithRelations | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState('');

  const { data: channels } = api.dashboard.youtube.channels.list.useQuery();
  const { data: containers } = api.dashboard.youtube.containers.list.useQuery();

  // Convert "all" to empty string for the API query
  const apiFilters = {
    channelId: filters.channelId === 'all' ? '' : filters.channelId,
    containerId: filters.containerId === 'all' ? '' : filters.containerId,
    search: filters.search,
    hasDrift:
      filters.drift === 'drifted' ? true : filters.drift === 'clean' ? false : undefined,
  };
  const { data: videos, isLoading, refetch } = api.dashboard.youtube.videos.list.useQuery(apiFilters);
  const assignMutation = api.dashboard.youtube.videos.assignToContainer.useMutation();
  const retryPushMutation = api.dashboard.youtube.videos.retryPush.useMutation();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Live refresh while any video has a push in flight (queued/updating) or a
  // retry pending, so the badges clear one-by-one as each completes.
  useEffect(() => {
    const hasActivePush = videos?.some(
      (video) => video.pushStatus && video.pushStatus !== 'idle'
    );
    if (!hasActivePush) return;

    const interval = setInterval(() => {
      refetch();
    }, 15000);
    return () => clearInterval(interval);
  }, [videos, refetch]);

  const handleRetryPush = async (video: VideoWithRelations) => {
    setRetryingId(video.id);
    try {
      await retryPushMutation.mutateAsync({ videoId: video.id });
      toast({
        title: 'Retrying update',
        description: 'The description push has been re-queued.',
      });
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to retry update',
        variant: 'destructive',
      });
    } finally {
      setRetryingId(null);
    }
  };

  const handleAssign = async () => {
    if (!selectedVideo || !selectedContainerId) return;

    try {
      await assignMutation.mutateAsync({
        videoId: selectedVideo.id,
        containerId: selectedContainerId,
      });
      toast({
        title: 'Video assigned',
        description: 'The video has been assigned to the container successfully.',
      });
      setAssignDialogOpen(false);
      setSelectedVideo(null);
      setSelectedContainerId('');
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to assign video',
        variant: 'destructive',
      });
    }
  };

  const openAssignDialog = (video: VideoWithRelations) => {
    setSelectedVideo(video);
    setAssignDialogOpen(true);
  };

  const openEditVariables = (video: VideoWithRelations) => {
    setSelectedVideo(video);
    setEditVariablesOpen(true);
  };

  const openHistory = (video: VideoWithRelations) => {
    setSelectedVideo(video);
    setHistoryOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Videos</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your YouTube videos and assign them to containers
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 pb-0">
            <div>
              <Label htmlFor="channel-filter">Channel</Label>
              <Select
                value={filters.channelId}
                onValueChange={(value) => setFilters({ ...filters, channelId: value })}
              >
                <SelectTrigger id="channel-filter">
                  <SelectValue placeholder="All channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {channels?.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="container-filter">Container</Label>
              <Select
                value={filters.containerId}
                onValueChange={(value) => setFilters({ ...filters, containerId: value })}
              >
                <SelectTrigger id="container-filter">
                  <SelectValue placeholder="All containers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All containers</SelectItem>
                  {containers?.map((container) => (
                    <SelectItem key={container.id} value={container.id}>
                      {container.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="drift-filter">Drift</Label>
              <Select
                value={filters.drift}
                onValueChange={(value) => setFilters({ ...filters, drift: value as DriftFilter })}
              >
                <SelectTrigger id="drift-filter">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="drifted">Drifted only</SelectItem>
                  <SelectItem value="clean">Not drifted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search videos..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
          </div>

          {/* Videos List */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !videos || videos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {filters.drift === 'drifted'
                  ? 'No drift detected. All videos match what VidTempla last pushed.'
                  : 'No videos found. Sync your channel to import videos.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Thumbnail</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(videos as VideoWithRelations[]).map((video) => {
                  const drifted = video.driftDetectedAt != null;
                  return (
                  <TableRow
                    key={video.id}
                    className={drifted ? 'bg-yellow-500/5' : undefined}
                  >
                    <TableCell>
                      <a
                        href={`https://youtube.com/watch?v=${video.videoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block transition-opacity hover:opacity-80"
                      >
                        <img
                          src={`https://img.youtube.com/vi/${video.videoId}/default.jpg`}
                          alt={video.title || 'Video thumbnail'}
                          className="w-24 h-auto rounded"
                        />
                      </a>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <a
                          href={`https://youtube.com/watch?v=${video.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 hover:underline"
                        >
                          <Play className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{video.title}</span>
                        </a>
                        {drifted && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="w-fit border-yellow-600/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Edited on YouTube
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                Description was edited outside VidTempla on{' '}
                                {video.driftDetectedAt
                                  ? new Date(video.driftDetectedAt).toLocaleString()
                                  : 'an unknown date'}
                                . Click History to review.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {(video.pushStatus === 'queued' ||
                          video.pushStatus === 'updating') && (
                          <Badge
                            variant="outline"
                            className="w-fit border-primary/40 bg-primary/10 text-primary"
                          >
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Updating…
                          </Badge>
                        )}
                        {video.pushStatus === 'retry_scheduled' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="w-fit border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                >
                                  Retrying in {hoursUntil(video.nextRetryAt)}h
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {video.lastPushError ?? 'Update failed — a retry is scheduled.'}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {video.pushStatus === 'failed' && (
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="destructive" className="w-fit">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Update failed
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {video.lastPushError ??
                                    'The description push failed after multiple retries.'}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={retryingId === video.id}
                              onClick={() => handleRetryPush(video)}
                            >
                              {retryingId === video.id ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <RotateCw className="h-3 w-3 mr-1" />
                              )}
                              Retry now
                            </Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {video.channel?.channelId ? (
                        <a
                          href={`https://youtube.com/channel/${video.channel.channelId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {video.channel.title}
                        </a>
                      ) : (
                        video.channel?.title
                      )}
                    </TableCell>
                    <TableCell>
                      {video.container ? (
                        <span className="px-2 py-1 bg-primary/10 text-primary rounded text-sm">
                          {video.container.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {video.publishedAt
                        ? new Date(video.publishedAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {!video.containerId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssignDialog(video)}
                          >
                            Assign
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditVariables(video)}
                              title="Edit Variables"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openHistory(video)}
                              title="Version History"
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Assign Dialog */}
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign to Container</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Video</Label>
                <p className="text-sm text-muted-foreground">{selectedVideo?.title}</p>
              </div>
              <div>
                <Label htmlFor="container-select">Container</Label>
                <Select value={selectedContainerId} onValueChange={setSelectedContainerId}>
                  <SelectTrigger id="container-select">
                    <SelectValue placeholder="Select a container" />
                  </SelectTrigger>
                  <SelectContent>
                    {containers?.map((container) => (
                      <SelectItem key={container.id} value={container.id}>
                        {container.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground mt-2">
                  Note: Container assignment is permanent and cannot be changed.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAssign}
                  disabled={!selectedContainerId || assignMutation.isPending}
                >
                  {assignMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Assign
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Variables Sheet */}
        {selectedVideo && (
          <EditVariablesSheet
            key={selectedVideo.id}
            videoId={selectedVideo.id}
            videoTitle={selectedVideo.title ?? 'Untitled Video'}
            open={editVariablesOpen}
            onOpenChange={setEditVariablesOpen}
            onSuccess={refetch}
          />
        )}

        {/* History Drawer */}
        {selectedVideo && (
          <HistoryDrawer
            key={selectedVideo.id}
            videoId={selectedVideo.id}
            videoTitle={selectedVideo.title ?? 'Untitled Video'}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            onSuccess={refetch}
          />
        )}
      </CardContent>
    </Card>
  );
}
