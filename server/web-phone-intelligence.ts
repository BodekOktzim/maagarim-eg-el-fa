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
  platforms: SocialPlatform[];
  socialProfiles: SocialProfile[];
  evidence: PublicEvidence[];
  entityLabels: string[];
};

export type EntityGroup = {
  label: string;
  kind: "business" | "person" | "unknown";
  confidence: ConfidenceLevel;
  confidenceScore: number;
  sourceCount: number;
  platforms: SocialPlatform[];
  reasons: string[];
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
    return { platform, url, username, displayName: title || undefined };
  } catch { return null; }
}

function normalizeLabel(value: string) {
  return value.toLocaleLowerCase("he").replace(/[^A-Za-z0-9א-ת]+/g, " ").trim();
}

function cleanCandidate(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[\s|:,-]+|[\s|:,-]+$/g, "").trim();
}

function extractEntityLabels(result: WebPhoneResult) {
  const labels: string[] = [];
  const title = cleanCandidate(result.title);
  if (title.length >= 2 && title.length <= 100 && !GENERIC_TITLES.has(title.toLocaleLowerCase("he")) && !/^\+?[\d\s()./-]+$/.test(title)) labels.push(title);
  const context = result.context || result.snippet;
  for (const pattern of [
    /(?:שם העסק|שם החברה|עסק|חברה|מותג|contact|business|company)\s*[:：-]\s*([^|,.;\n]{2,80})/i,
    /(?:צור קשר|להזמנות|whatsapp|טלפון)\s*[:：-]?\s*([^|.;\n]{2,80})/i,
  ]) {
    const match = pattern.exec(context);
    if (match?.[1]) labels.push(cleanCandidate(match[1]));
  }
  return Array.from(new Set(labels.filter((label) => label.length >= 2 && !/^\d+$/.test(label))));
}

function detectPlatforms(result: WebPhoneResult): SocialPlatform[] {
  const haystack = `${result.url} ${result.title} ${result.snippet}`.toLocaleLowerCase("he");
  return (Object.entries(SOCIAL_HOSTS).filter(([platform, hosts]) => hosts.some((host) => haystack.includes(host)) || haystack.includes(platform === "x" ? "twitter" : platform)).map(([platform]) => platform as SocialPlatform));
}

function classifyEntity(label: string): EntityGroup["kind"] {
  return /(עסק|חברה|חנות|שירות|קליניקה|מסעדה|סטודיו|בע״מ|בעמ|store|shop|business|company|service)/i.test(label) ? "business" : "unknown";
}

export function enrichWebPhoneResults(results: WebPhoneResult[]) {
  const enriched: EnrichedWebPhoneResult[] = results.map((result) => {
    const platforms = detectPlatforms(result);
    const profile = extractSocialProfile(result.url, result.title);
    return {
      ...result,
      domain: domainOf(result.url),
      platforms,
      socialProfiles: profile ? [profile] : [],
      evidence: [{ source: result.source, url: result.url, title: result.title, foundText: result.context || result.snippet, matchedPhone: result.matchedPhone, matchLocation: result.matchLocation, query: result.query }],
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

  const groups: EntityGroup[] = Array.from(buckets.values()).map(({ label, results: items }) => {
    const sourceCount = new Set(items.map((item) => item.url)).size;
    const fullTextCount = items.filter((item) => item.matchLocation === "page-text").length;
    const platforms = Array.from(new Set(items.flatMap((item) => item.platforms)));
    const confidence: ConfidenceLevel = sourceCount >= 3 && fullTextCount >= 2 ? "strong" : sourceCount >= 2 || fullTextCount >= 1 ? "possible" : "insufficient";
    const confidenceScore = Math.min(100, (sourceCount >= 3 ? 45 : sourceCount >= 2 ? 25 : 10) + Math.min(35, fullTextCount * 15) + Math.min(20, platforms.length * 7));
    return {
      label,
      kind: classifyEntity(label),
      confidence,
      confidenceScore,
      sourceCount,
      platforms,
      reasons: [
        `השם מופיע ב־${sourceCount} מקור${sourceCount === 1 ? "" : "ות"}`,
        fullTextCount > 0 ? `המספר נמצא בטקסט המלא ב־${fullTextCount} מקור${fullTextCount === 1 ? "" : "ות"}` : "המספר נמצא רק בקטעי תוצאה של מנוע החיפוש",
        platforms.length > 0 ? `נמצאו פלטפורמות: ${platforms.join(", ")}` : "לא נמצא קישור חברתי מזוהה",
      ],
      evidence: items.flatMap((item) => item.evidence),
    };
  }).sort((left, right) => right.confidenceScore - left.confidenceScore || right.sourceCount - left.sourceCount);

  const analysis = groups.length > 0 && groups[0].confidence !== "insufficient"
    ? `נמצאה ישות אפשרית: ${groups[0].label}. זו אינדיקציה המבוססת על מקורות ציבוריים ואינה הוכחה לזהות.`
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
