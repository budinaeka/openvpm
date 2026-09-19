import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import {
  careReminders,
  clients,
  patients,
} from "@openpims/db";
import { communicationsRouter } from "./communications";

const reminderStatus = z.enum(["open", "completed", "dismissed", "all"]);
const dueFilter = z.enum(["all", "overdue", "upcoming"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function assertPatientInPractice(
  ctx: { db: any; practiceId: string },
  patientId: string
) {
  const [row] = await ctx.db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.practiceId, ctx.practiceId),
        isNull(patients.deletedAt)
      )
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
  }
}

export const careRemindersRouter = createRouter({
  list: protectedProcedure
    .input(
      z.object({
        status: reminderStatus.default("open"),
        due: dueFilter.default("all"),
        patientId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(1000).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const today = todayIso();
      const conditions = [
        eq(careReminders.practiceId, ctx.practiceId),
        isNull(careReminders.deletedAt),
      ];
      if (input.status !== "all") conditions.push(eq(careReminders.status, input.status));
      if (input.due === "overdue") conditions.push(lte(careReminders.dueDate, today));
      if (input.due === "upcoming") conditions.push(gt(careReminders.dueDate, today));
      if (input.patientId) conditions.push(eq(careReminders.patientId, input.patientId));

      const rows = await ctx.db
        .select({
          id: careReminders.id,
          patientId: careReminders.patientId,
          patientName: patients.name,
          clientId: clients.id,
          clientName: sql<string>`concat(${clients.firstName}, ' ', ${clients.lastName})`,
          clientEmail: clients.email,
          clientPhone: clients.phone,
          title: careReminders.title,
          notes: careReminders.notes,
          dueDate: careReminders.dueDate,
          status: careReminders.status,
          imported: sql<boolean>`${careReminders.externalSource} is not null`,
          completedAt: careReminders.completedAt,
          dismissedAt: careReminders.dismissedAt,
          dismissalReason: careReminders.dismissalReason,
          createdAt: careReminders.createdAt,
          updatedAt: careReminders.updatedAt,
        })
        .from(careReminders)
        .innerJoin(patients, eq(careReminders.patientId, patients.id))
        .innerJoin(clients, eq(patients.clientId, clients.id))
        .where(and(...conditions))
        .orderBy(
          input.status === "completed"
            ? desc(careReminders.completedAt)
            : input.status === "dismissed"
              ? desc(careReminders.dismissedAt)
              : asc(careReminders.dueDate),
          asc(careReminders.id)
        )
        .limit(input.limit);

      const [summary] = await ctx.db
        .select({
          open: sql<number>`count(*) filter (where ${careReminders.status} = 'open')::int`,
          overdue: sql<number>`count(*) filter (where ${careReminders.status} = 'open' and ${careReminders.dueDate} <= ${today})::int`,
          upcoming: sql<number>`count(*) filter (where ${careReminders.status} = 'open' and ${careReminders.dueDate} > ${today})::int`,
          completed: sql<number>`count(*) filter (where ${careReminders.status} = 'completed')::int`,
          dismissed: sql<number>`count(*) filter (where ${careReminders.status} = 'dismissed')::int`,
        })
        .from(careReminders)
        .where(
          and(
            eq(careReminders.practiceId, ctx.practiceId),
            isNull(careReminders.deletedAt)
          )
        );

      return {
        data: rows,
        summary: summary ?? { open: 0, overdue: 0, upcoming: 0, completed: 0, dismissed: 0 },
      };
    }),

  create: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician"))
    .input(
      z.object({
        patientId: z.string().uuid(),
        title: z.string().trim().min(2).max(255),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertPatientInPractice(ctx, input.patientId);
      const [row] = await ctx.db
        .insert(careReminders)
        .values({
          practiceId: ctx.practiceId,
          patientId: input.patientId,
          title: input.title,
          dueDate: input.dueDate,
          notes: input.notes || null,
          createdBy: ctx.user.id,
        })
        .returning();
      return row!;
    }),

  setCompleted: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician"))
    .input(z.object({ id: z.string().uuid(), completed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(careReminders)
        .set(
          input.completed
            ? {
                status: "completed",
                completedAt: new Date(),
                completedBy: ctx.user.id,
                dismissedAt: null,
                dismissedBy: null,
                dismissalReason: null,
              }
            : { status: "open", completedAt: null, completedBy: null }
        )
        .where(
          and(
            eq(careReminders.id, input.id),
            eq(careReminders.practiceId, ctx.practiceId),
            isNull(careReminders.deletedAt)
          )
        )
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      return row;
    }),

  setDismissed: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician"))
    .input(
      z.object({
        items: z.array(z.string().uuid()).min(1).max(100),
        dismissed: z.boolean(),
        reason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(careReminders)
        .set(
          input.dismissed
            ? {
                status: "dismissed",
                dismissedAt: new Date(),
                dismissedBy: ctx.user.id,
                dismissalReason: input.reason || null,
              }
            : { status: "open", dismissedAt: null, dismissedBy: null, dismissalReason: null }
        )
        .where(
          and(
            inArray(careReminders.id, input.items),
            eq(careReminders.practiceId, ctx.practiceId),
            isNull(careReminders.deletedAt)
          )
        )
        .returning({ id: careReminders.id });
      return { count: row ? input.items.length : 0 };
    }),

  sendOutreach: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician", "front_desk"))
    .input(
      z.object({
        reminderId: z.string().uuid(),
        channel: z.enum(["email", "sms", "whatsapp"]),
        subject: z.string().trim().max(255).optional(),
        body: z.string().trim().min(1).max(4096),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [reminder] = await ctx.db
        .select({
          id: careReminders.id,
          patientId: careReminders.patientId,
          clientId: clients.id,
          clientName: sql<string>`concat(${clients.firstName}, ' ', ${clients.lastName})`,
        })
        .from(careReminders)
        .innerJoin(patients, eq(careReminders.patientId, patients.id))
        .innerJoin(clients, eq(patients.clientId, clients.id))
        .where(
          and(
            eq(careReminders.id, input.reminderId),
            eq(careReminders.practiceId, ctx.practiceId),
            isNull(careReminders.deletedAt)
          )
        )
        .limit(1);
      if (!reminder) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      }

      const caller = communicationsRouter.createCaller(ctx as any);
      const communication = await caller.create({
        clientId: reminder.clientId,
        channel: input.channel,
        direction: "outbound",
        subject: input.subject || "Care reminder",
        content: input.body,
      });
      return { ok: true, communication };
    }),
});
