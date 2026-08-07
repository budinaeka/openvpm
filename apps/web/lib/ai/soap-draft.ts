import { generateText } from "ai";
import { configuredModel } from "@/lib/agent/runner";
import { SOAP_SECTION_MAX_LENGTH } from "@/lib/records/soap-content";
import { loadSkill } from "@/lib/agent/vetclaw";

/**
 * One-shot AI draft of a SOAP visit note. Unlike ai.createSoapFromAI (the
 * inbound hook external scribes POST finished notes to), this generates a
 * DRAFT from chart context and returns it to the editor without saving
 * anything; the clinician reviews, edits, and saves.
 */

export const SOAP_DRAFT_MAX_OUTPUT_TOKENS = 1024;
export const SOAP_DRAFT_VISIT_CONTEXT_MAX_LENGTH = 2000;

export const SOAP_DRAFT_SYSTEM_PROMPT = `You draft veterinary SOAP notes for a clinician to review and edit.
Rules:
- Return ONLY a JSON object with the string keys "subjective", "objective", "assessment", and "plan". No markdown fences, no commentary.
- Ground every statement in the provided chart context. NEVER invent exam findings, vitals, doses, or owner reports.
- Where information is missing, write a short prompt for the clinician instead (for example "Owner reports: [add]").
- Use VetClaw clinical skill guidance when provided, especially for differential diagnosis, species-specific medicine, emergency triage, and common workup/treatment planning.
- If subjective and objective are already supplied, preserve them and focus on assessment + plan suggestions.
- Keep each section short, factual, and clinical.`;

export interface SoapDraft {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface SoapDraftContext {
  patient: {
    name: string;
    species: string | null;
    breed: string | null;
    sex: string | null;
    dob: string | null;
  };
  allergies: Array<{ allergen: string; severity: string | null }>;
  activeProblems: Array<{ description: string; status: string | null }>;
  latestVitals: {
    temperatureC: string | number | null;
    heartRateBpm: number | null;
    respiratoryRateBpm: number | null;
    weightKg: string | number | null;
  } | null;
  visitContext?: string;
  currentSubjective?: string;
  currentObjective?: string;
  mode?: "full" | "assessment_plan";
}

function line(label: string, value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? ""
    : `${label}: ${value}\n`;
}

function compactSkill(name: string, maxLength = 1800): string {
  const skill = loadSkill(name);
  if (!skill?.content) return "";
  return `\n--- VetClaw skill: ${name} ---\n${skill.content.slice(0, maxLength)}\n`;
}

function speciesSkillName(species: string | null): string | null {
  const normalized = species?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("dog") || normalized.includes("canine")) return "canine-medicine";
  if (normalized.includes("cat") || normalized.includes("feline")) return "feline-medicine";
  if (normalized.includes("horse") || normalized.includes("equine")) return "equine-medicine";
  if (normalized.includes("bird") || normalized.includes("avian")) return "avian-medicine";
  if (normalized.includes("reptile")) return "reptile-medicine";
  if (normalized.includes("rabbit") || normalized.includes("small mammal")) return "small-mammal-medicine";
  return null;
}

function vetClawContext(context: SoapDraftContext): string {
  const skills = [
    "differential-diagnosis",
    speciesSkillName(context.patient.species),
  ].filter((name): name is string => Boolean(name));
  const unique = Array.from(new Set(skills));
  const content = unique.map((name) => compactSkill(name)).join("\n");
  return content ? `\nVetClaw clinical guidance to consider (do not copy blindly; adapt to case):\n${content}\n` : "";
}

export function buildSoapDraftPrompt(context: SoapDraftContext): string {
  const { patient, allergies, activeProblems, latestVitals } = context;
  const mode = context.mode ?? "full";
  let prompt = mode === "assessment_plan"
    ? "Recommend Assessment and Plan for this veterinary SOAP note using the supplied Subjective and Objective sections. Preserve Subjective and Objective verbatim in the JSON response.\n\nPatient:\n"
    : "Draft a SOAP note for this veterinary visit.\n\nPatient:\n";
  prompt += line("Name", patient.name);
  prompt += line("Species", patient.species);
  prompt += line("Breed", patient.breed);
  prompt += line("Sex", patient.sex);
  prompt += line("Date of birth", patient.dob);

  if (allergies.length > 0) {
    prompt += "\nKnown allergies:\n";
    for (const allergy of allergies) {
      prompt += `- ${allergy.allergen}${allergy.severity ? ` (${allergy.severity})` : ""}\n`;
    }
  }

  if (activeProblems.length > 0) {
    prompt += "\nProblem list:\n";
    for (const problem of activeProblems) {
      prompt += `- ${problem.description}${problem.status ? ` [${problem.status}]` : ""}\n`;
    }
  }

  if (latestVitals) {
    prompt += "\nMost recent vitals:\n";
    prompt += line("Temperature (C)", latestVitals.temperatureC);
    prompt += line("Heart rate (bpm)", latestVitals.heartRateBpm);
    prompt += line("Respiratory rate (bpm)", latestVitals.respiratoryRateBpm);
    prompt += line("Weight (kg)", latestVitals.weightKg);
  }

  if (context.visitContext) {
    prompt += `\nVisit context from staff:\n${context.visitContext}\n`;
  }

  if (context.currentSubjective) {
    prompt += `\nCurrent Subjective section (preserve verbatim if mode=assessment_plan):\n${context.currentSubjective}\n`;
  }
  if (context.currentObjective) {
    prompt += `\nCurrent Objective section (preserve verbatim if mode=assessment_plan):\n${context.currentObjective}\n`;
  }

  prompt += vetClawContext(context);

  prompt += mode === "assessment_plan"
    ? "\nReturn the JSON object with subjective, objective, assessment, and plan. Use the current subjective/objective verbatim; recommend clinically appropriate assessment and plan only from provided facts."
    : "\nReturn the JSON object with subjective, objective, assessment, and plan.";
  return prompt;
}

function draftSection(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, SOAP_SECTION_MAX_LENGTH);
}

/**
 * Parse the model's response into the four SOAP sections. Tolerates markdown
 * fences and prose around the JSON object. Returns null when no usable
 * object is found or every section is empty.
 */
export function parseSoapDraft(text: string): SoapDraft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const draft: SoapDraft = {
    subjective: draftSection(record.subjective),
    objective: draftSection(record.objective),
    assessment: draftSection(record.assessment),
    plan: draftSection(record.plan),
  };

  const hasContent = Object.values(draft).some((section) => section.length > 0);
  return hasContent ? draft : null;
}

export class SoapDraftUnavailableError extends Error {
  constructor() {
    super("The AI draft did not come back in a usable shape. Try again.");
    this.name = "SoapDraftUnavailableError";
  }
}

/** Generate a SOAP draft. Throws AgentNotConfiguredError when no AI key is set. */
export async function draftSoapNote(
  context: SoapDraftContext
): Promise<SoapDraft> {
  const result = await generateText({
    model: configuredModel(),
    system: SOAP_DRAFT_SYSTEM_PROMPT,
    prompt: buildSoapDraftPrompt(context),
    maxOutputTokens: SOAP_DRAFT_MAX_OUTPUT_TOKENS,
  });

  const draft = parseSoapDraft(result.text);
  if (!draft) {
    throw new SoapDraftUnavailableError();
  }
  return draft;
}
