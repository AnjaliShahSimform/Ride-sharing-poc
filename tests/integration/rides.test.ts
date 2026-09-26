import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { resetDb } from "./testDb";

beforeEach(resetDb);

async function signupDriver(email = "dara@example.com") {
  const res = await request(app).post("/api/auth/signup").send({
    name: "Dara Driver",
    email,
    phone: "9999999999",
    password: "correct-horse",
  });
  return res.body.token as string;
}

async function createRide(token: string) {
  const res = await request(app)
    .post("/api/rides")
    .set("Authorization", `Bearer ${token}`)
    .send(validRide);
  return res.body.id as string;
}

const validRide = {
  originLat: 23.0225,
  originLng: 72.5714,
  destLat: 19.076,
  destLng: 72.8777,
  originLabel: "Ahmedabad",
  destLabel: "Mumbai",
  departureTime: "2027-01-01T06:00:00.000Z",
  totalSeats: 3,
  estimatedCost: "1200.00",
};

describe("POST /api/rides", () => {
  it("creates a ride for an authenticated driver", async () => {
    const token = await signupDriver();

    const res = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${token}`)
      .send(validRide);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      originLabel: "Ahmedabad",
      destLabel: "Mumbai",
      totalSeats: 3,
      seatsAvailable: 3,
      status: "SCHEDULED",
    });
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/rides").send(validRide);
    expect(res.status).toBe(401);
  });

  it("rejects a departureTime in the past", async () => {
    const token = await signupDriver();

    const res = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validRide, departureTime: "2020-01-01T06:00:00.000Z" });

    expect(res.status).toBe(400);
  });

  it("rejects totalSeats <= 0", async () => {
    const token = await signupDriver();

    const res = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validRide, totalSeats: 0 });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/rides/search", () => {
  // Ahmedabad -> Mumbai, matches the searches below within a small radius.
  const matchingSearch = {
    originLat: 23.03,
    originLng: 72.58,
    destLat: 19.08,
    destLng: 72.88,
    earliestDeparture: "2027-01-01T00:00:00.000Z",
    latestDeparture: "2027-01-01T12:00:00.000Z",
    radiusKm: 20,
  };

  it("returns a ride whose origin, destination, and time window all match", async () => {
    const token = await signupDriver();
    await request(app).post("/api/rides").set("Authorization", `Bearer ${token}`).send(validRide);

    const res = await request(app)
      .get("/api/rides/search")
      .set("Authorization", `Bearer ${token}`)
      .query(matchingSearch);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ originLabel: "Ahmedabad", destLabel: "Mumbai" });
  });

  it("never includes driver contact fields in results", async () => {
    const token = await signupDriver();
    await request(app).post("/api/rides").set("Authorization", `Bearer ${token}`).send(validRide);

    const res = await request(app)
      .get("/api/rides/search")
      .set("Authorization", `Bearer ${token}`)
      .query(matchingSearch);

    expect(res.body[0].driver).toBeUndefined();
  });

  it("excludes a ride whose origin is outside the search radius", async () => {
    const token = await signupDriver();
    await request(app).post("/api/rides").set("Authorization", `Bearer ${token}`).send(validRide);

    const res = await request(app)
      .get("/api/rides/search")
      .set("Authorization", `Bearer ${token}`)
      .query({ ...matchingSearch, originLat: 28.7041, originLng: 77.1025 }); // Delhi

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("excludes a ride whose departure time is outside the search window", async () => {
    const token = await signupDriver();
    await request(app).post("/api/rides").set("Authorization", `Bearer ${token}`).send(validRide);

    const res = await request(app)
      .get("/api/rides/search")
      .set("Authorization", `Bearer ${token}`)
      .query({
        ...matchingSearch,
        earliestDeparture: "2027-02-01T00:00:00.000Z",
        latestDeparture: "2027-02-01T12:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/rides/search").query(matchingSearch);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/rides/:id/cancel", () => {
  it("cancels the driver's own scheduled ride", async () => {
    const token = await signupDriver();
    const rideId = await createRide(token);

    const res = await request(app)
      .patch(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("rejects cancelling a ride owned by another driver", async () => {
    const ownerToken = await signupDriver("owner@example.com");
    const rideId = await createRide(ownerToken);
    const otherToken = await signupDriver("other@example.com");

    const res = await request(app)
      .patch(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it("rejects cancelling an already-cancelled ride", async () => {
    const token = await signupDriver();
    const rideId = await createRide(token);
    await request(app).patch(`/api/rides/${rideId}/cancel`).set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .patch(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
  });

  it("returns 404 for a ride that does not exist", async () => {
    const token = await signupDriver();

    const res = await request(app)
      .patch("/api/rides/00000000-0000-0000-0000-000000000000/cancel")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/rides/:id/complete", () => {
  it("completes the driver's own scheduled ride", async () => {
    const token = await signupDriver();
    const rideId = await createRide(token);

    const res = await request(app)
      .patch(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("rejects completing a ride owned by another driver", async () => {
    const ownerToken = await signupDriver("owner2@example.com");
    const rideId = await createRide(ownerToken);
    const otherToken = await signupDriver("other2@example.com");

    const res = await request(app)
      .patch(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it("rejects completing an already-completed ride", async () => {
    const token = await signupDriver();
    const rideId = await createRide(token);
    await request(app).patch(`/api/rides/${rideId}/complete`).set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .patch(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
  });
});
