import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { appConfig } from "@/config/app";
import { useUser } from "@/hooks/useUser";
import { api, setOrganizationId } from "@/utils/api";
import {
  CreditCard,
  LogOut,
  Settings,
  LayoutDashboard,
  Key,
  Server,
  BarChart3,
  Tag,
  ListChecks,
  Shield,
  ChevronUp,
  Check,
  Plus,
  Users,
  Building2,
  ChevronsUpDown,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "./ui/progress";
import { useRouter } from "next/router";
import Link from "next/link";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useOptionalOrganization } from "@/contexts/OrganizationContext";
import { authClient } from "@/lib/auth-client";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { useToast } from "@/hooks/use-toast";

function getInitial(str: string) {
  return str.charAt(0).toUpperCase();
}

function getDisplayName(email: string) {
  return email.split("@")[0] ?? email;
}

function OrgSwitcher() {
  const router = useRouter();
  const { open } = useSidebar();
  const org = useOptionalOrganization();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const utils = api.useUtils();

  useEffect(() => {
    authClient.organization.list().then(({ data }) => {
      if (data) setOrgs(data);
    });
  }, [org?.organizationId]);

  async function handleSwitch(targetSlug: string) {
    if (targetSlug === org?.slug) return;
    const target = orgs.find((o) => o.slug === targetSlug);
    if (target) {
      await authClient.organization.setActive({ organizationId: target.id });
      setOrganizationId(target.id);
      localStorage.setItem("lastOrgSlug", targetSlug);
      // Invalidate all tRPC cache and navigate
      await utils.invalidate();
      router.push(`/org/${targetSlug}/dashboard/youtube`);
    }
  }

  async function handleCreate() {
    if (!newOrgName.trim() || creating) return;
    setCreating(true);
    try {
      const { data } = await authClient.organization.create({
        name: newOrgName.trim(),
        slug: newOrgName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 30),
      });
      if (data) {
        setOrganizationId(data.id);
        localStorage.setItem("lastOrgSlug", data.slug ?? data.id);
        setCreateOpen(false);
        setNewOrgName("");
        router.push(`/org/${data.slug}/dashboard/youtube`);
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err?.message || "Unknown error" });
    } finally {
      setCreating(false);
    }
  }

  const currentName = org?.name ?? "Organization";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" className="h-auto px-3 py-3">
            <div className="flex w-full items-center gap-2">
              <div className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold">
                {getInitial(currentName)}
              </div>
              {open && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{currentName}</p>
                    {org?.role && (
                      <p className="text-muted-foreground truncate text-xs capitalize">{org.role}</p>
                    )}
                  </div>
                  <ChevronsUpDown className="text-muted-foreground h-4 w-4 shrink-0" />
                </>
              )}
            </div>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-64">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Organizations</div>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => handleSwitch(o.slug)}>
              <div className="flex items-center gap-2 flex-1">
                <div className="bg-muted flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-medium">
                  {getInitial(o.name)}
                </div>
                <span className="truncate">{o.name}</span>
              </div>
              {o.slug === org?.slug && <Check className="h-4 w-4 ml-2" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </DropdownMenuItem>
          {org && (
            <DropdownMenuItem onClick={() => router.push(`/org/${org.slug}/organization/settings`)}>
              <Settings className="mr-2 h-4 w-4" />
              Organization Settings
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="Organization name"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button onClick={handleCreate} disabled={creating || !newOrgName.trim()} className="w-full">
              {creating && <Spinner className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  jobs: ListChecks,
  "api-keys": Key,
  "mcp-server": Server,
  usage: BarChart3,
  pricing: Tag,
};

export default function DashboardSidebar() {
  const { user, signOut } = useUser();
  const router = useRouter();
  const { open } = useSidebar();
  const org = useOptionalOrganization();

  const { data: plan } = api.dashboard.billing.getCurrentPlan.useQuery(
    undefined,
    { enabled: !!org }
  );
  const { data: credits } = api.dashboard.apiKeys.getCreditBalance.useQuery(
    undefined,
    { enabled: !!org }
  );
  const isFreePlan = !plan || plan.planTier === "free";

  // Build nav items with org-scoped URLs
  const slugPrefix = org ? `/org/${org.slug}` : "/dashboard";

  const navItems = [
    { title: "Dashboard", url: `${slugPrefix}/dashboard/youtube`, key: "dashboard" },
    { title: "Jobs", url: `${slugPrefix}/jobs`, key: "jobs" },
    { title: "API Keys", url: `${slugPrefix}/api-keys`, key: "api-keys" },
    { title: "MCP Server", url: `${slugPrefix}/mcp-server`, key: "mcp-server" },
    { title: "Usage", url: `${slugPrefix}/usage`, key: "usage" },
    ...(isFreePlan
      ? [{ title: "Pricing", url: `${slugPrefix}/pricing`, key: "pricing" }]
      : []),
  ];

  const email = user?.email ?? "";
  const displayName = getDisplayName(email);
  const initial = getInitial(email);
  const isAdmin = email === "r@rayamjad.com";

  return (
    <Sidebar collapsible="icon" className="border-r bg-background">
      {/* Header — Org Switcher */}
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            {org ? (
              <OrgSwitcher />
            ) : (
              <Link
                href="/dashboard/youtube"
                className={`flex w-full items-center gap-2 ${open ? "px-4" : "justify-center"}`}
              >
                <span className={`font-bold text-foreground ${open ? "text-2xl" : "text-lg"}`}>
                  {open ? appConfig.brand.name : appConfig.brand.name.charAt(0)}
                </span>
              </Link>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Content */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Channel</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.filter((i) => i.key === "dashboard" || i.key === "jobs" || i.key === "usage" || i.key === "pricing").map((item) => {
                const Icon = iconMap[item.key] ?? CreditCard;
                const isActive =
                  router.asPath === item.url ||
                  router.asPath.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                      <Link href={item.url}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Integrations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.filter((i) => i.key === "api-keys" || i.key === "mcp-server").map((item) => {
                const Icon = iconMap[item.key] ?? CreditCard;
                const isActive =
                  router.asPath === item.url ||
                  router.asPath.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                      <Link href={item.url}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Team section (admin/owner only) */}
        {org?.isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Team</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Members"
                    isActive={router.asPath.includes("/organization/members")}
                  >
                    <Link href={`/org/${org.slug}/organization/members`}>
                      <Users />
                      <span>Members</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Organization Settings"
                    isActive={router.asPath.includes("/organization/settings")}
                  >
                    <Link href={`/org/${org.slug}/organization/settings`}>
                      <Building2 />
                      <span>Organization</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Super Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Admin Panel"
                    isActive={router.asPath.startsWith("/admin")}
                  >
                    <Link href="/admin">
                      <Shield />
                      <span>Admin Panel</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t p-4">
        <div className="space-y-4">
          {/* Credits display */}
          {open && credits && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Credits</span>
                <span>
                  {credits.balance.toLocaleString()} /{" "}
                  {credits.monthlyAllocation.toLocaleString()}
                </span>
              </div>
              <Progress
                value={
                  credits.monthlyAllocation > 0
                    ? (credits.balance / credits.monthlyAllocation) * 100
                    : 0
                }
                className="h-2"
              />
            </div>
          )}

          {/* Upgrade button for free tier */}
          {open && isFreePlan && org && (
            <Button
              className="w-full text-xs"
              size="sm"
              onClick={() => router.push(`/org/${org.slug}/pricing`)}
            >
              Upgrade Plan
            </Button>
          )}
        </div>

        <SidebarMenu className="mt-2">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="h-auto px-3 py-3">
                  <div className="flex w-full items-center gap-3">
                    <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium">
                      {initial}
                    </div>
                    {open && (
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {displayName}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {email}
                        </p>
                      </div>
                    )}
                    {open && (
                      <ChevronUp className="text-muted-foreground h-5 w-5 shrink-0" />
                    )}
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                className="w-64"
              >
                <div className="border-b px-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {displayName}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {email}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="py-1">
                  <DropdownMenuItem
                    onClick={() => router.push(org ? `/org/${org.slug}/settings` : "/dashboard/settings")}
                  >
                    <Settings className="mr-3 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => router.push(org ? `/org/${org.slug}/pricing` : "/dashboard/pricing")}
                  >
                    <CreditCard className="mr-3 h-4 w-4" />
                    <span>Billing</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut}>
                    <LogOut className="mr-3 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
