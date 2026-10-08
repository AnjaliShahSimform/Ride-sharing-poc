import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as useCurrentUserModule from "../hooks/useCurrentUser";
import { RequireAuth } from "./RequireAuth";

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route
          path="/protected"
          element={
            <RequireAuth>
              <p>Protected content</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  it("redirects to /login when there is no session", () => {
    // @ts-expect-error -- partial mock, only the fields RequireAuth reads
    vi.spyOn(useCurrentUserModule, "useCurrentUser").mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderWithRouter("/protected");

    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("renders children when there is a session", () => {
    // @ts-expect-error -- partial mock, only the fields RequireAuth reads
    vi.spyOn(useCurrentUserModule, "useCurrentUser").mockReturnValue({
      data: { user: { id: "1", name: "A", email: "a@example.com", phone: "1", roles: ["DRIVER"] } },
      isLoading: false,
      isError: false,
    });

    renderWithRouter("/protected");

    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("shows a loading state while the session check is in flight", () => {
    // @ts-expect-error -- partial mock, only the fields RequireAuth reads
    vi.spyOn(useCurrentUserModule, "useCurrentUser").mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithRouter("/protected");

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
