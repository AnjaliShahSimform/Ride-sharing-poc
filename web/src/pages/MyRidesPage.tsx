import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";
import { EditRideForm } from "../components/EditRideForm";
import { formatVehicle } from "../lib/vehicleTypes";

interface MyRide {
  id: string;
  originLabel: string;
  originLat: number;
  originLng: number;
  destLabel: string;
  destLat: number;
  destLng: number;
  departureTime: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  totalSeats: number;
  seatsAvailable: number;
  estimatedCost: string;
  vehicle?: { vehicleId: string; make: string; model: string; colour: string; plate: string } | null;
}

interface RideBooking {
  id: string;
  status: "CONFIRMED" | "CANCELLED";
  costShare: string;
  createdAt: string;
  cancelledAt: string | null;
  riderName: string;
  riderContact: { name: string; phone: string } | null;
}

export function MyRidesPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingRideId, setEditingRideId] = useState<string | null>(null);

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
            <p className="mt-1 text-sm text-gray-500">
              {ride.vehicle ? formatVehicle(ride.vehicle) : "Vehicle details not provided"}
            </p>
            {/* A cancelled ride keeps its old seatsAvailable (the booking cascade
                doesn't give seats back), so the count would be misleading there. */}
            {ride.status !== "CANCELLED" && (
              <p className="mt-1 text-sm text-gray-500">
                {ride.totalSeats - ride.seatsAvailable} of {ride.totalSeats} seats booked
              </p>
            )}
            {ride.status === "SCHEDULED" && editingRideId !== ride.id && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditingRideId(ride.id)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Edit
                </button>
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
            {editingRideId === ride.id && (
              <EditRideForm
                ride={ride}
                onCancel={() => setEditingRideId(null)}
                onSaved={async () => {
                  setEditingRideId(null);
                  await queryClient.refetchQueries({ queryKey: ["rides", "mine"] });
                }}
              />
            )}
            <RideBookings rideId={ride.id} status={ride.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// Confirmed: full contact + share + when it was booked. Cancelled: name and
// cancel time only (the API never sends a cancelled booking's phone).
function bookingLabel(b: RideBooking) {
  if (b.status === "CONFIRMED" && b.riderContact) {
    return `${b.riderContact.name} · ${b.riderContact.phone} · ₹${b.costShare} · ${formatWhen(b.createdAt)}`;
  }
  const when = b.cancelledAt ? formatWhen(b.cancelledAt) : "";
  return [b.riderName, when].filter(Boolean).join(" · ") || "Rider unknown";
}

function RideBookings({ rideId, status }: { rideId: string; status: MyRide["status"] }) {
  const { data } = useQuery<RideBooking[]>({
    queryKey: ["rides", rideId, "bookings"],
    queryFn: () => apiFetch(`/api/rides/${rideId}/bookings`),
    // Pick up new bookings without a manual reload, but only while the ride
    // can still receive them.
    refetchInterval: status === "SCHEDULED" ? 15_000 : false,
  });

  if (!data) {
    return null;
  }

  if (data.length === 0) {
    // Nothing to explain on a cancelled/completed ride that was never booked.
    return status === "SCHEDULED" ? (
      <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-400">No bookings yet</p>
    ) : null;
  }

  // Confirmed riders first; cancelled bookings sit greyed out below.
  const sorted = [...data].sort((a, b) => Number(b.status === "CONFIRMED") - Number(a.status === "CONFIRMED"));

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Riders</p>
      <ul className="space-y-1">
        {sorted.map((b) => (
          <li key={b.id} className="flex items-center gap-2 text-sm">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                b.status === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {b.status === "CONFIRMED" ? "Booked" : "Cancelled"}
            </span>
            <span className={b.status === "CONFIRMED" ? "text-gray-700" : "text-gray-400"}>{bookingLabel(b)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
