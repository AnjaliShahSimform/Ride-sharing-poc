import { PAGE_SIZES } from "../../hooks/useListParams";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

const buttonClass =
  "rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent";

export function Pagination({ page, pageSize, total, noun, onPage, onPageSize }: Props) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(total, current * pageSize);

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
      <span>
        Showing {first}–{last} of {total} {noun}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Rows
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => onPage(1)} disabled={current <= 1} className={buttonClass} aria-label="First page">
          «
        </button>
        <button type="button" onClick={() => onPage(current - 1)} disabled={current <= 1} className={buttonClass}>
          Previous
        </button>
        <span className="whitespace-nowrap">
          Page {current} of {totalPages}
        </span>
        <button type="button" onClick={() => onPage(current + 1)} disabled={current >= totalPages} className={buttonClass}>
          Next
        </button>
        <button
          type="button"
          onClick={() => onPage(totalPages)}
          disabled={current >= totalPages}
          className={buttonClass}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </nav>
  );
}
