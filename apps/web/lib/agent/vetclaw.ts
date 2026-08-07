import fs from "fs";
import path from "path";

/**
 * VetClaw integration for the OpenVPM Agent.
 *
 * Reads VetClaw's index.json and SKILL.md files from the local filesystem
 * (clone at /home/ubuntu/VetClaw, overridable via VETCLAW_REPO_PATH env var).
 * Also provides an openFDA API client for adverse-event queries.
 *
 * All four tools are read-only:
 *   - list_vetclaw_skills   → discover skills
 *   - get_vetclaw_skill     → load a skill's SKILL.md
 *   - search_veterinary_adverse_events  → query openFDA
 *   - top_adverse_reactions            → aggregate top reactions
 */

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const VETCLAW_REPO_PATH =
  process.env.VETCLAW_REPO_PATH ?? "/home/ubuntu/VetClaw";

function indexPath(): string {
  return path.join(VETCLAW_REPO_PATH, "index.json");
}

function skillPath(relativePath: string): string {
  return path.join(VETCLAW_REPO_PATH, relativePath);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VetClawSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface VetClawIndex {
  name: string;
  version: string;
  description: string;
  skill_count: number;
  categories: Record<string, number>;
  skills: VetClawSkill[];
}

// ---------------------------------------------------------------------------
// Index loader (lazy + cached)
// ---------------------------------------------------------------------------

let _indexCache: VetClawIndex | null = null;

export function loadIndex(): VetClawIndex {
  if (_indexCache) return _indexCache;
  const raw = fs.readFileSync(indexPath(), "utf-8");
  _indexCache = JSON.parse(raw) as VetClawIndex;
  return _indexCache!;
}

/** Reload the index (e.g. after a git pull). */
export function reloadIndex(): VetClawIndex {
  _indexCache = null;
  return loadIndex();
}

export function loadSkill(name: string): {
  name: string;
  path: string;
  content: string;
} | null {
  const index = loadIndex();
  const skill = index.skills.find((s) => s.name === name);
  if (!skill) return null;
  const fullPath = skillPath(skill.path);
  const content = fs.readFileSync(fullPath, "utf-8");
  return { name: skill.name, path: skill.path, content };
}

// ---------------------------------------------------------------------------
// openFDA client (Node.js native fetch — no SDK needed)
// ---------------------------------------------------------------------------

const OPENFDA_BASE = "https://api.fda.gov/animalandveterinary/event.json";

function openFdaApiKey(): string | undefined {
  const key = process.env.OPENFDA_API_KEY ?? process.env.OPEN_VPM_OPENFDA_KEY;
  return key?.trim() || undefined;
}

interface OpenFdaSearchParams {
  species?: string;
  breed?: string;
  drug?: string;
  reaction?: string;
  limit?: number;
}

function buildOpenFdaQuery(params: OpenFdaSearchParams): string | undefined {
  const parts: string[] = [];
  if (params.species) parts.push(`animal.species:"${params.species.toUpperCase()}"`);
  if (params.breed) parts.push(`animal.breed.breed_component:"${params.breed}"`);
  if (params.drug) parts.push(`drug.name:"${params.drug.toUpperCase()}"`);
  if (params.reaction) parts.push(`reaction.veddra_term_name:"${params.reaction}"`);
  return parts.length > 0 ? parts.join("+AND+") : undefined;
}

export async function searchAdverseEvents(
  params: OpenFdaSearchParams
): Promise<Record<string, unknown>> {
  const query = buildOpenFdaQuery(params);
  const urlParams = new URLSearchParams();
  if (query) urlParams.set("search", query);
  urlParams.set("limit", String(Math.min(params.limit ?? 10, 1000)));

  const apiKey = openFdaApiKey();
  if (apiKey) urlParams.set("api_key", apiKey);

  const url = `${OPENFDA_BASE}?${urlParams.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) {
      return { meta: { results: { total: 0 } }, results: [] };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `openFDA returned HTTP ${res.status}: ${text.slice(0, 300)}`, results: [] };
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      error: `openFDA request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      results: [],
    };
  }
}

export async function topReactions(
  species: string,
  drug?: string
): Promise<Record<string, unknown>> {
  const queryParts: string[] = [
    `animal.species:"${species.toUpperCase()}"`,
  ];
  if (drug) queryParts.push(`drug.name:"${drug.toUpperCase()}"`);
  const query = queryParts.join("+AND+");

  const urlParams = new URLSearchParams();
  urlParams.set("count", "reaction.veddra_term_name.exact");
  urlParams.set("search", query);

  const apiKey = openFdaApiKey();
  if (apiKey) urlParams.set("api_key", apiKey);

  const url = `${OPENFDA_BASE}?${urlParams.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) {
      return { results: [] };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `openFDA returned HTTP ${res.status}: ${text.slice(0, 300)}`, results: [] };
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      error: `openFDA request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      results: [],
    };
  }
}
