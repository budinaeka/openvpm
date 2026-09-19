"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, Mail, MessageSquare, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type StatusFilter = "open" | "completed" | "dismissed" | "all";
type DueFilter = "all" | "overdue" | "upcoming";

function displayDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function CareRemindersPage() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [due, setDue] = useState<DueFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const query = trpc.careReminders.list.useQuery({ status, due, limit: 1000 });
  const create = trpc.careReminders.create.useMutation({
    onSuccess: async () => {
      toast.success("Care reminder added");
      setShowCreate(false);
      setPatientId("");
      setTitle("");
      setNotes("");
      await utils.careReminders.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const complete = trpc.careReminders.setCompleted.useMutation({
    onSuccess: async (_, vars) => {
      toast.success(vars.completed ? "Reminder completed" : "Reminder reopened");
      await utils.careReminders.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const dismiss = trpc.careReminders.setDismissed.useMutation({
    onSuccess: async (_, vars) => {
      toast.success(vars.dismissed ? "Reminder dismissed" : "Reminder restored");
      await utils.careReminders.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const outreach = trpc.careReminders.sendOutreach.useMutation({
    onSuccess: async () => {
      toast.success("Care reminder recorded in Inbox");
      await utils.communications.listConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = query.data?.data ?? [];
  const summary = query.data?.summary;
  const busy = create.isPending || complete.isPending || dismiss.isPending || outreach.isPending;
  const summaryCards = useMemo(
    () => [
      ["Open", summary?.open ?? 0],
      ["Overdue", summary?.overdue ?? 0],
      ["Upcoming", summary?.upcoming ?? 0],
      ["Completed", summary?.completed ?? 0],
      ["Dismissed", summary?.dismissed ?? 0],
    ] as const,
    [summary]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Care reminders</h1>
          <p className="text-muted-foreground">Clinic-wide queue for follow-up tasks, imports, and owner outreach.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/recalls">Vaccination recalls</Link></Button>
          <Button onClick={() => setShowCreate((v) => !v)}><Plus className="mr-2 h-4 w-4" /> Add reminder</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {summaryCards.map(([label, value]) => (
          <Card key={label}><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></CardContent></Card>
        ))}
      </div>

      {showCreate && (
        <Card>
          <CardHeader><CardTitle>Add an internal reminder</CardTitle><CardDescription>Paste a patient UUID from the patient record URL for now; imported reminders use the same queue.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Patient ID</span><input className="w-full rounded-md border bg-background px-3 py-2" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="patient UUID" /></label>
            <label className="space-y-1 text-sm"><span>Due date</span><input type="date" className="w-full rounded-md border bg-background px-3 py-2" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
            <label className="space-y-1 text-sm md:col-span-2"><span>Reminder</span><input className="w-full rounded-md border bg-background px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recheck CBC after medication course" /></label>
            <label className="space-y-1 text-sm md:col-span-2"><span>Notes</span><textarea className="min-h-24 w-full rounded-md border bg-background px-3 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <div className="md:col-span-2"><Button disabled={busy || !patientId || !title || !dueDate} onClick={() => create.mutate({ patientId, title, dueDate, notes: notes || undefined })}>Save reminder</Button></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><CardTitle>Reminder queue</CardTitle><CardDescription>Complete valid reminders, dismiss invalid imports, or send outreach that lands in Inbox.</CardDescription></div>
            <div className="flex flex-wrap gap-2">
              <select className="rounded-md border bg-background px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                <option value="open">Open</option><option value="completed">Completed</option><option value="dismissed">Dismissed</option><option value="all">All</option>
              </select>
              <select className="rounded-md border bg-background px-3 py-2 text-sm" value={due} onChange={(e) => setDue(e.target.value as DueFilter)}>
                <option value="all">All due dates</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? <p className="text-sm text-muted-foreground">Loading care reminders…</p> : query.error ? <p className="text-sm text-destructive">{query.error.message}</p> : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground"><Bell className="mx-auto mb-3 h-8 w-8" />No reminders in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-4">Due</th><th className="py-3 pr-4">Reminder</th><th className="py-3 pr-4">Patient / client</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4 text-right">Actions</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b align-top last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap">{displayDate(row.dueDate)}</td>
                      <td className="py-3 pr-4"><p className="font-medium">{row.title}</p>{row.notes && <p className="mt-1 text-muted-foreground">{row.notes}</p>}{row.imported && <Badge variant="info" className="mt-2">Imported</Badge>}</td>
                      <td className="py-3 pr-4"><Link className="font-medium text-primary hover:underline" href={`/patients/${row.patientId}`}>{row.patientName}</Link><p className="text-muted-foreground">{row.clientName}</p></td>
                      <td className="py-3 pr-4"><Badge variant={row.status === "open" ? "warning" : row.status === "completed" ? "success" : "secondary"}>{row.status}</Badge>{row.dismissalReason && <p className="mt-1 text-xs text-muted-foreground">{row.dismissalReason}</p>}</td>
                      <td className="py-3 pr-4"><div className="flex justify-end gap-2">
                        {row.status === "open" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => complete.mutate({ id: row.id, completed: true })}><CheckCircle2 className="mr-1 h-4 w-4" />Done</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => row.status === "completed" ? complete.mutate({ id: row.id, completed: false }) : dismiss.mutate({ items: [row.id], dismissed: false })}><RotateCcw className="mr-1 h-4 w-4" />Reopen</Button>}
                        {row.status === "open" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate({ items: [row.id], dismissed: true, reason: "Dismissed from active queue" })}><Trash2 className="mr-1 h-4 w-4" />Dismiss</Button>}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => outreach.mutate({ reminderId: row.id, channel: "email", subject: `Care reminder for ${row.patientName}`, body: `Hello ${row.clientName},\n\nThis is a reminder from our veterinary team about ${row.patientName}: ${row.title}. The reminder date is ${displayDate(row.dueDate)}. Please contact us if you have questions or would like to schedule.` })}><Mail className="mr-1 h-4 w-4" />Email</Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => outreach.mutate({ reminderId: row.id, channel: "whatsapp", body: `Hello ${row.clientName}, this is a reminder from our veterinary team about ${row.patientName}: ${row.title}. Please contact us if you have questions or would like to schedule.` })}><MessageSquare className="mr-1 h-4 w-4" />WA</Button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
