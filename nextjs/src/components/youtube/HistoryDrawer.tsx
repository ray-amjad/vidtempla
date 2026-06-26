/**
 * History Drawer Component
 * Shows version history with rollback capability and drift resolution
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/ui/spinner';
import { RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

type HistoryVersion = RouterOutputs['dashboard']['youtube']['videos']['getHistory'][number];
type VideoData = RouterOutputs['dashboard']['youtube']['videos']['get'];

interface HistoryDrawerProps {
  videoId: string;
  videoTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const config: Record<string, { label: string; className: string }> = {
    initial_sync: { label: 'Sync', className: 'bg-muted text-muted-foreground border-muted' },
    template_push: { label: 'Template', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-600/20' },
    manual_youtube_edit: { label: 'Edited on YouTube', className: 'bg-warning/10 text-warning border-warning/20' },
    revert: { label: 'Revert', className: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-600/20' },
  };
  const c = config[source];
  if (!c) return null;
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
}

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function HistoryDrawer({
  videoId,
  videoTitle,
  open,
  onOpenChange,
  onSuccess,
}: HistoryDrawerProps) {
  const { toast } = useToast();
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [resolveConfirm, setResolveConfirm] = useState<'keep' | 'reapply' | null>(null);

  const { data: history, isLoading, refetch } = api.dashboard.youtube.videos.getHistory.useQuery(
    { videoId },
    { enabled: open }
  );

  const { data: currentVideo, refetch: refetchVideo } = api.dashboard.youtube.videos.get.useQuery(
    { videoId },
    { enabled: open }
  ) as { data: VideoData | undefined; refetch: () => void };

  const { data: variablesData } = api.dashboard.youtube.videos.getVariables.useQuery(
    { videoId },
    { enabled: open }
  );
  const variables = variablesData?.variables;

  const rollbackMutation = api.dashboard.youtube.videos.rollback.useMutation();
  const resolveDriftMutation = api.dashboard.youtube.videos.resolveDrift.useMutation();

  const toggleExpanded = (historyId: string) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(historyId)) {
        next.delete(historyId);
      } else {
        next.add(historyId);
      }
      return next;
    });
  };

  const handleRollback = async (historyId: string, versionNumber: number) => {
    try {
      const result = await rollbackMutation.mutateAsync({ videoId, historyId });

      if (result.delinkedContainer) {
        toast({
          title: 'Rollback successful',
          description: `Rolled back to version ${versionNumber}. Video delinked from container and ${result.variablesCleared} variable(s) cleared.`,
        });
      } else {
        toast({
          title: 'Rollback successful',
          description: `Rolled back to version ${versionNumber}.`,
        });
      }

      refetch();
      refetchVideo();
      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to rollback',
        variant: 'destructive',
      });
    }
  };

  const handleResolveDrift = async (strategy: 'keep_youtube_edit' | 'reapply_template') => {
    try {
      const result = await resolveDriftMutation.mutateAsync({
        videoId,
        strategy,
      });

      if (strategy === 'keep_youtube_edit') {
        toast({
          title: 'Drift resolved',
          description: `YouTube edit kept. Video delinked from container${result.variablesCleared ? ` and ${result.variablesCleared} variable(s) cleared` : ''}.`,
        });
      } else {
        toast({
          title: 'Template re-applied',
          description: 'Description rebuilt from template and pushed to YouTube.',
        });
      }

      setResolveConfirm(null);
      refetch();
      refetchVideo();
      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to resolve drift',
        variant: 'destructive',
      });
    }
  };

  const drifted = currentVideo?.driftDetectedAt != null;
  const hasContainer = !!currentVideo?.container;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Version History</SheetTitle>
          <p className="text-sm text-muted-foreground">{videoTitle}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Drift banner */}
          {drifted && (
            <div className="rounded-lg border border-warning/20 bg-warning/10 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-warning">
                    Drift detected {currentVideo?.driftDetectedAt ? timeAgo(currentVideo.driftDetectedAt) : ''}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Description was edited on YouTube Studio outside of VidTempla.
                  </p>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="border-warning/30">
                    Resolve drift
                    <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setResolveConfirm('keep')}>
                    Keep YouTube edit
                  </DropdownMenuItem>
                  {hasContainer ? (
                    <DropdownMenuItem onClick={() => setResolveConfirm('reapply')}>
                      Re-apply template
                    </DropdownMenuItem>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem disabled>
                            Re-apply template
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent>Assign the video to a container first.</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      // Just close the menu — user picks a version from the list below
                    }}
                  >
                    Revert to a previous version
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Keep YouTube edit confirmation */}
              <AlertDialog open={resolveConfirm === 'keep'} onOpenChange={(o) => !o && setResolveConfirm(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Keep YouTube edit?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This will preserve the description currently on YouTube.</p>
                      <div className="rounded-md border border-warning/20 bg-warning/10 p-3 space-y-1 text-sm">
                        <ul className="list-disc pl-6 space-y-1">
                          <li>Video will be removed from its container</li>
                          {variables && variables.length > 0 && (
                            <li>{variables.length} variable value(s) will be cleared</li>
                          )}
                        </ul>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleResolveDrift('keep_youtube_edit')}
                      disabled={resolveDriftMutation.isPending}
                    >
                      {resolveDriftMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                      Keep YouTube edit
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Re-apply template confirmation */}
              <AlertDialog open={resolveConfirm === 'reapply'} onOpenChange={(o) => !o && setResolveConfirm(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Re-apply template?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will overwrite the edit made on YouTube Studio with the current template output.
                      The manual edit will still be saved in version history.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleResolveDrift('reapply_template')}
                      disabled={resolveDriftMutation.isPending}
                    >
                      {resolveDriftMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                      Re-apply template
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-8 w-8 text-muted-foreground" />
            </div>
          ) : !history || history.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No version history available.</p>
            </div>
          ) : (
            history.map((version: HistoryVersion, index: number) => {
              const isExpanded = expandedVersions.has(version.id);
              const isCurrent = index === 0;
              const isManualEdit = version.source === 'manual_youtube_edit';

              return (
                <div
                  key={version.id}
                  className={`border rounded-lg p-4 ${
                    isCurrent ? 'border-primary bg-primary/5' : 'border-border'
                  } ${isManualEdit ? 'border-l-4 border-l-warning' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium">Version {version.versionNumber}</h4>
                        {isCurrent && (
                          <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded">
                            Current
                          </span>
                        )}
                        <SourceBadge source={version.source} />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(version.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleExpanded(version.id)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>

                      {!isCurrent && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Rollback
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Rollback to Version {version.versionNumber}?</AlertDialogTitle>
                              <AlertDialogDescription className="space-y-3">
                                <p>
                                  This will restore the description from{' '}
                                  {new Date(version.createdAt).toLocaleString()}.
                                </p>

                                {currentVideo?.container && (
                                  <div className="rounded-md border border-warning/20 bg-warning/10 p-3 space-y-2">
                                    <p className="font-semibold text-warning">
                                      Warning:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-1 text-sm">
                                      <li>Video will be removed from its container</li>
                                      {variables && variables.length > 0 && (
                                        <li>{variables.length} variable value(s) will be cleared</li>
                                      )}
                                      <li>Description will be updated on YouTube</li>
                                    </ul>
                                    <p className="text-xs text-muted-foreground mt-2">
                                      You can re-assign to a container later if needed.
                                    </p>
                                  </div>
                                )}

                                {!currentVideo?.container && (
                                  <p className="text-sm">
                                    The description will be updated on YouTube.
                                  </p>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  handleRollback(version.id, version.versionNumber)
                                }
                                disabled={rollbackMutation.isPending}
                              >
                                {rollbackMutation.isPending && (
                                  <Spinner className="mr-2 h-4 w-4" />
                                )}
                                {currentVideo?.container ? 'Restore Anyway' : 'Restore'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4">
                      <Textarea
                        value={version.description}
                        readOnly
                        rows={10}
                        className="font-mono text-sm resize-none"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {version.description.length} characters
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
