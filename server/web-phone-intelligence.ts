import type { WebPhoneResult } from "./web-phone-search";

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "x" | "linkedin" | "youtube";
export type ConfidenceLevel = "strong" | "possible" | "insufficient";

export type PhoneIntelligence = {
  local: string;
  international: string;
  country: "ישראל";
  formats: string[];
  likelyLineType: "mobile" | "landline" | "unknown";
};

export type SocialProfile = {
  platform: SocialPlatform;
  url: string;
  username?: string;
  displayName?: string;
  confidence: ConfidenceLevel;
  evidenceIds: string[];
};

export type PublicEvidence = {
  id: string;
  source: string;
  url: string;
  title: string;
  foundText: string;
  matchedPhone: string;
  matchLocation: WebPhoneResult["matchLocation"];
  query: string;
};

export type EnrichedWebPhoneResult = WebPhoneResult & {
  domain: string;
  sourceKind: "official" | "social" | "directory" | "forum" | "review" | "unknown";
  sourceQuality: number;
  platforms: SocialPlatform[];
  socialProfiles: SocialProfile[];
  contextTerms: string[];
  additionalPhones: string[];
  addresses: string[];
  evidence: PublicEvidence[];
  entityLabels: string[];
};

export type EntityGroup = {
  label: string;
  kind: "business" | "person" | "unknown";
  confidence: ConfidenceLevel;
  confidenceScore: number;
  sourceCount: number;
  evidenceCount: number;
  fullTextCount: number;
  sourceDomains: string[];
  evidenceTypes: string[];
  platforms: SocialPlatform[];
  socialProfiles: SocialProfile[];
  reasons: string[];
  explanation: string;
  contradictions: string[];
  evidence: PublicEvidence[];
};

const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  youtube: ["youtube.com", "youtu.be"],
};
const GENERIC_TITLES = new Set(["home", "homepage", "contact", "צור קשר", "טלפון", "phone", "search", "חיפוש", "ללא כותרת"]);
const CONTEXT_TERMS = ["להזמנות", "צור קשר", "טלפון", "whatsapp", "וואטסאפ", "שירות לקוחות", "עסק", "חנות", "משרד", "booking", "contact", "phone", "order", "service"];

function domainOf(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

function detectPlatform(value: string): SocialPlatform | undefined {
  const host = domainOf(value);
  return (Object.entries(SOCIAL_HOSTS).find(([, hosts]) => hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)))?.[0] as SocialPlatform | undefined);
}

function extractSocialProfile(url: string, title: string): SocialProfile | null {
  const platform = detectPlatform(url);
  if (!platform) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const username = parts[0] && !/^(pages|watch|videos|reel|p|company|in|channel|c|@)/i.test(parts[0]) ? parts[0].replace(/^@/, "") : undefined;
    return { platform, url, username, displayName: title || undefined, confidence: "insufficient", evidenceIds: [] };
  } catch { return null; }
}

function normalizeLabel(value: string) {
  return value.toLocaleLowerCase("he").replace(/[^A-Za-z0-9א-ת]+/g, " ").trim();
}

function cleanCandidate(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*[·|,;:-]?\s*(?:\+?972|0)[\s()./-]*\d(?:[\s()./-]*\d){6,14}\s*$/i, "").replace(/^[\s|:,-]+|[\s|:,-]+$/g, "").trim();
}

function extractEntityLabels(result: WebPhoneResult) {
  const labels: string[] = [];
  const title = cleanCandidate(result.title);
  if (title.length >= 2 && title.length <= 100 && !GENERIC_TITLES.has(title.toLocaleLowerCase("he")) && !/^\+?[\d\s()./-]+$/.test(title)) labels.push(title);
  const context = result.context || result.snippet;
  for (const pattern of [
    /(?:שם העסק|שם החברה|עסק|חברה|מותג|contact|business|company)\s*[:：-]\s*([^|,.;\n]{2,80})/i,
    /(?:צור קשר|להזמנות|whatsapp|טלפון)\s*[:：-]?\s*([^|.;\n]{2,80})/i,
    /(?:להזמנות\s+אצל|אצל|contact(?:\s+us)?|call|orders?\s+(?:from|at)|service(?:s)?\s+for)\s+([A-Za-zא-ת][A-Za-zא-ת0-9&'". -]{1,60}?)(?=\s*[:：-]?\s*(?:0\d|972|\+972))/i,
  ]) {
    const match = pattern.exec(context);
    if (match?.[1]) labels.push(cleanCandidate(match[1]));
  }
  return Array.from(new Set(labels.filter((label) => label.length >= 2 && !/^\d+$/.test(label))));
}

function extractContextTerms(result: WebPhoneResult) {
  const text = `${result.title} ${result.context || result.snippet}`.toLocaleLowerCase("he");
  return CONTEXT_TERMS.filter((term) => text.includes(term.toLocaleLowerCase("he")));
}

function extractAdditionalPhones(result: WebPhoneResult) {
  const text = result.context || result.snippet;
  const values = text.match(/(?:\+?972|0)[\s()./-]*\d(?:[\s()./-]*\d){6,14}/g) ?? [];
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.replace(/\D/g, "") !== result.matchedPhone.replace(/\D/g, ""))));
}

function extractAddresses(result: WebPhoneResult) {
  const text = result.context || result.snippet;
  const matches = text.match(/(?:רחוב|רח׳|כתובת|street|address)\s+[^|.;\n]{2,70}/gi) ?? [];
  return Array.from(new Set(matches.map(cleanCandidate)));
}

function detectPlatforms(result: WebPhoneResult): SocialPlatform[] {
  const haystack = `${result.url} ${result.title} ${result.snippet} ${result.context || ""}`.toLocaleLowerCase("he");
  return (Object.entries(SOCIAL_HOSTS).filter(([platform, hosts]) => hosts.some((host) => haystack.includes(host)) || haystack.includes(platform === "x" ? "twitter" : platform)).map(([platform]) => platform as SocialPlatform));
}

function sourceKind(result: WebPhoneResult): EnrichedWebPhoneResult["sourceKind"] {
  const domain = domainOf(result.url);
  if (detectPlatform(result.url)) return "social";
  if (/(directory|index|d.co.il|b144|עסקים|אינדקס)/i.test(`${domain} ${result.title}`)) return "directory";
  if (/(forum|reddit|פורום)/i.test(`${domain} ${result.title}`)) return "forum";
  if (/(review|tripadvisor|ביקורת|דירוג)/i.test(`${domain} ${result.title}`)) return "review";
  if (/(\.co\.il$|\.com$|\.org$|\.net$)/i.test(domain)) return "official";
  return "unknown";
}

function sourceQuality(result: WebPhoneResult) {
  const domain = domainOf(result.url);
  const kind = sourceKind(result);
  return Math.min(100, (kind === "official" ? 35 : kind === "social" ? 28 : kind === "directory" ? 22 : 15) + (domain.endsWith(".gov.il") || domain.endsWith(".org.il") ? 20 : 0) + (result.matchLocation === "page-text" ? 30 : 10) + (result.context && result.context.length > 160 ? 15 : 0));
}

function classifyEntity(label: string): EntityGroup["kind"] {
  return /(עסק|חברה|חנות|שירות|קליניקה|מסעדה|סטודיו|בע״מ|בעמ|store|shop|business|company|service)/i.test(label) ? "business" : "unknown";
}

export function enrichWebPhoneResults(results: WebPhoneResult[]) {
  const enriched: EnrichedWebPhoneResult[] = results.map((result, index) => {
    const platforms = detectPlatforms(result);
    const evidenceId = `evidence-${index + 1}`;
    const profile = extractSocialProfile(result.url, result.title);
    const evidence: PublicEvidence[] = [{ id: evidenceId, source: result.source, url: result.url, title: result.title, foundText: result.context || result.snippet, matchedPhone: result.matchedPhone, matchLocation: result.matchLocation, query: result.query }];
    return {
      ...result,
      domain: domainOf(result.url),
      sourceKind: sourceKind(result),
      sourceQuality: sourceQuality(result),
      platforms,
      socialProfiles: profile ? [{ ...profile, confidence: result.matchLocation === "page-text" ? "possible" : "insufficient", evidenceIds: [evidenceId] }] : [],
      contextTerms: extractContextTerms(result),
      additionalPhones: extractAdditionalPhones(result),
      addresses: extractAddresses(result),
      evidence,
      entityLabels: extractEntityLabels(result),
    };
  });

  const buckets = new Map<string, { label: string; results: EnrichedWebPhoneResult[] }>();
  for (const result of enriched) for (const label of result.entityLabels) {
    const key = normalizeLabel(label);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { label, results: [] };
    if (!bucket.results.some((item) => item.url === result.url)) bucket.results.push(result);
    buckets.set(key, bucket);
  }
  const allLabels = Array.from(buckets.values()).map((bucket) => bucket.label);
  const groups: EntityGroup[] = Array.from(buckets.values()).map(({ label, results: items }) => {
    const sourceDomains = Array.from(new Set(items.map((item) => item.domain)));
    const sourceCount = sourceDomains.length;
    const evidenceCount = items.length;
    const fullTextCount = items.filter((item) => item.matchLocation === "page-text").length;
    const platforms = Array.from(new Set(items.flatMap((item) => item.platforms)));
    const evidenceTypes = Array.from(new Set(items.map((item) => item.sourceKind)));
    const socialProfiles = items.flatMap((item) => item.socialProfiles);
    const hasIndependentSupport = evidenceTypes.length >= 2 || platforms.length >= 1;
    const confidence: ConfidenceLevel = sourceCount >= 3 && fullTextCount >= 2 && hasIndependentSupport ? "strong" : sourceCount >= 2 || fullTextCount >= 1 ? "possible" : "insufficient";
    const confidenceScore = Math.min(100, (sourceCount >= 3 ? 38 : sourceCount >= 2 ? 22 : 8) + Math.min(30, fullTextCount * 12) + (hasIndependentSupport ? 15 : 0) + Math.min(17, platforms.length * 6) + Math.min(10, Math.round(items.reduce((sum, item) => sum + item.sourceQuality, 0) / Math.max(1, items.length) / 10)));
    const contradictions = allLabels.filter((other) => normalizeLabel(other) !== normalizeLabel(label) && enriched.some((item) => item.entityLabels.some((candidate) => normalizeLabel(candidate) === normalizeLabel(other)))).map((other) => `מקור אחד או יותר מציע גם את הישות: ${other}`);
    const reasons = [
      `נמצאו ${sourceCount} דומיינים עצמאיים ו־${evidenceCount} ראיות`,
      fullTextCount > 0 ? `המספר נמצא בטקסט המלא ב־${fullTextCount} מקורות` : "המספר נמצא רק בקטעי תוצאה",
      evidenceTypes.length > 0 ? `סוגי מקורות: ${evidenceTypes.join(", ")}` : "סוג המקור לא זוהה",
      platforms.length > 0 ? `פלטפורמות: ${platforms.join(", ")}` : "לא נמצא קישור חברתי מזוהה",
      items.some((item) => item.contextTerms.length > 0) ? `מילות הקשר: ${Array.from(new Set(items.flatMap((item) => item.contextTerms))).join(", ")}` : "לא נמצאו מילות קשר עסקיות",
    ];
    const explanation = `נמצאו ${sourceCount} מקורות ציבוריים עצמאיים התומכים בקשר אפשרי ל־${label}. ${fullTextCount > 0 ? `המספר הופיע בטקסט מלא ב־${fullTextCount} מהם.` : "הראיות מבוססות בעיקר על קטעי תוצאות."} זו השערה מבוססת ראיות ולא קביעה עובדתית.`;
    return { label, kind: classifyEntity(label), confidence, confidenceScore, sourceCount, evidenceCount, fullTextCount, sourceDomains, evidenceTypes, platforms, socialProfiles, reasons, explanation, contradictions, evidence: items.flatMap((item) => item.evidence) };
  }).sort((left, right) => right.confidenceScore - left.confidenceScore || right.sourceCount - left.sourceCount);

  const analysis = groups.length > 0 && groups[0].confidence !== "insufficient"
    ? `נמצאו ${groups[0].sourceCount} מקורות עצמאיים שתומכים בקשר אפשרי ל־${groups[0].label}. יש להתייחס לכך כהשערה המבוססת על Evidence ציבורי בלבד.`
    : "לא ניתן לקבוע קשר אמין לישות מסוימת על סמך המקורות שנאספו.";
  return { results: enriched, groups, analysis };
}

export function buildPhoneIntelligence(input: string): PhoneIntelligence {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
  const internationalDigits = local.startsWith("0") ? `972${local.slice(1)}` : local;
  const international = `+${internationalDigits}`;
  const dashed = local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : local;
  const spaced = local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3)}` : local;
  return {
    local,
    international,
    country: "ישראל",
    formats: Array.from(new Set([local, international, internationalDigits, dashed, spaced, international.replace("+", "+ ")])),
    likelyLineType: /^05\d/.test(local) ? "mobile" : /^(0[2-9])/.test(local) ? "landline" : "unknown",
  };
}
