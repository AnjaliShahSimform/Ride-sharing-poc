import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { initialOf, roleSummary } from "../lib/profile";

// `end` so a link is active only on its own path: "/rides" must not light up on "/rides/mine".
function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `border-b-2 py-1 text-sm font-medium ${
          isActive ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-blue-600"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { data } = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    navigate("/login");
  }

  const isDriver = data?.user.roles.includes("DRIVER") ?? false;
  const isRider = data?.user.roles.includes("RIDER") ?? false;
  const isAdmin = data?.user.roles.includes("ADMIN") ?? false;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex flex-wrap items-center justify-between gap-y-3 border-b border-gray-200 bg-white px-6 py-4">
        <span className="text-lg font-semibold text-gray-900">RideShare</span>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {isRider && <NavItem to="/rides">Search rides</NavItem>}
          {isDriver && <NavItem to="/rides/new">Post a ride</NavItem>}
          {isDriver && <NavItem to="/rides/mine">My rides</NavItem>}
          {isDriver && <NavItem to="/vehicles/mine">My vehicles</NavItem>}
          {isRider && <NavItem to="/bookings/mine">My bookings</NavItem>}
          {isAdmin && (
            <>
              <NavItem to="/admin/users">Users</NavItem>
              <NavItem to="/admin/rides">All rides</NavItem>
              <NavItem to="/admin/vehicles">Vehicle review</NavItem>
              <NavItem to="/admin/audit-logs">Audit log</NavItem>
            </>
          )}
          {data && (
            <NavLink
              to="/profile"
              aria-label="Your profile"
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 hover:bg-gray-50 ${
                  isActive ? "border-blue-600 bg-blue-50" : "border-gray-200"
                }`
              }
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
              >
                {initialOf(data.user.name)}
              </span>
              <span className="max-w-[10rem] truncate text-sm font-medium text-gray-800">{data.user.name}</span>
              <span className="hidden text-xs text-gray-500 sm:inline">{roleSummary(data.user.roles)}</span>
            </NavLink>
          )}
          <button
            onClick={handleLogout}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Log out
          </button>
        </div>
      </nav>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
