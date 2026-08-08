import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VetFlowID pilot dashboard", () => {
  it("adds a dedicated pilot dashboard route", () => {
    expect(existsSync("app/(dashboard)/vetflowid/page.tsx")).toBe(true);

    const source = readFileSync("app/(dashboard)/vetflowid/page.tsx", "utf8");
    expect(source).toContain("VetFlowID Pilot Dashboard");
    expect(source).toContain("OpenVPM core");
    expect(source).toContain("WA Inbox");
    expect(source).toContain("Reminders");
    expect(source).toContain("VetClaw Ask");
    expect(source).toContain("Tenant isolation");
    expect(source).toContain("Backup & monitoring");
    expect(source).toContain("Onboarding manual");
    expect(source).toContain("WA inbound → client match → SOAP → VetClaw → WA follow-up");
  });

  it("exposes VetFlowID in the admin navigation", () => {
    const sidebar = readFileSync("components/layout/sidebar.tsx", "utf8");

    expect(sidebar).toContain("Rocket");
    expect(sidebar).toContain('href: "/vetflowid"');
    expect(sidebar).toContain('label: "VetFlowID"');
    expect(sidebar).toContain('roles: ["admin"]');
  });
});
