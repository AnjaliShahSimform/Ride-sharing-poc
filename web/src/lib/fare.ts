// The fare rule the API enforces (src/lib/fare.ts), repeated here only to show
// the suggested range while the driver fills in the form — this package shares
// no imports with the backend, so change both together. The server is the
// authority: it re-checks on submit and its message names the allowed range.
const MIN_RATE_PER_KM = 1; // ₹ per km
const MAX_RATE_PER_KM = 10; // ₹ per km
const MIN_FARE = 10; // ₹
const MAX_FARE = 50_000; // ₹
const SHORT_RIDE_MAX_FARE = 200; // ₹

const EARTH_RADIUS_KM = 6371;

// Great-circle (haversine) distance in km.
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function fareRange(distance: number): { min: number; max: number } {
  const min = Math.max(MIN_FARE, Math.ceil(distance * MIN_RATE_PER_KM));
  const max = Math.min(MAX_FARE, Math.max(SHORT_RIDE_MAX_FARE, Math.floor(distance * MAX_RATE_PER_KM)));
  return { min, max };
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// Whole rupees stay whole; anything else shows its paise (₹337.50, ₹116.67).
function formatShare(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// What a rider sees on a search result. `estimatedCost` is the whole car's cost,
// split equally among the riders who confirm — so the first rider pays all of
// it and the share falls as the car fills. Display only: the amount actually
// charged comes from the server (Booking.costShare). Mirrors the server's
// split, rounded to 2 places.
export function fareLabel(totalCost: string, totalSeats: number): string {
  const total = Number(totalCost);
  if (Number.isNaN(total)) {
    return "";
  }
  if (totalSeats <= 1) {
    return `${formatShare(total)} for the car`;
  }
  const eachWhenFull = Math.round((total / totalSeats) * 100) / 100;
  return `${formatShare(total)} for the car, shared by riders · ${formatShare(eachWhenFull)} each if all ${totalSeats} seats fill`;
}
