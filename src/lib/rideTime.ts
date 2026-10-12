// India has a single timezone with no daylight saving, so IST is a fixed
// UTC+5:30 offset and the "day of the ride" can be computed with plain
// arithmetic (rides are India-only, see lib/indiaBounds.ts).
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 00:00 IST on the calendar day (in IST) that `date` falls on.
export function startOfIstDay(date: Date): Date {
  const istMs = date.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(istMs / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

// A ride (or a booking on it) can only be cancelled until the day of
// departure begins: from 00:00 IST on the ride's date onward, it's locked.
export function isCancellationWindowClosed(departureTime: Date, now: Date = new Date()): boolean {
  return now.getTime() >= startOfIstDay(departureTime).getTime();
}

export function hasDeparted(departureTime: Date, now: Date = new Date()): boolean {
  return now.getTime() >= departureTime.getTime();
}
