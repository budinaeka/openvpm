"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Stethoscope,
  Search,
  BookOpen,
  AlertTriangle,
  Loader2,
  ChevronRight,
  Library,
  Beaker,
  Activity,
  Shield,
  Bird,
  Database,
  FileText,
  Pill,
  ArrowRight,
  Sparkles,
  ArrowUp,
  Bot,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import {
  AGENT_INSTRUCTION_MAX_LENGTH,
  isAgentInstructionValid,
} from "@/lib/agent/policy";

// ---------------------------------------------------------------------------
// Category icons & labels
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<string, { icon: React.ElementType; label: string }> = {
  clinical: { icon: Activity, label: "Clinical" },
  databases: { icon: Database, label: "Databases" },
  literature: { icon: BookOpen, label: "Literature" },
  pharma: { icon: Pill, label: "Pharma" },
  safety: { icon: Shield, label: "Safety" },
  species: { icon: Bird, label: "Species" },
};

function canAccessVetclaw(role?: string | null): boolean {
  return role === "admin" || role === "veterinarian";
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function VetclawPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking access...
        </div>
      </div>
    );
  }

  if (!canAccessVetclaw(session?.user?.role)) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={Stethoscope}
          title="VetClaw access is restricted"
          description="Only administrators and veterinarians can browse VetClaw veterinary reference skills."
          action={{
            label: "Back to dashboard",
            onClick: () => router.push("/"),
          }}
        />
      </div>
    );
  }

  return <VetclawBrowser />;
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

function VetclawBrowser() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  // ── Agent ask bar ──
  const [agentInstruction, setAgentInstruction] = useState("");
  const agentRun = trpc.agent.run.useMutation();
  const agentStatus = trpc.agent.status.useQuery();
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const agentConfigured = agentStatus.data?.configured ?? false;
  const agentInstructionInvalid =
    agentInstruction.length > 0 && !isAgentInstructionValid(agentInstruction);
  const agentSubmitDisabled =
    !agentConfigured || !isAgentInstructionValid(agentInstruction) || agentRun.isPending || agentLoading;

  const submitAgentAsk = () => {
    if (agentSubmitDisabled) return;
    const text = agentInstruction.trim();
    setAgentInstruction("");
    setAgentReply(null);
    setAgentLoading(true);
    agentRun.mutate(
      { instruction: text },
      {
        onSuccess: (data) => {
          setAgentReply(data.text);
          setAgentLoading(false);
        },
        onError: (err) => {
          setAgentReply(err.message);
          setAgentLoading(false);
        },
      }
    );
  };

  const trimmedSearch = search.trim();

  const { data, isLoading, error } = trpc.vetclaw.listSkills.useQuery(
    {
      category: selectedCategory ?? undefined,
      query: trimmedSearch || undefined,
    },
    { staleTime: 5 * 60 * 1000 }
  );

  const {
    data: skillDetail,
    isLoading: isLoadingSkill,
  } = trpc.vetclaw.getSkill.useQuery(
    { name: expandedSkill ?? "" },
    { enabled: Boolean(expandedSkill) }
  );

  const categories = data?.categories
    ? Object.keys(data.categories).sort()
    : ["clinical", "databases", "literature", "pharma", "safety", "species"];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="flex items-center gap-2">
            <Stethoscope className="h-6 w-6 text-primary" />
            VetClaw
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Veterinary clinical reference library — {data?.skillCount ?? 51} skills
          across {categories.length} categories. Evidence-based, species-first.
        </p>
      </div>

      {/* ── Agent Ask Bar ── */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm focus-within:border-primary/40">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <textarea
            value={agentInstruction}
            onChange={(e) => {
              setAgentInstruction(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitAgentAsk();
              }
            }}
            rows={2}
            maxLength={AGENT_INSTRUCTION_MAX_LENGTH}
            disabled={!agentConfigured || agentLoading}
            placeholder={
              agentConfigured
                ? "Ask about veterinary topics — the agent can pull VetClaw skills, check FDA data, and more. Enter to send."
                : "Agent is not configured. Set AI_API_KEY to enable."
            }
            className="max-h-28 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="button"
            size="icon"
            onClick={submitAgentAsk}
            disabled={agentSubmitDisabled}
            aria-label="Send"
            className="h-8 w-8 shrink-0 rounded-full"
          >
            {agentLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Agent reply */}
      {agentReply !== null && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="whitespace-pre-wrap">{agentReply}</div>
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills (toxicology, anesthesia, cardiology...)"
            className="pl-9"
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategory(null)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            !selectedCategory
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          All
          {data?.skillCount ? ` (${data.skillCount})` : ""}
        </button>
        {categories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta?.icon ?? Library;
          const count = data?.categories?.[cat] ?? 0;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-3 w-3" />
              {meta?.label ?? cat}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {/* Skills list */}
      {data && !isLoading && (
        <div className="space-y-2">
          {data.skills.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Library className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No skills match your search. Try a different keyword.
            </div>
          )}

          {data.skills.map((skill) => (
            <div
              key={skill.name}
              className={cn(
                "rounded-lg border border-border bg-card transition-colors",
                expandedSkill === skill.name && "ring-2 ring-primary/20"
              )}
            >
              <button
                onClick={() =>
                  setExpandedSkill(
                    expandedSkill === skill.name ? null : skill.name
                  )
                }
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <div className="mt-0.5 shrink-0">
                  {(() => {
                    const meta = CATEGORY_META[skill.category];
                    const Icon = meta?.icon ?? Library;
                    return (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                    );
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{skill.name}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                      {skill.category}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {skill.description}
                  </p>
                </div>
                <ChevronRight
                  className={cn(
                    "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    expandedSkill === skill.name && "rotate-90"
                  )}
                />
              </button>

              {/* Expanded content */}
              {expandedSkill === skill.name && (
                <div className="border-t border-border p-4">
                  {isLoadingSkill ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : skillDetail && "content" in skillDetail ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-code:text-primary prose-code:bg-muted prose-code:rounded prose-code:px-1">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: formatMarkdown((skillDetail as { content: string }).content),
                        }}
                      />
                    </div>
                  ) : skillDetail && "error" in skillDetail ? (
                    <p className="text-sm text-destructive">
                      {(skillDetail as { error: string }).error}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* openFDA section */}
      <OpenFdaSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple markdown → HTML (bold, headers, code, lists)
// ---------------------------------------------------------------------------

function formatMarkdown(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, "<h3 class='text-base font-semibold mt-4 mb-2'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='text-lg font-semibold mt-4 mb-2'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='text-xl font-bold mt-4 mb-2'>$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code class='bg-muted rounded px-1 py-0.5 text-xs'>$1</code>")
    // Unordered list items
    .replace(/^- (.+)$/gm, "<li class='text-sm text-muted-foreground ml-4 list-disc'>$1</li>")
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, "<li class='text-sm text-muted-foreground ml-4 list-decimal'>$1</li>")
    // Paragraphs (double newline)
    .replace(/\n\n/g, "</p><p class='text-sm text-muted-foreground mt-2'>")
    // Line breaks
    .replace(/\n(?!<)/g, "<br/>");
}

// ---------------------------------------------------------------------------
// openFDA quick-search widget
// ---------------------------------------------------------------------------

function OpenFdaSection() {
  const [species, setSpecies] = useState("DOG");
  const [drug, setDrug] = useState("");
  const [results, setResults] = useState<{
    reactions?: Array<{ term: string; count: number }>;
    error?: string;
  } | null>(null);

  const topReactionsQuery = trpc.vetclaw.topReactions.useQuery(
    { species, drug: drug.trim() || undefined },
    { enabled: false }
  );

  const handleCheck = async () => {
    setResults(null);
    const res = await topReactionsQuery.refetch();
    if (res.data) {
      const data = res.data as {
        reactions?: Array<{ term: string; count: number }>;
        results?: Array<{ term: string; count: number }>;
        error?: string;
      };
      setResults({
        reactions: data.reactions ?? data.results,
        error: data.error,
      });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">FDA Adverse Events</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Check the FDA openFDA database for reported adverse reactions by species
        and drug. All data is from US adverse-event reports.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground">
            Species
          </label>
          <select
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
          >
            {["DOG", "CAT", "HORSE", "CATTLE", "BIRD", "FISH", "RABBIT", "FERRET", "REPTILE", "SWINE", "SHEEP", "GOAT"].map(
              (s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              )
            )}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground">
            Drug (optional)
          </label>
          <Input
            value={drug}
            onChange={(e) => setDrug(e.target.value)}
            placeholder="e.g. Carprofen, Ivermectin..."
          />
        </div>
        <Button
          onClick={handleCheck}
          disabled={topReactionsQuery.isFetching}
          className="shrink-0"
        >
          {topReactionsQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          Check
        </Button>
      </div>

      {/* Results */}
      {topReactionsQuery.isFetching && (
        <div className="mt-4 flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {results?.error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {results.error}
        </div>
      )}

      {results?.reactions && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Top reported reactions
            {drug.trim() ? ` for ${drug.trim()} in ${species.toLowerCase()}s` : ` for ${species.toLowerCase()}s`}
            :
          </p>
          <div className="space-y-1">
            {Array.isArray(results.reactions) && results.reactions.slice(0, 10).map((r) => (
              <div
                key={r.term}
                className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5 text-sm"
              >
                <span className="capitalize">{r.term.toLowerCase()}</span>
                <span className="text-xs font-medium text-muted-foreground">
                  {r.count.toLocaleString()} reports
                </span>
              </div>
            ))}
            {(!Array.isArray(results.reactions) || results.reactions.length === 0) && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No adverse events found for this combination.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
