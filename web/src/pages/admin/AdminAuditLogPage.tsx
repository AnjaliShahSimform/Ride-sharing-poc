import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { useClampPage, useListParams, type Paged } from "../../hooks/useListParams";
import { DateRangeFilter, FilterBar, SelectFilter } from "../../components/admin/FilterBar";
import { EmptyRow, ListError, ListLoading } from "../../components/admin/ListMessages";
import { Pagination } from "../../components/admin/Pagination";

interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ENTITY_OPTIONS = ["Ride", "Booking", "Vehicle"].map((v) => ({ value: v, label: v }));

// Every action name the backend writes (see writeAuditLog call sites).
const ACTION_OPTIONS = [
  "CREATED",
  "UPDATED",
  "CANCELLED",
  "COMPLETED",
  "COST_RECALCULATED",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_VIEWED",
  "APPROVED",
  "REJECTED",
].map((v) => ({ value: v, label: v }));

const FILTER_KEYS = ["entityType", "action", "from", "to"] as const;

export function AdminAuditLogPage() {
  const list = useListParams(FILTER_KEYS);
  const { filters } = list;

  const { data, isLoading, isError, error, isFetching } = useQuery<Paged<AuditLogEntry>>({
    queryKey: ["admin", "audit-logs", list.query],
    queryFn: () => apiFetch(`/api/admin/audit-logs?${list.query}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(data, list.page, list.pageSize, list.setPage);

  if (isLoading) return <ListLoading />;
  if (isError && !data) return <ListError what="audit logs" error={error} />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Audit log</h1>
      <FilterBar hasFilters={list.hasFilters} onClear={list.clearFilters}>
        <SelectFilter
          label="Entity"
          value={filters.entityType}
          options={ENTITY_OPTIONS}
          allLabel="All entities"
          onChange={(v) => list.setFilter("entityType", v)}
        />
        <SelectFilter
          label="Action"
          value={filters.action}
          options={ACTION_OPTIONS}
          allLabel="All actions"
          onChange={(v) => list.setFilter("action", v)}
        />
        <DateRangeFilter
          label="Date"
          from={filters.from}
          to={filters.to}
          onFrom={(v) => list.setFilter("from", v)}
          onTo={(v) => list.setFilter("to", v)}
        />
      </FilterBar>
      {isError && <ListError what="audit logs" error={error} />}
      <div className={`overflow-x-auto rounded-xl bg-white shadow-sm ${isFetching ? "opacity-60" : ""}`}>
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.items.length === 0 && <EmptyRow colSpan={5} what="audit entries" hasFilters={list.hasFilters} />}
            {data?.items.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 whitespace-nowrap text-gray-500">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-600">
                  {entry.entityType} <span className="text-gray-400">{entry.entityId.slice(0, 8)}</span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{entry.action}</td>
                <td className="px-4 py-3 text-gray-500">{entry.actorId === "system" ? "system" : entry.actorId.slice(0, 8)}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{entry.metadata ? JSON.stringify(entry.metadata) : "—"}</td>
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
          noun="entries"
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  );
}
