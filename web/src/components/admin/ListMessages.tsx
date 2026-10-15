export function ListLoading() {
  return <p className="text-sm text-gray-500">Loading...</p>;
}

export function ListError({ what, error }: { what: string; error: unknown }) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      Failed to load {what}.{detail}
    </p>
  );
}

export function EmptyRow({ colSpan, what, hasFilters }: { colSpan: number; what: string; hasFilters: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-gray-500">
        {hasFilters ? `No ${what} match these filters.` : `No ${what} yet.`}
      </td>
    </tr>
  );
}
