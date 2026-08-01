import DocsArticle from "@/components/docs/DocsArticle";

export default function SettingsAndPlansPage() {
  return (
    <DocsArticle
      path="/docs/workspace/settings-and-plans"
      title="Settings and plans"
      description="Review workspace settings, plan status, billing period, and the subscription-management options available to your account."
    >
      <p>
        Settings displays the active plan, subscription status, billing period,
        and current channel and video usage for the active workspace.
      </p>
      <h2>Choose a plan</h2>
      <p>
        Open Pricing to compare the available plans and their limits, then begin
        a plan change from that page. Usage provides the operational detail
        behind the limits, including requests, YouTube quota, and credits.
      </p>
      <h2>Manage a subscription</h2>
      <p>
        If the workspace has a paid Stripe subscription, Settings provides a
        Manage Subscription action that opens the customer portal. A scheduled
        cancellation stays active through the displayed billing period.
      </p>
    </DocsArticle>
  );
}
