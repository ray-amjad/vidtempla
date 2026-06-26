import { OrganizationProvider } from "@/contexts/OrganizationContext";
import SettingsView from "@/components/views/SettingsView";

export default function OrgSettingsPage() {
  return (
    <OrganizationProvider>
      <SettingsView />
    </OrganizationProvider>
  );
}
