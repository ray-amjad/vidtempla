/**
 * Org-scoped MCP Server Guide Page
 * How to connect AI agents to VidTempla via MCP
 */

import Head from 'next/head';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const SERVER_URL = 'https://www.vidtempla.com/api/mcp';

const MCP_COMMAND = `claude mcp add --transport http vidtempla ${SERVER_URL} -s user`;

export default function OrgMcpServerPage() {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: 'Copied to clipboard' });
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <OrganizationProvider>
      <Head>
        <title>MCP Server | VidTempla</title>
      </Head>
      <DashboardLayout>
        <div className="grid gap-6">
          {/* Server Connection */}
          <Card>
            <CardHeader>
              <CardTitle>Server Connection</CardTitle>
              <CardDescription>
                Connection details for the VidTempla MCP server
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Server Name</span>
                <span className="text-sm text-muted-foreground">
                  VidTempla
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Version</span>
                <span className="text-sm text-muted-foreground">1.0.0</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Transport</span>
                <Badge variant="secondary">Streamable HTTP</Badge>
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Server URL</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md break-all">
                    {SERVER_URL}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => copyToClipboard(SERVER_URL, 'url')}
                  >
                    {copiedField === 'url' ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Setup */}
          <Card>
            <CardHeader>
              <CardTitle>Setup</CardTitle>
              <CardDescription>
                Run this command in your terminal to connect Claude Code
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <pre className="text-sm bg-muted px-4 py-3 pr-12 rounded-md overflow-x-auto">
                  {MCP_COMMAND}
                </pre>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7"
                  onClick={() => copyToClipboard(MCP_COMMAND, 'command')}
                >
                  {copiedField === 'command' ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The first time you use it, Claude Code will open your browser
                to sign in. After that, it works automatically.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    </OrganizationProvider>
  );
}
