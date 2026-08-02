import Link from "next/link";
import DocsArticle from "@/components/docs/DocsArticle";

export default function RestApiPage() {
  return (
    <DocsArticle
      path="/docs/api/rest-api"
      title="REST API"
      description="Use VidTempla’s API keys to manage channels, descriptions, and YouTube operations programmatically."
    >
      <h2>Authentication</h2>
      <p>
        Generate an API key in <Link href="/dashboard/api-keys">API Keys</Link>{" "}
        and send it as a Bearer token. Read keys can fetch data; read-write keys
        can create, update, and delete resources.
      </p>
      <pre>
        <code>{"Authorization: Bearer vtk_your_key_here"}</code>
      </pre>
      <h2>Response envelope and pagination</h2>
      <p>
        Successful responses use <code>data</code> and optional
        <code>meta</code> fields. Errors include a machine-readable code,
        message, HTTP status, and a suggestion. List endpoints use cursor
        pagination with a default limit of 50 and a maximum of 100.
      </p>
      <h2>Quota and write operations</h2>
      <p>
        VidTempla-native resources such as templates and containers have no
        YouTube quota cost. YouTube proxy operations and analytics can consume
        quota. Check the interactive reference before invoking a write or a
        high-cost YouTube operation.
      </p>
      <h2>Complete operation reference</h2>
      <p>
        <a href="/reference">Open the interactive Scalar reference</a> for every
        current REST method, parameters, request body, and response. The
        <a href="/openapi.yaml">OpenAPI specification</a> is available for
        generated clients and tooling.
      </p>
    </DocsArticle>
  );
}
