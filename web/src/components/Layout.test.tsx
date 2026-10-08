import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import * as useCurrentUserModule from "../hooks/useCurrentUser";
import { Layout } from "./Layout";

function renderLayout() {
  const queryClient = new QueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/rides"]}>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route element={<Layout />}>
            <Route path="/rides" element={<p>Rides content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe("Layout", () => {
  it("shows driver-only links for a user with the DRIVER role", () => {
    // @ts-expect-error -- partial mock, only the fields Layout reads
    vi.spyOn(useCurrentUserModule, "useCurrentUser").mockReturnValue({
      data: { user: { id: "1", name: "A", email: "a@example.com", phone: "1", roles: ["DRIVER", "RIDER"] } },
    });

    renderLayout();

    expect(screen.getByText("Post a ride")).toBeInTheDocument();
    expect(screen.getByText("My rides")).toBeInTheDocument();
  });

  it("hides driver-only links for a user without the DRIVER role", () => {
    // @ts-expect-error -- partial mock, only the fields Layout reads
    vi.spyOn(useCurrentUserModule, "useCurrentUser").mockReturnValue({
      data: { user: { id: "1", name: "A", email: "a@example.com", phone: "1", roles: ["RIDER"] } },
    });

    renderLayout();

    expect(screen.queryByText("Post a ride")).not.toBeInTheDocument();
    expect(screen.queryByText("My rides")).not.toBeInTheDocument();
  });

  it("clears the cached session and navigates to /login on logout", async () => {
    // @ts-expect-error -- partial mock, only the fields Layout reads
    vi.spyOn(useCurrentUserModule, "useCurrentUser").mockReturnValue({
      data: { user: { id: "1", name: "A", email: "a@example.com", phone: "1", roles: ["DRIVER", "RIDER"] } },
    });
    vi.spyOn(api, "apiFetch").mockResolvedValue({ message: "Logged out" });

    const { queryClient } = renderLayout();
    queryClient.setQueryData(["currentUser"], {
      user: { id: "1", name: "A", email: "a@example.com", phone: "1", roles: ["DRIVER", "RIDER"] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(api.apiFetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(queryClient.getQueryData(["currentUser"])).toBeUndefined();
  });
});
