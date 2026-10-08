import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import { MyRidesPage } from "./MyRidesPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MyRidesPage />
    </QueryClientProvider>,
  );
}

const scheduledRide = {
  id: "ride-1",
  originLabel: "Ahmedabad",
  destLabel: "Mumbai",
  departureTime: "2027-01-01T06:00:00.000Z",
  status: "SCHEDULED",
  totalSeats: 3,
  seatsAvailable: 3,
};

const cancelledRide = { ...scheduledRide, id: "ride-2", status: "CANCELLED" };

describe("MyRidesPage", () => {
  it("renders the driver's rides", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue([scheduledRide]);

    renderPage();

    expect(await screen.findByText(/Ahmedabad/)).toBeInTheDocument();
  });

  it("shows an explicit empty state when there are no rides", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("You haven't posted any rides yet.")).toBeInTheDocument();
  });

  it("shows cancel/complete buttons only for a SCHEDULED ride", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue([scheduledRide, cancelledRide]);

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBe(2);
    });

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("SCHEDULED");
    expect(items[0].querySelector("button")).not.toBeNull();
    expect(items[1]).toHaveTextContent("CANCELLED");
    expect(items[1].querySelector("button")).toBeNull();
  });

  it("cancels a ride and refetches the list", async () => {
    const apiFetchMock = vi
      .spyOn(api, "apiFetch")
      .mockResolvedValueOnce([scheduledRide])
      .mockResolvedValueOnce({ id: "ride-1", status: "CANCELLED" })
      .mockResolvedValueOnce([cancelledRide]);

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByText((content, element) => {
        return element?.tagName === "LI" && content.includes("CANCELLED");
      })).toBeInTheDocument();
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/rides/ride-1/cancel", { method: "PATCH" });
  });
});
