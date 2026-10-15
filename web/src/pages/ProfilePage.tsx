import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../lib/api";
import { useCurrentUser, type CurrentUser } from "../hooks/useCurrentUser";
import { initialOf, roleLabel } from "../lib/profile";

const ROLE_BADGE: Record<string, string> = {
  DRIVER: "bg-blue-100 text-blue-700",
  RIDER: "bg-green-100 text-green-700",
  ADMIN: "bg-purple-100 text-purple-700",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-36 text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export function ProfilePage() {
  const { data, isLoading, isError } = useCurrentUser();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (isError || !data)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load your profile.
      </p>
    );
  const user = data.user;

  function startEditing() {
    setName(user.name);
    setPhone(user.phone);
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const nextName = name.trim();
    const nextPhone = phone.trim();
    if (!nextName) return setError("Name is required");
    if (nextPhone.length < 7) return setError("Phone must be a valid number");

    // Send only what changed.
    const body: Partial<Pick<CurrentUser, "name" | "phone">> = {};
    if (nextName !== user.name) body.name = nextName;
    if (nextPhone !== user.phone) body.phone = nextPhone;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ user: CurrentUser }>("/api/auth/me", { method: "PATCH", body });
      queryClient.setQueryData(["currentUser"], res);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Your profile</h1>
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-xl font-semibold text-white"
          >
            {initialOf(user.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-medium text-gray-900">{user.name}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {user.roles.map((r) => (
                <span key={r} className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[r] ?? "bg-gray-100 text-gray-600"}`}>
                  {roleLabel(r)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {saved && !editing && (
          <p role="status" className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            Profile updated.
          </p>
        )}

        {editing ? (
          <form onSubmit={handleSubmit} className="divide-y divide-gray-100">
            {error && (
              <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <Row label="Name">
              <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} />
            </Row>
            <Row label="Email">
              <span className="text-gray-600">{user.email}</span>
              <span className="ml-2 text-xs text-gray-400">can't be changed</span>
            </Row>
            <Row label="Phone">
              <input aria-label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} className={inputClass} />
            </Row>
            <div className="flex gap-2 pt-4">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="divide-y divide-gray-100">
              <Row label="Name">{user.name}</Row>
              <Row label="Email">{user.email}</Row>
              <Row label="Phone">{user.phone}</Row>
              <Row label="Roles">{user.roles.map(roleLabel).join(", ")}</Row>
              <Row label="Member since">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
                  : "—"}
              </Row>
            </dl>
            <button
              type="button"
              onClick={startEditing}
              className="mt-4 rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Edit profile
            </button>
          </>
        )}
      </div>
    </div>
  );
}
