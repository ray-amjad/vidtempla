/**
 * Every stored comment with its published-version score, newest first.
 * Stored reads cost nothing, so this list pages freely.
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import CommentRow from './CommentRow';

const ALL = '__all__';

export default function ScoresCard({ channelId, labels }: { channelId: string; labels: string[] }) {
  const [label, setLabel] = useState(ALL);
  const comments = api.dashboard.moderation.comments.useInfiniteQuery(
    { channelId, limit: 25, label: label === ALL ? undefined : label },
    { getNextPageParam: (last) => last.cursor ?? undefined }
  );
  const items = comments.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Scores</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Stored viewer comments with the winning label and the probability of each label. Filter
            by the winning label.
          </p>
        </div>
        <Select value={label} onValueChange={setLabel}>
          <SelectTrigger className="w-44" aria-label="Filter by label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All labels</SelectItem>
            {labels.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {comments.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : comments.isError ? (
          <p className="text-sm text-destructive">{comments.error.message}</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No stored comments yet.</p>
        ) : (
          <div className="space-y-3">
            {items.map((c) => (
              <CommentRow key={c.id} channelId={channelId} comment={c} labels={labels} />
            ))}
            {comments.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => comments.fetchNextPage()}
                  disabled={comments.isFetchingNextPage}
                >
                  {comments.isFetchingNextPage && <Spinner className="mr-2 h-4 w-4" />}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
