import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api";
import { LocationPicker, type LocationValue } from "../components/LocationPicker";

const emptyLocation: LocationValue = { label: "", lat: "", lng: "" };

export function PostRidePage() {
  const [origin, setOrigin] = useState<LocationValue>(emptyLocation);
  const [dest, setDest] = useState<LocationValue>(emptyLocation);
  const [departureTime, setDepartureTime] = useState("");
  const [totalSeats, setTotalSeats] = useState("1");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const navigate = useNavigate();

  function useCurrentLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Your browser doesn't support location access.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({ label: "Current location", lat: String(position.coords.latitude), lng: String(position.coords.longitude) });
        setLocating(false);
      },
      () => {
        setGeoError("Couldn't get your location. Search for it below.");
        setLocating(false);
      },
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!origin.lat || !origin.lng || !dest.lat || !dest.lng) {
      setError("Select a location from the dropdown for both origin and destination.");
      return;
    }
    try {
      await apiFetch("/api/rides", {
        method: "POST",
        body: {
          originLabel: origin.label,
          originLat: Number(origin.lat),
          originLng: Number(origin.lng),
          destLabel: dest.label,
          destLat: Number(dest.lat),
          destLng: Number(dest.lng),
          departureTime: new Date(departureTime).toISOString(),
          totalSeats: Number(totalSeats),
          estimatedCost,
        },
      });
      navigate("/rides/mine");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Post a ride</h1>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
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
          <LocationPicker label="Origin" labelValue={origin.label} latValue={origin.lat} lngValue={origin.lng} onChange={setOrigin} />
        </div>
        <LocationPicker label="Destination" labelValue={dest.label} latValue={dest.lat} lngValue={dest.lng} onChange={setDest} />
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
        <div className="grid grid-cols-2 gap-4">
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
      </div>
      <button
        type="submit"
        className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Post ride
      </button>
    </form>
  );
}
