import { PrismaClient, Role, RideStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;
const SEED_PASSWORD = "password123";

async function upsertUser(email: string, name: string, phone: string, roles: Role[]) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, SALT_ROUNDS);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, phone, passwordHash, roles },
  });
}

function daysFromNow(days: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function main() {
  const dara = await upsertUser("dara.driver@example.com", "Dara Driver", "9000000001", [Role.DRIVER]);
  const ravi = await upsertUser("ravi.driver@example.com", "Ravi Driver", "9000000002", [Role.DRIVER]);
  const priya = await upsertUser("priya.driver@example.com", "Priya Driver", "9000000005", [Role.DRIVER]);
  const kiran = await upsertUser("kiran.driver@example.com", "Kiran Driver", "9000000006", [Role.DRIVER]);
  await upsertUser("rina.rider@example.com", "Rina Rider", "9000000003", [Role.RIDER]);
  await upsertUser("sam.rider@example.com", "Sam Rider", "9000000004", [Role.RIDER]);
  await upsertUser("neha.rider@example.com", "Neha Rider", "9000000007", [Role.RIDER]);
  await upsertUser("arjun.rider@example.com", "Arjun Rider", "9000000008", [Role.RIDER]);

  const seededDriverIds = [dara.id, ravi.id, priya.id, kiran.id];

  // Re-running the seed should not pile up duplicate rides — clear out
  // whatever these seeded drivers posted last time, then recreate.
  await prisma.ride.deleteMany({ where: { driverId: { in: seededDriverIds } } });

  await prisma.ride.createMany({
    data: [
      // Dara Driver — Ahmedabad hub, one of each status for badge variety.
      {
        driverId: dara.id,
        originLabel: "Ahmedabad",
        originLat: 23.0225,
        originLng: 72.5714,
        destLabel: "Mumbai",
        destLat: 19.076,
        destLng: 72.8777,
        departureTime: daysFromNow(3, 7),
        totalSeats: 3,
        seatsAvailable: 3,
        estimatedCost: "1200.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: dara.id,
        originLabel: "Ahmedabad",
        originLat: 23.03,
        originLng: 72.58,
        destLabel: "Mumbai",
        destLat: 19.09,
        destLng: 72.86,
        departureTime: daysFromNow(10, 9),
        totalSeats: 2,
        seatsAvailable: 1,
        estimatedCost: "1350.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: dara.id,
        originLabel: "Ahmedabad",
        originLat: 23.02,
        originLng: 72.57,
        destLabel: "Vadodara",
        destLat: 22.3072,
        destLng: 73.1812,
        departureTime: daysFromNow(-2, 8),
        totalSeats: 4,
        seatsAvailable: 4,
        estimatedCost: "450.00",
        status: RideStatus.COMPLETED,
      },
      {
        driverId: dara.id,
        originLabel: "Ahmedabad",
        originLat: 23.0225,
        originLng: 72.5714,
        destLabel: "Surat",
        destLat: 21.1702,
        destLng: 72.8311,
        departureTime: daysFromNow(5, 6),
        totalSeats: 3,
        seatsAvailable: 3,
        estimatedCost: "600.00",
        status: RideStatus.CANCELLED,
      },
      // Ravi Driver — North/South long-haul routes.
      {
        driverId: ravi.id,
        originLabel: "Delhi",
        originLat: 28.7041,
        originLng: 77.1025,
        destLabel: "Jaipur",
        destLat: 26.9124,
        destLng: 75.7873,
        departureTime: daysFromNow(4, 6),
        totalSeats: 4,
        seatsAvailable: 4,
        estimatedCost: "900.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: ravi.id,
        originLabel: "Delhi",
        originLat: 28.6139,
        originLng: 77.209,
        destLabel: "Jaipur",
        destLat: 26.8,
        destLng: 75.8,
        departureTime: daysFromNow(4, 18),
        totalSeats: 3,
        seatsAvailable: 2,
        estimatedCost: "950.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: ravi.id,
        originLabel: "Bangalore",
        originLat: 12.9716,
        originLng: 77.5946,
        destLabel: "Chennai",
        destLat: 13.0827,
        destLng: 80.2707,
        departureTime: daysFromNow(6, 5),
        totalSeats: 2,
        seatsAvailable: 2,
        estimatedCost: "800.00",
        status: RideStatus.SCHEDULED,
      },
      // Priya Driver — Pune/Hyderabad routes.
      {
        driverId: priya.id,
        originLabel: "Pune",
        originLat: 18.5204,
        originLng: 73.8567,
        destLabel: "Hyderabad",
        destLat: 17.385,
        destLng: 78.4867,
        departureTime: daysFromNow(2, 22),
        totalSeats: 4,
        seatsAvailable: 4,
        estimatedCost: "1100.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: priya.id,
        originLabel: "Pune",
        originLat: 18.5204,
        originLng: 73.8567,
        destLabel: "Mumbai",
        destLat: 19.076,
        destLng: 72.8777,
        departureTime: daysFromNow(1, 7),
        totalSeats: 3,
        seatsAvailable: 0,
        estimatedCost: "350.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: priya.id,
        originLabel: "Hyderabad",
        originLat: 17.385,
        originLng: 78.4867,
        destLabel: "Bangalore",
        destLat: 12.9716,
        destLng: 77.5946,
        departureTime: daysFromNow(8, 6),
        totalSeats: 4,
        seatsAvailable: 4,
        estimatedCost: "1050.00",
        status: RideStatus.SCHEDULED,
      },
      // Kiran Driver — Kolkata/Kochi routes, plus one already-completed trip.
      {
        driverId: kiran.id,
        originLabel: "Kolkata",
        originLat: 22.5726,
        originLng: 88.3639,
        destLabel: "Bhubaneswar",
        destLat: 20.2961,
        destLng: 85.8245,
        departureTime: daysFromNow(7, 6),
        totalSeats: 3,
        seatsAvailable: 2,
        estimatedCost: "700.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: kiran.id,
        originLabel: "Kochi",
        originLat: 9.9312,
        originLng: 76.2673,
        destLabel: "Bangalore",
        destLat: 12.9716,
        destLng: 77.5946,
        departureTime: daysFromNow(9, 20),
        totalSeats: 4,
        seatsAvailable: 4,
        estimatedCost: "950.00",
        status: RideStatus.SCHEDULED,
      },
      {
        driverId: kiran.id,
        originLabel: "Kochi",
        originLat: 9.9312,
        originLng: 76.2673,
        destLabel: "Thiruvananthapuram",
        destLat: 8.5241,
        destLng: 76.9366,
        departureTime: daysFromNow(-5, 9),
        totalSeats: 3,
        seatsAvailable: 3,
        estimatedCost: "400.00",
        status: RideStatus.COMPLETED,
      },
    ],
  });

  console.log("Seed complete.");
  console.log("  Drivers: dara.driver@example.com / ravi.driver@example.com / priya.driver@example.com / kiran.driver@example.com");
  console.log("  Riders:  rina.rider@example.com / sam.rider@example.com / neha.rider@example.com / arjun.rider@example.com");
  console.log(`  Password for all: ${SEED_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
