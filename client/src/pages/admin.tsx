import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, ScrollText, Settings, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { authQueryFn, authFetch } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";

const ALL_ROLES = [
  "student",
  "doctoral_candidate",
  "chair",
  "committee_member",
  "program_admin",
  "security_admin",
  "super_admin",
];

function formatRole(role: string): string {
  return role.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function getRoleBadgeVariant(role: string): "default" | "secondary" | "destructive" | "outline" {
  if (role === "super_admin" || role === "security_admin") return "default";
  if (role === "program_admin" || role === "chair") return "secondary";
  return "outline";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const { toast } = useToast();

  const { data: users, isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    queryFn: authQueryFn,
  });

  const { data: auditLogs, isLoading: logsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/audit-logs"],
    queryFn: authQueryFn,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    queryFn: authQueryFn,
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await authFetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Failed to update role");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Role Updated", description: "User role has been changed." });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-admin">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin Dashboard</h1>
        <p className="text-muted-foreground">Manage users, view audit logs, and configure settings</p>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-stat-users">{stats.userCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Documents</CardTitle>
              <ScrollText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-stat-documents">{stats.documentCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Analyses</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-stat-analyses">{stats.analysisCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="audit-logs" data-testid="tab-audit-logs">Audit Logs</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {usersLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Change Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users?.map((user) => (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell className="font-medium">{user.fullName}</TableCell>
                        <TableCell className="text-muted-foreground">{user.email}</TableCell>
                        <TableCell className="text-muted-foreground">{user.username}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(user.role)}>{formatRole(user.role)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? "default" : "destructive"}>
                            {user.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onValueChange={(role) => updateRoleMutation.mutate({ userId: user.id, role })}
                          >
                            <SelectTrigger className="w-40" data-testid={`select-role-${user.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALL_ROLES.map((role) => (
                                <SelectItem key={role} value={role}>{formatRole(role)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit-logs" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {logsLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs?.map((log) => (
                      <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                        <TableCell>
                          <Badge variant="outline">{log.action}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.resourceType} {log.resourceId ? `#${log.resourceId}` : ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {log.userId?.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="text-muted-foreground">{log.ipAddress || "N/A"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(log.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">General Settings</CardTitle>
                <CardDescription>Configure application-wide settings</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Settings configuration coming soon.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Analysis Engines</CardTitle>
                <CardDescription>Configure analysis engine parameters</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Engine configuration coming soon.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
