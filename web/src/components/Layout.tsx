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

  return (
    <div>
      <nav>
        <Link to="/rides">Search rides</Link>
        {isDriver && <Link to="/rides/new">Post a ride</Link>}
        {isDriver && <Link to="/rides/mine">My rides</Link>}
        <button onClick={handleLogout}>Log out</button>
      </nav>
      <Outlet />
    </div>
  );
}
