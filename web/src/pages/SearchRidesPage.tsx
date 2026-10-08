import { type ChangeEvent, type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

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

  const { data, isLoading, isError } = useQuery<RideResult[]>({
    queryKey: ["rides", "search", submitted],
    queryFn: () => apiFetch(`/api/rides/search?${new URLSearchParams(submitted as unknown as Record<string, string>).toString()}`),
    enabled: submitted !== null,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(form);
  }

  function updateField(field: keyof SearchParams) {
    return (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });
  }

  return (
    <div>
      <h1>Search rides</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Origin latitude
          <input value={form.originLat} onChange={updateField("originLat")} required />
        </label>
        <label>
          Origin longitude
          <input value={form.originLng} onChange={updateField("originLng")} required />
        </label>
        <label>
          Destination latitude
          <input value={form.destLat} onChange={updateField("destLat")} required />
        </label>
        <label>
          Destination longitude
          <input value={form.destLng} onChange={updateField("destLng")} required />
        </label>
        <label>
          Earliest departure
          <input
            type="datetime-local"
            value={form.earliestDeparture}
            onChange={updateField("earliestDeparture")}
            required
          />
        </label>
        <label>
          Latest departure
          <input type="datetime-local" value={form.latestDeparture} onChange={updateField("latestDeparture")} required />
        </label>
        <label>
          Search radius (km)
          <input value={form.radiusKm} onChange={updateField("radiusKm")} required />
        </label>
        <button type="submit">Search</button>
      </form>

      {isLoading && <p>Searching...</p>}
      {isError && <p role="alert">Search failed</p>}
      {data && data.length === 0 && <p>No rides match your search.</p>}
      {data && data.length > 0 && (
        <ul>
          {data.map((ride) => (
            <li key={ride.id}>
              {ride.originLabel} → {ride.destLabel} · {new Date(ride.departureTime).toLocaleString()} ·{" "}
              {ride.seatsAvailable}/{ride.totalSeats} seats · ₹{ride.estimatedCost}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
