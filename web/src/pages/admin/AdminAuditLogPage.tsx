import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";

interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

export function AdminAuditLogPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<AuditLogResponse>({
    queryKey: ["admin", "audit-logs", page],
    queryFn: () => apiFetch(`/api/admin/audit-logs?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load audit logs.
      </p>
    );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Audit log</h1>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
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
            {data?.entries.map((entry) => (
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
      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            Page {data.page} of {totalPages} ({data.total} entries)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
