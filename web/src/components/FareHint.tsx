import { distanceKm, fareRange, formatRupees } from "../lib/fare";

interface FareHintProps {
  originLat: string;
  originLng: string;
  destLat: string;
  destLng: string;
  fare: string;
}

// Shows the fare range the API will accept for this route, and warns as soon as
// the typed fare falls outside it. Renders nothing until both ends of the route
// are known. Advisory only: the server re-checks on submit.
export function FareHint({ originLat, originLng, destLat, destLng, fare }: FareHintProps) {
  const coords = [originLat, originLng, destLat, destLng].map((value) => (value.trim() === "" ? NaN : Number(value)));
  if (coords.some((n) => Number.isNaN(n))) {
    return <p className="text-xs text-gray-400">Pick both locations to see the suggested fare.</p>;
  }

  const km = distanceKm(coords[0], coords[1], coords[2], coords[3]);
  const { min, max } = fareRange(km);
  const typed = fare.trim() === "" ? NaN : Number(fare);
  const outside = !Number.isNaN(typed) && (typed < min || typed > max);

  return (
    <p className={`text-xs ${outside ? "text-red-600" : "text-gray-500"}`}>
      {outside
        ? `${formatRupees(typed)} is too ${typed < min ? "low" : "high"} for this ~${Math.round(km)} km route. `
        : `~${Math.round(km)} km route. `}
      Allowed total fare: {formatRupees(min)}–{formatRupees(max)}, split among your confirmed riders.
    </p>
  );
}
