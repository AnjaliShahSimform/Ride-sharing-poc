import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "../../src/middleware/csrf";
import { resetDb } from "./testDb";

beforeEach(resetDb);

type Agent = ReturnType<typeof request.agent>;

async function signup(email: string, role: "DRIVER" | "RIDER"): Promise<Agent> {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/signup")
    .set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
    .send({ name: "Test User", email, phone: "9999999999", password: "correct-horse", role });
  return agent;
}

const oneSeatRide = {
  originLat: 23.0225,
  originLng: 72.5714,
  destLat: 19.076,
  destLng: 72.8777,
  originLabel: "Ahmedabad",
  destLabel: "Mumbai",
  departureTime: "2027-01-01T06:00:00.000Z",
  totalSeats: 1,
  estimatedCost: "1000.00",
};

describe("POST /api/rides/:id/bookings — last-seat race safety", () => {
  it("lets exactly one of two concurrent requests win the last seat", async () => {
    const driver = await signup("driver@example.com", "DRIVER");
    const rideRes = await driver.post("/api/rides").set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE).send(oneSeatRide);
    const rideId = rideRes.body.id as string;

    const riderA = await signup("rider-a@example.com", "RIDER");
    const riderB = await signup("rider-b@example.com", "RIDER");

    const [resA, resB] = await Promise.all([
      riderA.post(`/api/rides/${rideId}/bookings`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE),
      riderB.post(`/api/rides/${rideId}/bookings`).set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.seatsAvailable).toBe(0);

    const confirmedCount = await prisma.booking.count({ where: { rideId, status: "CONFIRMED" } });
    expect(confirmedCount).toBe(1);
  });
});
