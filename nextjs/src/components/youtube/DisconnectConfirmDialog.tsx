/**
 * Disconnect Confirmation Dialog with Countdown
 * Requires users to wait before confirming channel disconnection
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AlertTriangle } from 'lucide-react';

interface DisconnectConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelTitle: string;
  onConfirm: () => void;
  isDeleting: boolean;
}

const COUNTDOWN_SECONDS = 5;

export default function DisconnectConfirmDialog({
  open,
  onOpenChange,
  channelTitle,
  onConfirm,
  isDeleting,
}: DisconnectConfirmDialogProps) {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [canConfirm, setCanConfirm] = useState(false);

  // Reset countdown when dialog opens
  useEffect(() => {
    if (open) {
      setCountdown(COUNTDOWN_SECONDS);
      setCanConfirm(false);
    }
  }, [open]);

  // Countdown timer
  useEffect(() => {
    if (!open || canConfirm) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCanConfirm(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [open, canConfirm]);

  const handleConfirm = useCallback(() => {
    if (canConfirm && !isDeleting) {
      onConfirm();
    }
  }, [canConfirm, isDeleting, onConfirm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Disconnect Channel?
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-3">
            <p>
              You are about to disconnect <strong>{channelTitle}</strong>.
            </p>
            <p className="text-destructive font-medium">
              This will permanently delete:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
              <li>All synced videos from this channel</li>
              <li>All video variable assignments</li>
              <li>All description history</li>
              <li>Container assignments for these videos</li>
            </ul>
            <p className="text-sm font-medium">
              This action cannot be undone.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm || isDeleting}
            className="min-w-[140px]"
          >
            {isDeleting ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Disconnecting...
              </>
            ) : canConfirm ? (
              'Disconnect Channel'
            ) : (
              `Wait ${countdown}s...`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
