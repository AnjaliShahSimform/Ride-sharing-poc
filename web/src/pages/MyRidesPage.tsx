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

  if (isLoading) return <p>Loading...</p>;
  if (isError) return <p role="alert">Failed to load your rides.</p>;

  return (
    <div>
      <h1>My rides</h1>
      {actionError && <p role="alert">{actionError}</p>}
      {data && data.length === 0 && <p>You haven't posted any rides yet.</p>}
      <ul>
        {data?.map((ride) => (
          <li key={ride.id}>
            {ride.originLabel} → {ride.destLabel} · {new Date(ride.departureTime).toLocaleString()} · {ride.status}
            {ride.status === "SCHEDULED" && (
              <>
                <button onClick={() => handleAction(ride.id, "cancel")}>Cancel</button>
                <button onClick={() => handleAction(ride.id, "complete")}>Mark complete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
