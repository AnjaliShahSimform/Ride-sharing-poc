export type VehicleStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DocType = "RC" | "LICENCE";

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  colour: string;
  plateNumber: string;
  seatCapacity: number;
  status: VehicleStatus;
  rejectionNote: string | null;
  createdAt: string;
  documents: { type: DocType; uploadedAt: string }[];
}

// What a ride/booking carries: a snapshot, not the live vehicle.
export interface VehicleSummary {
  make: string;
  model: string;
  colour: string;
  plate: string;
}

export function formatVehicle(v: VehicleSummary): string {
  return `${v.colour} ${v.make} ${v.model} · ${v.plate}`;
}

export const DOC_LABEL: Record<DocType, string> = { RC: "RC (registration certificate)", LICENCE: "Driving licence" };

export const vehicleStatusBadgeClass: Record<VehicleStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

// Opens a short-lived signed URL in a new tab. The link is fetched on click
// because it expires after 60 seconds.
export async function openDocument(apiFetch: <T>(path: string) => Promise<T>, vehicleId: string, type: DocType) {
  const { url } = await apiFetch<{ url: string }>(`/api/vehicles/${vehicleId}/documents/${type}`);
  window.open(url, "_blank", "noopener");
}
