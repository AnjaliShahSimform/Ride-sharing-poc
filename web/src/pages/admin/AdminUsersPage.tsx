import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { useClampPage, useListParams, type Paged } from "../../hooks/useListParams";
import { DateRangeFilter, FilterBar, SearchFilter, SelectFilter } from "../../components/admin/FilterBar";
import { EmptyRow, ListError, ListLoading } from "../../components/admin/ListMessages";
import { Pagination } from "../../components/admin/Pagination";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  createdAt: string;
}

const ROLE_OPTIONS = [
  { value: "RIDER", label: "Rider" },
  { value: "DRIVER", label: "Driver" },
  { value: "ADMIN", label: "Admin" },
];

const FILTER_KEYS = ["role", "q", "joinedFrom", "joinedTo"] as const;

export function AdminUsersPage() {
  const list = useListParams(FILTER_KEYS);
  const { filters } = list;

  const { data, isLoading, isError, error, isFetching } = useQuery<Paged<AdminUser>>({
    queryKey: ["admin", "users", list.query],
    queryFn: () => apiFetch(`/api/admin/users?${list.query}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(data, list.page, list.pageSize, list.setPage);

  if (isLoading) return <ListLoading />;
  if (isError && !data) return <ListError what="users" error={error} />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">All users</h1>
      <FilterBar hasFilters={list.hasFilters} onClear={list.clearFilters}>
        <SearchFilter
          label="Search"
          value={filters.q}
          placeholder="Name, email or phone"
          onChange={(v) => list.setFilter("q", v)}
        />
        <SelectFilter
          label="Role"
          value={filters.role}
          options={ROLE_OPTIONS}
          allLabel="All roles"
          onChange={(v) => list.setFilter("role", v)}
        />
        <DateRangeFilter
          label="Joined"
          from={filters.joinedFrom}
          to={filters.joinedTo}
          onFrom={(v) => list.setFilter("joinedFrom", v)}
          onTo={(v) => list.setFilter("joinedTo", v)}
        />
      </FilterBar>
      {isError && <ListError what="users" error={error} />}
      <div className={`overflow-x-auto rounded-xl bg-white shadow-sm ${isFetching ? "opacity-60" : ""}`}>
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
            {data?.items.length === 0 && <EmptyRow colSpan={5} what="users" hasFilters={list.hasFilters} />}
            {data?.items.map((user) => (
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
      {data && (
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={data.total}
          noun="users"
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  );
}
