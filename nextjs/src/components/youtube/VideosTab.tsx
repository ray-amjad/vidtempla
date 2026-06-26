/**
 * Videos Tab Component
 * Manage videos and assign to containers
 */

import { useState, useRef, useEffect } from 'react';
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
import { Loader2, Play, Edit, History, AlertTriangle } from 'lucide-react';
import EditVariablesSheet from './EditVariablesSheet';
import HistoryDrawer from './HistoryDrawer';
import { youtubeWatchUrl, youtubeThumbnailUrl } from '@/utils/youtubeUrls';

type VideoWithRelations = RouterOutputs['dashboard']['youtube']['videos']['list']['data'][number];

type DriftFilter = 'all' | 'drifted' | 'clean';

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
  const { data, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.dashboard.youtube.videos.list.useInfiniteQuery(apiFilters, {
      getNextPageParam: (lastPage) => lastPage.meta.cursor ?? undefined,
    });
  const videos = data?.pages.flatMap((page) => page.data) ?? [];

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const assignMutation = api.dashboard.youtube.videos.assignToContainer.useMutation();

  // Per-video push status (Updating…/Retry/Failed) now lives on the Jobs page,
  // which groups each push into a trackable job. The Videos tab only renders the
  // drift badge below.

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
                        href={youtubeWatchUrl(video.videoId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block transition-opacity hover:opacity-80"
                      >
                        <img
                          src={youtubeThumbnailUrl(video.videoId)}
                          alt={video.title || 'Video thumbnail'}
                          className="w-24 h-auto rounded"
                        />
                      </a>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <a
                          href={youtubeWatchUrl(video.videoId)}
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
          {videos.length > 0 && (
            <>
              <div ref={loadMoreRef} />
              {isFetchingNextPage && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </>
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
