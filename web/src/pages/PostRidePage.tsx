import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api";

export function PostRidePage() {
  const [originLabel, setOriginLabel] = useState("");
  const [originLat, setOriginLat] = useState("");
  const [originLng, setOriginLng] = useState("");
  const [destLabel, setDestLabel] = useState("");
  const [destLat, setDestLat] = useState("");
  const [destLng, setDestLng] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [totalSeats, setTotalSeats] = useState("1");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/rides", {
        method: "POST",
        body: {
          originLabel,
          originLat: Number(originLat),
          originLng: Number(originLng),
          destLabel,
          destLat: Number(destLat),
          destLng: Number(destLng),
          departureTime: new Date(departureTime).toISOString(),
          totalSeats: Number(totalSeats),
          estimatedCost,
        },
      });
      navigate("/rides/mine");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Post a ride</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        Origin label
        <input value={originLabel} onChange={(e) => setOriginLabel(e.target.value)} required />
      </label>
      <label>
        Origin latitude
        <input value={originLat} onChange={(e) => setOriginLat(e.target.value)} required />
      </label>
      <label>
        Origin longitude
        <input value={originLng} onChange={(e) => setOriginLng(e.target.value)} required />
      </label>
      <label>
        Destination label
        <input value={destLabel} onChange={(e) => setDestLabel(e.target.value)} required />
      </label>
      <label>
        Destination latitude
        <input value={destLat} onChange={(e) => setDestLat(e.target.value)} required />
      </label>
      <label>
        Destination longitude
        <input value={destLng} onChange={(e) => setDestLng(e.target.value)} required />
      </label>
      <label>
        Departure time
        <input type="datetime-local" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} required />
      </label>
      <label>
        Total seats
        <input type="number" min="1" value={totalSeats} onChange={(e) => setTotalSeats(e.target.value)} required />
      </label>
      <label>
        Estimated cost (₹)
        <input value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} required />
      </label>
      <button type="submit">Post ride</button>
    </form>
  );
}
