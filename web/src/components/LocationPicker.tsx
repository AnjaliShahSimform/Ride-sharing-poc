import { useEffect, useRef, useState } from "react";

export interface LocationValue {
  label: string;
  lat: string;
  lng: string;
}

interface LocationPickerProps {
  label: string;
  labelValue: string;
  latValue: string;
  lngValue: string;
  onChange: (next: LocationValue) => void;
  required?: boolean;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 400;

// OpenStreetMap's Nominatim — free, no API key, no signup. Usage policy asks
// for a debounced query rate (roughly 1/sec), which a normal autocomplete
// already satisfies. Called directly from the browser, not through apiFetch
// (that helper is for this app's own backend and adds a CSRF header that
// doesn't belong on a third-party GET).
async function searchNominatim(query: string, signal: AbortSignal): Promise<NominatimResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    return [];
  }
  return res.json();
}

export function LocationPicker({ label, labelValue, latValue, lngValue, onChange, required }: LocationPickerProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function handleInputChange(text: string) {
    // Typing invalidates any previously selected coordinates — a stale
    // lat/lng paired with new free-text would silently search the wrong
    // place.
    onChange({ label: text, lat: "", lng: "" });
    setSuggestions([]);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    abortRef.current?.abort();

    if (text.trim().length < MIN_QUERY_LENGTH) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      searchNominatim(text, controller.signal)
        .then(setSuggestions)
        .catch(() => {
          // Aborted or network failure — leave suggestions empty, no error
          // surfaced; the user can keep typing or try again.
        });
    }, DEBOUNCE_MS);
  }

  function handleSelect(result: NominatimResult) {
    onChange({ label: result.display_name, lat: result.lat, lng: result.lon });
    setSuggestions([]);
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        <input
          value={labelValue}
          onChange={(e) => handleInputChange(e.target.value)}
          required={required}
          autoComplete="off"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      {/* Hidden fields so a parent form's "has a real location been picked?"
          check has something concrete to read, same as before this
          component existed. */}
      <input type="hidden" value={latValue} />
      <input type="hidden" value={lngValue} />
      {suggestions.length > 0 && (
        <ul role="listbox" className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {suggestions.map((result) => (
            <li key={`${result.lat},${result.lon}`} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => handleSelect(result)}
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
              >
                {result.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
