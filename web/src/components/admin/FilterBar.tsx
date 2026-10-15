import { useEffect, useRef, useState, type ReactNode } from "react";

const inputClass = "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900";

export function FilterBar({
  children,
  hasFilters,
  onClear,
}: {
  children: ReactNode;
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm">
      {children}
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium uppercase text-gray-500">
      {label}
      {children}
    </label>
  );
}

export function SelectFilter({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} normal-case`}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// A from–to pair of calendar-day pickers. Each limits the other so the picker
// itself can't produce an inverted range (which the API rejects with a 400).
export function DateRangeFilter({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <>
      <Field label={`${label} from`}>
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onFrom(e.target.value)}
          className={`${inputClass} normal-case`}
        />
      </Field>
      <Field label={`${label} to`}>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onTo(e.target.value)}
          className={`${inputClass} normal-case`}
        />
      </Field>
    </>
  );
}

// Debounced so a request isn't fired per keystroke. The box keeps its own text
// while typing; `value` (from the URL) wins again only when something other
// than this box changed it, e.g. "Clear filters".
export function SearchFilter({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const lastSent = useRef(value);
  // Callers pass a fresh closure each render; the ref keeps the debounce timer
  // from restarting on every unrelated re-render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = trimmed;
      onChangeRef.current(trimmed);
    }, 400);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <Field label={label}>
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={100}
        className={`${inputClass} w-56 normal-case`}
      />
    </Field>
  );
}
