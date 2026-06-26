/**
 * Edit Variables Sheet Component
 * Allows users to edit video-specific variable values
 */

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { buildDescription } from '@/utils/templateParser';

type VideoVariableData = RouterOutputs['dashboard']['youtube']['videos']['getVariables'];
type VideoVariable = NonNullable<VideoVariableData['variables']>[number];

interface EditVariablesSheetProps {
  videoId: string;
  videoTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function EditVariablesSheet({
  videoId,
  videoTitle,
  open,
  onOpenChange,
  onSuccess,
}: EditVariablesSheetProps) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);
  const [driftDialogOpen, setDriftDialogOpen] = useState(false);
  const [driftInfo, setDriftInfo] = useState<{ driftDetectedAt?: string } | null>(null);
  const [formData, setFormData] = useState<
    Record<
      string,
      {
        templateId: string;
        name: string;
        value: string;
        templateName: string;
      }
    >
  >({});

  const { data: variablesData, isLoading } = api.dashboard.youtube.videos.getVariables.useQuery(
    { videoId },
    { enabled: open, refetchOnWindowFocus: false }
  );

  const updateMutation = api.dashboard.youtube.videos.updateVariables.useMutation();
  const resolveDriftMutation = api.dashboard.youtube.videos.resolveDrift.useMutation();

  // Reset form state when sheet closes
  useEffect(() => {
    if (!open) {
      setFormData({});
      setFormInitialized(false);
    }
  }, [open]);

  // Initialize form data once when variables first load (ignore subsequent refetches)
  useEffect(() => {
    if (variablesData?.variables && !formInitialized) {
      const initialData: typeof formData = {};
      variablesData.variables.forEach((variable: VideoVariable) => {
        const key = `${variable.templateId}-${variable.variableName}`;
        initialData[key] = {
          templateId: variable.templateId,
          name: variable.variableName,
          value: variable.variableValue || '',
          templateName: variable.template?.name || 'Unknown Template',
        };
      });
      setFormData(initialData);
      setFormInitialized(true);
    }
  }, [variablesData, formInitialized]);

  const handleValueChange = (key: string, value: string) => {
    setFormData((prev) => {
      if (!prev[key]) return prev;
      return {
        ...prev,
        [key]: {
          ...prev[key],
          value,
        },
      };
    });
  };

  const saveVariables = async (force?: boolean) => {
    const variablesArray = Object.values(formData).map((v) => ({
      templateId: v.templateId,
      name: v.name,
      value: v.value,
    }));

    await updateMutation.mutateAsync({
      videoId,
      variables: variablesArray,
      force,
    });

    // Refresh the cached variables (while the sheet is still open) so reopening
    // shows the values we just saved instead of the stale pre-save cache.
    await utils.dashboard.youtube.videos.getVariables.invalidate({ videoId });

    toast({
      title: 'Variables saved and update queued',
      description: 'Video variables have been saved and YouTube update is in progress.',
    });

    setDriftDialogOpen(false);
    onSuccess?.();
    onOpenChange(false);
  };

  const handleSave = async () => {
    try {
      await saveVariables();
    } catch (error: unknown) {
      // Check for drift error from tRPC errorFormatter
      const trpcError = error as { data?: { driftMeta?: { driftDetectedAt?: string } }; message?: string };
      if (trpcError?.data?.driftMeta || trpcError?.message?.includes('edited on YouTube')) {
        setDriftInfo({
          driftDetectedAt: trpcError.data?.driftMeta?.driftDetectedAt ?? undefined,
        });
        setDriftDialogOpen(true);
        return;
      }
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update variables',
        variant: 'destructive',
      });
    }
  };

  const handleForceOverwrite = async () => {
    try {
      await saveVariables(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive',
      });
    }
  };

  const handleKeepYouTubeEdit = async () => {
    try {
      await resolveDriftMutation.mutateAsync({
        videoId,
        strategy: 'keep_youtube_edit',
      });
      await utils.dashboard.youtube.videos.getVariables.invalidate({ videoId });
      toast({
        title: 'YouTube edit kept',
        description: 'Video delinked from container. Your variable changes were discarded.',
      });
      setDriftDialogOpen(false);
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to resolve drift',
        variant: 'destructive',
      });
    }
  };

  // Compute preview using current form data
  const previewDescription = useMemo(() => {
    if (!variablesData?.variables || !variablesData?.video?.container) {
      return '';
    }

    const container = variablesData.video.container;
    if (!container.templateOrder || container.templateOrder.length === 0) {
      return '';
    }

    // Build templates array in the correct order
    const templateMap = new Map<string, { id: string; content: string }>();
    variablesData.variables.forEach((v) => {
      if (v.template?.id && v.template?.content && !templateMap.has(v.template.id)) {
        templateMap.set(v.template.id, {
          id: v.template.id,
          content: v.template.content,
        });
      }
    });

    const sortedTemplates = container.templateOrder
      .map((id: string) => templateMap.get(id))
      .filter((t): t is { id: string; content: string } => t !== undefined);

    if (sortedTemplates.length === 0) {
      return '';
    }

    // Build variables map from current form data
    const variablesMap: Record<string, string> = {};
    Object.values(formData).forEach((v) => {
      variablesMap[v.name] = v.value;
    });

    // Build description with container's separator
    return buildDescription(
      sortedTemplates,
      variablesMap,
      container.separator || '\n\n',
      variablesData.video.videoId
    );
  }, [variablesData, formData]);

  // Group variables by template
  const groupedVariables: Record<string, typeof formData> = {};
  Object.entries(formData).forEach(([key, value]) => {
    if (!groupedVariables[value.templateName]) {
      groupedVariables[value.templateName] = {};
    }
    groupedVariables[value.templateName]![key] = value;
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0 flex flex-col">
        <div className="shrink-0 px-6 py-5 border-b bg-gradient-to-r from-background to-muted/20">
          <SheetHeader>
            <SheetTitle className="text-xl font-semibold">Edit Variables</SheetTitle>
            <SheetDescription className="text-sm mt-1.5 line-clamp-2">{videoTitle}</SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-8 w-8 text-muted-foreground" />
            </div>
          ) : Object.keys(groupedVariables).length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-muted-foreground text-center max-w-md text-sm leading-relaxed">
                No variables to edit. Assign this video to a container with templates
                containing variables.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedVariables).map(([templateName, vars]) => (
                <div key={templateName} className="group">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3">
                      {templateName}
                    </h3>
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                  </div>
                  <div className="space-y-3">
                    {Object.entries(vars).map(([key, variable]) => (
                      <div key={key} className="rounded-lg border bg-card">
                        <div className="p-4 space-y-3">
                          <Label
                            htmlFor={`var-${key}`}
                            className="text-sm font-medium text-foreground/90 flex items-center gap-1.5"
                          >
                            <span className="text-muted-foreground">{'{{'}</span>
                            <span>{variable.name}</span>
                            <span className="text-muted-foreground">{'}}'}</span>
                          </Label>
                          <Textarea
                            id={`var-${key}`}
                            value={variable.value}
                            onChange={(e) => handleValueChange(key, e.target.value)}
                            placeholder={`Enter ${variable.name}...`}
                            className="resize-none min-h-[100px] text-sm focus-visible:ring-1"
                            rows={3}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {Object.keys(formData).length > 0 && (
          <div className="shrink-0 px-6 pb-4 border-t pt-4 bg-muted/20">
            <Collapsible
              open={isPreviewOpen}
              onOpenChange={setIsPreviewOpen}
              className="space-y-3"
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between h-9 text-sm font-medium hover:bg-accent/50 border-dashed"
                >
                  <span>Preview Description</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${isPreviewOpen ? 'rotate-180' : ''
                      }`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1">
                {previewDescription ? (
                  <div className="rounded-lg border bg-background">
                    <Textarea
                      value={previewDescription}
                      readOnly
                      className="resize-none min-h-[200px] bg-transparent border-0 focus-visible:ring-0 text-sm p-4"
                      rows={8}
                    />
                  </div>
                ) : (
                  <div className="flex justify-center py-8">
                    <p className="text-muted-foreground text-sm">
                      No preview available. Assign video to a container with templates.
                    </p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <div className="shrink-0 border-t bg-background px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || Object.keys(formData).length === 0}
              className="flex-1"
            >
              {updateMutation.isPending && (
                <Spinner className="mr-2 h-4 w-4" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </SheetContent>

      {/* Drift confirmation dialog */}
      <AlertDialog open={driftDialogOpen} onOpenChange={setDriftDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              This video was edited on YouTube
              {driftInfo?.driftDetectedAt && (
                <span className="text-sm font-normal text-muted-foreground">
                  on {new Date(driftInfo.driftDetectedAt).toLocaleDateString()}
                </span>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                The video description was changed directly on YouTube Studio.
                Saving will overwrite that edit with the template output.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={handleKeepYouTubeEdit}
              disabled={resolveDriftMutation.isPending}
            >
              {resolveDriftMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
              Keep YouTube edit
            </Button>
            <Button
              onClick={handleForceOverwrite}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
              Save and overwrite edit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
