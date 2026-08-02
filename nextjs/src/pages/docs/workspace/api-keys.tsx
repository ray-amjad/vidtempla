import DocsArticle from "@/components/docs/DocsArticle";

export default function ApiKeysPage() {
  return (
    <DocsArticle
      path="/docs/workspace/api-keys"
      title="API keys"
      description="Create, copy, and revoke API keys for programmatic access to your workspace."
    >
      <p>
        Open API Keys from the dashboard to create credentials for the REST API.
        Choose a name, expiration period, and permission level before creating a
        key.
      </p>
      <h2>Copy keys immediately</h2>
      <p>
        VidTempla displays a newly created key only once. Copy it into your
        secret manager before closing the confirmation dialog.
      </p>
      <h2>Choose the minimum permission</h2>
      <p>
        Read keys can fetch data. Read-write keys can also make changes. Revoke
        a key you no longer need from the same page; revocation is immediate.
      </p>
    </DocsArticle>
  );
}
