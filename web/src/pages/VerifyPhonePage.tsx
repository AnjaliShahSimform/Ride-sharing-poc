import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../lib/api";
import { useCurrentUser, type CurrentUser } from "../hooks/useCurrentUser";
import { homePathFor } from "../lib/homePath";
import { maskPhone } from "../lib/profile";

export function VerifyPhonePage() {
  const { data } = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Seconds until Resend is allowed again; counts down once per second.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const message = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ user: CurrentUser }>("/api/auth/verify-phone", {
        method: "POST",
        body: { code },
      });
      queryClient.setQueryData(["currentUser"], res);
      navigate(homePathFor(res.user.roles), { replace: true });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (busy || cooldown > 0) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ resendAfterSeconds: number }>("/api/auth/verify-phone/resend", { method: "POST" });
      setCooldown(res.resendAfterSeconds);
      setCode("");
      setInfo("A new code is on its way.");
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds) setCooldown(err.retryAfterSeconds);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Verify your phone</h1>
        <p className="mb-6 text-sm text-gray-600">
          We sent a 6-digit code to {data ? maskPhone(data.user.phone) : "your phone"}. Enter it to continue.
        </p>
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {info}
          </p>
        )}
        <label className="mb-4 block text-sm font-medium text-gray-700">
          Verification code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            pattern="\d{6}"
            placeholder="123456"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-center text-lg tracking-widest text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Checking..." : "Verify"}
        </button>
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            disabled={busy || cooldown > 0}
            className="font-medium text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button type="button" onClick={handleLogout} className="text-gray-500 hover:underline">
            Log out
          </button>
        </div>
      </form>
    </div>
  );
}
