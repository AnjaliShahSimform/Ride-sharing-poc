import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
}

export function useCurrentUser() {
  return useQuery<{ user: CurrentUser }>({
    queryKey: ["currentUser"],
    queryFn: () => apiFetch("/api/auth/me"),
    retry: false,
  });
}
