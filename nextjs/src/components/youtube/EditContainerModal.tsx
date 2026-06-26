/**
 * Edit Container Modal Component
 * Edit container name and reorder templates
 */

import { useState, useEffect } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { GripVertical, ArrowUp, ArrowDown, X, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import UpdateImpactDialog from './UpdateImpactDialog';

interface EditContainerModalProps {
  containerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function EditContainerModal({
  containerId,
  open,
  onOpenChange,
  onSuccess,
}: EditContainerModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [separator, setSeparator] = useState('\n\n');

  // Track original values for change detection
  const [originalTemplateIds, setOriginalTemplateIds] = useState<string[]>([]);
  const [originalSeparator, setOriginalSeparator] = useState('\n\n');

  // Impact dialog state
  const [showImpactDialog, setShowImpactDialog] = useState(false);
  const [affectedVideoCount, setAffectedVideoCount] = useState(0);

  // Drift dialog state
  const [showDriftDialog, setShowDriftDialog] = useState(false);
  const [driftedCount, setDriftedCount] = useState(0);

  const { data: container } = api.dashboard.youtube.containers.list.useQuery(undefined, {
    enabled: open,
    select: (containers) => containers.find((c) => c.id === containerId),
  });

  const { data: allTemplates } = api.dashboard.youtube.templates.list.useQuery(undefined, {
    enabled: open,
  });

  const updateMutation = api.dashboard.youtube.containers.update.useMutation();
  const getAffectedVideosMutation = api.dashboard.youtube.containers.getAffectedVideos.useMutation();
  const isSaving = updateMutation.isPending || getAffectedVideosMutation.isPending;

  // Initialize form data on open and when container changes.
  // Depending on `open` ensures reopening the same container after a cancelled edit
  // resets the form — `container`'s reference doesn't change on reopen because
  // react-query serves it from cache.
  useEffect(() => {
    if (open && container) {
      setName(container.name);
      setTemplateIds(container.templateOrder || []);
      setSeparator(container.separator || '\n\n');
      setOriginalTemplateIds(container.templateOrder || []);
      setOriginalSeparator(container.separator || '\n\n');
    }
  }, [open, container]);

  const moveTemplate = (index: number, direction: 'up' | 'down') => {
    const newTemplateIds = [...templateIds];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newTemplateIds.length) return;

    const temp = newTemplateIds[index];
    newTemplateIds[index] = newTemplateIds[targetIndex]!;
    newTemplateIds[targetIndex] = temp!;

    setTemplateIds(newTemplateIds);
  };

  const removeTemplate = (templateId: string) => {
    setTemplateIds(templateIds.filter((id) => id !== templateId));
  };

  const availableTemplates =
    allTemplates?.filter((t) => !templateIds.includes(t.id)) || [];

  const addTemplate = (templateId: string) => {
    setTemplateIds([...templateIds, templateId]);
  };

  const getTemplateName = (templateId: string) => {
    return allTemplates?.find((t) => t.id === templateId)?.name || 'Unknown Template';
  };

  // Check if changes affect video descriptions
  const hasDescriptionChanges = () => {
    const templateOrderChanged =
      JSON.stringify(templateIds) !== JSON.stringify(originalTemplateIds);
    const separatorChanged = separator !== originalSeparator;
    return templateOrderChanged || separatorChanged;
  };

  const handleSave = async () => {
    // If no description-affecting changes, save directly
    if (!hasDescriptionChanges()) {
      await performUpdate();
      return;
    }

    // Get affected videos count
    try {
      const result = await getAffectedVideosMutation.mutateAsync({
        containerId,
      });
      setAffectedVideoCount(result.count);
      setShowImpactDialog(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to check affected videos',
        variant: 'destructive',
      });
    }
  };

  const performUpdate = async (force?: boolean) => {
    try {
      await updateMutation.mutateAsync({
        id: containerId,
        name,
        templateIds,
        separator,
        force,
      });

      const hasChanges = hasDescriptionChanges();
      toast({
        title: 'Container updated',
        description: hasChanges
          ? `Container updated. ${affectedVideoCount} video${affectedVideoCount !== 1 ? 's' : ''} will be updated in the background.`
          : 'Container has been updated successfully.',
      });

      setShowDriftDialog(false);
      onSuccess?.();
      onOpenChange(false);
    } catch (error: unknown) {
      const trpcError = error as { data?: { driftMeta?: { driftedVideoIds?: string[] } }; message?: string };
      if (trpcError?.data?.driftMeta?.driftedVideoIds || trpcError?.message?.includes('edited on YouTube')) {
        const count = trpcError.data?.driftMeta?.driftedVideoIds?.length ?? 0;
        setDriftedCount(count);
        setShowDriftDialog(true);
        return;
      }
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update container',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Container</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Container Name */}
          <div>
            <Label htmlFor="container-name">Container Name</Label>
            <Input
              id="container-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Videos"
            />
          </div>

          {/* Template Separator */}
          <div>
            <Label htmlFor="separator">Template Separator</Label>
            <div className="space-y-2">
              <Input
                id="separator"
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                placeholder="Enter separator (use \n for newline)"
                className="font-mono text-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSeparator('\n\n')}
                >
                  Double Newline
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSeparator('\n\n\n')}
                >
                  Triple Newline
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSeparator('\n\n—————\n\n')}
                >
                  Line Separator
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This text will appear between templates. Use \n for line breaks.
              </p>
            </div>
          </div>

          {/* Template Order */}
          <div>
            <Label>Template Order</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Templates will be applied in this order. Drag or use arrows to reorder.
            </p>

            {templateIds.length === 0 ? (
              <div className="text-center py-8 border border-dashed rounded-md">
                <p className="text-muted-foreground text-sm">
                  No templates added yet. Add templates from the list below.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {templateIds.map((templateId, index) => (
                  <div
                    key={templateId}
                    className="flex items-center gap-2 p-3 border rounded-md bg-background"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                    <span className="flex-1 font-medium">
                      {index + 1}. {getTemplateName(templateId)}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveTemplate(index, 'up')}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveTemplate(index, 'down')}
                        disabled={index === templateIds.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeTemplate(templateId)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available Templates */}
          {availableTemplates.length > 0 && (
            <div>
              <Label>Add Templates</Label>
              <div className="mt-2 border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                {availableTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between p-2 hover:bg-muted rounded cursor-pointer"
                    onClick={() => addTemplate(template.id)}
                  >
                    <span className="text-sm">{template.name}</span>
                    <Button size="sm" variant="ghost">
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {templateIds.length > 0 && (
            <div className="bg-muted p-3 rounded-md text-sm">
              <p className="font-medium mb-1">Preview Order:</p>
              <div className="flex items-center gap-2 text-muted-foreground">
                {templateIds.map((templateId, index) => (
                  <span key={templateId}>
                    {getTemplateName(templateId)}
                    {index < templateIds.length - 1 && ' → '}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving && <Spinner className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>

      <UpdateImpactDialog
        open={showImpactDialog}
        onOpenChange={setShowImpactDialog}
        onConfirm={() => performUpdate()}
        updateType="container"
        videoCount={affectedVideoCount}
      />

      {/* Bulk drift confirmation */}
      <AlertDialog open={showDriftDialog} onOpenChange={setShowDriftDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Videos edited on YouTube
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {driftedCount} of {affectedVideoCount} video{affectedVideoCount !== 1 ? 's' : ''} in this
                container {driftedCount === 1 ? 'has' : 'have'} been edited on YouTube Studio.
              </p>
              <p>Saving will overwrite those edits. They will be preserved in version history.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => performUpdate(true)} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
              Overwrite all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
