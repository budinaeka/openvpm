import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VetClaw Phase I clinical safety UX", () => {
  it("shows a clinical decision-support disclaimer and Indonesian prompt templates", () => {
    const source = readFileSync("app/(dashboard)/vetclaw/page.tsx", "utf8");

    expect(source).toContain("Clinical decision support");
    expect(source).toContain("dokter hewan tetap bertanggung jawab");
    expect(source).toContain("VetClawPromptTemplates");
    expect(source).toContain("Triage muntah/diare");
    expect(source).toContain("Kucing susah kencing");
    expect(source).toContain("Discharge instruction Bahasa Indonesia");
    expect(source).toContain("Adverse event obat");
    expect(source).toContain("Follow-up WhatsApp setelah vaksin");
    expect(source).toContain("setAgentInstruction(template.prompt)");
  });
});
