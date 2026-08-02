import Head from "next/head";
import type { ReactNode } from "react";
import DocsLayout from "./DocsLayout";

type DocsArticleProps = {
  children: ReactNode;
  description: string;
  path: string;
  title: string;
};

export default function DocsArticle({
  children,
  description,
  path,
  title,
}: DocsArticleProps) {
  return (
    <>
      <Head>
        <title>{`${title} | VidTempla documentation`}</title>
        <meta name="description" content={description} />
      </Head>
      <DocsLayout currentPath={path}>
        <p className="text-sm font-medium text-primary">Documentation</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          {description}
        </p>
        <div className="prose prose-slate dark:prose-invert mt-10 max-w-none">
          {children}
        </div>
      </DocsLayout>
    </>
  );
}
