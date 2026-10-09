import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { RequireAuth } from "./components/RequireAuth";
import { Layout } from "./components/Layout";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { SignupPage } from "./pages/SignupPage";
import { LoginPage } from "./pages/LoginPage";
import { SearchRidesPage } from "./pages/SearchRidesPage";
import { PostRidePage } from "./pages/PostRidePage";
import { MyRidesPage } from "./pages/MyRidesPage";
import { MyBookingsPage } from "./pages/MyBookingsPage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminRidesPage } from "./pages/admin/AdminRidesPage";
import { AdminAuditLogPage } from "./pages/admin/AdminAuditLogPage";
import "./index.css";

// An admin account has neither DRIVER nor RIDER, so /rides (search) isn't a
// useful landing page for it — land on the admin users list instead.
function HomeRedirect() {
  const { data } = useCurrentUser();
  const isAdminOnly = data?.user.roles.length === 1 && data.user.roles[0] === "ADMIN";
  return <Navigate to={isAdminOnly ? "/admin/users" : "/rides"} replace />;
}

const router = createBrowserRouter([
  { path: "/signup", element: <SignupPage /> },
  { path: "/login", element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <HomeRedirect /> },
      { path: "/rides", element: <SearchRidesPage /> },
      { path: "/rides/new", element: <PostRidePage /> },
      { path: "/rides/mine", element: <MyRidesPage /> },
      { path: "/bookings/mine", element: <MyBookingsPage /> },
      { path: "/admin/users", element: <AdminUsersPage /> },
      { path: "/admin/rides", element: <AdminRidesPage /> },
      { path: "/admin/audit-logs", element: <AdminAuditLogPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
