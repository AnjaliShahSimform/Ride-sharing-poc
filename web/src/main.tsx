import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { RequireAuth } from "./components/RequireAuth";
import { Layout } from "./components/Layout";
import { SignupPage } from "./pages/SignupPage";
import { LoginPage } from "./pages/LoginPage";
import { SearchRidesPage } from "./pages/SearchRidesPage";
import { PostRidePage } from "./pages/PostRidePage";
import { MyRidesPage } from "./pages/MyRidesPage";
import { MyBookingsPage } from "./pages/MyBookingsPage";
import "./index.css";

const router = createBrowserRouter([
  { path: "/signup", element: <SignupPage /> },
  { path: "/login", element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <Navigate to="/rides" replace /> },
      { path: "/rides", element: <SearchRidesPage /> },
      { path: "/rides/new", element: <PostRidePage /> },
      { path: "/rides/mine", element: <MyRidesPage /> },
      { path: "/bookings/mine", element: <MyBookingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
