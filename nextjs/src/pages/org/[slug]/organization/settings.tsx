import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { OrganizationProvider, useOrganization } from "@/contexts/OrganizationContext";
import { authClient } from "@/lib/auth-client";
import { api, setOrganizationId } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/router";
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
} from "@/components/ui/alert-dialog";

function OrgSettingsContent() {
  const { organizationId, name, slug, isOwner } = useOrganization();
  const { toast } = useToast();
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [savedOrgName, setSavedOrgName] = useState(name);
  const previousOrganizationIdRef = useRef(organizationId);
  const currentOrganizationIdRef = useRef(organizationId);
  const isDirtyRef = useRef(false);
  const saveRequestIdRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [orgCount, setOrgCount] = useState<number | null>(null);

  const { data: plan } = api.dashboard.billing.getCurrentPlan.useQuery();
  const isDirty = orgName !== savedOrgName;

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Defense-in-depth: resync local state when the org name prop changes (e.g.
  // active org switches in-place without a remount). Same-org updates are
  // dirty-guarded so they don't stomp on user typing, but org switches must
  // always reset the input to avoid saving a stale name into the new org.
  useEffect(() => {
    const organizationChanged = previousOrganizationIdRef.current !== organizationId;
    previousOrganizationIdRef.current = organizationId;
    currentOrganizationIdRef.current = organizationId;
    if (organizationChanged) {
      saveRequestIdRef.current += 1;
      setSaving(false);
    }
    setSavedOrgName(name);
    if (organizationChanged || !isDirtyRef.current) {
      setOrgName(name);
      isDirtyRef.current = false;
    }
  }, [organizationId, name]);

  useEffect(() => {
    authClient.organization.list().then(({ data }) => {
      setOrgCount(data?.length ?? 0);
    });
  }, []);

  const isPaid = plan?.planTier && plan.planTier !== "free";
  const isLastOrg = orgCount !== null && orgCount <= 1;
  const canDelete = isOwner && !isPaid && !isLastOrg;

  async function handleSave() {
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    const organizationIdAtSave = organizationId;
    const orgNameAtSave = orgName;
    setSaving(true);
    try {
      const { data } = await authClient.organization.update({
        data: { name: orgNameAtSave },
      });
      if (
        saveRequestIdRef.current !== requestId ||
        currentOrganizationIdRef.current !== organizationIdAtSave
      ) {
        return;
      }
      toast({ title: "Organization updated" });
      const updatedName = data?.name ?? orgNameAtSave;
      setOrgName(updatedName);
      setSavedOrgName(updatedName);
      isDirtyRef.current = false;
      // If slug changed, redirect
      if (data?.slug && data.slug !== slug) {
        router.replace(`/org/${data.slug}/organization/settings`);
      }
    } catch (err: any) {
      if (
        saveRequestIdRef.current !== requestId ||
        currentOrganizationIdRef.current !== organizationIdAtSave
      ) {
        return;
      }
      toast({ variant: "destructive", title: "Failed", description: err?.message || "Unknown error" });
    } finally {
      if (
        saveRequestIdRef.current === requestId &&
        currentOrganizationIdRef.current === organizationIdAtSave
      ) {
        setSaving(false);
      }
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await authClient.organization.delete({ organizationId });
      localStorage.removeItem("lastOrgSlug");
      localStorage.removeItem("activeOrganizationId");
      setOrganizationId(null);
      toast({ title: "Organization deleted" });
      router.replace("/org/resolve");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err?.message || "Unknown error" });
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Name */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Organization Name</label>
        <Input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
        />
        <Button onClick={handleSave} disabled={saving || !isDirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      {/* Danger zone */}
      {isOwner && (
        <div className="border border-destructive/20 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
          <p className="text-sm text-muted-foreground">
            Deleting this organization is permanent and cannot be undone. All channels,
            templates, containers, and API keys will be lost.
          </p>
          {isPaid && (
            <p className="text-sm text-destructive">
              Cancel your subscription before deleting this organization.{" "}
              <a href={`/org/${slug}/settings`} className="underline">Go to billing →</a>
            </p>
          )}
          {!isPaid && isLastOrg && (
            <p className="text-sm text-destructive">
              You cannot delete your only organization.
            </p>
          )}
          {canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete Organization</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &quot;{name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the organization and all its data. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    // Keep dialog mounted while delete is in flight; Radix closes on click by default.
                    onClick={(e) => {
                      e.preventDefault();
                      handleDelete();
                    }}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button variant="destructive" disabled>Delete Organization</Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function OrgSettingsPage() {
  return (
    <OrganizationProvider>
      <Head>
        <title>Organization Settings | VidTempla</title>
      </Head>
      <DashboardLayout title="Organization Settings" description="Manage your organization details">
        <OrgSettingsContent />
      </DashboardLayout>
    </OrganizationProvider>
  );
}
