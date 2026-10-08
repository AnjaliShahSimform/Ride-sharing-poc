import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import { SearchRidesPage } from "./SearchRidesPage";

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SearchRidesPage />
    </QueryClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Origin latitude"), { target: { value: "23.03" } });
  fireEvent.change(screen.getByLabelText("Origin longitude"), { target: { value: "72.58" } });
  fireEvent.change(screen.getByLabelText("Destination latitude"), { target: { value: "19.08" } });
  fireEvent.change(screen.getByLabelText("Destination longitude"), { target: { value: "72.88" } });
  fireEvent.change(screen.getByLabelText("Earliest departure"), { target: { value: "2027-01-01T00:00" } });
  fireEvent.change(screen.getByLabelText("Latest departure"), { target: { value: "2027-01-01T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

describe("SearchRidesPage", () => {
  it("renders search results after submitting the form", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue([
      {
        id: "ride-1",
        originLabel: "Ahmedabad",
        destLabel: "Mumbai",
        departureTime: "2027-01-01T06:00:00.000Z",
        totalSeats: 3,
        seatsAvailable: 2,
        estimatedCost: "1200.00",
      },
    ]);

    renderPage();
    fillAndSubmit();

    expect(await screen.findByText(/Ahmedabad/)).toBeInTheDocument();
  });

  it("shows an explicit empty state when no rides match", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue([]);

    renderPage();
    fillAndSubmit();

    expect(await screen.findByText("No rides match your search.")).toBeInTheDocument();
  });

  it("converts the departure time inputs to UTC ISO strings before sending them to the backend", async () => {
    const apiFetchMock = vi.spyOn(api, "apiFetch").mockResolvedValue([]);

    renderPage();
    fillAndSubmit();

    await screen.findByText("No rides match your search.");

    const calledPath = apiFetchMock.mock.calls[0][0] as string;
    const params = new URLSearchParams(calledPath.split("?")[1]);
    const earliestDeparture = params.get("earliestDeparture");
    const latestDeparture = params.get("latestDeparture");

    expect(earliestDeparture).toBe(new Date("2027-01-01T00:00").toISOString());
    expect(latestDeparture).toBe(new Date("2027-01-01T12:00").toISOString());
  });

  it("shows the actual error message when the search request fails", async () => {
    const { ApiError } = api;
    vi.spyOn(api, "apiFetch").mockRejectedValue(new ApiError(400, "radiusKm must be positive"));

    renderPage();
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("radiusKm must be positive");
  });
});
