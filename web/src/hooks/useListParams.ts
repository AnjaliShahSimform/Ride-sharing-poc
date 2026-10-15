import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export const PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

// The envelope every admin list endpoint returns.
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function positiveInt(raw: string | null, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// A list page's filters, page and page size live in the URL (not component
// state): a filtered view survives a refresh, can be shared as a link, and the
// browser's back button steps through it. Changing a filter or the page size
// drops back to page 1, since the old page number may no longer exist.
export function useListParams<K extends string>(filterKeys: readonly K[]) {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = positiveInt(searchParams.get("page"), 1);
  const requestedSize = positiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE;

  const filters = Object.fromEntries(filterKeys.map((k) => [k, searchParams.get(k) ?? ""])) as Record<K, string>;
  const hasFilters = filterKeys.some((k) => filters[k] !== "");

  // The query string for the API: only non-empty filters are sent.
  const apiParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const k of filterKeys) {
    if (filters[k]) apiParams.set(k, filters[k]);
  }
  const query = apiParams.toString();

  // Updater form, so quick consecutive changes build on each other.
  function update(patch: Record<string, string>, resetPage: boolean) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (resetPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  return {
    page,
    pageSize,
    filters,
    hasFilters,
    query,
    setFilter: (key: K, value: string) => update({ [key]: value }, true),
    setPage: (p: number) => update({ page: p > 1 ? String(p) : "" }, false),
    setPageSize: (size: number) => update({ pageSize: String(size) }, true),
    clearFilters: () =>
      update(Object.fromEntries(filterKeys.map((k) => [k, ""])), true),
  };
}

// A stale link (?page=9) or the last row of the last page being removed leaves
// the current page empty although matching rows exist: jump to the real last page.
export function useClampPage<T>(
  data: Paged<T> | undefined,
  page: number,
  pageSize: number,
  setPage: (p: number) => void,
) {
  useEffect(() => {
    if (!data || data.items.length > 0 || data.total === 0) return;
    const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
    // Only act while we're past the end: once page == lastPage this is a no-op,
    // so the placeholder data shown during the next fetch can't make it loop.
    if (page > lastPage) setPage(lastPage);
  }, [data, page, pageSize, setPage]);
}
