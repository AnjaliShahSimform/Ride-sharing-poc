import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";

interface AdminRide {
  id: string;
  originLabel: string;
  destLabel: string;
  departureTime: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  totalSeats: number;
  seatsAvailable: number;
  estimatedCost: string;
  driver: { id: string; name: string; email: string };
}

export function AdminRidesPage() {
  const { data, isLoading, isError } = useQuery<AdminRide[]>({
    queryKey: ["admin", "rides"],
    queryFn: () => apiFetch("/api/admin/rides"),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load rides.
      </p>
    );

  const statusBadgeClass: Record<AdminRide["status"], string> = {
    SCHEDULED: "bg-blue-100 text-blue-700",
    CANCELLED: "bg-gray-100 text-gray-600",
    COMPLETED: "bg-green-100 text-green-700",
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">All rides</h1>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Departure</th>
              <th className="px-4 py-3">Seats</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.map((ride) => (
              <tr key={ride.id}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {ride.originLabel} → {ride.destLabel}
                </td>
                <td className="px-4 py-3 text-gray-600">{ride.driver.name}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(ride.departureTime).toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-600">
                  {ride.seatsAvailable}/{ride.totalSeats}
                </td>
                <td className="px-4 py-3 text-gray-600">₹{ride.estimatedCost}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass[ride.status]}`}>
                    {ride.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
