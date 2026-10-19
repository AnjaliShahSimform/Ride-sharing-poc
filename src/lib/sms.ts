import { env } from "../config/env";
import { SmsDeliveryError } from "./AppError";
import { logger } from "./logger";

export interface SmsSender {
  send(toE164: string, body: string): Promise<void>;
}

// Local dev / demos: nothing leaves the machine, the "SMS" is a log line.
// Read the code from the server output.
class ConsoleSender implements SmsSender {
  async send(toE164: string, body: string) {
    logger.info({ to: toE164, body }, "SMS (console driver — not actually sent)");
  }
}

// Twilio's REST API over plain fetch (no SDK dependency): a form-encoded POST
// to the Messages resource with basic auth. A non-2xx answer (e.g. a trial
// account texting a number it hasn't verified) throws with Twilio's reason.
class TwilioSender implements SmsSender {
  constructor(
    private accountSid: string,
    private authToken: string,
    private from: string,
  ) {}

  async send(toE164: string, body: string) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toE164, From: this.from, Body: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio responded ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

function createSender(): SmsSender {
  if (env.SMS_DRIVER === "twilio") {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
      throw new Error("SMS_DRIVER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM");
    }
    return new TwilioSender(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM);
  }
  return new ConsoleSender();
}

const sender = createSender();

// Any provider failure becomes one clean 502; the cause goes to the log only
// (it can contain the destination number and provider internals).
export async function sendSms(toE164: string, body: string): Promise<void> {
  try {
    await sender.send(toE164, body);
  } catch (err) {
    logger.error({ err }, "SMS delivery failed");
    throw new SmsDeliveryError();
  }
}
