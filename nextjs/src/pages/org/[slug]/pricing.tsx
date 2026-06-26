import { OrganizationProvider } from "@/contexts/OrganizationContext";
import PricingView from "@/components/views/PricingView";

export default function OrgPricingPage() {
  return (
    <OrganizationProvider>
      <PricingView />
    </OrganizationProvider>
  );
}
