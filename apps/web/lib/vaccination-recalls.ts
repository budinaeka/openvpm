import { createHash } from "node:crypto";
import { normalizeEmailSuppressionAddress } from "@/lib/email-suppression";
import {
  automatedAppointmentReminderSuppressionReason,
  hasReservedFixturePhone,
} from "@/lib/automated-reminder-policy";
import { normalizeE164 } from "@/lib/messaging/phone";

export const VACCINATION_RECALL_DEDUPE_PREFIX = "vaccination-recall:v1";

export type VaccinationRecallBlockReason =
  | "test_practice"
  | "seeded_demo_data"
  | "reserved_contact"
  | "email_suppressed"
  | "sms_suppressed"
  | "quiet_hours"
  | "texting_unavailable"
  | "no_deliverable_channel";

export type VaccinationRecallVaccine = {
  recordId: string;
  vaccineName: string;
  nextDueDate: string;
};

export type VaccinationRecallCandidate = {
  patientId: string;
  patientName: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  preferredContactMethod: string | null;
  smsConsent: boolean;
  emailSuppressionReason: string | null;
  vaccines: VaccinationRecallVaccine[];
};

export type VaccinationRecallPracticeSettings = {
  analyticsExcluded: boolean;
  demoClientIds: Set<string>;
  demoPatientIds: Set<string>;
};

export type VaccinationRecallRecipient = VaccinationRecallCandidate & {
  status: "eligible" | "blocked" | "already_sent";
  channel: "whatsapp" | "sms" | "email" | null;
  blockReason: VaccinationRecallBlockReason | null;
  blockMessage: string | null;
  dedupeKey: string;
  lastSentAt: Date | null;
};

type RawPracticeSettings = {
  analyticsExcluded?: unknown;
  demoData?: { clientIds?: unknown; patientIds?: unknown } | null;
};

function stringSet(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  );
}

export function vaccinationRecallPracticeSettings(
  value: unknown,
): VaccinationRecallPracticeSettings {
  const settings =
    value && typeof value === "object" ? (value as RawPracticeSettings) : {};
  return {
    analyticsExcluded: settings.analyticsExcluded === true,
    demoClientIds: stringSet(settings.demoData?.clientIds),
    demoPatientIds: stringSet(settings.demoData?.patientIds),
  };
}

export function vaccinationRecallDedupeKey(
  practiceId: string,
  candidate: Pick<VaccinationRecallCandidate, "patientId" | "vaccines">,
): string {
  const snapshot = candidate.vaccines
    .map((vaccine) =>
      [
        vaccine.recordId,
        vaccine.vaccineName.trim().toLowerCase(),
        vaccine.nextDueDate,
      ].join(":"),
    )
    .sort()
    .join("|");
  const digest = createHash("sha256")
    .update(snapshot)
    .digest("hex")
    .slice(0, 24);
  return `${VACCINATION_RECALL_DEDUPE_PREFIX}:${practiceId}:${candidate.patientId}:${digest}`;
}

function blocked(
  candidate: VaccinationRecallCandidate,
  dedupeKey: string,
  reason: VaccinationRecallBlockReason,
  message: string,
): VaccinationRecallRecipient {
  return {
    ...candidate,
    status: "blocked",
    channel: null,
    blockReason: reason,
    blockMessage: message,
    dedupeKey,
    lastSentAt: null,
  };
}

export function evaluateVaccinationRecallRecipient(input: {
  practiceId: string;
  practiceSettings: VaccinationRecallPracticeSettings;
  candidate: VaccinationRecallCandidate;
  smsSenderAvailable: boolean;
  whatsAppAvailable?: boolean;
  smsSuppressedPhones: ReadonlySet<string>;
  quietHours: boolean;
  existingSend?: { createdAt: Date } | null;
}): VaccinationRecallRecipient {
  const { candidate, practiceSettings } = input;
  const dedupeKey = vaccinationRecallDedupeKey(input.practiceId, candidate);

  if (practiceSettings.analyticsExcluded) {
    return blocked(
      candidate,
      dedupeKey,
      "test_practice",
      "Recall sending is disabled for practices marked as demo or test data.",
    );
  }

  const seededDemo =
    practiceSettings.demoClientIds.has(candidate.clientId) ||
    practiceSettings.demoPatientIds.has(candidate.patientId);
  const fixtureSuppression = automatedAppointmentReminderSuppressionReason({
    isSeededDemoClient: seededDemo,
    clientEmail: candidate.clientEmail,
  });
  if (fixtureSuppression === "seeded_demo_data") {
    return blocked(
      candidate,
      dedupeKey,
      "seeded_demo_data",
      "Seeded sample records can be reviewed but never contacted.",
    );
  }
  if (fixtureSuppression === "reserved_email_domain") {
    return blocked(
      candidate,
      dedupeKey,
      "reserved_contact",
      "This client uses a reserved test email domain and cannot be contacted.",
    );
  }
  if (hasReservedFixturePhone(candidate.clientPhone)) {
    return blocked(
      candidate,
      dedupeKey,
      "reserved_contact",
      "This client uses a reserved fictional phone number and cannot be contacted.",
    );
  }

  if (input.existingSend) {
    return {
      ...candidate,
      status: "already_sent",
      channel: null,
      blockReason: null,
      blockMessage: "This exact overdue-vaccine set has already been reminded.",
      dedupeKey,
      lastSentAt: input.existingSend.createdAt,
    };
  }

  const normalizedEmail = normalizeEmailSuppressionAddress(
    candidate.clientEmail,
  );
  const emailAvailable = Boolean(
    normalizedEmail && !candidate.emailSuppressionReason,
  );
  const normalizedPhone = normalizeE164(candidate.clientPhone);
  const smsSuppressed = Boolean(
    normalizedPhone && input.smsSuppressedPhones.has(normalizedPhone),
  );

  // Local policy: OpenVPM uses Kirimdev/WhatsApp as the best live reminder channel when available.
  if (input.whatsAppAvailable && candidate.clientPhone && !smsSuppressed) {
    return {
      ...candidate,
      status: "eligible",
      channel: "whatsapp",
      blockReason: null,
      blockMessage: null,
      dedupeKey,
      lastSentAt: null,
    };
  }

  const smsConfigured =
    candidate.preferredContactMethod === "sms" &&
    candidate.smsConsent &&
    Boolean(normalizedPhone);
  const smsAvailable =
    smsConfigured &&
    input.smsSenderAvailable &&
    !smsSuppressed &&
    !input.quietHours;
  if (smsAvailable) {
    return {
      ...candidate,
      status: "eligible",
      channel: "sms",
      blockReason: null,
      blockMessage: null,
      dedupeKey,
      lastSentAt: null,
    };
  }

  if (emailAvailable) {
    return {
      ...candidate,
      status: "eligible",
      channel: "email",
      blockReason: null,
      blockMessage:
        smsConfigured && !smsAvailable
          ? "Texting is unavailable right now; this reminder will use email."
          : null,
      dedupeKey,
      lastSentAt: null,
    };
  }

  if (candidate.emailSuppressionReason)
    return blocked(
      candidate,
      dedupeKey,
      "email_suppressed",
      "The client's email is suppressed and no safe fallback is available.",
    );
  if (smsSuppressed)
    return blocked(
      candidate,
      dedupeKey,
      "sms_suppressed",
      "The client has opted out of text messages and has no deliverable email.",
    );
  if (smsConfigured && input.quietHours)
    return blocked(
      candidate,
      dedupeKey,
      "quiet_hours",
      "Texting is in quiet hours and this client has no email fallback.",
    );
  if (smsConfigured && !input.smsSenderAvailable)
    return blocked(
      candidate,
      dedupeKey,
      "texting_unavailable",
      "No active clinic texting number is available and this client has no email fallback.",
    );
  return blocked(
    candidate,
    dedupeKey,
    "no_deliverable_channel",
    "Add a deliverable email or an opted-in mobile number before sending.",
  );
}
