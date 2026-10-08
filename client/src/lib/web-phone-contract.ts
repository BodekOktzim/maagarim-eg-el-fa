export type WebSearchEvidence = {
  id: string;
  source: string;
  url: string;
  domain: string;
  independentSource: string;
  title: string;
  foundText: string;
  matchedPhone: string;
  matchLocation: "page-text" | "provider-snippet";
  fullText: boolean;
  query: string;
  keywords: string[];
  relatedPhones: string[];
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
  domain: string;
  matchedPhone: string;
  matchLocation: "page-text" | "provider-snippet";
  relevanceScore: number;
  relevanceLabel: string;
  context: string;
  platforms: string[];
  socialProfiles: { platform: string; url: string; username?: string; displayName?: string }[];
  evidence: WebSearchEvidence[];
  entityLabels: string[];
  relatedPhones: string[];
  contextKeywords: string[];
};

export type WebEntityGroup = {
  label: string;
  kind: "business" | "person" | "unknown";
  confidence: "strong" | "possible" | "insufficient";
  confidenceScore: number;
  sourceCount: number;
  supportingSources: string[];
  platforms: string[];
  socialProfiles: WebSearchResult["socialProfiles"];
  reasons: string[];
  evidenceIds: string[];
  evidence: WebSearchEvidence[];
  contradictions: string[];
};

export type PhoneIntelligence = {
  local: string;
  international: string;
  country: string;
  formats: string[];
  likelyLineType: "mobile" | "landline" | "unknown";
};

type WebPhonePayload = {
  phone?: unknown;
  results?: unknown;
  groups?: unknown;
  analysis?: unknown;
  sourceCount?: unknown;
  route?: unknown;
  incomplete?: unknown;
  limited?: unknown;
  error?: unknown;
};

export type NormalizedWebPhonePayload = {
  phone: PhoneIntelligence | null;
  results: WebSearchResult[];
  groups: WebEntityGroup[];
  analysis: string;
  sourceCount: number;
  route: string;
  incomplete: boolean;
  limited: boolean;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSocialProfiles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).map((profile) => ({
    platform: asString(profile.platform, "unknown"),
    url: asString(profile.url),
    ...(typeof profile.username === "string" ? { username: profile.username } : {}),
    ...(typeof profile.displayName === "string" ? { displayName: profile.displayName } : {}),
  })).filter((profile) => profile.url);
}

function normalizeEvidence(value: unknown): WebSearchEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).map((evidence, index) => ({
    id: asString(evidence.id, `evidence-${index + 1}`),
    source: asString(evidence.source),
    url: asString(evidence.url),
    domain: asString(evidence.domain),
    independentSource: asString(evidence.independentSource),
    title: asString(evidence.title),
    foundText: asString(evidence.foundText),
    matchedPhone: asString(evidence.matchedPhone),
    matchLocation: evidence.matchLocation === "provider-snippet" ? "provider-snippet" : "page-text",
    fullText: asBoolean(evidence.fullText),
    query: asString(evidence.query),
    keywords: asStringArray(evidence.keywords),
    relatedPhones: asStringArray(evidence.relatedPhones),
  }));
}

function normalizeResult(value: unknown): WebSearchResult {
  const result = asRecord(value);
  return {
    title: asString(result.title, "ללא כותרת"),
    url: asString(result.url),
    snippet: asString(result.snippet),
    source: asString(result.source),
    query: asString(result.query),
    domain: asString(result.domain),
    matchedPhone: asString(result.matchedPhone),
    matchLocation: result.matchLocation === "provider-snippet" ? "provider-snippet" : "page-text",
    relevanceScore: asNumber(result.relevanceScore),
    relevanceLabel: asString(result.relevanceLabel),
    context: asString(result.context),
    platforms: asStringArray(result.platforms),
    socialProfiles: normalizeSocialProfiles(result.socialProfiles),
    evidence: normalizeEvidence(result.evidence),
    entityLabels: asStringArray(result.entityLabels),
    relatedPhones: asStringArray(result.relatedPhones),
    contextKeywords: asStringArray(result.contextKeywords),
  };
}

function normalizeGroup(value: unknown): WebEntityGroup {
  const group = asRecord(value);
  const kind = group.kind === "business" || group.kind === "person" ? group.kind : "unknown";
  const confidence = group.confidence === "strong" || group.confidence === "possible" ? group.confidence : "insufficient";
  return {
    label: asString(group.label, "לא מסווג"),
    kind,
    confidence,
    confidenceScore: asNumber(group.confidenceScore),
    sourceCount: asNumber(group.sourceCount),
    supportingSources: asStringArray(group.supportingSources),
    platforms: asStringArray(group.platforms),
    socialProfiles: normalizeSocialProfiles(group.socialProfiles),
    reasons: asStringArray(group.reasons),
    evidenceIds: asStringArray(group.evidenceIds),
    evidence: normalizeEvidence(group.evidence),
    contradictions: asStringArray(group.contradictions),
  };
}

function normalizePhone(value: unknown): PhoneIntelligence | null {
  const phone = asRecord(value);
  if (!Object.keys(phone).length) return null;
  const lineType = phone.likelyLineType === "mobile" || phone.likelyLineType === "landline" ? phone.likelyLineType : "unknown";
  return {
    local: asString(phone.local),
    international: asString(phone.international),
    country: asString(phone.country, "ישראל"),
    formats: asStringArray(phone.formats),
    likelyLineType: lineType,
  };
}

export function normalizeWebPhonePayload(value: unknown): NormalizedWebPhonePayload {
  const payload = asRecord(value) as WebPhonePayload;
  const results = Array.isArray(payload.results) ? payload.results.map(normalizeResult) : [];
  const groups = Array.isArray(payload.groups) ? payload.groups.map(normalizeGroup) : [];
  const sourceCount = asNumber(payload.sourceCount, results.length);
  return {
    phone: normalizePhone(payload.phone),
    results,
    groups,
    analysis: asString(payload.analysis),
    sourceCount,
    route: asString(payload.route, "direct"),
    incomplete: asBoolean(payload.incomplete),
    limited: asBoolean(payload.limited),
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
  };
}
