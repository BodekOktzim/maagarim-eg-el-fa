import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

export type WebPhoneResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
  matchedPhone: string;
  matchLocation: "page-text";
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
    const pageTextSources = [item.raw_content, item.content].filter((value): value is string => typeof value === "string" && value.length > 0);
    let match: ReturnType<typeof findExactPhone> = null;
    for (const text of pageTextSources) {
      match = findExactPhone(text, targetPhone);
      if (match) break;
    }
    if (!match) continue;
    filtered.push({
      title: item.title || "ללא כותרת",
      url: item.url,
      snippet: `המספר מופיע בטקסט שנשלף: ${match.value}`,
      source: "Tavily",
      query,
      matchedPhone: match.value,
      matchLocation: "page-text",
    });
  }
  return filtered;
}

function buildQueries(phone: ReturnType<typeof normalizePhone>) {
  const quoted = phone.variants.map((value) => `"${value}"`);
  return [
    quoted.join(" OR "),
    `(${quoted.slice(0, 3).join(" OR ")}) ישראל`,
    `(${quoted.slice(0, 3).join(" OR ")}) עסק OR שירות OR חברה`,
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
    max_results: 10,
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
  return { phone, route, incomplete: successfulSearches < queries.length, results: Array.from(byUrl.values()).slice(0, 50) };
}
