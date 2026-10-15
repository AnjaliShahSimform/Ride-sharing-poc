import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { useClampPage, useListParams, type Paged } from "../../hooks/useListParams";
import { DateRangeFilter, FilterBar, SearchFilter, SelectFilter } from "../../components/admin/FilterBar";
import { EmptyRow, ListError, ListLoading } from "../../components/admin/ListMessages";
import { Pagination } from "../../components/admin/Pagination";
import { formatVehicle, type VehicleSummary } from "../../lib/vehicleTypes";

interface AdminRide {
  id: string;
  originLabel: string;
  destLabel: string;
  departureTime: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  totalSeats: number;
  seatsAvailable: number;
  estimatedCost: string;
  driver: { id: string; name: string; email: string };
  vehicle?: VehicleSummary | null;
}

const STATUS_OPTIONS = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const FILTER_KEYS = ["status", "q", "departureFrom", "departureTo"] as const;

export function AdminRidesPage() {
  const list = useListParams(FILTER_KEYS);
  const { filters } = list;

  const { data, isLoading, isError, error, isFetching } = useQuery<Paged<AdminRide>>({
    queryKey: ["admin", "rides", list.query],
    queryFn: () => apiFetch(`/api/admin/rides?${list.query}`),
    placeholderData: keepPreviousData,
  });
  useClampPage(data, list.page, list.pageSize, list.setPage);

  if (isLoading) return <ListLoading />;
  if (isError && !data) return <ListError what="rides" error={error} />;

  const statusBadgeClass: Record<AdminRide["status"], string> = {
    SCHEDULED: "bg-blue-100 text-blue-700",
    CANCELLED: "bg-gray-100 text-gray-600",
    COMPLETED: "bg-green-100 text-green-700",
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">All rides</h1>
      <FilterBar hasFilters={list.hasFilters} onClear={list.clearFilters}>
        <SearchFilter
          label="Search"
          value={filters.q}
          placeholder="Route, driver name or email"
          onChange={(v) => list.setFilter("q", v)}
        />
        <SelectFilter
          label="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
          onChange={(v) => list.setFilter("status", v)}
        />
        <DateRangeFilter
          label="Departs"
          from={filters.departureFrom}
          to={filters.departureTo}
          onFrom={(v) => list.setFilter("departureFrom", v)}
          onTo={(v) => list.setFilter("departureTo", v)}
        />
      </FilterBar>
      {isError && <ListError what="rides" error={error} />}
      <div className={`overflow-x-auto rounded-xl bg-white shadow-sm ${isFetching ? "opacity-60" : ""}`}>
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Departure</th>
              <th className="px-4 py-3">Seats</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.items.length === 0 && <EmptyRow colSpan={7} what="rides" hasFilters={list.hasFilters} />}
            {data?.items.map((ride) => (
              <tr key={ride.id}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {ride.originLabel} → {ride.destLabel}
                </td>
                <td className="px-4 py-3 text-gray-600">{ride.driver.name}</td>
                <td className="px-4 py-3 text-gray-600">{ride.vehicle ? formatVehicle(ride.vehicle) : "—"}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(ride.departureTime).toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-600">
                  {ride.seatsAvailable}/{ride.totalSeats}
                </td>
                <td className="px-4 py-3 text-gray-600">₹{ride.estimatedCost}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass[ride.status]}`}>
                    {ride.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={data.total}
          noun="rides"
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  );
}
