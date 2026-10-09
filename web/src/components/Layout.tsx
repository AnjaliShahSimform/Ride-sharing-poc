import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useCurrentUser } from "../hooks/useCurrentUser";

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

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <span className="text-lg font-semibold text-gray-900">RideShare</span>
        <div className="flex items-center gap-6">
          <Link to="/rides" className="text-sm font-medium text-gray-600 hover:text-blue-600">
            Search rides
          </Link>
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
          {isRider && (
            <Link to="/bookings/mine" className="text-sm font-medium text-gray-600 hover:text-blue-600">
              My bookings
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
