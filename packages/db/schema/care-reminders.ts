import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseColumns } from "./common";
import { practices } from "./practices";
import { patients } from "./patients";
import { users } from "./users";

export const careReminderStatusEnum = pgEnum("care_reminder_status", [
  "open",
  "completed",
  "dismissed",
]);

export const careReminders = pgTable(
  "care_reminders",
  {
    ...baseColumns(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    title: varchar("title", { length: 255 }).notNull(),
    notes: text("notes"),
    dueDate: date("due_date").notNull(),
    status: careReminderStatusEnum("status").notNull().default("open"),
    createdBy: uuid("created_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: uuid("dismissed_by").references(() => users.id),
    dismissalReason: text("dismissal_reason"),
    externalSource: varchar("external_source", { length: 64 }),
    externalId: varchar("external_id", { length: 128 }),
  },
  (table) => ({
    practiceStatusDueIdx: index("care_reminders_practice_status_due_idx").on(
      table.practiceId,
      table.status,
      table.dueDate,
      table.deletedAt
    ),
    patientIdx: index("care_reminders_patient_idx").on(
      table.patientId,
      table.deletedAt
    ),
    externalUnique: uniqueIndex("care_reminders_external_unique_idx").on(
      table.practiceId,
      table.externalSource,
      table.externalId
    ),
  })
);

export const careRemindersRelations = relations(careReminders, ({ one }) => ({
  practice: one(practices, {
    fields: [careReminders.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [careReminders.patientId],
    references: [patients.id],
  }),
  creator: one(users, {
    fields: [careReminders.createdBy],
    references: [users.id],
  }),
  completer: one(users, {
    fields: [careReminders.completedBy],
    references: [users.id],
  }),
  dismisser: one(users, {
    fields: [careReminders.dismissedBy],
    references: [users.id],
  }),
}));
