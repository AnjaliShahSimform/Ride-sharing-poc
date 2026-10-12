// Rectangular approximation of India's extent (mainland + islands). This is a
// coarse guard, not a border check: it also admits slivers of neighbouring
// countries near the edges. The frontend's Nominatim `countrycodes=in` filter
// is the exact one; a point-in-polygon check would be the upgrade path if
// strict enforcement is ever needed.
export const INDIA_BOUNDS = {
  minLat: 6.5,
  maxLat: 37.5,
  minLng: 68.0,
  maxLng: 97.5,
} as const;

export function isWithinIndia(lat: number, lng: number): boolean {
  return (
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}
