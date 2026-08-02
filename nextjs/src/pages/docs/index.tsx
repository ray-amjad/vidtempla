import Head from "next/head";
import Link from "next/link";
import DocsLayout from "@/components/docs/DocsLayout";

export default function DocumentationIndexPage() {
  return (
    <>
      <Head>
        <title>Documentation | VidTempla</title>
        <meta
          name="description"
          content="Guides for managing YouTube video descriptions with VidTempla."
        />
      </Head>
      <DocsLayout currentPath="/docs">
        <p className="text-sm font-medium text-primary">Documentation</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground">
          Manage YouTube descriptions with confidence.
        </h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          VidTempla keeps description templates, per-video variables, and
          YouTube updates in one place. The guides below will expand as each
          shipped feature is documented.
        </p>
        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/reference"
            className="rounded-xl border p-5 transition-colors hover:bg-muted/50"
          >
            <h2 className="font-semibold text-foreground">
              REST API reference
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Explore every available REST operation in Scalar.
            </p>
          </Link>
          <Link
            href="/dashboard/mcp-server"
            className="rounded-xl border p-5 transition-colors hover:bg-muted/50"
          >
            <h2 className="font-semibold text-foreground">
              Connect an MCP client
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Find the live Streamable HTTP connection details in your
              dashboard.
            </p>
          </Link>
        </section>
      </DocsLayout>
    </>
  );
}
