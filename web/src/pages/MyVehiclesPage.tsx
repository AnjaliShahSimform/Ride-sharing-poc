import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";
import {
  DOC_LABEL,
  type DocType,
  type Vehicle,
  openDocument,
  vehicleStatusBadgeClass,
} from "../lib/vehicleTypes";

const DOC_TYPES: DocType[] = ["RC", "LICENCE"];

export function MyVehiclesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [seatCapacity, setSeatCapacity] = useState("4");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<Vehicle[]>({
    queryKey: ["vehicles", "mine"],
    queryFn: () => apiFetch("/api/vehicles/mine"),
  });

  const refresh = () => queryClient.refetchQueries({ queryKey: ["vehicles", "mine"] });
  const message = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong");

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/vehicles", {
        method: "POST",
        body: { make, model, colour, plateNumber, seatCapacity: Number(seatCapacity) },
      });
      setMake("");
      setModel("");
      setColour("");
      setPlateNumber("");
      setSeatCapacity("4");
      await refresh();
    } catch (err) {
      setError(message(err));
    }
  }

  async function handleUpload(vehicleId: string, type: DocType, file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusyKey(`${vehicleId}:${type}`);
    try {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      await apiFetch(`/api/vehicles/${vehicleId}/documents`, { method: "POST", body: form });
      await refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleView(vehicleId: string, type: DocType) {
    setError(null);
    try {
      await openDocument(apiFetch, vehicleId, type);
    } catch (err) {
      setError(message(err));
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">My vehicles</h1>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleAdd} className="mb-8 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-gray-900">Add a vehicle</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Make
            <input value={make} onChange={(e) => setMake(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Model
            <input value={model} onChange={(e) => setModel(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Colour
            <input value={colour} onChange={(e) => setColour(e.target.value)} required className={inputClass} />
          </label>
          <label className={labelClass}>
            Plate number
            <input
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              placeholder="MH12AB1234"
              required
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Passenger seats (excluding you)
            <input
              type="number"
              min="1"
              max="8"
              value={seatCapacity}
              onChange={(e) => setSeatCapacity(e.target.value)}
              required
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Add vehicle
        </button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {isError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load your vehicles.
        </p>
      )}
      {data && data.length === 0 && <p className="text-sm text-gray-500">You haven't added any vehicles yet.</p>}

      <ul className="space-y-3">
        {data?.map((v) => (
          <li key={v.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-900">
                {v.colour} {v.make} {v.model} · {v.plateNumber}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${vehicleStatusBadgeClass[v.status]}`}>
                {v.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{v.seatCapacity} passenger seats</p>
            {v.status === "PENDING" && v.documents.length < DOC_TYPES.length && (
              <p className="mt-1 text-sm text-yellow-700">Upload both documents so an admin can review this vehicle.</p>
            )}
            {v.status === "PENDING" && v.documents.length === DOC_TYPES.length && (
              <p className="mt-1 text-sm text-gray-500">Waiting for admin review.</p>
            )}
            {v.status === "REJECTED" && (
              <p className="mt-1 text-sm text-red-700">
                Rejected{v.rejectionNote ? `: ${v.rejectionNote}` : ""}. Re-upload a document to resubmit.
              </p>
            )}
            <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              {DOC_TYPES.map((type) => {
                const uploaded = v.documents.some((d) => d.type === type);
                const busy = busyKey === `${v.id}:${type}`;
                return (
                  <li key={type} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-56 text-gray-700">{DOC_LABEL[type]}</span>
                    <span className={uploaded ? "text-green-700" : "text-gray-400"}>
                      {uploaded ? "Uploaded" : "Not uploaded"}
                    </span>
                    {uploaded && (
                      <button
                        type="button"
                        onClick={() => handleView(v.id, type)}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        View
                      </button>
                    )}
                    <label className="cursor-pointer font-medium text-blue-600 hover:underline">
                      {busy ? "Uploading..." : uploaded ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        disabled={busy}
                        className="hidden"
                        onChange={(e) => {
                          void handleUpload(v.id, type, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
            {v.status === "APPROVED" && (
              <p className="mt-2 text-xs text-gray-400">Replacing a document sends this vehicle back for review.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
