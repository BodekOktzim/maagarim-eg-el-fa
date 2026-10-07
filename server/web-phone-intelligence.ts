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
};

export type PublicEvidence = {
  id: string;
  source: string;
  url: string;
  domain: string;
  independentSource: string;
  title: string;
  foundText: string;
  matchedPhone: string;
  matchLocation: WebPhoneResult["matchLocation"];
  fullText: boolean;
  query: string;
  keywords: string[];
  relatedPhones: string[];
};

export type EnrichedWebPhoneResult = WebPhoneResult & {
  domain: string;
  platforms: SocialPlatform[];
  socialProfiles: SocialProfile[];
  evidence: PublicEvidence[];
  entityLabels: string[];
  relatedPhones: string[];
  contextKeywords: string[];
};

export type EntityGroup = {
  label: string;
  kind: "business" | "person" | "unknown";
  confidence: ConfidenceLevel;
  confidenceScore: number;
  sourceCount: number;
  supportingSources: string[];
  platforms: SocialPlatform[];
  socialProfiles: SocialProfile[];
  reasons: string[];
  evidenceIds: string[];
  evidence: PublicEvidence[];
  contradictions: string[];
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
const CONTEXT_KEYWORDS: Array<[string, RegExp]> = [
  ["להזמנות", /להזמנות|הזמנה|orders?|booking/i],
  ["צור קשר", /צור קשר|contact us|contact/i],
  ["שירות לקוחות", /שירות לקוחות|customer service/i],
  ["WhatsApp", /whatsapp|וואטסאפ/i],
  ["עסק", /עסק|business|company|חברה|חנות|store|shop/i],
  ["טלפון", /טלפון|phone|telephone|call/i],
];

function domainOf(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, "").toLocaleLowerCase("en"); } catch { return "unknown"; }
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
    return { platform, url, username, displayName: title || undefined };
  } catch { return null; }
}

function normalizeLabel(value: string) {
  return value.toLocaleLowerCase("he").replace(/[^A-Za-z0-9א-ת]+/g, " ").trim();
}

function cleanCandidate(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[\s|:,-]+|[\s|:,-]+$/g, "").trim();
}

function isUsefulLabel(value: string) {
  const normalized = value.toLocaleLowerCase("he");
  return value.length >= 2 && value.length <= 100 && !GENERIC_TITLES.has(normalized) && !/^\+?[\d\s()./-]+$/.test(value);
}

function looksLikePhoneMention(value: string) {
  return /(?:\+?972[\s()./-]*|0)(?:[\s()./-]*\d){7,10}/.test(value);
}

function extractContext(result: WebPhoneResult) {
  return `${result.title} ${result.context || result.snippet}`.replace(/\s+/g, " ").trim();
}

function extractEntityLabels(result: WebPhoneResult) {
  const labels: string[] = [];
  const title = cleanCandidate(result.title);
  if (isUsefulLabel(title)) labels.push(title);
  const context = extractContext(result);
  for (const pattern of [
    /(?:שם העסק|שם החברה|שם המותג|עסק|חברה|מותג|business|company|brand)\s*[:：-]\s*([^|,.;\n]{2,80})/i,
    /(?:צור קשר|להזמנות|שירות לקוחות|whatsapp|טלפון|contact|orders?)\s*[:：-]?\s*([^|.;\n]{2,80})/i,
  ]) {
    const match = pattern.exec(context);
    const candidate = match?.[1] ? cleanCandidate(match[1]) : "";
    if (candidate && !looksLikePhoneMention(candidate)) labels.push(candidate);
  }
  return Array.from(new Set(labels.map(cleanCandidate).filter(isUsefulLabel)));
}

function extractContextKeywords(result: WebPhoneResult) {
  const context = extractContext(result);
  return CONTEXT_KEYWORDS.filter(([, pattern]) => pattern.test(context)).map(([label]) => label);
}

function canonicalPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "";
  return digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
}

function extractRelatedPhones(result: WebPhoneResult) {
  const context = extractContext(result);
  const phones = context.match(/(?:\+?972[\s()./-]*|0)(?:[\s()./-]*\d){7,10}/g) ?? [];
  return Array.from(new Set(phones.map(canonicalPhone).filter(Boolean))).filter((phone) => phone !== canonicalPhone(result.matchedPhone));
}

function detectPlatforms(result: WebPhoneResult): SocialPlatform[] {
  const haystack = `${result.url} ${result.title} ${result.snippet} ${result.context || ""}`.toLocaleLowerCase("he");
  return Object.entries(SOCIAL_HOSTS).filter(([platform, hosts]) => hosts.some((host) => haystack.includes(host)) || haystack.includes(platform === "x" ? "twitter" : platform)).map(([platform]) => platform as SocialPlatform);
}

function classifyEntity(label: string, keywords: string[]): EntityGroup["kind"] {
  if (/(עסק|חברה|חנות|שירות|קליניקה|מסעדה|סטודיו|בע״מ|בעמ|store|shop|business|company|service)/i.test(`${label} ${keywords.join(" ")}`)) return "business";
  return "unknown";
}

function tokenOverlap(left: string, right: string) {
  const a = new Set(normalizeLabel(left).split(" ").filter(Boolean));
  const b = new Set(normalizeLabel(right).split(" ").filter(Boolean));
  return Array.from(a).filter((token) => b.has(token)).length;
}

function evidenceId(result: WebPhoneResult, index: number) {
  const stable = `${domainOf(result.url)}-${normalizeLabel(result.title).replace(/ /g, "-") || "page"}`.slice(0, 90);
  return `evidence-${index + 1}-${stable}`;
}

export function enrichWebPhoneResults(results: WebPhoneResult[]) {
  const enriched: EnrichedWebPhoneResult[] = results.map((result, index) => {
    const platforms = detectPlatforms(result);
    const profile = extractSocialProfile(result.url, result.title);
    const domain = domainOf(result.url);
    const foundText = result.context || result.snippet;
    const keywords = extractContextKeywords(result);
    const relatedPhones = extractRelatedPhones(result);
    return {
      ...result,
      domain,
      platforms,
      socialProfiles: profile ? [profile] : [],
      relatedPhones,
      contextKeywords: keywords,
      evidence: [{ id: evidenceId(result, index), source: result.source, url: result.url, domain, independentSource: domain, title: result.title, foundText, matchedPhone: result.matchedPhone, matchLocation: result.matchLocation, fullText: result.matchLocation === "page-text", query: result.query, keywords, relatedPhones }],
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
    const evidence = items.flatMap((item) => item.evidence);
    const supportingSources = Array.from(new Set(evidence.map((item) => item.independentSource).filter((source) => source !== "unknown")));
    const sourceCount = supportingSources.length;
    const fullTextCount = evidence.filter((item) => item.fullText).length;
    const platforms = Array.from(new Set(items.flatMap((item) => item.platforms)));
    const socialProfiles = Array.from(new Map(items.flatMap((item) => item.socialProfiles).map((profile) => [profile.url, profile])).values());
    const keywords = Array.from(new Set(evidence.flatMap((item) => item.keywords)));
    const contradictions = allLabels.filter((other) => other !== label && tokenOverlap(label, other) === 0 && (buckets.get(normalizeLabel(other))?.results.length ?? 0) > 0);
    const relevance = evidence.length ? Math.round(evidence.reduce((sum, item) => sum + (items.find((candidate) => candidate.url === item.url)?.relevanceScore ?? 0), 0) / evidence.length) : 0;
    const score = Math.max(0, Math.min(100,
      Math.min(40, sourceCount * 20) +
      Math.min(25, fullTextCount * 12) +
      Math.min(15, Math.round(relevance / 7)) +
      Math.min(10, platforms.length * 5) +
      Math.min(10, keywords.length * 2) -
      Math.min(25, contradictions.length * 12),
    ));
    const confidence: ConfidenceLevel = score >= 70 && sourceCount >= 3 ? "strong" : score >= 40 ? "possible" : "insufficient";
    const reasons = [
      `המספר אומת ב־${sourceCount} מקור${sourceCount === 1 ? "" : "ות"} עצמאיים לפי דומיין`,
      fullTextCount > 0 ? `המספר נמצא בטקסט מלא ב־${fullTextCount} מקור${fullTextCount === 1 ? "" : "ות"}` : "המספר נמצא רק בקטעי תוצאה של מנוע החיפוש",
      keywords.length > 0 ? `מילות הקשר שנמצאו: ${keywords.join(", ")}` : "לא נמצאו מילות הקשר עסקיות מובהקות",
      platforms.length > 0 ? `נמצאו פרופילים: ${platforms.join(", ")}` : "לא נמצא פרופיל חברתי מזוהה",
      contradictions.length > 0 ? `נמצאו גם תוויות סותרות: ${contradictions.slice(0, 3).join(", ")}` : "לא נמצאה סתירה בין התוויות שנאספו",
    ];
    return {
      label,
      kind: classifyEntity(label, keywords),
      confidence,
      confidenceScore: score,
      sourceCount,
      supportingSources,
      platforms,
      socialProfiles,
      reasons,
      evidenceIds: evidence.map((item) => item.id),
      evidence,
      contradictions,
    };
  }).sort((left, right) => right.confidenceScore - left.confidenceScore || right.sourceCount - left.sourceCount || left.label.localeCompare(right.label));

  const top = groups[0];
  const analysis = top && top.confidence !== "insufficient"
    ? `נמצאה ישות אפשרית «${top.label}» עם ציון ${top.confidenceScore}/100, על בסיס ${top.sourceCount} מקור${top.sourceCount === 1 ? "" : "ות"} עצמאיים${top.contradictions.length ? `; קיימות ${top.contradictions.length} סתירות שיש לבדוק` : ""}. זו אינדיקציה מבוססת Evidence ציבורי בלבד ואינה הוכחה לזהות.`
    : "לא ניתן לקבוע קשר אמין לישות מסוימת על סמך ה־Evidence שנאסף. אין להסיק מסקנה מעבר למידע המוצג.";
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
