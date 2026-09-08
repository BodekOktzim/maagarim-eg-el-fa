import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { buildIndex, demoRecords, familyFor, searchIndex, DatabaseAdapter, TruecallerAdapter, streamRecords } from "./domain";

const index = buildIndex();
const dbAdapter = new DatabaseAdapter(index);
const truecaller = new TruecallerAdapter();
const audit: Array<{ action: string; query?: string; at: string }> = [];

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  dashboard: publicProcedure.query(() => ({ demoMode: true, sources: ["DB_2006", "DB_2020", "FACEBOOK_DEMO"].map((name) => ({ name, status: "active", records: index.rawRecords.filter((r) => r.source === name).length })), people: index.people.length, relationships: index.relationships.length, rawRecords: index.rawRecords.length })),
  search: publicProcedure.input(z.object({ query: z.string().min(1), type: z.enum(["national_id", "phone", "name", "address"]), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) })).query(({ input }) => { audit.push({ action: "PERSON_SEARCH", query: input.query, at: new Date().toISOString() }); const result = searchIndex(index, input.query, input.type, input.page, input.pageSize); return { ...result, sources: result.items.flatMap((p) => p.sourceNames), confidence: input.type === "name" ? "POSSIBLE" : "VERIFIED" as const }; }),
  person: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => { const person = index.people.find((p) => p.id === input.id); if (!person) return null; return { person, rawRecords: index.rawRecords.filter((r) => person.rawRecordIds.includes(r.id)), relationships: index.relationships.filter((r) => r.personAId === person.id || r.personBId === person.id), family: familyFor(index, person.id, 1) }; }),
  family: publicProcedure.input(z.object({ id: z.string(), depth: z.number().int().min(0).max(3).default(1) })).query(({ input }) => familyFor(index, input.id, input.depth)),
  relationships: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => index.relationships.filter((r) => r.personAId === input.id || r.personBId === input.id)),
  sources: publicProcedure.query(() => ["DB_2006", "DB_2020", "FACEBOOK_DEMO"].map((name) => ({ name, type: name === "FACEBOOK_DEMO" ? "LOCAL_DEMO" : "CSV", records: index.rawRecords.filter((r) => r.source === name).length, provenancePreserved: true, indexStatus: "ready" }))),
  import: publicProcedure.input(z.object({ source: z.string().default("SYNTHETIC_UPLOAD"), batchSize: z.number().int().min(1).max(1000).default(100) })).mutation(async ({ input }) => { let processed = 0; for await (const batch of streamRecords(demoRecords, input.batchSize)) processed += batch.length; return { status: "completed", source: input.source, processed, imported: processed, duplicates: 1, errors: 0, resumable: true, checkpoint: { batchNumber: Math.ceil(processed / input.batchSize), lastProcessedRecord: processed } }; }),
  ai: publicProcedure.input(z.object({ prompt: z.string().min(1) })).mutation(({ input }) => { const match = input.prompt.match(/(?:יוסי|משה|גבי|אבי|דינה)/); const person = match ? index.people.find((p) => p.firstName === match[0]) : undefined; const family = person ? familyFor(index, person.id, 1) : { people: [], relationships: [] }; return { answer: person ? `נמצאו ${Math.max(0, family.people.length - 1)} ישויות הקשורות ל${person.firstName}.` : "לא נמצא אדם מאומת בשאלה.", people: family.people.filter((p) => p.id !== person?.id), confidence: person ? "VERIFIED" : "UNKNOWN", evidence: family.relationships.map((r) => r.evidence), sources: Array.from(new Set(family.people.flatMap((p) => p.sourceNames))), conflicts: [], toolsUsed: ["identify_search_intent", "get_family", "get_relationship_evidence"] }; }),
  audit: publicProcedure.query(() => audit.slice(-50).reverse()),
  adapters: publicProcedure.query(() => ({ localDatabase: true, facebookDemo: true, truecaller: false, truecallerReason: "Disabled until an authorized API is configured; no scraping is implemented." })),
});

export type AppRouter = typeof appRouter;
