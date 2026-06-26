/**
 * Jobs view — lists description-push jobs (one batch of per-video pushes from a
 * single user action) newest-first with live progress, and drills into a job to
 * show each video's outcome. Read-only.
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { youtubeWatchUrl, youtubeThumbnailUrl } from '@/utils/youtubeUrls';

type JobSummary = RouterOutputs['dashboard']['jobs']['list']['data'][number];

const TRIGGER_LABELS: Record<string, string> = {
  template_update: 'Template edit',
  container_update: 'Container edit',
  manual_push: 'Manual update',
  variable_edit: 'Variable edit',
  drift_resolve: 'Drift resolve',
  retry: 'Retry',
};

function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger;
}

type Counts = JobSummary['counts'];

/** "198/233 done · 30 in progress · 5 failed · 2 superseded" */
function progressSummary(total: number, counts: Counts): string {
  const active = counts.queued + counts.updating + counts.retry_scheduled;
  const segments = [`${counts.succeeded}/${total} done`];
  if (active > 0) segments.push(`${active} in progress`);
  if (counts.failed > 0) segments.push(`${counts.failed} failed`);
  if (counts.superseded > 0) segments.push(`${counts.superseded} superseded`);
  return segments.join(' · ');
}

type JobStatus = JobSummary['status'];

function JobStatusBadge({ status }: { status: JobStatus }) {
  if (status === 'running') {
    return (
      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
        <Spinner className="h-3 w-3 mr-1" />
        Running
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="warning">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Completed with errors
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      Completed
    </Badge>
  );
}

function ItemStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'succeeded':
      return (
        <Badge variant="success">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Done
        </Badge>
      );
    case 'queued':
    case 'updating':
      return (
        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
          <Spinner className="h-3 w-3 mr-1" />
          {status === 'queued' ? 'Queued' : 'Updating…'}
        </Badge>
      );
    case 'retry_scheduled':
      return (
        <Badge variant="warning">
          Retrying
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" className="w-fit">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'superseded':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Superseded
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function JobDetailSheet({
  jobId,
  jobLabel,
  open,
  onOpenChange,
}: {
  jobId: string | null;
  jobLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = api.dashboard.jobs.getItems.useQuery(
    { jobId: jobId ?? '' },
    {
      enabled: open && !!jobId,
      // Poll while the job is still running so the per-video outcomes tick over.
      refetchInterval: (data) =>
        data?.job.status === 'running' ? 15000 : false,
    }
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{jobLabel}</SheetTitle>
          {data?.job && (
            <p className="text-sm text-muted-foreground">
              {triggerLabel(data.job.trigger)} ·{' '}
              {progressSummary(data.job.totalVideos, data.job.counts)}
            </p>
          )}
        </SheetHeader>

        <div className="mt-6">
          {isLoading || !data ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-8 w-8 text-muted-foreground" />
            </div>
          ) : data.items.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No videos in this job.
            </p>
          ) : (
            <div className="space-y-2">
              {data.items.length < data.job.totalVideos && (
                <p className="text-xs text-muted-foreground pb-1">
                  Showing the first {data.items.length} of {data.job.totalVideos}{' '}
                  videos (failed and in-progress first).
                </p>
              )}
              {data.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border p-2"
                >
                  <a
                    href={youtubeWatchUrl(item.videoYoutubeId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 transition-opacity hover:opacity-80"
                  >
                    <img
                      src={youtubeThumbnailUrl(item.videoYoutubeId)}
                      alt={item.videoTitle || 'Video thumbnail'}
                      className="w-20 h-auto rounded"
                    />
                  </a>
                  <span className="flex-1 text-sm font-medium line-clamp-2">
                    {item.videoTitle ?? 'Untitled Video'}
                  </span>
                  {item.lastError ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">
                            <ItemStatusBadge status={item.status} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {item.lastError}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <ItemStatusBadge status={item.status} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function JobsView() {
  const [selectedJob, setSelectedJob] = useState<JobSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.dashboard.jobs.list.useInfiniteQuery(
    {},
    {
      getNextPageParam: (lastPage) => lastPage.meta.cursor ?? undefined,
      // Keep the list fresh while any job is still running; stop polling once
      // every job has settled (so we never leave a permanent background poll),
      // and pause entirely while the detail sheet is open over a job (the sheet
      // runs its own poll for the data actually on screen).
      refetchInterval: (data) =>
        !detailOpen &&
        data?.pages.some((page) =>
          page.data.some((job) => job.status === 'running')
        )
          ? 15000
          : false,
    }
  );

  const jobs = data?.pages.flatMap((page) => page.data) ?? [];

  const openDetail = (job: JobSummary) => {
    setSelectedJob(job);
    setDetailOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Each YouTube description push is grouped into a job. Track live progress
          and review past pushes.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No jobs yet. Editing a template, container, or variables — or pushing
              an update to YouTube — will create one.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow
                  key={job.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(job)}
                >
                  <TableCell className="font-medium">{job.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {triggerLabel(job.trigger)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {progressSummary(job.totalVideos, job.counts)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {hasNextPage && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage && (
                <Spinner className="mr-2 h-4 w-4" />
              )}
              Load more
            </Button>
          </div>
        )}
      </CardContent>

      <JobDetailSheet
        jobId={selectedJob?.id ?? null}
        jobLabel={selectedJob?.label ?? 'Job'}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </Card>
  );
}
