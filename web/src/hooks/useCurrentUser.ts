import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  createdAt?: string;
  // false until the phone is verified. Optional so accounts/tests that predate
  // the field read as verified (RequireAuth only redirects on === false).
  phoneVerified?: boolean;
}

export function useCurrentUser() {
  return useQuery<{ user: CurrentUser }>({
    queryKey: ["currentUser"],
    queryFn: () => apiFetch("/api/auth/me"),
    retry: false,
  });
}
