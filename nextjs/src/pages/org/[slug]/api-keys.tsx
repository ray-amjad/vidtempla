/**
 * Org-scoped API Keys Page
 * Manage API keys for programmatic access to VidTempla
 */

import Head from 'next/head';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Copy, Check, Trash2, BookOpen, ExternalLink } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import Link from 'next/link';
import { api } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export default function OrgApiKeysPage() {
  const { toast } = useToast();
  // API Keys
  const { data: apiKeysList, isLoading: keysLoading } =
    api.dashboard.apiKeys.list.useQuery();

  const utils = api.useUtils();

  const createKeyMutation = api.dashboard.apiKeys.create.useMutation({
    onSuccess: () => {
      utils.dashboard.apiKeys.list.invalidate();
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create API key',
        description: error.message,
      });
    },
  });

  const revokeKeyMutation = api.dashboard.apiKeys.revoke.useMutation({
    onSuccess: () => {
      utils.dashboard.apiKeys.list.invalidate();
      toast({ title: 'API key revoked' });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to revoke API key',
        description: error.message,
      });
    },
  });

  // Create key dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>('never');
  const [newKeyPermission, setNewKeyPermission] = useState<'read' | 'read-write'>('read');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const formatShortDate = (dateString: string | Date | null) => {
    if (!dateString) return 'Never';
    return formatDate(dateString);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    const expiresInDays = newKeyExpiry === 'never' ? undefined : parseInt(newKeyExpiry);

    const result = await createKeyMutation.mutateAsync({
      name: newKeyName.trim(),
      expiresInDays,
      permission: newKeyPermission,
    });

    setCreatedKey(result.plaintext);
    setNewKeyName('');
    setNewKeyExpiry('never');
    setNewKeyPermission('read');
  };

  const handleCopyKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast({ title: 'API key copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
    setCreatedKey(null);
    setCopied(false);
    setNewKeyName('');
    setNewKeyExpiry('never');
    setNewKeyPermission('read');
  };

  return (
    <OrganizationProvider>
      <Head>
        <title>API Keys | VidTempla</title>
      </Head>
      <DashboardLayout>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-success" />
                <CardTitle className="text-lg">API Documentation</CardTitle>
              </div>
              <CardDescription>
                Explore the full REST API reference with endpoint details, request/response examples, and authentication guides.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/reference">
                <Button variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View API Docs
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">Your Keys</CardTitle>
              <Dialog open={createDialogOpen} onOpenChange={(open) => {
                if (!open) handleCloseCreateDialog();
                else setCreateDialogOpen(true);
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="success">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  {createdKey ? (
                    <>
                      <DialogHeader>
                        <DialogTitle>API Key Created</DialogTitle>
                        <DialogDescription>
                          Copy your API key now. It will not be shown again.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="p-3 bg-warning/10 border border-warning/30 rounded-md">
                          <p className="text-sm text-warning font-medium">
                            Make sure to copy your API key. You will not be able to see it again.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={createdKey}
                            readOnly
                            className="font-mono text-sm"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={handleCopyKey}
                          >
                            {copied ? (
                              <Check className="h-4 w-4 text-success" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleCloseCreateDialog}>
                          Done
                        </Button>
                      </DialogFooter>
                    </>
                  ) : (
                    <>
                      <DialogHeader>
                        <DialogTitle>Create API Key</DialogTitle>
                        <DialogDescription>
                          Create a new API key for programmatic access.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="key-name">Name</Label>
                          <Input
                            id="key-name"
                            placeholder="e.g., My Agent, Production Bot"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="key-expiry">Expiration</Label>
                          <Select value={newKeyExpiry} onValueChange={setNewKeyExpiry}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="never">Never</SelectItem>
                              <SelectItem value="30">30 days</SelectItem>
                              <SelectItem value="60">60 days</SelectItem>
                              <SelectItem value="90">90 days</SelectItem>
                              <SelectItem value="365">1 year</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="key-permission">Permission</Label>
                          <Select value={newKeyPermission} onValueChange={(v) => setNewKeyPermission(v as 'read' | 'read-write')}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="read">Read only</SelectItem>
                              <SelectItem value="read-write">Read & Write</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Read-only keys can only fetch data. Read & Write keys can also create, update, and delete resources.
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={handleCloseCreateDialog}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleCreateKey}
                          disabled={!newKeyName.trim() || createKeyMutation.isPending}
                          variant="success"
                        >
                          {createKeyMutation.isPending ? (
                            <>
                              <Spinner className="mr-2 h-4 w-4" />
                              Creating...
                            </>
                          ) : (
                            'Create Key'
                          )}
                        </Button>
                      </DialogFooter>
                    </>
                  )}
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              {keysLoading ? (
                <div className="flex items-center gap-2 p-6">
                  <Spinner className="h-4 w-4" />
                  <span className="text-sm text-muted-foreground">Loading API keys...</span>
                </div>
              ) : apiKeysList && apiKeysList.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Permission</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiKeysList.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-0.5 rounded">
                            {key.keyPrefix}...
                          </code>
                        </TableCell>
                        <TableCell>
                          {key.permission === 'read-write' ? (
                            <Badge variant="warning">
                              Read & Write
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
                              Read only
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatShortDate(key.lastUsedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {key.expiresAt ? (
                            <span className={
                              new Date(key.expiresAt) < new Date()
                                ? 'text-red-600'
                                : ''
                            }>
                              {formatShortDate(key.expiresAt)}
                            </span>
                          ) : (
                            'Never'
                          )}
                        </TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to revoke the API key &quot;{key.name}&quot;? Any applications using this key will lose access immediately.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() => revokeKeyMutation.mutate({ id: key.id })}
                                >
                                  Revoke Key
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">No API keys yet</p>
                  <p className="text-xs mt-1">Create an API key to get started with the REST API</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    </OrganizationProvider>
  );
}
