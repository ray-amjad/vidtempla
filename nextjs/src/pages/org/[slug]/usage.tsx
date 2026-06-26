/**
 * Org-scoped API Usage Page
 * Shows credit balance, request counts, quota usage, breakdowns, and request history
 */

import { useState } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

function statusColor(code: number) {
  if (code >= 200 && code < 300) return 'text-success';
  if (code >= 400 && code < 500) return 'text-warning';
  return 'text-red-600';
}

export default function OrgUsagePage() {
  const { data: usage, isLoading } =
    api.dashboard.apiKeys.getDetailedUsage.useQuery({});
  const { data: credits } =
    api.dashboard.apiKeys.getCreditBalance.useQuery();

  const [sourceFilter, setSourceFilter] = useState<'all' | 'rest' | 'mcp'>('all');
  const [endpointSearch, setEndpointSearch] = useState('');

  const {
    data: history,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.dashboard.apiKeys.getRequestHistory.useInfiniteQuery(
    { limit: 50, source: sourceFilter, endpointSearch: endpointSearch || undefined },
    {
      getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    }
  );

  const historyRows = history?.pages.flatMap((p) => p.items) ?? [];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTimestamp = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatPeriod = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${s.toLocaleDateString('en-US', opts)} \u2013 ${e.toLocaleDateString('en-US', opts)}`;
  };

  const creditPercent = credits ? (credits.balance / credits.monthlyAllocation) * 100 : 100;
  const creditFull = credits && credits.balance >= credits.monthlyAllocation;
  const creditLow = creditPercent < 10;

  return (
    <OrganizationProvider>
      <Head>
        <title>Usage | VidTempla</title>
      </Head>
      <DashboardLayout>
        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 p-2">
              <Spinner className="h-4 w-4" />
              <span className="text-sm text-muted-foreground">Loading usage data...</span>
            </div>
          ) : usage ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Total Requests</p>
                    <p className="text-2xl font-bold">{usage.totals.requests.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatPeriod(usage.periodStart, usage.periodEnd)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">YouTube Quota Used</p>
                    <p className="text-2xl font-bold">{usage.totals.quotaUnits.toLocaleString()}</p>
                  </CardContent>
                </Card>
                {credits && (
                  <Card className={creditFull ? 'border-success' : creditLow ? 'border-destructive' : undefined}>
                    <CardContent className="pt-6">
                      {creditFull ? (
                        <>
                          <p className="text-sm text-muted-foreground">Credits</p>
                          <p className="text-2xl font-bold text-success">Full</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">Credits Remaining</p>
                          <p className={`text-2xl font-bold ${creditLow ? 'text-red-600' : ''}`}>
                            {credits.balance.toLocaleString()} / {credits.monthlyAllocation.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Resets {formatDate(credits.periodEnd)}
                          </p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Daily breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {usage.daily.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Quota Units</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.daily.map((day) => (
                          <TableRow key={day.date}>
                            <TableCell>{formatDate(day.date)}</TableCell>
                            <TableCell className="text-right">{day.requestCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{day.quotaUnits.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No requests this period</p>
                  )}
                </CardContent>
              </Card>

              {/* Per-endpoint breakdown */}
              {usage.byEndpoint.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">By Endpoint</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Endpoint</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Quota Units</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.byEndpoint.map((row) => (
                          <TableRow key={row.endpoint}>
                            <TableCell className="font-mono text-sm">{row.endpoint}</TableCell>
                            <TableCell className="text-right">{row.requests.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.quotaUnits.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Per-key breakdown */}
              {usage.byKey.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">By API Key</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Key Name</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Quota Units</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.byKey.map((row, i) => (
                          <TableRow key={row.apiKeyId ?? `mcp-${i}`}>
                            <TableCell className="font-medium">
                              {row.source === 'mcp' ? (
                                <Badge variant="secondary">MCP</Badge>
                              ) : (
                                row.keyName
                              )}
                            </TableCell>
                            <TableCell className="text-right">{row.requests.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.quotaUnits.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Per-member breakdown */}
              {usage.byMember.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">By Member</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Quota Units</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.byMember.map((row) => (
                          <TableRow key={row.userId}>
                            <TableCell className="font-medium">
                              {row.userName ?? row.userEmail ?? 'Unknown'}
                            </TableCell>
                            <TableCell className="text-right">{row.requests.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.quotaUnits.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Request History */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Request History</CardTitle>
                    <div className="flex items-center gap-2">
                      <Select
                        value={sourceFilter}
                        onValueChange={(v) => setSourceFilter(v as 'all' | 'rest' | 'mcp')}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Sources</SelectItem>
                          <SelectItem value="rest">REST</SelectItem>
                          <SelectItem value="mcp">MCP</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Search endpoint..."
                        value={endpointSearch}
                        onChange={(e) => setEndpointSearch(e.target.value)}
                        className="w-[200px]"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {historyRows.length > 0 ? (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Endpoint</TableHead>
                            <TableHead>Method</TableHead>
                            <TableHead className="text-right">Status</TableHead>
                            <TableHead className="text-right">Quota</TableHead>
                            <TableHead>API Key</TableHead>
                            <TableHead>Member</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {historyRows.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {formatTimestamp(row.createdAt)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={row.source === 'mcp' ? 'secondary' : 'outline'}>
                                  {row.source === 'mcp' ? 'MCP' : 'REST'}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{row.endpoint}</TableCell>
                              <TableCell className="text-sm">{row.method}</TableCell>
                              <TableCell className={`text-right font-mono ${statusColor(row.statusCode)}`}>
                                {row.statusCode}
                              </TableCell>
                              <TableCell className="text-right">{row.quotaUnits}</TableCell>
                              <TableCell className="text-sm">
                                {row.source === 'mcp' ? (
                                  <Badge variant="secondary">MCP</Badge>
                                ) : (
                                  row.keyName ?? '\u2014'
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {row.memberName ?? '\u2014'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {hasNextPage && (
                        <div className="flex justify-center py-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchNextPage()}
                            disabled={isFetchingNextPage}
                          >
                            {isFetchingNextPage ? (
                              <>
                                <Spinner className="mr-2 h-3 w-3" />
                                Loading...
                              </>
                            ) : (
                              'Load more'
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No requests found</p>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No usage data available</p>
          )}
        </div>
      </DashboardLayout>
    </OrganizationProvider>
  );
}
