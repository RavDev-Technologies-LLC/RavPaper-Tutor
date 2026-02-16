import { Link, useLocation } from "wouter";
import {
  GraduationCap,
  LayoutDashboard,
  FileText,
  Upload,
  FlaskConical,
  Shield,
  Users,
  ScrollText,
  Settings,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Upload Document", url: "/upload", icon: Upload },
];

const analysisItems = [
  { title: "Run Analysis", url: "/documents", icon: FlaskConical },
  { title: "Defense Simulation", url: "/documents", icon: Shield },
];

const adminItems = [
  { title: "Users", url: "/admin", icon: Users },
  { title: "Audit Logs", url: "/admin", icon: ScrollText },
  { title: "Settings", url: "/admin", icon: Settings },
];

const ADMIN_ROLES = ["program_admin", "security_admin", "super_admin"];

function getRoleBadgeVariant(role: string): "default" | "secondary" | "destructive" | "outline" {
  if (role === "super_admin" || role === "security_admin") return "default";
  if (role === "program_admin" || role === "chair") return "secondary";
  return "outline";
}

function formatRole(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold" data-testid="text-app-name">Paper Tutor</span>
            <span className="text-xs text-muted-foreground">Academic Intelligence</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={item.title}
                  >
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Analysis</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {analysisItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                  >
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url && item.title === "Users"}
                      tooltip={item.title}
                    >
                      <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter>
        {user && (
          <div className="flex items-center gap-2 p-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs" data-testid="text-user-avatar">
                {getInitials(user.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col min-w-0">
              <span className="text-sm font-medium truncate" data-testid="text-user-name">
                {user.fullName}
              </span>
              <Badge variant={getRoleBadgeVariant(user.role)} className="w-fit text-[10px]" data-testid="badge-user-role">
                {formatRole(user.role)}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Logout</span>
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
