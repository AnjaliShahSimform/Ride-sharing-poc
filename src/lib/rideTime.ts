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

// ---- calendar-date filters (admin lists) ----------------------------------
// Admin filters are "YYYY-MM-DD" strings meaning an IST calendar day, so
// "2027-01-01" covers 00:00 IST up to (not including) 00:00 IST the next day.

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// True only for a real calendar date ("2027-02-29" and "2027-13-01" are not).
export function parseIstDate(ymd: string): boolean {
  const m = YMD.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

// 00:00 IST on that day. Caller must have validated with parseIstDate.
export function istDayStart(ymd: string): Date {
  return new Date(Date.parse(`${ymd}T00:00:00.000Z`) - IST_OFFSET_MS);
}

// 00:00 IST on the following day — use with `lt` so the whole day is included.
export function istDayEndExclusive(ymd: string): Date {
  return new Date(istDayStart(ymd).getTime() + DAY_MS);
}
