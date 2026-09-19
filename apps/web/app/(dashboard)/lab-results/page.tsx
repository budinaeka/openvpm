"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FlaskConical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LabStatus = "pending" | "completed" | "reviewed";

function displayDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusBadge(status: LabStatus) {
  if (status === "reviewed") return "success";
  if (status === "completed") return "info";
  return "warning";
}

export default function LabResultsInboxPage() {
  const utils = trpc.useUtils();
  const [patientId, setPatientId] = useState("");
  const [loadedPatientId, setLoadedPatientId] = useState("");
  const [status, setStatus] = useState<"all" | LabStatus>("all");

  const query = trpc.records.listLabResults.useQuery(
    { patientId: loadedPatientId },
    { enabled: Boolean(loadedPatientId) }
  );
  const update = trpc.records.updateLabResultStatus.useMutation({
    onSuccess: async () => {
      toast.success("Lab result updated");
      await utils.records.listLabResults.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    return status === "all" ? all : all.filter((row) => row.status === status);
  }, [query.data, status]);

  const counts = useMemo(() => {
    const all = query.data ?? [];
    return {
      all: all.length,
      pending: all.filter((r) => r.status === "pending").length,
      completed: all.filter((r) => r.status === "completed").length,
      reviewed: all.filter((r) => r.status === "reviewed").length,
    };
  }, [query.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Lab Inbox</h1>
          <p className="text-muted-foreground">Review pending and completed lab results from a patient record.</p>
        </div>
        <Button variant="outline" asChild><Link href="/records">Open records</Link></Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Load a patient lab queue</CardTitle>
          <CardDescription>Paste the patient UUID from the patient record URL. Results entered in Records → Lab Results appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 md:flex-row">
            <input className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="patient UUID" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
            <Button onClick={() => setLoadedPatientId(patientId.trim())} disabled={!patientId.trim()}><RefreshCw className="mr-2 h-4 w-4" />Load labs</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Upstream OpenVPM now includes a clinic-wide Lab Inbox. This local deployment exposes the review workflow while preserving existing patient-scoped lab storage.</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        {(["all", "pending", "completed", "reviewed"] as const).map((key) => (
          <button key={key} onClick={() => setStatus(key as any)} className={`rounded-lg border p-4 text-left ${status === key ? "border-primary bg-primary/5" : "bg-card"}`}>
            <p className="text-xs uppercase text-muted-foreground">{key}</p>
            <p className="mt-1 text-2xl font-semibold">{counts[key]}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Results</CardTitle><CardDescription>Mark completed labs as reviewed once a veterinarian signs off.</CardDescription></CardHeader>
        <CardContent>
          {!loadedPatientId ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground"><FlaskConical className="mx-auto mb-3 h-8 w-8" />Load a patient to view lab results.</div>
          ) : query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading lab results…</p>
          ) : query.error ? (
            <p className="text-sm text-destructive">{query.error.message}</p>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground"><FlaskConical className="mx-auto mb-3 h-8 w-8" />No lab results in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-4">Date</th><th className="py-3 pr-4">Test</th><th className="py-3 pr-4">Result</th><th className="py-3 pr-4">Range</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4 text-right">Actions</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap">{displayDate(row.createdAt)}</td>
                      <td className="py-3 pr-4"><p className="font-medium">{row.testName}</p>{row.orderedByName && <p className="text-xs text-muted-foreground">Ordered by {row.orderedByName}</p>}</td>
                      <td className="py-3 pr-4">{row.resultValue ?? "—"} {row.unit ?? ""}</td>
                      <td className="py-3 pr-4">{row.referenceRangeLow ?? "—"} – {row.referenceRangeHigh ?? "—"}</td>
                      <td className="py-3 pr-4"><Badge variant={statusBadge(row.status as LabStatus) as any}>{row.status}</Badge></td>
                      <td className="py-3 pr-4 text-right">
                        {row.status !== "reviewed" ? <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: row.id, status: "reviewed" })}><CheckCircle2 className="mr-1 h-4 w-4" />Review</Button> : <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: row.id, status: "completed" })}>Reopen</Button>}
                      </td>
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
