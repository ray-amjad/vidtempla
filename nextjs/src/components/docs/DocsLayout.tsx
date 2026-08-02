import Link from "next/link";
import type { ReactNode } from "react";
import manifest from "../../../docs-manifest.json";

type DocsLayoutProps = {
  children: ReactNode;
  currentPath: string;
};

export default function DocsLayout({ children, currentPath }: DocsLayoutProps) {
  return (
    <main className="mx-auto flex w-full max-w-6xl gap-10 px-6 py-12 lg:px-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <Link href="/" className="text-sm font-semibold text-foreground">
          VidTempla
        </Link>
        <nav aria-label="Documentation" className="mt-8 space-y-6">
          {Array.from(new Set(manifest.pages.map((page) => page.section))).map(
            (section) => (
              <div key={section}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section}
                </h2>
                <ul className="mt-2 space-y-1">
                  {manifest.pages
                    .filter((page) => page.section === section)
                    .map((page) => (
                      <li key={page.path}>
                        <Link
                          href={page.path}
                          className={
                            currentPath === page.path
                              ? "text-sm font-medium text-foreground"
                              : "text-sm text-muted-foreground hover:text-foreground"
                          }
                        >
                          {page.title}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ),
          )}
        </nav>
      </aside>
      <article className="min-w-0 max-w-3xl flex-1">{children}</article>
    </main>
  );
}
