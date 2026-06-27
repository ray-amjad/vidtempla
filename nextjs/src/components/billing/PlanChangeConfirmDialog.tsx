/**
 * Plan Change Confirmation Dialog
 * Handles both upgrade and downgrade confirmations with appropriate UX
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
import { AlertTriangle, ArrowUp, ArrowDown, Check, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import type { PlanTier } from '@/lib/stripe';
import { formatDateLong } from '@/lib/format';

interface PlanChangeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: {
    tier: PlanTier;
    name: string;
  };
  targetPlan: {
    tier: PlanTier;
    name: string;
  };
  isUpgrade: boolean;
  proratedAmountFormatted: string;
  newMonthlyPriceFormatted: string;
  currentPeriodEnd: string | null;
  featuresGaining: string[];
  featuresLosing: string[];
  onConfirm: () => void;
  isLoading: boolean;
}

const COUNTDOWN_SECONDS = 5;

export default function PlanChangeConfirmDialog({
  open,
  onOpenChange,
  currentPlan,
  targetPlan,
  isUpgrade,
  proratedAmountFormatted,
  newMonthlyPriceFormatted,
  currentPeriodEnd,
  featuresGaining,
  featuresLosing,
  onConfirm,
  isLoading,
}: PlanChangeConfirmDialogProps) {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [canConfirm, setCanConfirm] = useState(isUpgrade); // Upgrades can confirm immediately

  const isDowngradeToFree = targetPlan.tier === 'free';

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setCountdown(COUNTDOWN_SECONDS);
      // Upgrades can confirm immediately, downgrades need countdown
      setCanConfirm(isUpgrade);
    }
  }, [open, isUpgrade]);

  // Countdown timer for downgrades
  useEffect(() => {
    if (!open || isUpgrade || canConfirm) return;

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
  }, [open, isUpgrade, canConfirm]);

  const handleConfirm = useCallback(() => {
    if (canConfirm && !isLoading) {
      onConfirm();
    }
  }, [canConfirm, isLoading, onConfirm]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'your next billing date';
    return formatDateLong(dateString);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isDowngradeToFree ? 'text-destructive' : ''}`}>
            {isUpgrade ? (
              <>
                <ArrowUp className="h-5 w-5 text-success" />
                Upgrade to {targetPlan.name}?
              </>
            ) : isDowngradeToFree ? (
              <>
                <AlertTriangle className="h-5 w-5" />
                Cancel Subscription?
              </>
            ) : (
              <>
                <ArrowDown className="h-5 w-5 text-warning" />
                Downgrade to {targetPlan.name}?
              </>
            )}
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-4" asChild>
            <div>
              {isUpgrade ? (
                <>
                  {/* Upgrade content */}
                  {featuresGaining.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        You&apos;ll gain access to:
                      </p>
                      <ul className="space-y-1">
                        {featuresGaining.map((feature, index) => (
                          <li key={index} className="flex items-center gap-2 text-sm text-success">
                            <Check className="h-4 w-4 flex-shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="bg-muted p-4 rounded-lg">
                    <p className="text-sm">
                      <span className="font-medium">Today&apos;s charge:</span>{' '}
                      <span className="text-success font-semibold">~{proratedAmountFormatted}</span>
                      <span className="text-muted-foreground text-xs ml-1">(prorated)</span>
                    </p>
                    <p className="text-sm mt-1">
                      <span className="font-medium">Going forward:</span>{' '}
                      <span>{newMonthlyPriceFormatted}/month</span>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {/* Downgrade/Cancel content */}
                  {featuresLosing.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-destructive mb-2">
                        You&apos;ll lose access to:
                      </p>
                      <ul className="space-y-1">
                        {featuresLosing.map((feature, index) => (
                          <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <X className="h-4 w-4 flex-shrink-0 text-destructive" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="bg-warning/10 border border-warning/30 p-4 rounded-lg">
                    <p className="text-sm text-warning">
                      {isDowngradeToFree ? (
                        <>
                          Your {currentPlan.name} features remain active until{' '}
                          <strong>{formatDate(currentPeriodEnd)}</strong>. After that, you&apos;ll be on the Free plan.
                        </>
                      ) : (
                        <>
                          Your current features remain active until{' '}
                          <strong>{formatDate(currentPeriodEnd)}</strong>. After that, you&apos;ll be on the {targetPlan.name} plan at {newMonthlyPriceFormatted}/month.
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant={isUpgrade ? 'success' : 'default'}
            onClick={handleConfirm}
            disabled={!canConfirm || isLoading}
            className="min-w-[160px]"
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                {isUpgrade ? 'Upgrading...' : 'Processing...'}
              </>
            ) : canConfirm ? (
              isUpgrade ? (
                'Upgrade Now'
              ) : isDowngradeToFree ? (
                'Cancel Subscription'
              ) : (
                'Confirm Downgrade'
              )
            ) : (
              `Wait ${countdown}s...`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
