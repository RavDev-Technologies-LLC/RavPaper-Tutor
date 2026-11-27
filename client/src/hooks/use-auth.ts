import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { setAccessToken, logoutRequest, authQueryFn } from "@/lib/auth";
import type { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: authQueryFn as unknown as () => Promise<User | null>,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || "Login failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      queryClient.setQueryData(["/api/auth/me"], data.user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (params: { username: string; email: string; password: string; fullName: string }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || "Registration failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      queryClient.setQueryData(["/api/auth/me"], data.user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logout = async () => {
    await logoutRequest().catch(() => {});
    queryClient.setQueryData(["/api/auth/me"], null);
    queryClient.clear();
  };

  return {
    user: (user ?? null) as User | null,
    isLoading,
    isAuthenticated: !!user,
    login: loginMutation.mutateAsync,
    loginPending: loginMutation.isPending,
    register: registerMutation.mutateAsync,
    registerPending: registerMutation.isPending,
    logout,
  };
}
