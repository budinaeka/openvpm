import Link from "next/link";
import {
  Activity,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  DatabaseBackup,
  MessageSquare,
  Rocket,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

const readinessTracks = [
  {
    title: "OpenVPM core",
    status: "Stabilizing",
    icon: Activity,
    description:
      "Login, clients, patients, schedule, SOAP, billing, settings, and pilot demo data.",
    checks: [
      "Authenticated dashboard routes load",
      "Client and patient records are tenant scoped",
      "SOAP and appointment flows are ready for pilot smoke tests",
    ],
  },
  {
    title: "WA Inbox",
    status: "Working path",
    icon: MessageSquare,
    description:
      "Kirimdev standalone webhook and Cloud API replies through the OpenVPM Inbox.",
    checks: [
      "Inbound WA maps to matched or unmatched communications",
      "Staff can link unmatched messages to clients",
      "WhatsApp replies enforce the 4096-character limit",
    ],
  },
  {
    title: "Reminders",
    status: "Needs pilot copy",
    icon: ClipboardCheck,
    description:
      "Appointment, vaccine, wellness, invoice, and follow-up reminders with WhatsApp-first delivery.",
    checks: [
      "Manual reminders can be triggered from clinic workflows",
      "Dedupe keys prevent duplicate reminder sends",
      "Approved template candidates are drafted for outside-window messages",
    ],
  },
  {
    title: "VetClaw Ask",
    status: "Ready for clinical templates",
    icon: Stethoscope,
    description:
      "VetClaw clinical references, Agent Ask, and openFDA adverse-event support.",
    checks: [
      "Skill browser and AI ask bar are available to doctors",
      "openFDA empty results show as empty state, not fatal errors",
      "Clinical safety disclaimer frames AI as decision support",
    ],
  },
  {
    title: "Tenant isolation",
    status: "Review required",
    icon: ShieldCheck,
    description:
      "Systematic per-router review for practiceId filters, webhook tenant mapping, and file scoping.",
    checks: [
      "Protected reads filter by ctx.practiceId",
      "Writes set practiceId from session, not client input",
      "Backup export is practice scoped unless platform admin",
    ],
  },
  {
    title: "Backup & monitoring",
    status: "Runbook drafted",
    icon: DatabaseBackup,
    description:
      "Service, HTTP, PostgreSQL, MinIO, Caddy, and restore-drill operations for pilots.",
    checks: [
      "Readiness script checks core services and public routes",
      "PostgreSQL backup procedure is documented",
      "Restore drill remains to be executed before paid pilots",
    ],
  },
  {
    title: "Onboarding manual",
    status: "Drafted",
    icon: Bot,
    description:
      "Clinic setup, staff training, WhatsApp policy, VetClaw safety, and week-1 support rhythm.",
    checks: [
      "Front desk, doctor, and admin training scripts exist",
      "WhatsApp consent copy is drafted",
      "Exit interview questions are ready for pilots",
    ],
  },
];

const pilotMetrics = [
  ["Pilot clinics", "3–5"],
  ["Time-to-first-reply", "< 5 min"],
  ["WA delivery target", "> 95%"],
  ["AI usefulness", "4/5+"],
];

const workflowSteps = [
  "WA inbound",
  "Client match",
  "SOAP",
  "VetClaw",
  "WA follow-up",
];

export default function VetFlowIdPilotDashboardPage() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-emerald-950 via-slate-950 to-teal-950 p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
              <Rocket className="h-3.5 w-3.5" />
              VetFlowID Phase I
            </div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              VetFlowID Pilot Dashboard
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-emerald-50/80 md:text-base">
              Indonesian WhatsApp-first AI veterinary practice platform. This
              dashboard tracks the Phase I path from OpenVPM core stabilization
              to clinic onboarding readiness.
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 p-4 text-sm text-emerald-50 shadow-sm backdrop-blur">
            <p className="font-semibold">Target workflow</p>
            <p className="mt-1 text-emerald-50/80">
              WA inbound → client match → SOAP → VetClaw → WA follow-up
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {pilotMetrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-5 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-xl font-semibold">Phase I readiness tracks</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {readinessTracks.map((track) => {
            const Icon = track.icon;
            return (
              <article key={track.title} className="rounded-lg border border-border bg-background p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading text-base font-semibold">{track.title}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {track.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {track.description}
                    </p>
                    <ul className="mt-3 space-y-2 text-sm">
                      {track.checks.map((check) => (
                        <li key={check} className="flex gap-2 text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{check}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-heading text-xl font-semibold">Pilot workflow</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <div key={step} className="rounded-lg border border-border bg-background p-4">
                <p className="text-xs font-semibold text-primary">Step {index + 1}</p>
                <p className="mt-2 text-sm font-medium">{step}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-heading text-xl font-semibold">Operator docs</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>
              Keep the VetFlowID repo as the pilot operating manual while the
              OpenVPM app becomes the product runtime.
            </p>
            <p>
              Run readiness from the VPS: <code className="rounded bg-muted px-1.5 py-0.5">cd &quot;/home/ubuntu/Baru saja&quot; && npm run readiness</code>
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" href="/inbox">
              Open Inbox
            </Link>
            <Link className="rounded-md border border-border px-3 py-2 text-sm font-medium" href="/vetclaw">
              Open VetClaw
            </Link>
            <Link className="rounded-md border border-border px-3 py-2 text-sm font-medium" href="/recalls">
              Open Reminders
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
