import { OrganizationProvider } from "@/contexts/OrganizationContext";
import ApiKeysView from "@/components/views/ApiKeysView";

export default function OrgApiKeysPage() {
  return (
    <OrganizationProvider>
      <ApiKeysView />
    </OrganizationProvider>
  );
}
