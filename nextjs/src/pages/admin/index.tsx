import Head from "next/head";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { api } from "@/utils/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { Loader2, Users, CreditCard, UserPlus, Tv } from "lucide-react";

export default function AdminPage() {
  const { data: stats, isLoading, isError } = api.admin.stats.useQuery();
  const { data: recentUsers } = api.admin.recentUsers.useQuery();

  type RecentUser = NonNullable<typeof recentUsers>[number];
  const userColumns: ColumnDef<RecentUser>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    { accessorKey: "email", header: "Email" },
    {
      accessorKey: "emailVerified",
      header: "Verified",
      cell: ({ row }) => (
        <Badge variant={row.original.emailVerified ? "default" : "secondary"}>
          {row.original.emailVerified ? "Yes" : "No"}
        </Badge>
      ),
    },
    {
      accessorKey: "planTier",
      header: "Plan",
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.planTier ?? "free"}</Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Signed Up",
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ];

  if (isError) {
    return (
      <DashboardLayout>
        <Head>
          <title>Not Found</title>
        </Head>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Page not found</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      breadcrumbs={[{ label: "Admin" }]}
      title="Admin"
      description="Platform overview and recent activity"
    >
      <Head>
        <title>Admin | VidTempla</title>
      </Head>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Users
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalUsers}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Paid Users
                </CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.paidUsers}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Users (7d)
                </CardTitle>
                <UserPlus className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.recentUsers}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Channels
                </CardTitle>
                <Tv className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats?.totalChannels}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">Recent Users</h2>
            <DataTable columns={userColumns} data={recentUsers ?? []} />
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
