import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api";

export function PostRidePage() {
  const [originLabel, setOriginLabel] = useState("");
  const [originLat, setOriginLat] = useState("");
  const [originLng, setOriginLng] = useState("");
  const [destLabel, setDestLabel] = useState("");
  const [destLat, setDestLat] = useState("");
  const [destLng, setDestLng] = useState("");
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
        setOriginLat(String(position.coords.latitude));
        setOriginLng(String(position.coords.longitude));
        setLocating(false);
      },
      () => {
        setGeoError("Couldn't get your location. Enter it manually below.");
        setLocating(false);
      },
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/rides", {
        method: "POST",
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
        <label className={labelClass}>
          Origin label
          <input value={originLabel} onChange={(e) => setOriginLabel(e.target.value)} required className={inputClass} />
        </label>
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
              <input value={originLat} onChange={(e) => setOriginLat(e.target.value)} required className={inputClass} />
            </label>
            <label className={labelClass}>
              Origin longitude
              <input value={originLng} onChange={(e) => setOriginLng(e.target.value)} required className={inputClass} />
            </label>
          </div>
        </div>
        <label className={labelClass}>
          Destination label
          <input value={destLabel} onChange={(e) => setDestLabel(e.target.value)} required className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-4">
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
