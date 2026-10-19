import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { homePathFor } from "../lib/homePath";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useCurrentUser();
  const { pathname } = useLocation();

  if (isLoading) {
    return <p>Loading...</p>;
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  // An account that hasn't verified its phone can see nothing else (the API
  // refuses it too); a verified one has no business on the verify screen.
  // `=== false` so a user object without the field reads as verified.
  const unverified = data.user.phoneVerified === false;
  if (unverified && pathname !== "/verify-phone") {
    return <Navigate to="/verify-phone" replace />;
  }
  if (!unverified && pathname === "/verify-phone") {
    return <Navigate to={homePathFor(data.user.roles)} replace />;
  }

  return <>{children}</>;
}
