import { type FormEvent, useState } from "react";
import { apiFetch, ApiError } from "../lib/api";

export interface EditableRide {
  id: string;
  originLabel: string;
  originLat: number;
  originLng: number;
  destLabel: string;
  destLat: number;
  destLng: number;
  departureTime: string;
  totalSeats: number;
  estimatedCost: string;
}

interface EditRideFormProps {
  ride: EditableRide;
  onSaved: () => void;
  onCancel: () => void;
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time, not an ISO
// UTC string — same conversion PostRidePage does in reverse on submit.
function toDatetimeLocalValue(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditRideForm({ ride, onSaved, onCancel }: EditRideFormProps) {
  const [originLabel, setOriginLabel] = useState(ride.originLabel);
  const [originLat, setOriginLat] = useState(String(ride.originLat));
  const [originLng, setOriginLng] = useState(String(ride.originLng));
  const [destLabel, setDestLabel] = useState(ride.destLabel);
  const [destLat, setDestLat] = useState(String(ride.destLat));
  const [destLng, setDestLng] = useState(String(ride.destLng));
  const [departureTime, setDepartureTime] = useState(toDatetimeLocalValue(ride.departureTime));
  const [totalSeats, setTotalSeats] = useState(String(ride.totalSeats));
  const [estimatedCost, setEstimatedCost] = useState(ride.estimatedCost);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch(`/api/rides/${ride.id}`, {
        method: "PATCH",
        body: {
          originLabel,
          originLat: Number(originLat),
          originLng: Number(originLng),
          destLabel,
          destLat: Number(destLat),
          destLng: Number(destLng),
          departureTime: new Date(departureTime).toISOString(),
          totalSeats: Number(totalSeats),
          estimatedCost,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "block text-xs font-medium text-gray-700";

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <label className={labelClass}>
        Origin label
        <input value={originLabel} onChange={(e) => setOriginLabel(e.target.value)} required className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Origin latitude
          <input value={originLat} onChange={(e) => setOriginLat(e.target.value)} required className={inputClass} />
        </label>
        <label className={labelClass}>
          Origin longitude
          <input value={originLng} onChange={(e) => setOriginLng(e.target.value)} required className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        Destination label
        <input value={destLabel} onChange={(e) => setDestLabel(e.target.value)} required className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Destination latitude
          <input value={destLat} onChange={(e) => setDestLat(e.target.value)} required className={inputClass} />
        </label>
        <label className={labelClass}>
          Destination longitude
          <input value={destLng} onChange={(e) => setDestLng(e.target.value)} required className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        Departure time
        <input
          type="datetime-local"
          value={departureTime}
          onChange={(e) => setDepartureTime(e.target.value)}
          required
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Total seats
          <input
            type="number"
            min="1"
            value={totalSeats}
            onChange={(e) => setTotalSeats(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Estimated cost (₹)
          <input value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} required className={inputClass} />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
