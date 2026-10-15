import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { useClampPage, useListParams, type Paged } from "../../hooks/useListParams";
import { ListError, ListLoading } from "../../components/admin/ListMessages";
import { Pagination } from "../../components/admin/Pagination";
import { DOC_LABEL, type DocType, type Vehicle, openDocument } from "../../lib/vehicleTypes";

type ReviewVehicle = Vehicle & { reviewVersion: string; owner: { id: string; name: string; email: string } };

const STATUS_TABS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

export function AdminVehiclesPage() {
  const list = useListParams(["status"] as const);
  const status = STATUS_TABS.some((t) => t.value === list.filters.status) ? list.filters.status : "PENDING";

  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Per-vehicle rejection note being typed.
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Vehicle whose review request is in flight; blocks a second click.
  const [reviewing, setReviewing] = useState<string | null>(null);

  const query = new URLSearchParams({ status, page: String(list.page), pageSize: String(list.pageSize) }).toString();
  const { data, isLoading, isError, error: loadError, isFetching } = useQuery<Paged<ReviewVehicle>>({
    queryKey: ["admin", "vehicles", query],
    queryFn: () => apiFetch(`/api/admin/vehicles?${query}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(data, list.page, list.pageSize, list.setPage);

  const message = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong");

  async function review(v: ReviewVehicle, decision: "APPROVED" | "REJECTED") {
    if (reviewing === v.id) return;
    setError(null);
    setReviewing(v.id);
    try {
      await apiFetch(`/api/admin/vehicles/${v.id}/review`, {
        method: "PATCH",
        body: {
          decision,
          reviewVersion: v.reviewVersion,
          ...(decision === "REJECTED" && { note: notes[v.id] ?? "" }),
        },
      });
    } catch (err) {
      setError(message(err));
    } finally {
      // Refresh even after a failure, so a stale card (e.g. after a 409) doesn't linger.
      await queryClient.refetchQueries({ queryKey: ["admin", "vehicles"] });
      setReviewing(null);
    }
  }

  async function view(vehicleId: string, type: DocType) {
    setError(null);
    try {
      await openDocument(apiFetch, vehicleId, type);
    } catch (err) {
      setError(message(err));
    }
  }

  if (isLoading) return <ListLoading />;
  if (isError && !data) return <ListError what="the review queue" error={loadError} />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Vehicle review</h1>
      <div role="tablist" aria-label="Vehicle status" className="mb-4 flex gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={status === t.value}
            onClick={() => list.setFilter("status", t.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              status === t.value ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isError && <ListError what="the review queue" error={loadError} />}
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {data?.items.length === 0 && (
        <p className="text-sm text-gray-500">
          {status === "PENDING" ? "Nothing waiting for review." : `No ${status.toLowerCase()} vehicles.`}
        </p>
      )}
      <ul className={`space-y-3 ${isFetching ? "opacity-60" : ""}`}>
        {data?.items.map((v) => {
          const hasBoth = (["RC", "LICENCE"] as DocType[]).every((t) => v.documents.some((d) => d.type === t));
          return (
            <li key={v.id} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                {v.colour} {v.make} {v.model} · {v.plateNumber} · {v.seatCapacity} seats
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[v.status]}`}>{v.status}</span>
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Owner: {v.owner.name} ({v.owner.email}) · submitted {new Date(v.createdAt).toLocaleString()}
              </p>
              {v.status === "REJECTED" && v.rejectionNote && (
                <p className="mt-1 text-sm text-red-700">Reason: {v.rejectionNote}</p>
              )}
              {v.status === "PENDING" && (
                <p className="mt-1 text-xs text-gray-400">Check that the plate and name match the RC and licence.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {(["RC", "LICENCE"] as DocType[]).map((type) =>
                  v.documents.some((d) => d.type === type) ? (
                    <button
                      key={type}
                      type="button"
                      onClick={() => view(v.id, type)}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      View {DOC_LABEL[type]}
                    </button>
                  ) : (
                    <span key={type} className="text-gray-400">
                      {DOC_LABEL[type]}: missing
                    </span>
                  ),
                )}
              </div>
              {v.status === "PENDING" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!hasBoth || reviewing === v.id}
                    onClick={() => review(v, "APPROVED")}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <input
                    value={notes[v.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [v.id]: e.target.value }))}
                    placeholder="Reason (required to reject)"
                    maxLength={500}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={!(notes[v.id] ?? "").trim() || reviewing === v.id}
                    onClick={() => review(v, "REJECTED")}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data && (
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={data.total}
          noun="vehicles"
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  );
}
