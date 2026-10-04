import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

export type WebPhoneResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
  matchedPhone: string;
  matchLocation: "page-text" | "provider-snippet";
  relevanceScore: number;
  relevanceLabel: "גבוהה" | "בינונית" | "נמוכה";
};

type TavilyResult = { title?: string; url?: string; content?: string; raw_content?: string };

const PROVIDER_TIMEOUT_MS = 8_000;

function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new Error("מספר הטלפון אינו תקין.");
  const local = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
  const international = local.startsWith("0") ? `+972${local.slice(1)}` : `+${local}`;
  const dashed = local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : local;
  const spaced = local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3)}` : local;
  return { local, international, variants: Array.from(new Set([local, dashed, spaced, international, international.replace("+", "+ ")])) };
}

function canonicalPhoneDigits(input: string) {
  const digits = input.replace(/\D/g, "");
  return digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
}

function findExactPhone(text: string, targetPhone: string) {
  const equivalentDigits = new Set([targetPhone]);
  if (targetPhone.startsWith("0")) equivalentDigits.add(`972${targetPhone.slice(1)}`);
  if (targetPhone.startsWith("972")) equivalentDigits.add(`0${targetPhone.slice(3)}`);
  for (const digits of Array.from(equivalentDigits).sort((a, b) => b.length - a.length)) {
    const formattedDigits = digits.split("").join("[\\s()./-]*");
    const pattern = new RegExp(`(?<!\\d)(\\+?${formattedDigits})(?!\\d)`, "g");
    const match = pattern.exec(text);
    if (match) return { value: match[1], start: match.index, end: match.index + match[1].length };
  }
  return null;
}

function scoreResult(item: TavilyResult, match: { start: number; end: number }, query: string, matchLocation: WebPhoneResult["matchLocation"]) {
  const title = String(item.title ?? "").toLocaleLowerCase("he");
  const text = String(item.raw_content ?? "").toLocaleLowerCase("he");
  const context = text.slice(Math.max(0, match.start - 280), Math.min(text.length, match.end + 280));
  const queryTerms = query.replace(/["()+]/g, " ").split(/\s+/).filter((term) => term.length >= 3);
  const termHits = queryTerms.filter((term) => title.includes(term) || context.includes(term)).length;
  const socialOrDirectory = /(instagram|facebook|tiktok|linkedin|עסק|חברה|שירות|טלפון|whatsapp|וואטסאפ)/i.test(`${title} ${context}`);
  const score = Math.min(100, (matchLocation === "page-text" ? 45 : 25) + Math.min(30, termHits * 8) + (socialOrDirectory ? 15 : 0) + (item.raw_content && item.raw_content.length > 300 ? 10 : 0));
  return { score, label: score >= 75 ? "גבוהה" as const : score >= 58 ? "בינונית" as const : "נמוכה" as const };
}

export function filterExactPhoneResults(results: TavilyResult[], inputPhone: string, query: string): WebPhoneResult[] {
  const targetPhone = normalizePhone(inputPhone).local;
  const filtered: WebPhoneResult[] = [];
  for (const item of results) {
    if (typeof item.url !== "string" || !item.url) continue;
    try {
      const resultUrl = new URL(item.url);
      if (resultUrl.protocol !== "https:" && resultUrl.protocol !== "http:") continue;
    } catch {
      continue;
    }
    const pageText = typeof item.raw_content === "string" ? item.raw_content : "";
    const snippetText = typeof item.content === "string" ? item.content : "";
    const pageMatch = findExactPhone(pageText, targetPhone);
    const match = pageMatch ?? findExactPhone(snippetText, targetPhone);
    if (!match) continue;
    const matchLocation = pageMatch ? "page-text" : "provider-snippet";
    const relevance = scoreResult(item, match, query, matchLocation);
    filtered.push({
      title: item.title || "ללא כותרת",
      url: item.url,
      snippet: pageMatch ? `המספר מופיע בטקסט שנשלף: ${match.value}` : `המספר מופיע בקטע התוכן שסופק על ידי מנוע החיפוש: ${match.value}`,
      source: "Tavily",
      query,
      matchedPhone: match.value,
      matchLocation,
      relevanceScore: relevance.score,
      relevanceLabel: relevance.label,
    });
  }
  return filtered.sort((left, right) => right.relevanceScore - left.relevanceScore || left.url.localeCompare(right.url));
}

export function buildQueries(phone: ReturnType<typeof normalizePhone>) {
  const quoted = phone.variants.map((value) => `"${value}"`);
  return [
    quoted.join(" OR "),
    `(${quoted.slice(0, 3).join(" OR ")}) ישראל`,
    `(${quoted.slice(0, 3).join(" OR ")}) Instagram OR Facebook OR TikTok OR LinkedIn`,
    `(${quoted.slice(0, 3).join(" OR ")}) עסק OR שירות OR חברה OR טלפון OR WhatsApp`,
    `(${quoted.slice(0, 2).join(" OR ")}) זיהוי OR אינדקס OR directory OR contact`,
    `${quoted[0]} ${quoted[3] ?? quoted[0]} ישראל`,
  ];
}

function providerConfigured() {
  return Boolean(process.env.TAVILY_API_KEY);
}

async function tavilySearch(query: string, useTor: boolean): Promise<TavilyResult[]> {
  const proxy = process.env.TOR_SOCKS_URL;
  const agent = useTor && proxy ? new SocksProxyAgent(proxy) : undefined;
  const response = await axios.post("https://api.tavily.com/search", {
    api_key: process.env.TAVILY_API_KEY,
    query,
    search_depth: "advanced",
    max_results: 20,
    include_answer: false,
    include_raw_content: "text",
  }, { timeout: PROVIDER_TIMEOUT_MS, ...(agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {}) });
  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  return results;
}

async function searchWithFallback(query: string) {
  if (!process.env.TOR_SOCKS_URL) return { results: await tavilySearch(query, false), route: "direct" as const };
  try {
    return { results: await tavilySearch(query, true), route: "tor" as const };
  } catch {
    return { results: await tavilySearch(query, false), route: "direct-fallback" as const };
  }
}

export async function searchPublicPhone(input: string) {
  if (!providerConfigured()) throw new Error("חיפוש אינטרנטי פנימי אינו מוגדר בשרת. יש להגדיר TAVILY_API_KEY.");
  const phone = normalizePhone(input);
  const queries = buildQueries(phone);
  const responses = await Promise.allSettled(queries.map(searchWithFallback));
  const byUrl = new Map<string, WebPhoneResult>();
  let route: "tor" | "direct" | "direct-fallback" = "direct";
  let successfulSearches = 0;
  for (let index = 0; index < responses.length; index += 1) {
    const response = responses[index];
    if (response.status !== "fulfilled") continue;
    successfulSearches += 1;
    route = response.value.route === "direct-fallback" ? "direct-fallback" : route === "direct" ? response.value.route : route;
    for (const result of filterExactPhoneResults(response.value.results, phone.local, queries[index])) byUrl.set(result.url, result);
  }
  if (successfulSearches === 0) throw new Error("ספק החיפוש לא הגיב. לא ניתן להציג תוצאות או להסיק שלא נמצאו תוצאות.");
  const results = Array.from(byUrl.values()).sort((left, right) => right.relevanceScore - left.relevanceScore || left.url.localeCompare(right.url));
  return { phone, route, incomplete: successfulSearches < queries.length, limited: results.length > 100, results: results.slice(0, 100) };
}
