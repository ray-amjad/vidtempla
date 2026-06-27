/**
 * UpdateImpactDialog Component
 * Shows the impact of container/template updates before confirmation
 */

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

interface UpdateImpactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  updateType: 'container' | 'template';
  videoCount: number;
  containers?: Array<{
    id: string;
    name: string;
    videoCount: number;
  }>;
}

export default function UpdateImpactDialog({
  open,
  onOpenChange,
  onConfirm,
  updateType,
  videoCount,
  containers = [],
}: UpdateImpactDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Update</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {updateType === 'container' ? (
                <p>
                  This will update{' '}
                  <strong className="text-foreground">{videoCount} video{videoCount !== 1 ? 's' : ''}</strong>{' '}
                  assigned to this container.
                </p>
              ) : (
                <>
                  <p>
                    This template is used in{' '}
                    <strong className="text-foreground">{containers.length} container{containers.length !== 1 ? 's' : ''}</strong>,
                    affecting{' '}
                    <strong className="text-foreground">{videoCount} video{videoCount !== 1 ? 's' : ''}</strong>.
                  </p>
                  {containers.length > 0 && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
                      <p className="text-xs font-medium text-foreground mb-2">Affected Containers:</p>
                      <ul className="space-y-1 text-sm">
                        {containers.map((container) => (
                          <li key={container.id} className="flex justify-between text-muted-foreground">
                            <span>{container.name}</span>
                            <span className="text-xs">
                              {container.videoCount} video{container.videoCount !== 1 ? 's' : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {videoCount > 0 && (
                <p className="text-sm">
                  The video descriptions will be updated automatically in the background.
                </p>
              )}

              {videoCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  No videos will be affected by this change.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            Confirm & Update
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
