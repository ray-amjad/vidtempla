import { OrganizationProvider } from "@/contexts/OrganizationContext";
import UsageView from "@/components/views/UsageView";

export default function OrgUsagePage() {
  return (
    <OrganizationProvider>
      <UsageView showMembers />
    </OrganizationProvider>
  );
}
