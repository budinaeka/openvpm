import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@openpims/db/client";
import { clients, communications } from "@openpims/db";
import { withSystem, withTenant } from "@/lib/tenant-db";
import { readRequestBytesWithLimit } from "@/lib/request-body";
import {
  MESSAGING_WEBHOOK_BODY_MAX_BYTES,
  messagingWebhookContentLengthTooLarge,
} from "@/lib/messaging-webhook-limits";
import { latestAssignedToForClient } from "@/lib/communications/assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Env helpers ────────────────────────────────────────────────────────

function kirimdevWebhookSecrets(): string[] {
  const raw = process.env.KIRIMDEV_WEBHOOK_SECRETS?.trim() ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function openvpmPhoneNumberId(): string {
  return process.env.OPENVPM_KIRIMDEV_PHONE_NUMBER_ID?.trim() ?? "";
}

function hermesOwnerPhones(): string[] {
  const raw = process.env.HERMES_OWNER_PHONES?.trim() ?? "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function hermesWebhookUrl(): string {
  return (
    process.env.HERMES_KIRIMDEV_WEBHOOK_URL?.trim() ??
    "http://127.0.0.1:8646/webhook"
  );
}

// ── Signature verification (Kirimdev X-Kirim-Signature) ────────────────

function verifyKirimSignature(
  rawBody: Uint8Array,
  headerValue: string | null,
  secrets: string[],
  toleranceSec = 300
): boolean {
  if (!headerValue || secrets.length === 0) return false;

  // Parse "t=<ts>,v1=<hex>" header
  const parts = headerValue.split(",");
  const tEntry = parts.find((p) => p.startsWith("t="));
  if (!tEntry) return false;

  const t = Number(tEntry.slice(2));
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) {
    return false;
  }

  const suppliedSigs = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => {
      try {
        return Buffer.from(p.slice(3), "hex");
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Buffer[];

  if (suppliedSigs.length === 0) return false;

  const signedPayload = Buffer.concat([
    Buffer.from(`${t}.`, "utf8"),
    Buffer.from(rawBody),
  ]);

  for (const secret of secrets) {
    const expected = createHmac("sha256", secret)
      .update(signedPayload)
      .digest();
    for (const sig of suppliedSigs) {
      if (timingSafeEqual(sig, expected)) {
        return true;
      }
    }
  }
  return false;
}

// ── Payload parsing ────────────────────────────────────────────────────

interface InboundMessage {
  phoneNumberId: string;
  customerPhone: string;
  wamid: string;
  messageType: string;
  content: string;
  customerName: string;
}

function parseInboundMessages(body: unknown): InboundMessage[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  if (obj.object !== "whatsapp_business_account") return [];

  const out: InboundMessage[] = [];
  const entries = obj.entry as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = entry.changes as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      if (change.field !== "messages") continue;

      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const metadata = value.metadata as Record<string, unknown> | undefined;
      const phoneNumberId = String(metadata?.phone_number_id ?? "").trim();
      if (!phoneNumberId) continue;

      // Parse contacts for names
      const contacts = value.contacts as
        | Array<{ wa_id?: string; profile?: { name?: string } }>
        | undefined;
      const nameMap = new Map<string, string>();
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          const waId = String(c.wa_id ?? "").replace(/\D/g, "");
          const name = c.profile?.name ?? "";
          if (waId) nameMap.set(waId, String(name));
        }
      }

      const messages = value.messages as
        | Array<{
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
            interactive?: Record<string, unknown>;
          }>
        | undefined;
      if (!Array.isArray(messages)) continue;

      for (const msg of messages) {
        const customerPhone = String(msg.from ?? "").replace(/\D/g, "");
        if (!customerPhone) continue;

        const wamid = String(msg.id ?? "");
        const mtype = (msg.type ?? "text").toLowerCase();
        let content = "";

        if (mtype === "text") {
          content = msg.text?.body ?? "";
        } else if (mtype === "interactive") {
          const interactive = (msg.interactive ?? {}) as Record<string, unknown>;
          const reply =
            (interactive.button_reply as { title?: string; id?: string }) ??
            (interactive.list_reply as { title?: string; id?: string });
          content = reply?.title ?? reply?.id ?? "";
        }

        out.push({
          phoneNumberId,
          customerPhone,
          wamid,
          messageType: mtype,
          content,
          customerName: nameMap.get(customerPhone) ?? "",
        });
      }
    }
  }
  return out;
}

// ── Client lookup ──────────────────────────────────────────────────────

async function findPracticeForPhoneNumber(
  phoneNumberId: string
): Promise<string | null> {
  // For now, hard-map the clinic phone_number_id to the practice.
  // In production, a location_messaging table entry or config is better.
  if (phoneNumberId === openvpmPhoneNumberId()) {
    // Query the only active practice (or match by config)
    const matches = await withSystem(db, (tx) =>
      tx
        .select({ practiceId: clients.practiceId })
        .from(clients)
        .where(isNull(clients.deletedAt))
        .limit(1)
    );
    return matches[0]?.practiceId ?? null;
  }
  return null;
}

async function findClientByPhone(
  practiceId: string,
  customerPhone: string
): Promise<string | null> {
  // Match by last 10 digits of phone number
  const digits = customerPhone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return null;

  const matches = await withSystem(db, (tx) =>
    tx
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.practiceId, practiceId),
          isNull(clients.deletedAt),
          sql`right(regexp_replace(${clients.phone}, '\\D', '', 'g'), 10) = ${digits}`
        )
      )
      .limit(2)
  );
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

// ── Inbound dedupe key ─────────────────────────────────────────────────

function inboundDedupeKey(providerMessageId: string): string {
  const key = `kirimdev:inbound:${providerMessageId}`;
  if (key.length <= 160) return key;
  return `kirimdev:inbound:${createHash("sha256").update(providerMessageId).digest("hex")}`;
}

// ── Forward to Hermes plugin ───────────────────────────────────────────

async function forwardToHermes(
  request: Request,
  rawBody: Uint8Array
): Promise<void> {
  const url = hermesWebhookUrl();
  const headers: Record<string, string> = {
    "Content-Type": request.headers.get("content-type") ?? "application/json",
  };
  const sig = request.headers.get("x-kirim-signature");
  if (sig) headers["X-Kirim-Signature"] = sig;
  const eventId = request.headers.get("x-kirim-event-id");
  if (eventId) headers["X-Kirim-Event-Id"] = eventId;

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: Buffer.from(rawBody) as unknown as BodyInit,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn(
      "[kirimdev-webhook] forward to Hermes plugin failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (messagingWebhookContentLengthTooLarge(request.headers)) {
    return NextResponse.json(
      { error: "Webhook payload too large" },
      { status: 413 }
    );
  }

  // Read raw body (needed for signature verification + forwarding)
  const rawBodyResult = await readRequestBytesWithLimit(
    request,
    MESSAGING_WEBHOOK_BODY_MAX_BYTES
  );
  if (!rawBodyResult.ok) {
    return NextResponse.json(
      { error: "Webhook payload too large" },
      { status: 413 }
    );
  }

  const rawBody = rawBodyResult.bytes;

  // Verify signature
  const signatureHeader = request.headers.get("x-kirim-signature");
  const secrets = kirimdevWebhookSecrets();
  if (!verifyKirimSignature(rawBody, signatureHeader, secrets)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Extract inbound messages
  const messages = parseInboundMessages(parsed);
  if (messages.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // Route by sender: owner → Hermes, others → clinic inbox
  // (since both Hermes assistant & clinic share the same phone_number_id)
  const ownerPhones = hermesOwnerPhones();
  let hasHermesMessage = false;
  let hasClinicMessage = false;

  for (const msg of messages) {
    const isOwner = ownerPhones.includes(msg.customerPhone);

    if (isOwner) {
      // Owner messages → forward to Hermes plugin
      hasHermesMessage = true;
    } else {
      // Non-owner messages → clinic inbox
      hasClinicMessage = true;

      const practiceId = await findPracticeForPhoneNumber(msg.phoneNumberId);
      if (!practiceId) {
        console.warn(
          `[kirimdev-webhook] no practice for phone_number_id ${msg.phoneNumberId}`
        );
        continue;
      }

      const clientId = await findClientByPhone(practiceId, msg.customerPhone);

      const dedupeKey = msg.wamid ? inboundDedupeKey(msg.wamid) : undefined;

      await withTenant(db, practiceId, async (tx) => {
        await tx
          .insert(communications)
          .values({
            practiceId,
            clientId: clientId ?? undefined,
            channel: "whatsapp",
            direction: "inbound",
            subject: `WA from ${msg.customerName || msg.customerPhone}`,
            content: msg.content,
            status: "delivered",
            providerMessageId: msg.wamid || undefined,
            dedupeKey,
            ...(clientId
              ? {
                  assignedTo: latestAssignedToForClient(
                    practiceId,
                    clientId
                  ),
                }
              : {}),
          })
          .onConflictDoNothing({ target: communications.dedupeKey });
      });

      console.log(
        `[kirimdev-webhook] logged WA inbound: practice=${practiceId} client=${clientId ?? "unmatched"} phone=${msg.customerPhone}`
      );
    }
  }

  // Forward owner messages to Hermes plugin (raw body + all headers)
  if (hasHermesMessage) {
    await forwardToHermes(request, rawBody);
  }

  return NextResponse.json({ ok: true, logged: hasClinicMessage });
}
