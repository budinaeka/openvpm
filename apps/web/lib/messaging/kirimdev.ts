/**
 * Kirimdev WhatsApp Cloud API client — send plain-text WhatsApp messages.
 *
 * Kirimdev wraps the Meta WhatsApp Business Cloud API. To send a message you
 * need a KIRIMDEV_API_KEY and a KIRIMDEV_PHONE_NUMBER_ID (the Meta business
 * phone_number_id that owns the conversation). Both are env vars per deployment.
 *
 * Inbound messages arrive through a Kirimdev webhook (X-Kirim-Signature
 * verified) handled by the /api/webhooks/kirimdev route — this module only
 * sends outgoing messages.
 *
 * Env vars:
 *   KIRIMDEV_API_KEY — public API key (Dashboard → Settings → API Keys)
 *   KIRIMDEV_PHONE_NUMBER_ID — Meta business_phone_number_id
 *   KIRIMDEV_API_BASE_URL — optional override (default: https://api.kirimdev.com/v1)
 */

const KIRIMDEV_DEFAULT_BASE_URL = "https://api.kirimdev.com/v1";

export function kirimdevApiKey(): string | undefined {
  return process.env.KIRIMDEV_API_KEY?.trim() || undefined;
}

export function kirimdevPhoneNumberId(): string | undefined {
  return process.env.KIRIMDEV_PHONE_NUMBER_ID?.trim() || undefined;
}

export function kirimdevBaseUrl(): string {
  return (
    process.env.KIRIMDEV_API_BASE_URL?.trim() || KIRIMDEV_DEFAULT_BASE_URL
  );
}

export interface KirimdevSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a plain-text WhatsApp message to a customer.
 *
 * @param to  Recipient phone in international format (E.164, e.g. "6281384645564")
 * @param text  Message body (max 4096 chars, WhatsApp bubble limit)
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
): Promise<KirimdevSendResult> {
  const apiKey = kirimdevApiKey();
  if (!apiKey) {
    return { success: false, error: "KIRIMDEV_API_KEY is not configured." };
  }

  const phoneNumberId = kirimdevPhoneNumberId();
  if (!phoneNumberId) {
    return {
      success: false,
      error: "KIRIMDEV_PHONE_NUMBER_ID is not configured.",
    };
  }

  // Strip any leading "+" — Kirimdev expects digits-only E.164
  const normalizedTo = to.replace(/^\+/, "");

  const url = `${kirimdevBaseUrl()}/messages`;
  const payload = {
    phone_number_id: phoneNumberId,
    to: normalizedTo,
    type: "text",
    text: { body: text.slice(0, 4096) },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        success: false,
        error: `Kirimdev returned HTTP ${res.status}: ${body.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as {
      message_id?: string;
      messages?: Array<{ id: string }>;
      id?: string;
      error?: { message?: string };
    };

    if (json.error) {
      return {
        success: false,
        error: json.error.message ?? "Kirimdev API error",
      };
    }

    const messageId =
      json.message_id ??
      json.messages?.[0]?.id ??
      json.id ??
      undefined;

    return { success: true, messageId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Kirimdev request failed",
    };
  }
}

/** Whether Kirimdev is configured enough to send messages. */
export function isKirimdevConfigured(): boolean {
  return Boolean(kirimdevApiKey() && kirimdevPhoneNumberId());
}
