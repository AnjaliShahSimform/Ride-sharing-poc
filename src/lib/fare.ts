// Sanity rules for a ride's `estimatedCost`. That value is the TOTAL trip cost,
// which is split evenly among the riders who confirm — so the rule is about the
// whole car trip, not one seat. It is judged against the straight-line distance
// between origin and destination (no routing API involved): real roads are
// longer, which the generous upper rate absorbs, and the lower rate is low
// enough that no honest cost-sharing fare falls under it.
//
// The numbers live here only. web/src/lib/fare.ts repeats them to show the
// suggested range in the form (the two packages share no imports); change both.
export const MIN_RATE_PER_KM = 1; // ₹ per km
export const MAX_RATE_PER_KM = 10; // ₹ per km — fuel, tolls and wear for a car
export const MIN_FARE = 10; // ₹ — floor for very short hops
export const MAX_FARE = 50_000; // ₹ — absolute ceiling, whatever the distance
export const SHORT_RIDE_MAX_FARE = 200; // ₹ — a short hop may still cost this much

const EARTH_RADIUS_KM = 6371;

// Great-circle (haversine) distance in km.
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Whole-rupee bounds (min rounded up, max rounded down) so the message and the
// check agree exactly on what is allowed.
export function fareRange(distance: number): { min: number; max: number } {
  const min = Math.max(MIN_FARE, Math.ceil(distance * MIN_RATE_PER_KM));
  const max = Math.min(MAX_FARE, Math.max(SHORT_RIDE_MAX_FARE, Math.floor(distance * MAX_RATE_PER_KM)));
  return { min, max };
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
