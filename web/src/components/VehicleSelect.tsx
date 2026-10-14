import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { Vehicle } from "../lib/vehicleTypes";

interface VehicleSelectProps {
  value: string;
  // The chosen vehicle is passed along (undefined when the placeholder is
  // picked) so the form can show the seat count the vehicle fixes.
  onChange: (vehicleId: string, vehicle?: Vehicle) => void;
  className?: string;
}

// Dropdown of the driver's APPROVED vehicles only. The server re-checks
// ownership and approval on submit and fixes the ride's seats to the vehicle's
// capacity; this is just the friendly path.
export function VehicleSelect({ value, onChange, className }: VehicleSelectProps) {
  const { data, isLoading } = useQuery<Vehicle[]>({
    queryKey: ["vehicles", "mine"],
    queryFn: () => apiFetch("/api/vehicles/mine"),
  });
  const approved = (Array.isArray(data) ? data : []).filter((v) => v.status === "APPROVED");

  if (isLoading) return <p className="text-sm text-gray-500">Loading vehicles...</p>;

  if (approved.length === 0) {
    return (
      <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
        You need an approved vehicle to post a ride.{" "}
        <Link to="/vehicles/mine" className="font-medium underline">
          Add or check your vehicles
        </Link>
      </p>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value, approved.find((v) => v.id === e.target.value))}
      required
      className={className}
    >
      <option value="">Select a vehicle</option>
      {approved.map((v) => (
        <option key={v.id} value={v.id}>
          {v.colour} {v.make} {v.model} · {v.plateNumber} ({v.seatCapacity} seats)
        </option>
      ))}
    </select>
  );
}
