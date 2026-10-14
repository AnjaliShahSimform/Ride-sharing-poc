import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, Role, RideStatus, BookingStatus, VehicleStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;
const SEED_PASSWORD = "password123";

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();

function daysFromNow(days: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * HOUR);
}

// Nothing in the seed may be timestamped in the future (an audit entry or a
// booking can't predate "now" less than an hour ago), so every history time
// is clamped to just before the moment the seed runs.
function clampPast(date: Date) {
  const limit = NOW - HOUR;
  return date.getTime() > limit ? new Date(limit) : date;
}

// ---------------------------------------------------------------------------
// Users. Every account shares SEED_PASSWORD. ADMIN has no self-service signup
// path (auth.schemas.ts's signupSchema only accepts DRIVER/RIDER), so this
// seed is where the admin account gets created. `aditi` holds both roles, to
// show a user who posts rides and also books other drivers' rides.
// ---------------------------------------------------------------------------
const USER_DEFS = {
  dara: { name: "Dara Driver", email: "dara.driver@example.com", phone: "9000000001", roles: [Role.DRIVER] },
  ravi: { name: "Ravi Driver", email: "ravi.driver@example.com", phone: "9000000002", roles: [Role.DRIVER] },
  priya: { name: "Priya Driver", email: "priya.driver@example.com", phone: "9000000005", roles: [Role.DRIVER] },
  kiran: { name: "Kiran Driver", email: "kiran.driver@example.com", phone: "9000000006", roles: [Role.DRIVER] },
  meera: { name: "Meera Driver", email: "meera.driver@example.com", phone: "9000000010", roles: [Role.DRIVER] },
  vikram: { name: "Vikram Driver", email: "vikram.driver@example.com", phone: "9000000011", roles: [Role.DRIVER] },
  aditi: { name: "Aditi Both", email: "aditi.both@example.com", phone: "9000000016", roles: [Role.DRIVER, Role.RIDER] },
  rina: { name: "Rina Rider", email: "rina.rider@example.com", phone: "9000000003", roles: [Role.RIDER] },
  sam: { name: "Sam Rider", email: "sam.rider@example.com", phone: "9000000004", roles: [Role.RIDER] },
  neha: { name: "Neha Rider", email: "neha.rider@example.com", phone: "9000000007", roles: [Role.RIDER] },
  arjun: { name: "Arjun Rider", email: "arjun.rider@example.com", phone: "9000000008", roles: [Role.RIDER] },
  isha: { name: "Isha Rider", email: "isha.rider@example.com", phone: "9000000012", roles: [Role.RIDER] },
  rohan: { name: "Rohan Rider", email: "rohan.rider@example.com", phone: "9000000013", roles: [Role.RIDER] },
  tanvi: { name: "Tanvi Rider", email: "tanvi.rider@example.com", phone: "9000000014", roles: [Role.RIDER] },
  karan: { name: "Karan Rider", email: "karan.rider@example.com", phone: "9000000015", roles: [Role.RIDER] },
  admin: { name: "Admin", email: "admin@example.com", phone: "9000000009", roles: [Role.ADMIN] },
} as const;
type UserKey = keyof typeof USER_DEFS;

// ---------------------------------------------------------------------------
// Vehicles — one of every state. Seeded vehicles skip the document workflow
// (like the seed already skips signup), so none has documents: the APPROVED
// ones let drivers post rides straight away, the PENDING ones fill the admin
// review queue (upload an RC and a licence through the UI to try approval),
// and the REJECTED one shows the rejection note and the resubmit path.
// Plates follow the app's Indian-plate format; `plateKey` is the unique handle
// and is NULL for a REJECTED vehicle (frees the plate), as in the real flow.
// ---------------------------------------------------------------------------
interface VehicleDef {
  owner: UserKey;
  make: string;
  model: string;
  colour: string;
  plateNumber: string;
  seatCapacity: number;
  status: VehicleStatus;
  createdDaysAgo: number;
  rejectionNote?: string;
}
const VEHICLE_DEFS = {
  swift: { owner: "dara", make: "Maruti", model: "Swift", colour: "White", plateNumber: "GJ01AB1234", seatCapacity: 4, status: "APPROVED", createdDaysAgo: 45 },
  creta: { owner: "ravi", make: "Hyundai", model: "Creta", colour: "Grey", plateNumber: "MH12CD5678", seatCapacity: 4, status: "APPROVED", createdDaysAgo: 44 },
  city: { owner: "priya", make: "Honda", model: "City", colour: "Black", plateNumber: "KA03EF9012", seatCapacity: 4, status: "APPROVED", createdDaysAgo: 43 },
  innova: { owner: "kiran", make: "Toyota", model: "Innova", colour: "Silver", plateNumber: "DL8CAF3456", seatCapacity: 6, status: "APPROVED", createdDaysAgo: 42 },
  punch: { owner: "meera", make: "Tata", model: "Punch", colour: "Orange", plateNumber: "TN09JK2468", seatCapacity: 4, status: "APPROVED", createdDaysAgo: 41 },
  xuv: { owner: "meera", make: "Mahindra", model: "XUV700", colour: "Red", plateNumber: "TN10LM1357", seatCapacity: 6, status: "APPROVED", createdDaysAgo: 35 },
  seltos: { owner: "vikram", make: "Kia", model: "Seltos", colour: "White", plateNumber: "UP32NP8642", seatCapacity: 4, status: "APPROVED", createdDaysAgo: 40 },
  i20: { owner: "aditi", make: "Hyundai", model: "i20", colour: "Blue", plateNumber: "MP09ST1122", seatCapacity: 4, status: "APPROVED", createdDaysAgo: 30 },
  nexon: { owner: "kiran", make: "Tata", model: "Nexon", colour: "Blue", plateNumber: "RJ14GH7890", seatCapacity: 4, status: "PENDING", createdDaysAgo: 2 },
  kiger: { owner: "aditi", make: "Renault", model: "Kiger", colour: "Yellow", plateNumber: "MP04UV3344", seatCapacity: 4, status: "PENDING", createdDaysAgo: 1 },
  ertiga: {
    owner: "vikram",
    make: "Maruti",
    model: "Ertiga",
    colour: "Grey",
    plateNumber: "HR26QR9753",
    seatCapacity: 6,
    status: "REJECTED",
    createdDaysAgo: 12,
    rejectionNote: "The plate on the RC does not match the registration number entered. Please re-upload the correct RC.",
  },
} satisfies Record<string, VehicleDef>;
type VehicleKey = keyof typeof VEHICLE_DEFS;

// ---------------------------------------------------------------------------
// Rides and their bookings. Departures are relative to the day the seed runs.
// Every number that has to agree is derived by simulateRide() from the booking
// list, never typed by hand: seatsAvailable, each booking's cost share, the
// cancellation timestamps and the audit trail all come from one timeline.
// A ride without `vehicle` is a "legacy" ride (posted before vehicles existed):
// it has no snapshot, which the UI shows as "vehicle details not provided".
// ---------------------------------------------------------------------------
interface Place {
  label: string;
  lat: number;
  lng: number;
}
const AHMEDABAD: Place = { label: "Ahmedabad", lat: 23.0225, lng: 72.5714 };
const MUMBAI: Place = { label: "Mumbai", lat: 19.076, lng: 72.8777 };
const VADODARA: Place = { label: "Vadodara", lat: 22.3072, lng: 73.1812 };
const SURAT: Place = { label: "Surat", lat: 21.1702, lng: 72.8311 };
const DELHI: Place = { label: "Delhi", lat: 28.7041, lng: 77.1025 };
const JAIPUR: Place = { label: "Jaipur", lat: 26.9124, lng: 75.7873 };
const CHANDIGARH: Place = { label: "Chandigarh", lat: 30.7333, lng: 76.7794 };
const BANGALORE: Place = { label: "Bangalore", lat: 12.9716, lng: 77.5946 };
const CHENNAI: Place = { label: "Chennai", lat: 13.0827, lng: 80.2707 };
const COIMBATORE: Place = { label: "Coimbatore", lat: 11.0168, lng: 76.9558 };
const PUNE: Place = { label: "Pune", lat: 18.5204, lng: 73.8567 };
const HYDERABAD: Place = { label: "Hyderabad", lat: 17.385, lng: 78.4867 };
const KOLKATA: Place = { label: "Kolkata", lat: 22.5726, lng: 88.3639 };
const BHUBANESWAR: Place = { label: "Bhubaneswar", lat: 20.2961, lng: 85.8245 };
const KOCHI: Place = { label: "Kochi", lat: 9.9312, lng: 76.2673 };
const THIRUVANANTHAPURAM: Place = { label: "Thiruvananthapuram", lat: 8.5241, lng: 76.9366 };
const LUCKNOW: Place = { label: "Lucknow", lat: 26.8467, lng: 80.9462 };
const KANPUR: Place = { label: "Kanpur", lat: 26.4499, lng: 80.3319 };
const INDORE: Place = { label: "Indore", lat: 22.7196, lng: 75.8577 };
const BHOPAL: Place = { label: "Bhopal", lat: 23.2599, lng: 77.4126 };

type BookingState = "CONFIRMED" | "RIDER_CANCELLED";
interface BookingSpec {
  rider: UserKey;
  // CONFIRMED stays confirmed — unless the ride itself is CANCELLED by its
  // driver, in which case it is flipped to CANCELLED along with the ride.
  state: BookingState;
}
interface RideSpec {
  driver: UserKey;
  vehicle?: VehicleKey;
  from: Place;
  to: Place;
  day: number;
  hour: number;
  // Only for a ride without a vehicle: a ride with one always has the vehicle's
  // seat capacity, exactly as the API sets it.
  seats?: number;
  cost: string;
  status: RideStatus;
  postedDaysBefore: number;
  edited?: boolean;
  // Closed by the background job instead of the driver: COMPLETED needs at
  // least one confirmed rider (AUTO_COMPLETED); CANCELLED needs none
  // (EXPIRED_NO_BOOKINGS).
  closedBySystem?: boolean;
  bookings?: BookingSpec[];
}

const RIDE_SPECS: RideSpec[] = [
  // --- Dara (Swift, 4 seats) — Ahmedabad hub: one of every status. ---
  { driver: "dara", vehicle: "swift", from: AHMEDABAD, to: MUMBAI, day: 3, hour: 7, cost: "1200.00", status: RideStatus.SCHEDULED, postedDaysBefore: 6 },
  { driver: "dara", vehicle: "swift", from: AHMEDABAD, to: MUMBAI, day: 10, hour: 9, cost: "1350.00", status: RideStatus.SCHEDULED, postedDaysBefore: 4, bookings: [{ rider: "rina", state: "CONFIRMED" }] },
  { driver: "dara", vehicle: "swift", from: AHMEDABAD, to: VADODARA, day: -2, hour: 8, cost: "450.00", status: RideStatus.COMPLETED, postedDaysBefore: 8, bookings: [{ rider: "sam", state: "CONFIRMED" }, { rider: "neha", state: "CONFIRMED" }, { rider: "isha", state: "CONFIRMED" }] },
  { driver: "dara", vehicle: "swift", from: AHMEDABAD, to: SURAT, day: 5, hour: 6, cost: "600.00", status: RideStatus.CANCELLED, postedDaysBefore: 7, bookings: [{ rider: "arjun", state: "CONFIRMED" }, { rider: "rohan", state: "CONFIRMED" }] },
  { driver: "dara", from: AHMEDABAD, to: SURAT, day: -20, hour: 7, seats: 3, cost: "500.00", status: RideStatus.COMPLETED, postedDaysBefore: 5, bookings: [{ rider: "rina", state: "CONFIRMED" }, { rider: "sam", state: "CONFIRMED" }] },

  // --- Ravi (Creta, 4 seats) — long-haul north/south. ---
  { driver: "ravi", vehicle: "creta", from: DELHI, to: JAIPUR, day: 4, hour: 6, cost: "900.00", status: RideStatus.SCHEDULED, postedDaysBefore: 5 },
  { driver: "ravi", vehicle: "creta", from: DELHI, to: JAIPUR, day: 4, hour: 18, cost: "950.00", status: RideStatus.SCHEDULED, postedDaysBefore: 5, bookings: [{ rider: "sam", state: "CONFIRMED" }, { rider: "tanvi", state: "CONFIRMED" }] },
  { driver: "ravi", vehicle: "creta", from: BANGALORE, to: CHENNAI, day: 6, hour: 5, cost: "800.00", status: RideStatus.SCHEDULED, postedDaysBefore: 4, bookings: [{ rider: "karan", state: "CONFIRMED" }, { rider: "isha", state: "RIDER_CANCELLED" }] },
  { driver: "ravi", vehicle: "creta", from: DELHI, to: CHANDIGARH, day: -3, hour: 6, cost: "700.00", status: RideStatus.COMPLETED, postedDaysBefore: 9, bookings: [{ rider: "rina", state: "CONFIRMED" }, { rider: "neha", state: "CONFIRMED" }, { rider: "rohan", state: "CONFIRMED" }, { rider: "tanvi", state: "CONFIRMED" }] },

  // --- Priya (City, 4 seats) — Pune / Hyderabad. ---
  { driver: "priya", vehicle: "city", from: PUNE, to: HYDERABAD, day: 2, hour: 22, cost: "1100.00", status: RideStatus.SCHEDULED, postedDaysBefore: 6, bookings: [{ rider: "neha", state: "CONFIRMED" }, { rider: "arjun", state: "RIDER_CANCELLED" }] },
  { driver: "priya", vehicle: "city", from: PUNE, to: MUMBAI, day: 1, hour: 7, cost: "350.00", status: RideStatus.SCHEDULED, postedDaysBefore: 5, bookings: [{ rider: "rina", state: "CONFIRMED" }, { rider: "sam", state: "CONFIRMED" }, { rider: "neha", state: "CONFIRMED" }] },
  { driver: "priya", vehicle: "city", from: HYDERABAD, to: BANGALORE, day: 8, hour: 6, cost: "1050.00", status: RideStatus.SCHEDULED, postedDaysBefore: 3, edited: true },
  { driver: "priya", vehicle: "city", from: PUNE, to: MUMBAI, day: -9, hour: 7, cost: "350.00", status: RideStatus.COMPLETED, postedDaysBefore: 6, closedBySystem: true, bookings: [{ rider: "isha", state: "CONFIRMED" }, { rider: "karan", state: "CONFIRMED" }] },

  // --- Kiran (Innova, 6 seats) — east coast / Kerala. ---
  { driver: "kiran", vehicle: "innova", from: KOLKATA, to: BHUBANESWAR, day: 7, hour: 6, cost: "700.00", status: RideStatus.SCHEDULED, postedDaysBefore: 5, bookings: [{ rider: "arjun", state: "CONFIRMED" }] },
  { driver: "kiran", vehicle: "innova", from: KOCHI, to: BANGALORE, day: 9, hour: 20, cost: "950.00", status: RideStatus.SCHEDULED, postedDaysBefore: 4 },
  { driver: "kiran", vehicle: "innova", from: KOCHI, to: THIRUVANANTHAPURAM, day: -5, hour: 9, cost: "400.00", status: RideStatus.COMPLETED, postedDaysBefore: 7, bookings: [{ rider: "rina", state: "CONFIRMED" }, { rider: "tanvi", state: "CONFIRMED" }] },
  { driver: "kiran", vehicle: "innova", from: KOCHI, to: THIRUVANANTHAPURAM, day: 12, hour: 6, cost: "500.00", status: RideStatus.SCHEDULED, postedDaysBefore: 3, bookings: [{ rider: "sam", state: "CONFIRMED" }, { rider: "neha", state: "CONFIRMED" }, { rider: "isha", state: "CONFIRMED" }, { rider: "rohan", state: "CONFIRMED" }, { rider: "karan", state: "CONFIRMED" }] },

  // --- Meera (Punch 4 seats, XUV700 6 seats) — Tamil Nadu; two approved vehicles. ---
  { driver: "meera", vehicle: "punch", from: CHENNAI, to: COIMBATORE, day: 3, hour: 6, cost: "650.00", status: RideStatus.SCHEDULED, postedDaysBefore: 4, bookings: [{ rider: "rohan", state: "CONFIRMED" }] },
  { driver: "meera", vehicle: "xuv", from: CHENNAI, to: COIMBATORE, day: 11, hour: 7, cost: "700.00", status: RideStatus.SCHEDULED, postedDaysBefore: 3, bookings: [{ rider: "aditi", state: "CONFIRMED" }, { rider: "arjun", state: "CONFIRMED" }] },
  { driver: "meera", vehicle: "punch", from: BANGALORE, to: CHENNAI, day: -1, hour: 6, cost: "800.00", status: RideStatus.COMPLETED, postedDaysBefore: 6, bookings: [{ rider: "karan", state: "CONFIRMED" }, { rider: "tanvi", state: "RIDER_CANCELLED" }] },
  { driver: "meera", vehicle: "punch", from: COIMBATORE, to: CHENNAI, day: -2, hour: 9, cost: "650.00", status: RideStatus.CANCELLED, postedDaysBefore: 5, closedBySystem: true },

  // --- Vikram (Seltos, 4 seats) — Uttar Pradesh; his Ertiga was rejected. ---
  { driver: "vikram", vehicle: "seltos", from: LUCKNOW, to: KANPUR, day: 2, hour: 8, cost: "300.00", status: RideStatus.SCHEDULED, postedDaysBefore: 4, bookings: [{ rider: "rina", state: "CONFIRMED" }, { rider: "rohan", state: "CONFIRMED" }, { rider: "karan", state: "RIDER_CANCELLED" }] },
  { driver: "vikram", vehicle: "seltos", from: LUCKNOW, to: DELHI, day: 14, hour: 5, cost: "1500.00", status: RideStatus.SCHEDULED, postedDaysBefore: 3 },
  { driver: "vikram", vehicle: "seltos", from: DELHI, to: LUCKNOW, day: -4, hour: 5, cost: "1400.00", status: RideStatus.CANCELLED, postedDaysBefore: 8, bookings: [{ rider: "sam", state: "CONFIRMED" }, { rider: "isha", state: "CONFIRMED" }] },

  // --- Aditi (i20, 4 seats) — DRIVER + RIDER; her Kiger is still pending. ---
  { driver: "aditi", vehicle: "i20", from: INDORE, to: BHOPAL, day: 5, hour: 7, cost: "400.00", status: RideStatus.SCHEDULED, postedDaysBefore: 4, bookings: [{ rider: "neha", state: "CONFIRMED" }] },
  { driver: "aditi", vehicle: "i20", from: BHOPAL, to: INDORE, day: -6, hour: 7, cost: "400.00", status: RideStatus.COMPLETED, postedDaysBefore: 6, bookings: [{ rider: "arjun", state: "CONFIRMED" }, { rider: "tanvi", state: "CONFIRMED" }] },
];

// ---------------------------------------------------------------------------
// Replays one ride's history in time order and returns every row the ride
// needs. It mirrors what the services do: a booking splits the cost evenly
// among CONFIRMED riders (recalculateShares) and writes Booking CREATED + Ride
// COST_RECALCULATED; a rider cancelling writes Booking CANCELLED, gives the
// seat back and re-splits; a driver cancelling the ride flips the remaining
// CONFIRMED bookings to CANCELLED but does NOT give seats back, and does not
// re-split (transitionRide); completing leaves bookings as they are.
// ---------------------------------------------------------------------------
type AuditRow = Prisma.AuditLogCreateManyInput;

function simulateRide(spec: RideSpec, ids: Record<UserKey, string>, vehicleIds: Record<VehicleKey, string>) {
  const rideId = randomUUID();
  const departure = daysFromNow(spec.day, spec.hour);
  const createdAt = clampPast(addHours(departure, -spec.postedDaysBefore * 24));
  const driverId = ids[spec.driver];
  const cost = new Prisma.Decimal(spec.cost);
  const bookingSpecs = spec.bookings ?? [];

  const vehicleDef = spec.vehicle ? VEHICLE_DEFS[spec.vehicle] : undefined;
  if (spec.vehicle && vehicleDef) {
    // Guard against a typo in the tables above silently seeding data the app
    // itself would refuse: own vehicle, APPROVED, and enough seats.
    if (vehicleDef.owner !== spec.driver) throw new Error(`Ride ${spec.from.label}->${spec.to.label}: ${spec.vehicle} is not ${spec.driver}'s vehicle`);
    if (vehicleDef.status !== "APPROVED") throw new Error(`Ride ${spec.from.label}->${spec.to.label}: ${spec.vehicle} is not APPROVED`);
    if (spec.seats !== undefined) throw new Error(`Ride ${spec.from.label}->${spec.to.label}: seats come from the vehicle, drop "seats"`);
  }
  const totalSeats = vehicleDef ? vehicleDef.seatCapacity : spec.seats;
  if (totalSeats === undefined) throw new Error(`Ride ${spec.from.label}->${spec.to.label}: a ride without a vehicle needs "seats"`);
  if (bookingSpecs.length > totalSeats) throw new Error(`Ride ${spec.from.label}->${spec.to.label}: more bookings than seats`);
  if (spec.closedBySystem && spec.status === RideStatus.COMPLETED && bookingSpecs.length === 0) throw new Error("A system-completed ride needs confirmed riders");
  if (spec.closedBySystem && spec.status === RideStatus.CANCELLED && bookingSpecs.length > 0) throw new Error("A system-expired ride has no bookings");
  for (const b of bookingSpecs) {
    if (!USER_DEFS[b.rider].roles.some((r) => r === Role.RIDER)) throw new Error(`${b.rider} is not a RIDER`);
    if (b.rider === spec.driver) throw new Error(`${b.rider} cannot book their own ride`);
  }

  const audits: AuditRow[] = [];
  const audit = (action: string, actorId: string, at: Date, metadata?: Prisma.InputJsonValue, entityType = "Ride", entityId = rideId) => {
    audits.push({ entityType, entityId, action, actorId, createdAt: at, ...(metadata === undefined ? {} : { metadata }) });
  };

  audit("CREATED", driverId, createdAt, spec.vehicle ? { vehicleId: vehicleIds[spec.vehicle] } : undefined);
  if (spec.edited) {
    audit("UPDATED", driverId, clampPast(addHours(createdAt, 2)), spec.vehicle ? { vehicleId: vehicleIds[spec.vehicle] } : undefined);
  }

  // Timeline events, in time order. A rider's cancellation can't be on or after
  // the ride's departure day (rideTime.ts), so it is capped at 00:00 of that day.
  const dayStart = new Date(departure);
  dayStart.setHours(0, 0, 0, 0);
  type Event = { at: Date; kind: "BOOK" | "RIDER_CANCEL"; idx: number };
  const events: Event[] = [];
  const bookedAt: Date[] = [];
  bookingSpecs.forEach((b, idx) => {
    const booked = clampPast(addHours(createdAt, 4 * (idx + 1)));
    bookedAt.push(booked);
    events.push({ at: booked, kind: "BOOK", idx });
    if (b.state === "RIDER_CANCELLED") {
      const cancelAt = clampPast(new Date(Math.min(addHours(booked, 5).getTime(), dayStart.getTime() - HOUR)));
      events.push({ at: cancelAt < booked ? booked : cancelAt, kind: "RIDER_CANCEL", idx });
    }
  });
  events.sort((a, b) => a.at.getTime() - b.at.getTime()); // stable: ties keep booking-before-cancel order

  const bookingIds = bookingSpecs.map(() => randomUUID());
  const confirmed = new Set<number>();
  const lastShare: Prisma.Decimal[] = bookingSpecs.map(() => cost);
  const cancelledAt: (Date | null)[] = bookingSpecs.map(() => null);
  let lastEventAt = createdAt;

  const recalc = (at: Date) => {
    if (confirmed.size === 0) return;
    const share = cost.dividedBy(confirmed.size).toDecimalPlaces(2);
    for (const idx of confirmed) lastShare[idx] = share;
    audit("COST_RECALCULATED", "system", new Date(at.getTime() + 1000), {
      shares: [...confirmed].map((idx) => ({ bookingId: bookingIds[idx], costShare: share.toString() })),
    });
  };

  for (const ev of events) {
    const riderId = ids[bookingSpecs[ev.idx].rider];
    if (ev.kind === "BOOK") {
      confirmed.add(ev.idx);
      audit("CREATED", riderId, ev.at, { rideId }, "Booking", bookingIds[ev.idx]);
    } else {
      confirmed.delete(ev.idx);
      cancelledAt[ev.idx] = ev.at;
      audit("CANCELLED", riderId, ev.at, { rideId }, "Booking", bookingIds[ev.idx]);
    }
    recalc(ev.at);
    lastEventAt = ev.at;
  }

  // Seats taken = CONFIRMED bookings at this point. A rider's cancellation gave
  // its seat back; a driver cancelling the ride below does not (seatsAvailable
  // is left as it was, like the real transition).
  const seatsAvailable = totalSeats - confirmed.size;

  if (spec.status === RideStatus.COMPLETED) {
    if (spec.closedBySystem) {
      audit("COMPLETED", "system", clampPast(addHours(departure, 13)), { reason: "AUTO_COMPLETED" });
    } else {
      audit("COMPLETED", driverId, clampPast(addHours(departure, 2)));
    }
  } else if (spec.status === RideStatus.CANCELLED) {
    if (spec.closedBySystem) {
      audit("CANCELLED", "system", clampPast(addHours(departure, 13)), { reason: "EXPIRED_NO_BOOKINGS" });
    } else {
      // The driver cancels the ride before its departure day; every still-CONFIRMED
      // booking is cancelled with it, in the same step.
      const cancelAt = clampPast(new Date(Math.min(addHours(lastEventAt, 6).getTime(), dayStart.getTime() - HOUR)));
      const at = cancelAt < lastEventAt ? lastEventAt : cancelAt;
      const cascaded = [...confirmed];
      for (const idx of cascaded) cancelledAt[idx] = at;
      audit("CANCELLED", driverId, at, { cascadedBookingIds: cascaded.map((idx) => bookingIds[idx]) });
      confirmed.clear();
    }
  }

  const rideRow: Prisma.RideCreateManyInput = {
    id: rideId,
    driverId,
    originLabel: spec.from.label,
    originLat: spec.from.lat,
    originLng: spec.from.lng,
    destLabel: spec.to.label,
    destLat: spec.to.lat,
    destLng: spec.to.lng,
    departureTime: departure,
    totalSeats,
    seatsAvailable,
    estimatedCost: cost,
    status: spec.status,
    createdAt,
  };

  const bookingRows: Prisma.BookingCreateManyInput[] = bookingSpecs.map((b, idx) => ({
    id: bookingIds[idx],
    rideId,
    riderId: ids[b.rider],
    status: cancelledAt[idx] ? BookingStatus.CANCELLED : BookingStatus.CONFIRMED,
    costShare: lastShare[idx],
    createdAt: bookedAt[idx],
    cancelledAt: cancelledAt[idx],
  }));

  const snapshotRow: Prisma.RideVehicleCreateManyInput | undefined =
    spec.vehicle && vehicleDef
      ? {
          rideId,
          vehicleId: vehicleIds[spec.vehicle],
          make: vehicleDef.make,
          model: vehicleDef.model,
          colour: vehicleDef.colour,
          plate: vehicleDef.plateNumber,
        }
      : undefined;

  return { rideRow, bookingRows, snapshotRow, audits };
}

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, SALT_ROUNDS);

  const ids = {} as Record<UserKey, string>;
  for (const key of Object.keys(USER_DEFS) as UserKey[]) {
    const def = USER_DEFS[key];
    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {},
      create: { name: def.name, email: def.email, phone: def.phone, passwordHash, roles: [...def.roles], createdAt: daysFromNow(-60, 10) },
    });
    ids[key] = user.id;
  }
  const seededUserIds = Object.values(ids);
  const seededDriverIds = (Object.keys(USER_DEFS) as UserKey[])
    .filter((key) => USER_DEFS[key].roles.some((r) => r === Role.DRIVER))
    .map((key) => ids[key]);

  // Re-running the seed must not pile up duplicates: clear everything these
  // seeded drivers own, children before parents (FK order), plus the audit
  // trail for it. AuditLog has no foreign keys, so it is matched by the ids it
  // refers to and by the seeded users who acted. OutboxEvent is deliberately
  // never seeded — a running email relay would try to send it for real.
  const oldRides = await prisma.ride.findMany({ where: { driverId: { in: seededDriverIds } }, select: { id: true } });
  const oldBookings = await prisma.booking.findMany({ where: { rideId: { in: oldRides.map((r) => r.id) } }, select: { id: true } });
  const oldVehicles = await prisma.vehicle.findMany({ where: { ownerId: { in: seededDriverIds } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: seededUserIds } },
        { entityId: { in: [...oldRides, ...oldBookings, ...oldVehicles].map((row) => row.id) } },
      ],
    },
  });
  await prisma.booking.deleteMany({ where: { ride: { driverId: { in: seededDriverIds } } } });
  await prisma.ride.deleteMany({ where: { driverId: { in: seededDriverIds } } }); // cascades RideVehicle
  await prisma.vehicle.deleteMany({ where: { ownerId: { in: seededDriverIds } } }); // cascades VehicleDocument

  // Vehicles, with the history an admin review leaves behind.
  const vehicleIds = {} as Record<VehicleKey, string>;
  const vehicleAudits: AuditRow[] = [];
  const vehicleRows: Prisma.VehicleCreateManyInput[] = [];
  for (const key of Object.keys(VEHICLE_DEFS) as VehicleKey[]) {
    const def: VehicleDef = VEHICLE_DEFS[key];
    const id = randomUUID();
    vehicleIds[key] = id;
    const createdAt = daysFromNow(-def.createdDaysAgo, 11);
    const reviewedAt = def.status === "PENDING" ? null : addHours(createdAt, 24);
    vehicleRows.push({
      id,
      ownerId: ids[def.owner],
      make: def.make,
      model: def.model,
      colour: def.colour,
      plateNumber: def.plateNumber,
      plateKey: def.status === "REJECTED" ? null : def.plateNumber,
      seatCapacity: def.seatCapacity,
      status: def.status,
      rejectionNote: def.rejectionNote ?? null,
      reviewedById: reviewedAt ? ids.admin : null,
      reviewedAt,
      createdAt,
    });
    vehicleAudits.push({ entityType: "Vehicle", entityId: id, action: "CREATED", actorId: ids[def.owner], createdAt });
    if (reviewedAt) {
      vehicleAudits.push({
        entityType: "Vehicle",
        entityId: id,
        action: def.status,
        actorId: ids.admin,
        createdAt: reviewedAt,
        ...(def.rejectionNote ? { metadata: { note: def.rejectionNote } } : {}),
      });
    }
  }
  await prisma.vehicle.createMany({ data: vehicleRows });

  // Rides, their bookings and the audit trail, all from simulateRide().
  const rideRows: Prisma.RideCreateManyInput[] = [];
  const bookingRows: Prisma.BookingCreateManyInput[] = [];
  const snapshotRows: Prisma.RideVehicleCreateManyInput[] = [];
  const auditRows: AuditRow[] = [...vehicleAudits];
  for (const spec of RIDE_SPECS) {
    const sim = simulateRide(spec, ids, vehicleIds);
    rideRows.push(sim.rideRow);
    bookingRows.push(...sim.bookingRows);
    if (sim.snapshotRow) snapshotRows.push(sim.snapshotRow);
    auditRows.push(...sim.audits);
  }
  await prisma.ride.createMany({ data: rideRows });
  await prisma.rideVehicle.createMany({ data: snapshotRows });
  await prisma.booking.createMany({ data: bookingRows });
  await prisma.auditLog.createMany({ data: auditRows });

  const [users, vehicles, rides, bookings, audits] = await Promise.all([
    prisma.user.count({ where: { id: { in: seededUserIds } } }),
    prisma.vehicle.count({ where: { ownerId: { in: seededDriverIds } } }),
    prisma.ride.count({ where: { driverId: { in: seededDriverIds } } }),
    prisma.booking.count({ where: { ride: { driverId: { in: seededDriverIds } } } }),
    prisma.auditLog.count(),
  ]);

  console.log("Seed complete.");
  console.log(`  ${users} users, ${vehicles} vehicles, ${rides} rides, ${bookings} bookings, ${audits} audit entries in the database.`);
  console.log("  Drivers: dara / ravi / priya / kiran / meera / vikram .driver@example.com");
  console.log("  Both roles (driver + rider): aditi.both@example.com");
  console.log("  Riders:  rina / sam / neha / arjun / isha / rohan / tanvi / karan .rider@example.com");
  console.log("  Admin:   admin@example.com");
  console.log(`  Password for all: ${SEED_PASSWORD}`);
  console.log("  Vehicles: kiran's Nexon and aditi's Kiger are PENDING (admin review queue); vikram's Ertiga is REJECTED.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
