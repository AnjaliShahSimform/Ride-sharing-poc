import { type ChangeEvent, type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";

interface RideResult {
  id: string;
  originLabel: string;
  destLabel: string;
  departureTime: string;
  totalSeats: number;
  seatsAvailable: number;
  estimatedCost: string;
}

interface SearchParams {
  originLat: string;
  originLng: string;
  destLat: string;
  destLng: string;
  earliestDeparture: string;
  latestDeparture: string;
  radiusKm: string;
}

const emptySearch: SearchParams = {
  originLat: "",
  originLng: "",
  destLat: "",
  destLng: "",
  earliestDeparture: "",
  latestDeparture: "",
  radiusKm: "10",
};

export function SearchRidesPage() {
  const [form, setForm] = useState<SearchParams>(emptySearch);
  const [submitted, setSubmitted] = useState<SearchParams | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function useCurrentLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Your browser doesn't support location access.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((f) => ({
          ...f,
          originLat: String(position.coords.latitude),
          originLng: String(position.coords.longitude),
        }));
        setLocating(false);
      },
      () => {
        setGeoError("Couldn't get your location. Enter it manually below.");
        setLocating(false);
      },
    );
  }

  const { data, isLoading, isError, error } = useQuery<RideResult[]>({
    queryKey: ["rides", "search", submitted],
    queryFn: () => apiFetch(`/api/rides/search?${new URLSearchParams(submitted as unknown as Record<string, string>).toString()}`),
    enabled: submitted !== null,
    retry: false,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // The backend parses these as UTC, so the raw datetime-local value (which
    // has no timezone of its own) must be converted to a UTC ISO string here
    // the same way PostRidePage does — otherwise a non-UTC user's search
    // window is silently shifted by their timezone offset.
    setSubmitted({
      ...form,
      earliestDeparture: new Date(form.earliestDeparture).toISOString(),
      latestDeparture: new Date(form.latestDeparture).toISOString(),
    });
  }

  function updateField(field: keyof SearchParams) {
    return (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Search rides</h1>
      <form onSubmit={handleSubmit} className="rounded-xl bg-white p-8 shadow-sm">
        <div className="space-y-4">
          <div>
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={locating}
              className="mb-2 text-sm font-medium text-blue-600 hover:underline disabled:text-gray-400"
            >
              {locating ? "Locating..." : "Use my current location"}
            </button>
            {geoError && <p className="mb-2 text-sm text-red-600">{geoError}</p>}
            <div className="grid grid-cols-2 gap-4">
              <label className={labelClass}>
                Origin latitude
                <input value={form.originLat} onChange={updateField("originLat")} required className={inputClass} />
              </label>
              <label className={labelClass}>
                Origin longitude
                <input value={form.originLng} onChange={updateField("originLng")} required className={inputClass} />
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelClass}>
              Destination latitude
              <input value={form.destLat} onChange={updateField("destLat")} required className={inputClass} />
            </label>
            <label className={labelClass}>
              Destination longitude
              <input value={form.destLng} onChange={updateField("destLng")} required className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelClass}>
              Earliest departure
              <input
                type="datetime-local"
                value={form.earliestDeparture}
                onChange={updateField("earliestDeparture")}
                required
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Latest departure
              <input
                type="datetime-local"
                value={form.latestDeparture}
                onChange={updateField("latestDeparture")}
                required
                className={inputClass}
              />
            </label>
          </div>
          <label className={labelClass}>
            Search radius (km)
            <input value={form.radiusKm} onChange={updateField("radiusKm")} required className={inputClass} />
          </label>
        </div>
        <button
          type="submit"
          className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Search
        </button>
      </form>

      <div className="mt-6">
        {isLoading && <p className="text-sm text-gray-500">Searching...</p>}
        {isError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error instanceof ApiError ? error.message : "Search failed"}
          </p>
        )}
        {data && data.length === 0 && <p className="text-sm text-gray-500">No rides match your search.</p>}
        {data && data.length > 0 && (
          <ul className="space-y-3">
            {data.map((ride) => (
              <li key={ride.id} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="font-medium text-gray-900">
                  {ride.originLabel} → {ride.destLabel}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {new Date(ride.departureTime).toLocaleString()} · {ride.seatsAvailable}/{ride.totalSeats} seats · ₹
                  {ride.estimatedCost}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
