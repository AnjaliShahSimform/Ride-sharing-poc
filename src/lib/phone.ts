// Rides are India-only (lib/indiaBounds.ts), so accounts are too: a phone is a
// 10-digit Indian mobile (first digit 6-9) with an optional +91 / 91 / 0 prefix.
// Normalised to E.164 ("+91XXXXXXXXXX"), which is what SMS providers expect.
export function normaliseIndianMobile(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, "");
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(compact);
  return match ? `+91${match[1]}` : null;
}

// "+919876543210" -> "+91 ••••• ••210": enough for the user to recognise their
// number, not enough to read it off a shoulder-surfed screen or a log.
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)} ••••• ••${e164.slice(-3)}`;
}
