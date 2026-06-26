import DashboardSidebar from "@/components/dashboard-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import RootLayout from "./RootLayout";
import { useRouter } from "next/router";
import React from "react";

export type BreadcrumbItemType = {
  label: string;
  href?: string;
};

const SEGMENT_NAMES: Record<string, string> = {
  youtube: "YouTube",
  jobs: "Jobs",
  "api-keys": "API Keys",
  "mcp-server": "MCP Server",
  usage: "Usage",
  settings: "Settings",
  pricing: "Pricing",
  admin: "Admin",
};

function DashboardBreadcrumb({
  customBreadcrumbs,
}: {
  customBreadcrumbs?: BreadcrumbItemType[];
}) {
  const router = useRouter();

  if (customBreadcrumbs) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          {customBreadcrumbs.map((item, index) => {
            const isLast = index === customBreadcrumbs.length - 1;
            return (
              <React.Fragment key={index}>
                <BreadcrumbItem>
                  {!isLast && item.href ? (
                    <BreadcrumbLink href={item.href}>
                      {item.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // Auto-generate breadcrumbs from URL path
  const pathSegments = router.asPath
    .split("?")[0]!
    .split("/")
    .filter((p) => p);

  // Skip "org/[slug]/" or "dashboard/" prefix
  let displaySegments: string[];
  if (pathSegments[0] === "org" && pathSegments.length >= 2) {
    // /org/[slug]/dashboard/youtube → skip org, slug, then handle rest
    const afterSlug = pathSegments.slice(2);
    displaySegments = afterSlug[0] === "dashboard" ? afterSlug.slice(1) : afterSlug;
  } else {
    displaySegments = pathSegments[0] === "dashboard" ? pathSegments.slice(1) : pathSegments;
  }

  const getName = (segment: string) =>
    SEGMENT_NAMES[segment] ??
    segment
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  if (displaySegments.length === 0) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {displaySegments.map((segment, index) => {
          const href = `/dashboard/${displaySegments.slice(0, index + 1).join("/")}`;
          const isLast = index === displaySegments.length - 1;
          return (
            <React.Fragment key={href}>
              <BreadcrumbItem>
                {!isLast ? (
                  <BreadcrumbLink href={href}>{getName(segment)}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{getName(segment)}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export default function DashboardLayout({
  children,
  breadcrumbs,
  title,
  description,
}: {
  children: React.ReactNode;
  breadcrumbs?: BreadcrumbItemType[];
  /** Optional standard page header rendered above the content. */
  title?: string;
  description?: string;
}) {
  return (
    <RootLayout>
      <SidebarProvider>
        <DashboardSidebar />
        <div className="flex flex-col flex-1 min-h-screen">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <DashboardBreadcrumb customBreadcrumbs={breadcrumbs} />
          </header>
          <main className="flex-1 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {title && (
              <div className="mb-6 space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                {description && (
                  <p className="text-muted-foreground">{description}</p>
                )}
              </div>
            )}
            {children}
          </main>
        </div>
      </SidebarProvider>
    </RootLayout>
  );
}
