"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Bell,
  Syringe,
  HeartPulse,
  Calendar,
  AlertTriangle,
  Loader2,
  ChevronRight,
  CheckCircle2,
  Clock,
  User,
  PawPrint,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/common/empty-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 86_400_000
  );
}

function canAccess(role?: string | null): boolean {
  return role === "admin" || role === "veterinarian";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecallsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (!canAccess(session?.user?.role)) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={Bell}
          title="Recalls are restricted"
          description="Only administrators and veterinarians can view recall lists."
          action={{
            label: "Back to dashboard",
            onClick: () => router.push("/"),
          }}
        />
      </div>
    );
  }

  return <RecallsDashboard />;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function RecallsDashboard() {
  const overdueVax = trpc.ai.patientsOverdueVaccinations.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const wellnessDue = trpc.wellness.listDue.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const isLoading = overdueVax.isLoading || wellnessDue.isLoading;
  const hasError = overdueVax.error || wellnessDue.error;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl py-12 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Loading recall data...
        </p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">
              Could not load recall data
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {overdueVax.error?.message ??
                wellnessDue.error?.message ??
                "An unknown error occurred."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const vaccinations = overdueVax.data ?? [];
  const wellnessItems = wellnessDue.data ?? [];
  const totalRecalls = vaccinations.length + wellnessItems.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Recalls &amp; Reminders
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalRecalls === 0
            ? "All caught up! No patients need attention right now."
            : `${totalRecalls} patient${totalRecalls === 1 ? "" : "s"} need${totalRecalls === 1 ? "s" : ""} follow-up.`}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard
          icon={Syringe}
          iconBg="bg-amber-100 text-amber-700"
          label="Overdue Vaccinations"
          count={vaccinations.length}
          href="/patients"
        />
        <SummaryCard
          icon={HeartPulse}
          iconBg="bg-emerald-100 text-emerald-700"
          label="Active Wellness Plans"
          count={wellnessItems.length}
          href="/billing"
        />
      </div>

      {/* Vaccinations section */}
      <Section
        icon={Syringe}
        title="Overdue Vaccinations"
        count={vaccinations.length}
        emptyMessage="No patients are overdue for vaccinations."
      >
        {vaccinations.map((v, i) => (
          <div
            key={`vax-${v.patientId}-${i}`}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Syringe className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{v.patientName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {v.species}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.vaccineName} — due{" "}
                  {v.nextDueDate
                    ? new Date(v.nextDueDate).toLocaleDateString("en-US")
                    : "Unknown"}
                </p>
                {v.clientName && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70">
                    <User className="h-3 w-3" />
                    {v.clientName}
                  </div>
                )}
              </div>
            </div>
            <Link
              href={`/patients/${v.patientId}`}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </Section>

      {/* Wellness section */}
      <Section
        icon={HeartPulse}
        title="Active Wellness Plans"
        count={wellnessItems.length}
        emptyMessage="No active wellness plans are due for billing or renewal."
      >
        {wellnessItems.map((item, i) => (
          <div
            key={`ws-${(item as any).enrollmentId ?? i}`}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <HeartPulse className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {(item as any).patientName ?? (item as any).planName ?? "Wellness plan"}
                  </span>
                  {(item as any).planName && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {(item as any).planName}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {(item as any).species && `${(item as any).species} · `}
                  Next billing:{" "}
                  {(item as any).nextBillingDate
                    ? new Date(
                        (item as any).nextBillingDate
                      ).toLocaleDateString("en-US")
                    : "N/A"}
                </p>
                {(item as any).clientName && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70">
                    <User className="h-3 w-3" />
                    {(item as any).clientName}
                  </div>
                )}
              </div>
            </div>
            {(item as any).clientId ? (
              <Link
                href={`/clients/${(item as any).clientId}`}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        ))}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  iconBg,
  label,
  count,
  href,
}: {
  icon: React.ElementType;
  iconBg: string;
  label: string;
  count: number;
  href: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", iconBg)}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-2xl font-bold tabular-nums">{count}</span>
      </div>
      <p className="mt-2 text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">
        {count === 0
          ? "All clear"
          : `${count} patient${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} follow-up`}
      </p>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  emptyMessage,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {count > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {count}
          </span>
        )}
      </div>
      {count === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" />
          <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}
