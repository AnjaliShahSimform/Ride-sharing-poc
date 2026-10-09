import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  createdAt: string;
}

export function AdminUsersPage() {
  const { data, isLoading, isError } = useQuery<AdminUser[]>({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load users.
      </p>
    );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">All users</h1>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3 text-gray-600">{user.phone}</td>
                <td className="px-4 py-3 text-gray-600">{user.roles.join(", ")}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
