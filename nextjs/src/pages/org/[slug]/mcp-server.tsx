import { OrganizationProvider } from "@/contexts/OrganizationContext";
import McpServerView from "@/components/views/McpServerView";

export default function OrgMcpServerPage() {
  return (
    <OrganizationProvider>
      <McpServerView />
    </OrganizationProvider>
  );
}
