import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import { PostRidePage } from "./PostRidePage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/rides/new"]}>
      <Routes>
        <Route path="/rides/new" element={<PostRidePage />} />
        <Route path="/rides/mine" element={<p>My rides page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Origin label"), { target: { value: "Ahmedabad" } });
  fireEvent.change(screen.getByLabelText("Origin latitude"), { target: { value: "23.0225" } });
  fireEvent.change(screen.getByLabelText("Origin longitude"), { target: { value: "72.5714" } });
  fireEvent.change(screen.getByLabelText("Destination label"), { target: { value: "Mumbai" } });
  fireEvent.change(screen.getByLabelText("Destination latitude"), { target: { value: "19.076" } });
  fireEvent.change(screen.getByLabelText("Destination longitude"), { target: { value: "72.8777" } });
  fireEvent.change(screen.getByLabelText("Departure time"), { target: { value: "2027-01-01T06:00" } });
  fireEvent.change(screen.getByLabelText("Total seats"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Estimated cost (₹)"), { target: { value: "1200.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Post ride" }));
}

describe("PostRidePage", () => {
  it("submits the form and navigates to /rides/mine on success", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ id: "ride-1" });
    renderPage();

    fillAndSubmit();

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith("/api/rides", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("My rides page")).toBeInTheDocument();
  });

  it("shows the server's error message when posting fails", async () => {
    vi.spyOn(api, "apiFetch").mockRejectedValue(new api.ApiError(400, "departureTime must be in the future"));
    renderPage();

    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("departureTime must be in the future");
  });
});
