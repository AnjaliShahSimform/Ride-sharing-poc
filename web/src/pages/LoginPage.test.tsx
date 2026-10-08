import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import { LoginPage } from "./LoginPage";

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/rides" element={<p>Rides page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anjali@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginPage", () => {
  it("submits the form and navigates to /rides on success", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ user: { id: "1" } });
    renderPage();

    fillAndSubmit();

    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledWith("/api/auth/login", {
        method: "POST",
        body: { email: "anjali@example.com", password: "correct-horse" },
      });
    });
    expect(await screen.findByText("Rides page")).toBeInTheDocument();
  });

  it("shows the server's error message when login fails", async () => {
    vi.spyOn(api, "apiFetch").mockRejectedValue(new api.ApiError(401, "Invalid email or password"));
    renderPage();

    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});
