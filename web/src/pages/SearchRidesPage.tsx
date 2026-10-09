import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { LocationPicker, type LocationValue } from "../components/LocationPicker";

interface RideResult {
  id: string;
  originLabel: string;
  destLabel: string;
  departureTime: string;
  totalSeats: number;
  seatsAvailable: number;
  estimatedCost: string;
}

interface SubmittedParams {
  originLat: string;
  originLng: string;
  destLat: string;
  destLng: string;
  earliestDeparture: string;
  latestDeparture: string;
  radiusKm: string;
}

const emptyLocation: LocationValue = { label: "", lat: "", lng: "" };

export function SearchRidesPage() {
  const [origin, setOrigin] = useState<LocationValue>(emptyLocation);
  const [dest, setDest] = useState<LocationValue>(emptyLocation);
  const [date, setDate] = useState("");
  const [radiusKm, setRadiusKm] = useState("10");
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const isRider = currentUser?.user.roles.includes("RIDER") ?? false;
  const [bookError, setBookError] = useState<string | null>(null);
  const [bookSuccess, setBookSuccess] = useState<string | null>(null);
  const [bookingInProgress, setBookingInProgress] = useState<string | null>(null);

  async function handleBook(rideId: string) {
    if (bookingInProgress) {
      return;
    }
    setBookError(null);
    setBookSuccess(null);
    setBookingInProgress(rideId);
    try {
      const booking = await apiFetch<{ costShare: string }>(`/api/rides/${rideId}/bookings`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["rides", "search"] });
      setBookSuccess(`Booked! Your share: ₹${booking.costShare}`);
    } catch (err) {
      setBookError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBookingInProgress(null);
    }
  }

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

  const { data, isLoading, isError, error } = useQuery<RideResult[]>({
    queryKey: ["rides", "search", submitted],
    queryFn: () => apiFetch(`/api/rides/search?${new URLSearchParams(submitted as unknown as Record<string, string>).toString()}`),
    enabled: submitted !== null,
    retry: false,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!origin.lat || !origin.lng || !dest.lat || !dest.lng) {
      setFormError("Select a location from the dropdown for both origin and destination.");
      return;
    }
    // A single calendar date, expanded to its full local day (midnight to
    // midnight) and converted to UTC — the backend still takes an exact
    // earliest/latest departure range, it's just always a whole day now.
    setSubmitted({
      originLat: origin.lat,
      originLng: origin.lng,
      destLat: dest.lat,
      destLng: dest.lng,
      radiusKm,
      earliestDeparture: new Date(`${date}T00:00:00`).toISOString(),
      latestDeparture: new Date(`${date}T23:59:59.999`).toISOString(),
    });
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Search rides</h1>
      <form onSubmit={handleSubmit} className="rounded-xl bg-white p-8 shadow-sm">
        {formError && (
          <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
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
            Travel date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Search radius (km)
            <input value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} required className={inputClass} />
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
          <>
            {bookError && (
              <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {bookError}
              </p>
            )}
            {bookSuccess && (
              <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{bookSuccess}</p>
            )}
            <ul className="space-y-3">
              {data.map((ride) => (
                <li key={ride.id} className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
                  <div>
                    <p className="font-medium text-gray-900">
                      {ride.originLabel} → {ride.destLabel}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {new Date(ride.departureTime).toLocaleString()} · {ride.seatsAvailable}/{ride.totalSeats} seats · ₹
                      {ride.estimatedCost}
                    </p>
                  </div>
                  {isRider && (
                    <button
                      onClick={() => handleBook(ride.id)}
                      disabled={bookingInProgress === ride.id}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {bookingInProgress === ride.id ? "Booking..." : "Book"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
