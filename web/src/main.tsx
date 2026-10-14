import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { RequireAuth } from "./components/RequireAuth";
import { Layout } from "./components/Layout";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { homePathFor } from "./lib/homePath";
import { SignupPage } from "./pages/SignupPage";
import { LoginPage } from "./pages/LoginPage";
import { SearchRidesPage } from "./pages/SearchRidesPage";
import { PostRidePage } from "./pages/PostRidePage";
import { MyRidesPage } from "./pages/MyRidesPage";
import { MyBookingsPage } from "./pages/MyBookingsPage";
import { MyVehiclesPage } from "./pages/MyVehiclesPage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminRidesPage } from "./pages/admin/AdminRidesPage";
import { AdminAuditLogPage } from "./pages/admin/AdminAuditLogPage";
import "./index.css";

function HomeRedirect() {
  const { data } = useCurrentUser();
  return <Navigate to={homePathFor(data?.user.roles)} replace />;
}

// Search only makes sense for someone who can book (RIDER); anyone else who
// types /rides in the address bar is sent to their own home page.
function RiderOnly({ children }: { children: React.ReactNode }) {
  const { data } = useCurrentUser();
  if (data && !data.user.roles.includes("RIDER")) {
    return <Navigate to={homePathFor(data.user.roles)} replace />;
  }
  return <>{children}</>;
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
      {
        path: "/rides",
        element: (
          <RiderOnly>
            <SearchRidesPage />
          </RiderOnly>
        ),
      },
      { path: "/rides/new", element: <PostRidePage /> },
      { path: "/rides/mine", element: <MyRidesPage /> },
      { path: "/bookings/mine", element: <MyBookingsPage /> },
      { path: "/vehicles/mine", element: <MyVehiclesPage /> },
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
