/** Every automatic and manual moderation action on the channel, newest first. */

import { api } from '@/utils/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { ACTION_LABELS, statusBadgeVariant } from './shared';

const DEGRADED_LABELS: Record<string, string> = {
  cap_reached: 'daily cap reached',
  paused: 'automation paused',
  batch_failed: 'batch failed, held instead',
  no_author: 'no author to ban',
};

const STATUS_LABELS: Record<string, string> = {
  skipped_non_production: 'not applied (non-production)',
};

export default function ActionLogCard({ channelId }: { channelId: string }) {
  const log = api.dashboard.moderation.actionLog.useInfiniteQuery(
    { channelId, limit: 25 },
    { getNextPageParam: (last) => last.cursor ?? undefined }
  );
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Action log</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Automatic actions come from rules; manual ones from the review queue.
        </p>
      </CardHeader>
      <CardContent>
        {log.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : log.isError ? (
          <p className="text-sm text-destructive">{log.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No actions yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.youtubeCommentId}</TableCell>
                    <TableCell>
                      {ACTION_LABELS[row.appliedAction] ?? row.appliedAction}
                      {row.appliedAction !== row.requestedAction && (
                        <span className="block text-xs text-muted-foreground">
                          asked: {ACTION_LABELS[row.requestedAction] ?? row.requestedAction}
                          {row.degradedReason
                            ? ` · ${DEGRADED_LABELS[row.degradedReason] ?? row.degradedReason}`
                            : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.source === 'auto' ? 'Rule' : 'Dashboard'}
                      {row.rubricVersion !== null && (
                        <span className="block text-xs text-muted-foreground">
                          rubric v{row.rubricVersion}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(row.status)}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                      {row.error && (
                        <span className="block text-xs text-muted-foreground">{row.error}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {log.hasNextPage && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => log.fetchNextPage()}
                  disabled={log.isFetchingNextPage}
                >
                  {log.isFetchingNextPage && <Spinner className="mr-2 h-4 w-4" />}
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
