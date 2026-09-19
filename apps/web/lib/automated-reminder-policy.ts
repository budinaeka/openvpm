export type AutomatedReminderSuppressionReason =
  | "seeded_demo_data"
  | "reserved_email_domain";

const RESERVED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "localhost",
]);

const RESERVED_EMAIL_SUFFIXES = [".example", ".invalid", ".localhost", ".test"];

export function hasReservedEmailDomain(
  value: string | null | undefined,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at !== normalized.indexOf("@")) return false;
  const domain = normalized.slice(at + 1).replace(/\.$/, "");
  if (!domain) return false;
  if (RESERVED_EMAIL_DOMAINS.has(domain)) return true;
  if (
    [...RESERVED_EMAIL_DOMAINS].some((reserved) =>
      domain.endsWith(`.${reserved}`),
    )
  ) {
    return true;
  }
  return RESERVED_EMAIL_SUFFIXES.some(
    (suffix) => domain === suffix.slice(1) || domain.endsWith(suffix),
  );
}

export function hasReservedFixturePhone(
  value: string | null | undefined,
): boolean {
  const digits = value?.replace(/\D/g, "") ?? "";
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{3}55501\d{2}$/.test(national);
}

export function automatedAppointmentReminderSuppressionReason(input: {
  isSeededDemoClient?: boolean | null;
  isSeededDemoAppointment?: boolean | null;
  clientEmail?: string | null;
}): AutomatedReminderSuppressionReason | null {
  if (input.isSeededDemoClient || input.isSeededDemoAppointment)
    return "seeded_demo_data";
  if (hasReservedEmailDomain(input.clientEmail)) return "reserved_email_domain";
  return null;
}
