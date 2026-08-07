/**
 * Shared reminder-delivery policy: quiet-hours windows and channel selection.
 * Pure functions so the cron sweep and the manual notifications router apply
 * identical rules (consent, preference, suppression-by-send, quiet hours).
 */

import { normalizeE164 } from "./phone";

export type ReminderChannel = "whatsapp" | "sms" | "email" | "skip" | "none";

// TCPA quiet hours: no non-urgent texts before 8am or at/after 9pm local.
const QUIET_END_HOUR = 8; // 8am — sending allowed from here
const QUIET_START_HOUR = 21; // 9pm — quiet from here

/**
 * Is `now` within quiet hours for the given IANA timezone? We approximate the
 * recipient's local time with the practice/location timezone (we don't store a
 * per-client tz). Unknown/empty tz → not quiet (don't block).
 */
export function isQuietHours(
  now: Date,
  timeZone: string | null | undefined
): boolean {
  const normalizedTimeZone = timeZone?.trim();
  if (!normalizedTimeZone) return false;
  let hour: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    hour = Number(parts.find((p) => p.type === "hour")?.value ?? "") % 24; // "24" → 0
  } catch {
    return false; // invalid tz → don't block
  }
  if (Number.isNaN(hour)) return false;
  return hour < QUIET_END_HOUR || hour >= QUIET_START_HOUR;
}

/**
 * Choose the channel for one reminder:
 * - "whatsapp" — WhatsApp configured + client has phone; no quiet-hours gate
 *   (WA is async, not as intrusive as SMS)
 * - "sms"   — client prefers SMS, has a phone + consent, and it's not quiet hours
 * - "email" — fall back to email whenever preferable channels aren't available
 * - "skip"  — SMS-preferred but quiet hours and no email → defer to a later run
 * - "none"  — no usable channel
 */
export function pickReminderChannel(opts: {
  preferredContactMethod: string | null | undefined;
  phone: string | null | undefined;
  smsConsent: boolean;
  hasEmail: boolean;
  quietHours: boolean;
  hasWhatsApp?: boolean;
}): ReminderChannel {
  const hasPhone = normalizeE164(opts.phone) !== null;

  // WhatsApp — best channel when available (no quiet-hours gate, async)
  if (opts.hasWhatsApp && hasPhone) return "whatsapp";

  const smsEligible =
    opts.preferredContactMethod === "sms" &&
    hasPhone &&
    opts.smsConsent;
  if (smsEligible && !opts.quietHours) return "sms";
  if (opts.hasEmail) return "email";
  if (smsEligible && opts.quietHours) return "skip";
  return "none";
}
