import Head from "next/head";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { OrganizationProvider, useOrganization } from "@/contexts/OrganizationContext";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserPlus, MoreHorizontal, Trash2, Shield, Crown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

function MembersContent() {
  const { organizationId, isOwner, isAdmin } = useOrganization();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);

  // Fetch members using Better Auth client
  const { data: orgData, refetch } = useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: async () => {
      const { data } = await authClient.organization.getFullOrganization();
      return data;
    },
  });

  const members = orgData?.members ?? [];
  const invitations = orgData?.invitations ?? [];

  async function handleInvite() {
    if (!inviteEmail || inviting) return;
    setInviting(true);
    try {
      await authClient.organization.inviteMember({
        email: inviteEmail,
        role: inviteRole,
      });
      toast({ title: "Invitation sent", description: `Invited ${inviteEmail} as ${inviteRole}` });
      setInviteEmail("");
      setInviteOpen(false);
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to invite", description: err?.message || "Unknown error" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (pendingMemberId) return;
    setPendingMemberId(memberId);
    try {
      await authClient.organization.removeMember({ memberIdOrEmail: memberId });
      toast({ title: "Member removed" });
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err?.message || "Unknown error" });
    } finally {
      setPendingMemberId(null);
    }
  }

  async function handleUpdateRole(memberId: string, role: "admin" | "member") {
    if (pendingMemberId) return;
    setPendingMemberId(memberId);
    try {
      await authClient.organization.updateMemberRole({ memberId, role });
      toast({ title: "Role updated" });
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err?.message || "Unknown error" });
    } finally {
      setPendingMemberId(null);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (cancellingInviteId) return;
    setCancellingInviteId(invitationId);
    try {
      await authClient.organization.cancelInvitation({ invitationId });
      toast({ title: "Invitation cancelled" });
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err?.message || "Unknown error" });
    } finally {
      setCancellingInviteId(null);
    }
  }

  const roleIcon = (role: string) => {
    if (role === "owner") return <Crown className="h-3 w-3" />;
    if (role === "admin") return <Shield className="h-3 w-3" />;
    return null;
  };

  const roleBadgeVariant = (role: string) => {
    if (role === "owner") return "default" as const;
    if (role === "admin") return "secondary" as const;
    return "outline" as const;
  };

  return (
    <>
      <div className="flex items-center justify-end mb-6">
        {isAdmin && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="mr-2 h-4 w-4" />Invite Member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a new member</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <Input
                  placeholder="Email address"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "member" | "admin")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail} className="w-full">
                  {inviting && <Spinner className="mr-2 h-4 w-4" />}
                  Send Invitation
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Members list */}
      <div className="border rounded-lg divide-y">
        {members.map((m: any) => (
          <div key={m.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium">
                {(m.user?.name ?? m.user?.email ?? "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium">{m.user?.name || m.user?.email}</p>
                <p className="text-xs text-muted-foreground">{m.user?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pendingMemberId === m.id && (
                <Spinner className="h-4 w-4 text-muted-foreground" />
              )}
              <Badge variant={roleBadgeVariant(m.role)} className="gap-1">
                {roleIcon(m.role)}
                {m.role}
              </Badge>
              {isAdmin && m.role !== "owner" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={pendingMemberId === m.id}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {m.role === "member" && (
                      <DropdownMenuItem
                        disabled={pendingMemberId === m.id}
                        onClick={() => handleUpdateRole(m.id, "admin")}
                      >
                        <Shield className="mr-2 h-4 w-4" />Make Admin
                      </DropdownMenuItem>
                    )}
                    {m.role === "admin" && isOwner && (
                      <DropdownMenuItem
                        disabled={pendingMemberId === m.id}
                        onClick={() => handleUpdateRole(m.id, "member")}
                      >
                        Remove Admin
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="text-destructive"
                      disabled={pendingMemberId === m.id}
                      onClick={() => handleRemoveMember(m.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Pending Invitations</h2>
          <div className="border rounded-lg divide-y">
            {invitations
              .filter((inv: any) => inv.status === "pending")
              .map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">Invited as {inv.role}</p>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancellingInviteId === inv.id}
                      onClick={() => handleCancelInvitation(inv.id)}
                    >
                      {cancellingInviteId === inv.id && (
                        <Spinner className="mr-2 h-4 w-4" />
                      )}
                      Cancel
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function OrgMembersPage() {
  return (
    <OrganizationProvider>
      <Head>
        <title>Members | VidTempla</title>
      </Head>
      <DashboardLayout title="Members" description="Manage your organization members and invitations">
        <MembersContent />
      </DashboardLayout>
    </OrganizationProvider>
  );
}
