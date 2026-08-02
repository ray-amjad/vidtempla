import DocsArticle from "@/components/docs/DocsArticle";

export default function UsageAndBillingPage() {
  return (
    <DocsArticle
      path="/docs/workspace/usage-and-billing"
      title="Usage and billing"
      description="Review API activity, YouTube quota, credits, plan limits, and subscription details."
    >
      <h2>Usage</h2>
      <p>
        The Usage page shows total requests, YouTube quota used, and remaining
        credits for the current period. It also breaks activity down by day,
        endpoint, API key, and request history. Filter history by REST or MCP
        source and search for an endpoint.
      </p>
      <h2>Plans</h2>
      <p>
        The Pricing page lists the features and limits for available plans. Use
        it to begin a plan change. Your Settings page shows the active plan,
        subscription status, billing period, and video and channel usage.
      </p>
      <h2>Manage a paid subscription</h2>
      <p>
        When a paid plan has a Stripe customer record, Settings includes a
        Manage Subscription action that opens the customer portal. A scheduled
        cancellation remains active through the displayed billing period.
      </p>
    </DocsArticle>
  );
}
