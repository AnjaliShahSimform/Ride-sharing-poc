import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useCurrentUser();

  if (isLoading) {
    return <p>Loading...</p>;
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
