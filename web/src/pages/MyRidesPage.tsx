import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";

interface MyRide {
  id: string;
  originLabel: string;
  destLabel: string;
  departureTime: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  totalSeats: number;
  seatsAvailable: number;
}

export function MyRidesPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<MyRide[]>({
    queryKey: ["rides", "mine"],
    queryFn: () => apiFetch("/api/rides/mine"),
  });

  async function handleAction(rideId: string, action: "cancel" | "complete") {
    setActionError(null);
    try {
      await apiFetch(`/api/rides/${rideId}/${action}`, { method: "PATCH" });
      await queryClient.refetchQueries({ queryKey: ["rides", "mine"] });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load your rides.
      </p>
    );

  const statusBadgeClass: Record<MyRide["status"], string> = {
    SCHEDULED: "bg-blue-100 text-blue-700",
    CANCELLED: "bg-gray-100 text-gray-600",
    COMPLETED: "bg-green-100 text-green-700",
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">My rides</h1>
      {actionError && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {data && data.length === 0 && <p className="text-sm text-gray-500">You haven't posted any rides yet.</p>}
      <ul className="space-y-3">
        {data?.map((ride) => (
          <li key={ride.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-900">
                {ride.originLabel} → {ride.destLabel}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass[ride.status]}`}>
                {ride.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{new Date(ride.departureTime).toLocaleString()}</p>
            {ride.status === "SCHEDULED" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleAction(ride.id, "cancel")}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleAction(ride.id, "complete")}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Mark complete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
