import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { DOC_LABEL, type DocType, type Vehicle, openDocument } from "../../lib/vehicleTypes";

type ReviewVehicle = Vehicle & { reviewVersion: string; owner: { id: string; name: string; email: string } };

export function AdminVehiclesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Per-vehicle rejection note being typed.
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Vehicle whose review request is in flight; blocks a second click.
  const [reviewing, setReviewing] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<ReviewVehicle[]>({
    queryKey: ["admin", "vehicles"],
    queryFn: () => apiFetch("/api/admin/vehicles?status=PENDING"),
  });

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

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load the review queue.
      </p>
    );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Vehicle review</h1>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {data && data.length === 0 && <p className="text-sm text-gray-500">Nothing waiting for review.</p>}
      <ul className="space-y-3">
        {data?.map((v) => {
          const hasBoth = (["RC", "LICENCE"] as DocType[]).every((t) => v.documents.some((d) => d.type === t));
          return (
            <li key={v.id} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="font-medium text-gray-900">
                {v.colour} {v.make} {v.model} · {v.plateNumber} · {v.seatCapacity} seats
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Owner: {v.owner.name} ({v.owner.email}) · submitted {new Date(v.createdAt).toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-gray-400">Check that the plate and name match the RC and licence.</p>
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
