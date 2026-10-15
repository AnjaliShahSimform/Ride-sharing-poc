import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { initialOf, roleSummary } from "../lib/profile";

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
          {isRider && (
            <Link to="/rides" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              Search rides
            </Link>
          )}
          {isDriver && (
            <Link to="/rides/new" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              Post a ride
            </Link>
          )}
          {isDriver && (
            <Link to="/rides/mine" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              My rides
            </Link>
          )}
          {isDriver && (
            <Link to="/vehicles/mine" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              My vehicles
            </Link>
          )}
          {isRider && (
            <Link to="/bookings/mine" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              My bookings
            </Link>
          )}
          {isAdmin && (
            <>
              <Link to="/admin/users" className="text-sm font-medium text-gray-600 hover:text-blue-600">
                Users
              </Link>
              <Link to="/admin/rides" className="text-sm font-medium text-gray-600 hover:text-blue-600">
                All rides
              </Link>
              <Link to="/admin/vehicles" className="text-sm font-medium text-gray-600 hover:text-blue-600">
                Vehicle review
              </Link>
              <Link to="/admin/audit-logs" className="text-sm font-medium text-gray-600 hover:text-blue-600">
                Audit log
              </Link>
            </>
          )}
          {data && (
            <Link
              to="/profile"
              aria-label="Your profile"
              className="flex items-center gap-2 rounded-full border border-gray-200 py-1 pl-1 pr-3 hover:bg-gray-50"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
              >
                {initialOf(data.user.name)}
              </span>
              <span className="max-w-[10rem] truncate text-sm font-medium text-gray-800">{data.user.name}</span>
              <span className="hidden text-xs text-gray-500 sm:inline">{roleSummary(data.user.roles)}</span>
            </Link>
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
