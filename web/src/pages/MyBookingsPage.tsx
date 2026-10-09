import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";

interface MyBooking {
  id: string;
  rideId: string;
  status: "CONFIRMED" | "CANCELLED";
  costShare: string;
  createdAt: string;
  ride: {
    originLabel: string;
    destLabel: string;
    departureTime: string;
    status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  };
  driverContact: { name: string; phone: string } | null;
}

export function MyBookingsPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<MyBooking[]>({
    queryKey: ["bookings", "mine"],
    queryFn: () => apiFetch("/api/bookings/mine"),
  });

  async function handleCancel(bookingId: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/bookings/${bookingId}/cancel`, { method: "PATCH" });
      await queryClient.refetchQueries({ queryKey: ["bookings", "mine"] });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load your bookings.
      </p>
    );

  const statusBadgeClass: Record<MyBooking["status"], string> = {
    CONFIRMED: "bg-blue-100 text-blue-700",
    CANCELLED: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">My bookings</h1>
      {actionError && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {data && data.length === 0 && <p className="text-sm text-gray-500">You haven't booked any rides yet.</p>}
      <ul className="space-y-3">
        {data?.map((booking) => (
          <li key={booking.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-900">
                {booking.ride.originLabel} → {booking.ride.destLabel}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass[booking.status]}`}>
                {booking.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {new Date(booking.ride.departureTime).toLocaleString()} · your share: ₹{booking.costShare}
            </p>
            {booking.driverContact && (
              <p className="mt-1 text-sm text-gray-500">
                Driver: {booking.driverContact.name} · {booking.driverContact.phone}
              </p>
            )}
            {booking.status === "CONFIRMED" && booking.ride.status === "SCHEDULED" && (
              <div className="mt-3">
                <button
                  onClick={() => handleCancel(booking.id)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
