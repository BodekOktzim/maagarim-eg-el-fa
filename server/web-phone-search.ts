import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

export type WebPhoneResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
};

function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new Error("מספר הטלפון אינו תקין.");
  const local = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
  const international = local.startsWith("0") ? `+972${local.slice(1)}` : `+${local}`;
  const dashed = local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : local;
  const spaced = local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3)}` : local;
  return { local, international, variants: Array.from(new Set([local, dashed, spaced, international, international.replace("+", "+ ")])) };
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

async function tavilySearch(query: string, useTor: boolean): Promise<WebPhoneResult[]> {
  const proxy = process.env.TOR_SOCKS_URL;
  const agent = useTor && proxy ? new SocksProxyAgent(proxy) : undefined;
  const response = await axios.post("https://api.tavily.com/search", {
    api_key: process.env.TAVILY_API_KEY,
    query,
    search_depth: "advanced",
    max_results: 10,
    include_answer: false,
    include_raw_content: false,
  }, { timeout: 12_000, ...(agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {}) });
  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  return results.map((item: { title?: string; url?: string; content?: string }) => ({
    title: item.title || "ללא כותרת",
    url: item.url || "",
    snippet: item.content || "לא נמצא קטע מידע.",
    source: "Tavily",
    query,
  })).filter((item: WebPhoneResult) => item.url);
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
  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    route = response.value.route === "direct-fallback" ? "direct-fallback" : route === "direct" ? response.value.route : route;
    for (const result of response.value.results) byUrl.set(result.url, result);
  }
  return { phone, route, results: Array.from(byUrl.values()).slice(0, 50) };
}
