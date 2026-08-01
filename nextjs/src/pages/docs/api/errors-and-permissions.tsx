import DocsArticle from "@/components/docs/DocsArticle";

export default function ErrorsAndPermissionsPage() {
  return (
    <DocsArticle
      path="/docs/api/errors-and-permissions"
      title="API errors and permissions"
      description="Interpret VidTempla API responses, choose the right API-key permission, and handle quota-limited YouTube operations."
    >
      <h2>Response envelope</h2>
      <p>
        Successful responses contain <code>data</code> and may include
        <code>meta</code>. Errors return <code>data: null</code> and an
        <code>error</code> object with a code, message, suggestion, and HTTP
        status. List responses use <code>meta.cursor</code> and
        <code>meta.hasMore</code> to paginate.
      </p>
      <h2>API-key permissions</h2>
      <p>
        Read keys can retrieve data. Read-write keys are required for routes
        that change templates, containers, video assignments or variables, and
        connected YouTube resources. A key without write access receives
        <code>INSUFFICIENT_PERMISSIONS</code> with HTTP 403.
      </p>
      <h2>Common errors</h2>
      <p>
        Missing, invalid, expired, or no-longer-organization-scoped keys return
        HTTP 401 with a corrective suggestion. Invalid input returns a 400;
        unavailable resources return a 404; and a YouTube quota limit returns a
        429. Use the suggestion in the error response before retrying.
      </p>
      <h2>Quota-aware requests</h2>
      <p>
        Native VidTempla resources do not consume YouTube quota. YouTube proxy
        operations and analytics can consume quota, especially searches and
        writes. Consult the <a href="/reference">interactive REST reference</a>{" "}
        for each operation’s parameters and quota context.
      </p>
    </DocsArticle>
  );
}
