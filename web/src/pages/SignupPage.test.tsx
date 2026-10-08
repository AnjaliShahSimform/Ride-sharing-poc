import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import { SignupPage } from "./SignupPage";

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/signup"]}>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/rides" element={<p>Rides page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anjali" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anjali@example.com" } });
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "9999999999" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
}

describe("SignupPage", () => {
  it("submits the form and navigates to /rides on success", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ user: { id: "1" } });
    renderPage();

    fillAndSubmit();

    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledWith("/api/auth/signup", {
        method: "POST",
        body: { name: "Anjali", email: "anjali@example.com", phone: "9999999999", password: "correct-horse" },
      });
    });
    expect(await screen.findByText("Rides page")).toBeInTheDocument();
  });

  it("shows the server's error message when signup fails", async () => {
    vi.spyOn(api, "apiFetch").mockRejectedValue(new api.ApiError(409, "An account with this email already exists"));
    renderPage();

    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
  });
});
