export const COMMUNICATION_SUBJECT_MAX_LENGTH = 255;
export const COMMUNICATION_CONTENT_MAX_LENGTH = 5000;
export const SMS_COMMUNICATION_CONTENT_MAX_LENGTH = 1600;
export const WHATSAPP_COMMUNICATION_CONTENT_MAX_LENGTH = 4096;

export type CommunicationComposeChannel = "sms" | "email" | "portal" | "whatsapp";

export function communicationContentMaxLength(
  channel: CommunicationComposeChannel
): number {
  if (channel === "sms") return SMS_COMMUNICATION_CONTENT_MAX_LENGTH;
  if (channel === "whatsapp") return WHATSAPP_COMMUNICATION_CONTENT_MAX_LENGTH;
  return COMMUNICATION_CONTENT_MAX_LENGTH;
}

export function isCommunicationSubjectValid(value: string): boolean {
  return value.trim().length <= COMMUNICATION_SUBJECT_MAX_LENGTH;
}

export function isCommunicationContentValid(
  value: string,
  channel: CommunicationComposeChannel
): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= communicationContentMaxLength(channel)
  );
}
