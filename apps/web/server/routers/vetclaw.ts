import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import { loadIndex, loadSkill, searchAdverseEvents, topReactions as topVetReactions } from "@/lib/agent/vetclaw";

const vetclawProcedure = protectedProcedure
  .use(requireRole("admin", "veterinarian"));

const VETCLAW_QUERY_MAX = 100;
const VETCLAW_SKILL_NAME_MAX = 64;

export const vetclawRouter = createRouter({
  /** List all VetClaw skills, optionally filtered by category or query. */
  listSkills: vetclawProcedure
    .input(
      z.object({
        category: z.string().max(VETCLAW_QUERY_MAX).optional(),
        query: z.string().max(VETCLAW_QUERY_MAX).optional(),
      }).optional()
    )
    .query(({ input }) => {
      const index = loadIndex();
      let skills = index.skills;
      if (input?.category) {
        skills = skills.filter((s) => s.category === input.category);
      }
      if (input?.query) {
        const q = input.query.toLowerCase();
        skills = skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        );
      }
      return {
        categories: index.categories,
        skillCount: index.skill_count,
        skills: skills.map((s) => ({
          name: s.name,
          category: s.category,
          description: s.description,
        })),
      };
    }),

  /** Get a single skill's full content. */
  getSkill: vetclawProcedure
    .input(z.object({ name: z.string().min(1).max(VETCLAW_SKILL_NAME_MAX) }))
    .query(({ input }) => {
      const skill = loadSkill(input.name);
      if (!skill) {
        return { error: `Unknown skill '${input.name}'` };
      }
      return skill;
    }),

  /** Search openFDA adverse events. */
  searchEvents: vetclawProcedure
    .input(
      z.object({
        species: z.string().max(50).optional(),
        drug: z.string().max(100).optional(),
        reaction: z.string().max(200).optional(),
        breed: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(100).optional().default(10),
      }).optional()
    )
    .query(async ({ input }) => {
      return searchAdverseEvents(input ?? {});
    }),

  /** Top adverse reactions by species (optionally by drug). */
  topReactions: vetclawProcedure
    .input(
      z.object({
        species: z.string().min(1).max(50),
        drug: z.string().max(100).optional(),
      })
    )
    .query(async ({ input }) => {
      return topVetReactions(input.species, input.drug);
    }),
});
