// One entry per email the app sends. `vars` are snapshotted into the
// OutboxEvent row when the change commits, so an email always describes the
// state at that moment and the consumer never has to query domain tables.

export interface RideSummary {
  originLabel: string;
  destLabel: string;
  departureTime: string; // ISO string
}

export interface TemplateVars {
  // To the rider who just booked. Includes the driver's contact details —
  // allowed because the booking is CONFIRMED (same rule as the API).
  BOOKING_CONFIRMED: {
    riderName: string;
    driverName: string;
    driverPhone: string;
    costShare: string;
    ride: RideSummary;
  };
  // To the driver whose ride just got a booking.
  BOOKING_RECEIVED: {
    driverName: string;
    riderName: string;
    riderPhone: string;
    seatsAvailable: number;
    ride: RideSummary;
  };
  // To whichever party did NOT cancel.
  BOOKING_CANCELLED: {
    recipientName: string;
    otherName: string;
    cancelledBy: "RIDER" | "DRIVER";
    ride: RideSummary;
  };
  // To every rider who had a CONFIRMED booking when the driver cancelled.
  RIDE_CANCELLED: { riderName: string; driverName: string; ride: RideSummary };
  // To every rider who had a CONFIRMED booking when the driver completed.
  RIDE_COMPLETED: { riderName: string; driverName: string; ride: RideSummary };
}

export type TemplateName = keyof TemplateVars;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Names, labels and phones are user-supplied and end up in HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Rides are India-only, so times are shown in IST regardless of server TZ.
function formatDeparture(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function rideLine(ride: RideSummary): string {
  return `${ride.originLabel} → ${ride.destLabel}, ${formatDeparture(ride.departureTime)}`;
}

// Builds both bodies from the same lines so text and HTML can't drift apart.
function compose(subject: string, greetingName: string, lines: string[]): RenderedEmail {
  const text = [`Hi ${greetingName},`, "", ...lines, "", "— Ride Share"].join("\n");
  const html =
    `<p>Hi ${escapeHtml(greetingName)},</p>` +
    lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
    "<p>— Ride Share</p>";
  return { subject, text, html };
}

const renderers: { [T in TemplateName]: (vars: TemplateVars[T]) => RenderedEmail } = {
  BOOKING_CONFIRMED: (v) =>
    compose("Your ride booking is confirmed", v.riderName, [
      `You're booked on ${rideLine(v.ride)}.`,
      `Driver: ${v.driverName}, phone ${v.driverPhone}.`,
      `Your current cost share is ₹${v.costShare} (it may change as other riders join or leave).`,
    ]),
  BOOKING_RECEIVED: (v) =>
    compose("New booking on your ride", v.driverName, [
      `${v.riderName} (phone ${v.riderPhone}) booked a seat on ${rideLine(v.ride)}.`,
      `Seats still available: ${v.seatsAvailable}.`,
    ]),
  BOOKING_CANCELLED: (v) =>
    compose("A booking was cancelled", v.recipientName, [
      v.cancelledBy === "RIDER"
        ? `${v.otherName} cancelled their seat on ${rideLine(v.ride)}. The seat is available again.`
        : `${v.otherName}, the driver, cancelled your booking on ${rideLine(v.ride)}.`,
    ]),
  RIDE_CANCELLED: (v) =>
    compose("Your ride was cancelled", v.riderName, [
      `${v.driverName} cancelled ${rideLine(v.ride)}, so your booking is cancelled too.`,
    ]),
  RIDE_COMPLETED: (v) =>
    compose("Your ride is complete", v.riderName, [
      `${v.driverName} marked ${rideLine(v.ride)} as completed. Thanks for riding!`,
    ]),
};

// `name` and `vars` arrive from a queue, so they're untyped at runtime.
// Returns undefined for an unknown template so the consumer can dead-letter
// the message instead of crashing.
export function renderEmail(name: string, vars: unknown): RenderedEmail | undefined {
  if (!Object.hasOwn(renderers, name)) {
    return undefined;
  }
  return (renderers[name as TemplateName] as (v: unknown) => RenderedEmail)(vars);
}
