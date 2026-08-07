import { NextResponse } from "next/server";
import {
  eq,
  and,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@openpims/db/client";
import {
  communications,
  wellnessEnrollments,
  wellnessPlans,
  clients,
  patients,
  practices,
  emailSuppressions,
} from "@openpims/db";
import { sendWellnessReminder } from "@/lib/email";
import {
  isKirimdevConfigured,
  sendWellnessReminderWA,
} from "@/lib/messaging/kirimdev";
import { normalizeE164 } from "@/lib/messaging";
import { alertOps } from "@/lib/alerts";
import { withSystem, withTenant } from "@/lib/tenant-db";
import { cronAuthError } from "@/lib/cron-auth";
import { reportCronHeartbeat } from "@/lib/cron-heartbeat";
import {
  emailSuppressionSendBlockMessage,
  normalizeEmailSuppressionAddress,
} from "@/lib/email-suppression";

const REMINDER_PENDING_RECLAIM_MS = 30 * 60 * 1000;
const LOOKAHEAD_DAYS = 7; // remind up to 7 days before due

function wellnessDedupeKey(enrollmentId: string, billingDate: string): string {
  return `wellness:${enrollmentId}:${billingDate}`;
}

async function claimWellnessCommunication(opts: {
  practiceId: string;
  clientId: string;
  channel: "whatsapp" | "email";
  planName: string;
  patientName: string | null;
  billingDate: string;
  dedupeKey: string;
}): Promise<string | null> {
  const [row] = await withTenant(db, opts.practiceId, (tx) =>
    tx
      .insert(communications)
      .values({
        practiceId: opts.practiceId,
        clientId: opts.clientId,
        channel: opts.channel,
        direction: "outbound",
        subject: "Wellness Plan Reminder",
        content: `Wellness plan reminder pending for ${opts.planName} / ${opts.patientName ?? "Unknown"} billing ${opts.billingDate}`,
        status: "pending",
        dedupeKey: opts.dedupeKey,
      })
      .onConflictDoNothing({ target: communications.dedupeKey })
      .returning({ id: communications.id })
  );
  if (row?.id) return row.id;

  // Claim already exists — try to reclaim if stale
  const [existing] = await withTenant(db, opts.practiceId, (tx) =>
    tx
      .select({
        id: communications.id,
        status: communications.status,
        createdAt: communications.createdAt,
      })
      .from(communications)
      .where(
        and(
          eq(communications.practiceId, opts.practiceId),
          eq(communications.dedupeKey, opts.dedupeKey),
          isNull(communications.deletedAt)
        )
      )
      .limit(1)
  );
  if (!existing) return null;
  if (existing.status !== "failed" && existing.status !== "pending") return null;

  const staleBefore = new Date(Date.now() - REMINDER_PENDING_RECLAIM_MS);
  const canReclaim =
    existing.status === "failed" ||
    new Date(existing.createdAt).getTime() <= staleBefore.getTime();
  if (!canReclaim) return null;

  await withTenant(db, opts.practiceId, (tx) =>
    tx
      .delete(communications)
      .where(
        and(
          eq(communications.id, existing.id),
          isNull(communications.deletedAt),
        )
      )
  );

  const [retry] = await withTenant(db, opts.practiceId, (tx) =>
    tx
      .insert(communications)
      .values({
        practiceId: opts.practiceId,
        clientId: opts.clientId,
        channel: opts.channel,
        direction: "outbound",
        subject: "Wellness Plan Reminder",
        content: `Wellness plan reminder pending for ${opts.planName} / ${opts.patientName ?? "Unknown"} billing ${opts.billingDate}`,
        status: "pending",
        dedupeKey: opts.dedupeKey,
      })
      .returning({ id: communications.id })
  );
  return retry?.id ?? null;
}

async function recordOutcome(opts: {
  practiceId: string;
  communicationId: string;
  channel: "whatsapp" | "email";
  status: "sent" | "failed";
  content: string;
  providerMessageId?: string;
}): Promise<void> {
  await withTenant(db, opts.practiceId, (tx) =>
    tx
      .update(communications)
      .set({
        channel: opts.channel,
        status: opts.status,
        content: opts.content,
        providerMessageId: opts.providerMessageId,
      })
      .where(eq(communications.id, opts.communicationId))
  );
}

export async function GET(request: Request) {
  const authError = cronAuthError(request);
  if (authError) return authError;

  try {
    const now = new Date();
    const lookahead = new Date();
    lookahead.setDate(lookahead.getDate() + LOOKAHEAD_DAYS);
    const todayStr = now.toISOString().slice(0, 10);

    const hasWhatsApp = isKirimdevConfigured();

    // Cross-tenant sweep: active wellness enrollments with nextBillingDate due now
    const dueEnrollments = await withSystem(db, (tx) =>
      tx
        .select({
          enrollmentId: wellnessEnrollments.id,
          practiceId: wellnessEnrollments.practiceId,
          clientId: wellnessEnrollments.clientId,
          patientName: patients.name,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          clientEmail: clients.email,
          clientPhone: clients.phone,
          planName: wellnessPlans.name,
          planPrice: wellnessPlans.price,
          nextBillingDate: wellnessEnrollments.nextBillingDate,
          practiceName: practices.name,
          practicePhone: practices.phone,
          emailSuppressionReason: emailSuppressions.reason,
        })
        .from(wellnessEnrollments)
        .innerJoin(
          wellnessPlans,
          and(
            eq(wellnessEnrollments.planId, wellnessPlans.id),
            eq(wellnessPlans.practiceId, wellnessEnrollments.practiceId),
            eq(wellnessPlans.active, true),
            isNull(wellnessPlans.deletedAt)
          )
        )
        .innerJoin(
          clients,
          and(
            eq(wellnessEnrollments.clientId, clients.id),
            eq(clients.practiceId, wellnessEnrollments.practiceId),
            isNull(clients.deletedAt)
          )
        )
        .leftJoin(
          patients,
          and(
            eq(wellnessEnrollments.patientId, patients.id),
            eq(patients.clientId, wellnessEnrollments.clientId),
            eq(patients.practiceId, wellnessEnrollments.practiceId),
            isNull(patients.deletedAt)
          )
        )
        .innerJoin(
          practices,
          and(
            eq(wellnessEnrollments.practiceId, practices.id),
            isNull(practices.deletedAt)
          )
        )
        .leftJoin(
          emailSuppressions,
          and(
            eq(emailSuppressions.practiceId, wellnessEnrollments.practiceId),
            sql`${emailSuppressions.email} = lower(trim(${clients.email}))`,
            isNull(emailSuppressions.deletedAt)
          )
        )
        .where(
          and(
            eq(wellnessEnrollments.status, "active"),
            isNull(wellnessEnrollments.deletedAt),
            lte(wellnessEnrollments.nextBillingDate, lookahead.toISOString().slice(0, 10)),
          )
        )
        .orderBy(wellnessEnrollments.nextBillingDate)
    );

    let sent = 0;
    let failed = 0;
    let deduped = 0;

    for (const enr of dueEnrollments) {
      const billingDateStr = enr.nextBillingDate;
      const dedupeKey = wellnessDedupeKey(enr.enrollmentId, billingDateStr);
      const patientName = enr.patientName ?? "Unknown";
      const clientName = `${enr.clientFirstName} ${enr.clientLastName}`;
      const hasPhone = normalizeE164(enr.clientPhone) !== null;

      const sendEmailReminder = async (communicationId: string): Promise<boolean> => {
        const clientEmail = normalizeEmailSuppressionAddress(enr.clientEmail);
        if (!clientEmail) return false;
        if (enr.emailSuppressionReason) {
          await recordOutcome({
            practiceId: enr.practiceId,
            communicationId,
            channel: "email",
            status: "failed",
            content: `Wellness reminder blocked for ${patientName}: ${emailSuppressionSendBlockMessage(enr.emailSuppressionReason)}`,
          });
          return false;
        }
        try {
          const result = await sendWellnessReminder({
            to: clientEmail,
            clientName,
            patientName,
            planName: enr.planName,
            planPrice: enr.planPrice ?? "0",
            billingDate: billingDateStr,
            practiceName: enr.practiceName ?? "",
            practicePhone: enr.practicePhone ?? undefined,
          });
          if (result.success) {
            await recordOutcome({
              practiceId: enr.practiceId,
              communicationId,
              channel: "email",
              status: "sent",
              content: `Wellness plan reminder sent for ${enr.planName} / ${patientName} billing ${billingDateStr}`,
              providerMessageId: result.id,
            });
            return true;
          }
        } catch { /* fall through to failure */ }

        await recordOutcome({
          practiceId: enr.practiceId,
          communicationId,
          channel: "email",
          status: "failed",
          content: `Wellness plan reminder failed for ${enr.planName} / ${patientName}`,
        });
        return false;
      };

      try {
        const channel = hasWhatsApp && hasPhone ? "whatsapp" : "email";
        const communicationId = await claimWellnessCommunication({
          practiceId: enr.practiceId,
          clientId: enr.clientId,
          channel,
          planName: enr.planName,
          patientName: enr.patientName,
          billingDate: billingDateStr,
          dedupeKey,
        });
        if (!communicationId) {
          deduped++;
          continue;
        }

        if (channel === "whatsapp") {
          const result = await sendWellnessReminderWA({
            to: enr.clientPhone!,
            patientName,
            planName: enr.planName,
            practiceName: enr.practiceName ?? "",
            practicePhone: enr.practicePhone ?? undefined,
          });
          if (result.success) {
            await recordOutcome({
              practiceId: enr.practiceId,
              communicationId,
              channel: "whatsapp",
              status: "sent",
              content: `WhatsApp wellness plan reminder sent for ${enr.planName} / ${patientName} billing ${billingDateStr}`,
              providerMessageId: result.messageId,
            });
            sent++;
          } else if (await sendEmailReminder(communicationId)) {
            // WhatsApp failed — fall back to email
            sent++;
          } else {
            await recordOutcome({
              practiceId: enr.practiceId,
              communicationId,
              channel: "whatsapp",
              status: "failed",
              content: `WhatsApp wellness plan reminder failed for ${enr.planName} / ${patientName}: ${result.error ?? "unknown error"}`,
            });
            failed++;
          }
        } else {
          if (await sendEmailReminder(communicationId)) {
            sent++;
          } else {
            failed++;
          }
        }
      } catch (error) {
        console.error(
          `Failed wellness reminder for enrollment ${enr.enrollmentId}:`,
          error
        );
        failed++;
      }
    }

    console.log(
      `Cron wellness-reminders completed: ${sent} sent, ${failed} failed, ${deduped} deduped out of ${dueEnrollments.length} total`,
    );

    if (failed > 0) {
      void alertOps(
        "Wellness reminders had failures",
        `${failed} of ${dueEnrollments.length} wellness reminders failed (${sent} sent, ${deduped} deduped).`
      );
    }

    await reportCronHeartbeat({
      job: "wellness-reminders",
      status: failed > 0 ? "degraded" : "ok",
      detail: `${sent} sent, ${failed} failed, ${deduped} deduped`,
      metrics: {
        total: dueEnrollments.length,
        sent,
        failed,
        deduped,
      },
    });

    return NextResponse.json({ sent, failed, deduped });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void alertOps("Wellness reminder cron job crashed", message);
    console.error("Cron wellness-reminders failed:", error);
    await reportCronHeartbeat({
      job: "wellness-reminders",
      status: "failed",
      detail: message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
