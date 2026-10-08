import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Download, Info, KeyRound, LoaderCircle, LockKeyhole, LogOut, MapPin, Network, Search, UsersRound } from "lucide-react";
import FamilyTree from "@/components/FamilyTree";
import PwaControls from "@/components/PwaControls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildSearchResultRows, buildSearchResultsCsv, createSearchExportBlob, SEARCH_EXPORT_FORMATS, type SearchExportFormat } from "@/lib/search-export";
import {
  searchFamilyTreeById,
  searchFullDatasetsByFacebookId,
  searchFullDatasetsByIdWithDetails,
  searchFullDatasetsByPhone,
  searchFullDatasetsByText,
  type SourceFilter,
  type FamilyTreeData,
  type SearchHit,
  type TextMatchMode,
} from "@/lib/full-dataset-search";
import { normalizeWebPhonePayload, type PhoneIntelligence, type WebEntityGroup, type WebSearchResult } from "@/lib/web-phone-contract";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "https://maagarim-web-search-api.onrender.com").replace(/\/$/, "");
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";
const normalizeId = (value: string) => value.replace(/\D/g, "");
const SOURCE_OPTIONS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "agron2006", label: "אגרון" },
  { id: "elector", label: "אלקטור" },
  { id: "facebook", label: "Facebook" },
];

function formatSearchDuration(milliseconds: number) {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} מ״ש` : `${(milliseconds / 1000).toFixed(2)} שנ׳`;
}

function facebookProfileUrl(facebookId: string) {
  return `https://www.facebook.com/profile.php?id=${encodeURIComponent(facebookId)}`;
}

type SearchDetailGroup = { title: string; rows: [string, string][] };

function searchHitDetailGroups(hit: SearchHit): SearchDetailGroup[] {
  const personalRows: [string, string][] = [
    hit.nationalId ? ["תעודת זהות", hit.nationalId] : undefined,
    hit.facebookId ? ["מזהה Facebook", hit.facebookId] : undefined,
    hit.birthDate ? ["תאריך לידה", hit.birthDate] : undefined,
    hit.age ? ["גיל", hit.age] : undefined,
    hit.maritalStatus ? ["מצב אישי", hit.maritalStatus] : undefined,
  ].filter((row): row is [string, string] => Boolean(row?.[1]));
  const contactRows: [string, string][] = [
    hit.phone ? [`טלפון ${hit.phoneYear ? `(${hit.phoneYear})` : ""}`.trim(), hit.phone] : undefined,
    hit.address ? [hit.addressYear === "2020" ? "כתובת מעודכנת (2020)" : hit.addressYear ? `כתובת (${hit.addressYear})` : "כתובת", hit.address] : undefined,
    hit.previousAddress ? [`כתובת ישנה (${hit.previousAddressYear ?? "2006"})`, hit.previousAddress] : undefined,
    hit.city ? ["יישוב", hit.city] : undefined,
    hit.cityCode ? ["קוד יישוב", hit.cityCode] : undefined,
  ].filter((row): row is [string, string] => Boolean(row?.[1]));
  return [
    { title: "פרטים אישיים", rows: personalRows },
    { title: "טלפון, כתובות ויישוב", rows: contactRows },
  ].filter((group) => group.rows.length > 0);
}

function WebIntelligencePanel({ groups }: { groups: WebEntityGroup[] }) {
  if (!groups.length) return null;
  const confidenceLabel = (confidence: WebEntityGroup["confidence"]) => confidence === "strong" ? "Strong · התאמה חזקה" : confidence === "possible" ? "Possible · התאמה אפשרית" : "Insufficient · מידע לא מספיק";
  const kindLabel = (kind: WebEntityGroup["kind"]) => kind === "business" ? "עסק" : kind === "person" ? "אדם" : "לא מסווג";
  return <section className="space-y-3 rounded-xl border border-fuchsia-200/15 bg-fuchsia-200/[0.035] p-3" aria-label="ניתוח חכם">
    <div><h3 className="text-sm font-semibold text-fuchsia-100">🔎 ניתוח חכם</h3><p className="mt-1 text-xs text-white/50">קיבוץ דטרמיניסטי של Evidence ציבורי בלבד; אין כאן מסקנה אוטומטית מעבר למידע שנאסף.</p></div>
    {groups.slice(0, 8).map((group) => <article key={`smart-${group.label}`} className="rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold text-white/90">{group.label}</h4><p className="mt-1 text-[11px] text-white/45">{kindLabel(group.kind)} · {group.sourceCount} מקורות עצמאיים · {group.confidenceScore}/100</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${group.confidence === "strong" ? "bg-emerald-200/15 text-emerald-100" : group.confidence === "possible" ? "bg-amber-200/15 text-amber-100" : "bg-white/10 text-white/60"}`}>{confidenceLabel(group.confidence)}</span></div>
      <div className="mt-2 grid gap-2 text-xs text-white/65 sm:grid-cols-2"><div><p className="text-white/40">למה קובץ</p><ul className="mt-1 list-disc space-y-1 ps-4">{group.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div><div><p className="text-white/40">מקורות ופרופילים</p><p className="mt-1 break-words">{group.supportingSources.join(" · ") || "אין מקור עצמאי מזוהה"}</p>{group.socialProfiles.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{group.socialProfiles.map((profile) => <a key={profile.url} href={profile.url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-cyan-200/15 px-2 py-1 text-cyan-100 hover:bg-cyan-200/10">{profile.platform}{profile.username ? ` · @${profile.username}` : ""}</a>)}</div>}</div></div>
      {group.contradictions.length > 0 && <div className="mt-2 rounded-lg border border-rose-200/20 bg-rose-300/[0.06] p-2 text-xs text-rose-100"><strong>סתירות:</strong> {group.contradictions.join(" · ")}</div>}
      <details className="mt-2 text-xs text-white/55"><summary className="cursor-pointer text-fuchsia-100/80">Evidence ({group.evidenceIds.length})</summary><div className="mt-2 space-y-2">{group.evidence.map((evidence) => <div key={evidence.id} className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-2"><p className="break-all text-white/65">{evidence.domain} · {evidence.fullText ? "טקסט מלא" : "Snippet"}</p><p className="mt-1 leading-5">{evidence.foundText}</p><a href={evidence.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-cyan-200 underline decoration-dotted">{evidence.url}</a></div>)}</div></details>
    </article>)}
  </section>;
}

function TextMatchModeSelector({ mode, onChange }: { mode: TextMatchMode; onChange: (mode: TextMatchMode) => void }) {
  return <section className="rounded-2xl border border-white/10 bg-black/10 p-3" aria-label="מצב התאמת שם ומיקום">
    <p className="mb-2 text-xs font-semibold text-white/75">התאמת שם ומיקום</p>
    <div className="grid max-w-[360px] grid-cols-2 gap-3">
      {(["exact", "similar"] as const).map((option) => <div key={option} className="flex flex-col items-stretch gap-1.5">
        <Popover>
          <PopoverTrigger asChild><button type="button" className="inline-flex min-h-8 items-center justify-center gap-1 text-xs text-white/60 underline decoration-dotted underline-offset-4 hover:text-white"><Info size={13}/>הסבר</button></PopoverTrigger>
          <PopoverContent dir="rtl" side="top" className="w-64 max-w-[calc(100vw-2rem)] border-white/15 bg-[#211528] text-right text-xs leading-relaxed text-white/85">
            {option === "exact" ? <><p className="font-semibold text-fuchsia-100">חיפוש מדויק</p><p className="mt-1">מחפש לפי האותיות שהקלדת. למשל „כהו” לא יחזיר „כהן”.</p></> : <><p className="font-semibold text-fuchsia-100">חיפוש דומה</p><p className="mt-1">מחפש גם עם טעות של אות אחת בשם או במקום. למשל „כהו” עשוי למצוא „כהן”; ייתכנו יותר תוצאות.</p></>}
          </PopoverContent>
        </Popover>
        <button type="button" aria-pressed={mode === option} onClick={() => onChange(option)} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${mode === option ? "border-[#f2a9d2]/60 bg-[#f2a9d2] text-[#30123e]" : "border-white/15 bg-white/[0.035] text-white/75 hover:bg-white/10"}`}>{option === "exact" ? "מדויק" : "דומה"}</button>
      </div>)}
    </div>
  </section>;
}

export default function GitHubPagesHome() {
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const unlocked = sessionStartedAt !== null;
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(TURNSTILE_SITE_KEY);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const captchaContainerRef = useRef<HTMLDivElement>(null);
  const captchaWidgetIdRef = useRef<string | number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [location, setLocation] = useState("");
  const [age, setAge] = useState("");
  const [nationalIdQuery, setNationalIdQuery] = useState("");
  const [facebookPhone, setFacebookPhone] = useState("");
  const [facebookFirstName, setFacebookFirstName] = useState("");
  const [facebookLastName, setFacebookLastName] = useState("");
  const [facebookIdQuery, setFacebookIdQuery] = useState("");
  const [facebookMode, setFacebookMode] = useState<"phone" | "name" | "facebook-id">("phone");
  const [internetSearchEnabled, setInternetSearchEnabled] = useState(false);
  const [textMatchMode, setTextMatchMode] = useState<TextMatchMode>("exact");
  const [webPhoneQuery, setWebPhoneQuery] = useState("");
  const [webSearchResults, setWebSearchResults] = useState<WebSearchResult[]>([]);
  const [webPhoneIntelligence, setWebPhoneIntelligence] = useState<PhoneIntelligence | null>(null);
  const [webSearchGroups, setWebSearchGroups] = useState<WebEntityGroup[]>([]);
  const [webSearchAnalysis, setWebSearchAnalysis] = useState("");
  const [webSearchSourceCount, setWebSearchSourceCount] = useState(0);
  const [webSearchRoute, setWebSearchRoute] = useState("");
  const [isWebSearching, setIsWebSearching] = useState(false);
  const [webSearchError, setWebSearchError] = useState("");
  const [webSearchCompleted, setWebSearchCompleted] = useState(false);
  const [webSearchIncomplete, setWebSearchIncomplete] = useState(false);
  const [webSearchLimited, setWebSearchLimited] = useState(false);
  const [webSearchDurationMs, setWebSearchDurationMs] = useState<number | null>(null);
  const webSearchStartedAtRef = useRef<number | null>(null);
  const webResumeInFlightRef = useRef(false);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);
  const [exportFormat, setExportFormat] = useState<SearchExportFormat>("csv");
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFamilyId, setExportingFamilyId] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [familyData, setFamilyData] = useState<FamilyTreeData | null>(null);
  const [familyCentralId, setFamilyCentralId] = useState("");
  const [isLoadingFamily, setIsLoadingFamily] = useState(false);
  const [familyError, setFamilyError] = useState("");
  const [familyDurationMs, setFamilyDurationMs] = useState<number | null>(null);
  const activeSearchRef = useRef<{ description: string; search: () => Promise<SearchHit[]>; startedAt: number } | null>(null);
  const searchRunRef = useRef(0);
  const resumeInFlightRef = useRef(false);

  useEffect(() => {
    if (turnstileSiteKey) return;
    void fetch(`${API_BASE}/api/public-config`, { credentials: "omit" }).then(async (response) => {
      if (!response.ok) return;
      const config = await response.json() as { turnstileSiteKey?: string };
      if (config.turnstileSiteKey) setTurnstileSiteKey(config.turnstileSiteKey);
    }).catch(() => setCaptchaError("לא ניתן להתחבר לשירות האימות. נסה לרענן את הדף."));
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (unlocked || !turnstileSiteKey || !captchaContainerRef.current) return;
    let disposed = false;
    let timer: number | undefined;
    const render = () => {
      const turnstile = (window as Window & { turnstile?: { render: (element: HTMLElement, options: Record<string, unknown>) => string | number } }).turnstile;
      if (disposed || !turnstile || !captchaContainerRef.current || captchaWidgetIdRef.current !== null) return Boolean(turnstile);
      captchaWidgetIdRef.current = turnstile.render(captchaContainerRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => { setCaptchaToken(token); setCaptchaError(""); },
        "expired-callback": () => { setCaptchaToken(""); setCaptchaError("האימות פג. יש לבצע אותו שוב."); },
        "error-callback": () => { setCaptchaToken(""); setCaptchaError("Turnstile לא נטען. נסה לרענן או לבטל חוסם פרסומות."); },
      });
      return true;
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.onerror = () => setCaptchaError("לא ניתן לטעון את האימות האנושי. בדוק חוסם פרסומות.");
      document.head.appendChild(script);
    }
    timer = window.setInterval(() => { if (render() && timer) window.clearInterval(timer); }, 250);
    render();
    return () => { disposed = true; if (timer) window.clearInterval(timer); captchaWidgetIdRef.current = null; };
  }, [unlocked, turnstileSiteKey]);

  useEffect(() => {
    void fetch(`${API_BASE}/api/access/me`, { credentials: "include" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { authenticated?: boolean; expiresAt?: string | null };
      if (payload.authenticated) {
        setSessionStartedAt(Date.now());
        setSessionExpiresAt(payload.expiresAt ? Date.parse(payload.expiresAt) : null);
      }
    }).catch(() => undefined);
  }, []);

  const clearTree = () => { setFamilyData(null); setFamilyCentralId(""); setFamilyError(""); setFamilyDurationMs(null); };
  const exportSearchResults = async () => {
    if (!results.length || isExporting) return;
    setIsExporting(true);
    setExportError("");
    try {
      const rows = buildSearchResultRows(results);
      const blob = await createSearchExportBlob(rows, exportFormat);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "_").slice(0, 15);
      const extension = SEARCH_EXPORT_FORMATS.find((format) => format.id === exportFormat)!.extension;
      link.href = url;
      link.download = `osint-search-results_${timestamp}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("הייצוא נכשל. נסה פורמט אחר או נסה שוב.");
    } finally {
      setIsExporting(false);
    }
  };
  const exportPersonWithFamily = async (hit: SearchHit) => {
    const centralId = normalizeId(hit.nationalId);
    if (centralId.length < 5 || centralId.length > 9 || exportingFamilyId) return;
    setExportingFamilyId(centralId);
    setExportError("");
    try {
      const family = await searchFamilyTreeById(centralId);
      const person = { id: centralId, fullName: hit.fullName, nationalId: hit.nationalId, phone: hit.phone, address: hit.address, city: hit.city, birthDate: hit.birthDate, sourceNames: hit.sourceNames ?? [hit.source] };
      const csv = buildSearchResultsCsv([person], family.people, family.relationships, centralId);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `osint-person-family_${centralId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "הורדת האדם ועץ המשפחה נכשלה.");
    } finally {
      setExportingFamilyId(null);
    }
  };
  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    if (!password) { setPasswordError("יש להזין סיסמה."); return; }
    if (turnstileSiteKey && !captchaToken) { setPasswordError("יש להשלים את האימות האנושי לפני הכניסה."); return; }
      try {
      const response = await fetch(`${API_BASE}/api/access/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ password, ...(captchaToken ? { captchaToken } : {}) }) });
      const payload = await response.json() as { expiresAt?: string | null; error?: string };
      if (!response.ok) {
        setCaptchaToken("");
        throw new Error(payload.error || "הכניסה נכשלה.");
      }
      const startedAt = Date.now();
      setPassword(""); setCaptchaToken(""); setSessionStartedAt(startedAt); setSessionExpiresAt(payload.expiresAt ? Date.parse(payload.expiresAt) : null);
    } catch (error) { setPasswordError(error instanceof Error ? error.message : "הכניסה נכשלה."); }
  };

  const lock = () => {
    void fetch(`${API_BASE}/api/access/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setSessionStartedAt(null);
    setSessionExpiresAt(null);
    setResults([]);
    setSearched(false);
    setLastQuery("");
    clearTree();
  };

  useEffect(() => {
    if (sessionStartedAt === null) return;
    if (sessionExpiresAt === null) return;
    const timeout = window.setTimeout(lock, Math.max(0, sessionExpiresAt - Date.now()));
    return () => {
      window.clearTimeout(timeout);
    };
  }, [sessionStartedAt, sessionExpiresAt]);

  const selectSource = (next: SourceFilter) => {
    setSourceFilter(next);
    setFirstName("");
    setLastName("");
    setLocation("");
    setAge("");
    setNationalIdQuery("");
    setFacebookPhone("");
    setFacebookFirstName("");
    setFacebookLastName("");
    setFacebookIdQuery("");
    setFacebookMode("phone");
    setResults([]);
    setSearchError("");
    setSearched(false);
    clearTree();
  };

  const executeSearch = async (description: string, search: () => Promise<SearchHit[]>, force = false) => {
    if (isSearching && !force) return;
    const runId = ++searchRunRef.current;
    activeSearchRef.current = { description, search, startedAt: Date.now() };
    sessionStorage.setItem("maagarim-pending-search", JSON.stringify({ description, startedAt: Date.now() }));
    setSearchError("");
    setResults([]);
    setSearched(true);
    clearTree();
    setIsSearching(true);
    setSearchDurationMs(null);
    const startedAt = performance.now();
    const sourceLabel = SOURCE_OPTIONS.find((option) => option.id === sourceFilter)?.label ?? "הכול";
    try {
      setLastQuery(`${sourceLabel} · ${description}`);
      const nextResults = await search();
      if (runId === searchRunRef.current) setResults(nextResults);
    } catch (error) {
      if (runId === searchRunRef.current) setSearchError(error instanceof Error ? error.message : "החיפוש נכשל. בדוק חיבור לאינטרנט ונסה שוב.");
    } finally {
      if (runId === searchRunRef.current) {
        setSearchDurationMs(performance.now() - startedAt);
        setIsSearching(false);
        activeSearchRef.current = null;
        sessionStorage.removeItem("maagarim-pending-search");
      }
    }
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || resumeInFlightRef.current) return;
      const pending = activeSearchRef.current;
      if (!pending || !isSearching || Date.now() - pending.startedAt < 3000) return;
      resumeInFlightRef.current = true;
      void executeSearch(pending.description, pending.search, true).finally(() => { resumeInFlightRef.current = false; });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isSearching]);

  const rejectSearch = (message: string) => {
    setSearchError(message);
    setResults([]);
    setSearched(false);
    setSearchDurationMs(null);
    clearTree();
  };

  const runDetailSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (isSearching) return;
    if (sourceFilter === "facebook") {
      if (facebookMode === "phone") {
        if (!facebookPhone.trim()) { rejectSearch("יש להזין מספר טלפון."); return; }
        const phone = facebookPhone.trim();
        await executeSearch(`טלפון ${phone}`, () => searchFullDatasetsByPhone(phone, "facebook"));
        if (internetSearchEnabled) { setWebPhoneQuery(phone); await performInternetPhoneSearch(phone); }
        return;
      }
      if (facebookMode === "facebook-id") {
        if (!facebookIdQuery.trim()) { rejectSearch("יש להזין מזהה Facebook."); return; }
        await executeSearch(`מזהה Facebook ${facebookIdQuery.trim()}`, () => searchFullDatasetsByFacebookId(facebookIdQuery.trim(), "facebook"));
        return;
      }
      const first = facebookFirstName.trim();
      const last = facebookLastName.trim();
      if (!first || !last) { rejectSearch("בחיפוש לפי שם ב־Facebook יש למלא גם שם פרטי וגם שם משפחה."); return; }
      await executeSearch(`${first} ${last} · ${textMatchMode === "exact" ? "מדויק" : "דומה"}`, () => searchFullDatasetsByText({ firstName: first, lastName: last }, textMatchMode, "facebook"));
      return;
    }

    const first = firstName.trim();
    const last = lastName.trim();
    const place = location.trim();
    const years = age.trim();
    if (!first && !last) { rejectSearch("כדי לחפש לפי פרטים יש להזין לפחות שם פרטי או שם משפחה."); return; }
    const criteria = {
      firstName: first || undefined,
      lastName: last || undefined,
      location: place || undefined,
      age: years || undefined,
    };
    const description = [first, last, place, years ? `גיל ${years}` : ""].filter(Boolean).join(" · ");
    await executeSearch(`${description} · ${textMatchMode === "exact" ? "מדויק" : "דומה"}`, () => searchFullDatasetsByText(criteria, textMatchMode, sourceFilter));
  };

  const runNationalIdSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const id = nationalIdQuery.trim();
    if (!id) { rejectSearch("יש להזין מספר תעודת זהות."); return; }
    if (sourceFilter === "facebook") { rejectSearch("חיפוש תעודת זהות זמין ב׳הכול׳, אגרון ואלקטור בלבד."); return; }
    await executeSearch(`תעודת זהות ${id}`, () => searchFullDatasetsByIdWithDetails(id, sourceFilter));
  };

  const performInternetPhoneSearch = async (query = webPhoneQuery) => {
    setWebSearchError("");
    if (query.replace(/\D/g, "").length < 7) { setWebSearchResults([]); setWebSearchCompleted(false); setWebSearchError("יש להזין מספר טלפון בן 7 ספרות לפחות."); return; }
    const startedAt = performance.now();
    setWebSearchDurationMs(null);
    webSearchStartedAtRef.current = Date.now();
    sessionStorage.setItem("maagarim-pending-web-phone-search", query);
    setIsWebSearching(true); setWebSearchResults([]); setWebPhoneIntelligence(null); setWebSearchGroups([]); setWebSearchAnalysis(""); setWebSearchSourceCount(0); setWebSearchRoute(""); setWebSearchCompleted(false); setWebSearchIncomplete(false); setWebSearchLimited(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
      if (!base && window.location.hostname.endsWith("github.io")) throw new Error("חיפוש אינטרנטי פנימי דורש חיבור Backend. יש להגדיר VITE_API_BASE_URL לכתובת שרת החיפוש.");
      const response = await fetch(`${base}/api/web-phone-search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: query }), signal: controller.signal });
      const contentType = response.headers.get("content-type") ?? "";
      const rawPayload: unknown = contentType.includes("application/json") ? await response.json() : { error: "שרת החיפוש החזיר דף HTML במקום תשובת API. יש לבדוק את VITE_API_BASE_URL." };
      const payload = normalizeWebPhonePayload(rawPayload);
      if (!response.ok) throw new Error(payload.error || "חיפוש האינטרנט נכשל.");
      setWebSearchResults(payload.results); setWebPhoneIntelligence(payload.phone); setWebSearchGroups(payload.groups); setWebSearchAnalysis(payload.analysis); setWebSearchSourceCount(payload.sourceCount); setWebSearchRoute(payload.route); setWebSearchIncomplete(payload.incomplete); setWebSearchLimited(payload.limited); setWebSearchCompleted(true);
    } catch (error) {
      setWebSearchError(error instanceof DOMException && error.name === "AbortError"
        ? "שרת החיפוש לא הגיב בתוך 35 שניות. ייתכן ששירות Render עדיין מתעורר או שהחיפוש דרך הספק אינו זמין. נסה שוב בעוד רגע."
        : error instanceof Error ? error.message : "חיפוש האינטרנט נכשל.");
    } finally { window.clearTimeout(timeout); setWebSearchDurationMs(performance.now() - startedAt); setIsWebSearching(false); webSearchStartedAtRef.current = null; sessionStorage.removeItem("maagarim-pending-web-phone-search"); }
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !isWebSearching || webResumeInFlightRef.current) return;
      if (!webSearchStartedAtRef.current || Date.now() - webSearchStartedAtRef.current < 3000) return;
      webResumeInFlightRef.current = true;
      void performInternetPhoneSearch().finally(() => { webResumeInFlightRef.current = false; });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isWebSearching, webPhoneQuery]);

  const openFamily = async (hit: SearchHit) => {
    const digits = normalizeId(hit.nationalId);
    if (digits.length < 5 || digits.length > 9) {
      setFamilyError("לא ניתן לפתוח עץ: ברשומה שנבחרה אין מספר מזהה תקין.");
      return;
    }
    setFamilyError("");
    setFamilyCentralId(digits);
    setFamilyData(null);
    setIsLoadingFamily(true);
    setFamilyDurationMs(null);
    const startedAt = performance.now();
    try {
      setFamilyData(await searchFamilyTreeById(digits));
      window.setTimeout(() => document.getElementById("family-tree")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (error) {
      setFamilyError(error instanceof Error ? error.message : "לא ניתן לטעון את נתוני המשפחה.");
    } finally {
      setFamilyDurationMs(performance.now() - startedAt);
      setIsLoadingFamily(false);
    }
  };

  const changeFamilyCenter = async (id: string) => {
    const digits = normalizeId(id);
    if (digits.length < 5 || digits.length > 9 || digits === familyCentralId) return;
    setFamilyCentralId(digits);
    setFamilyData(null);
    setFamilyError("");
    setIsLoadingFamily(true);
    setFamilyDurationMs(null);
    const startedAt = performance.now();
    try { setFamilyData(await searchFamilyTreeById(digits)); }
    catch (error) { setFamilyError(error instanceof Error ? error.message : "לא ניתן לטעון את נתוני המשפחה."); }
    finally { setFamilyDurationMs(performance.now() - startedAt); setIsLoadingFamily(false); }
  };

  if (!unlocked) {
    return <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[#100b17] px-4 py-10 text-slate-100">
      <main className="w-full max-w-xl space-y-5">
          <div className="fixed left-4 top-4 z-40"><PwaControls/></div>
          <div className="rounded-[28px] border border-fuchsia-200/15 bg-[#20102b] p-6 shadow-[0_24px_80px_rgba(46,24,61,0.35)] sm:p-9">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-300/15 text-fuchsia-200"><LockKeyhole size={26}/></div>
          <h1 className="mt-5 text-center"><span className="bg-gradient-to-r from-fuchsia-200 via-white to-violet-200 bg-clip-text font-serif text-3xl font-bold tracking-[0.12em] text-transparent sm:text-4xl">OSINT Search</span></h1>
          <form onSubmit={unlock} className="mt-7 space-y-3">
            <label htmlFor="site-password" className="sr-only">סיסמה</label>
            <input id="site-password" autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="סיסמה" className="h-14 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/>
            {turnstileSiteKey && <div className="rounded-xl border border-white/10 bg-black/15 p-3"><p className="mb-2 text-sm text-white/80">אימות אנושי — יש להשלים לפני הכניסה</p><div ref={captchaContainerRef} className="min-h-[65px]" aria-label="אימות אנושי" />{!captchaError && !captchaToken && <p className="text-xs text-white/55">טוען את אפשרות האימות…</p>}{captchaError && <p role="alert" className="text-xs text-rose-200">{captchaError}</p>}</div>}
            {passwordError && <p role="alert" className="text-sm text-rose-200">{passwordError}</p>}
            <button type="submit" className="h-12 w-full rounded-xl bg-[#f2a9d2] px-5 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0]"><KeyRound size={17} className="ml-2 inline"/>כניסה</button>
          </form>
          <a href={`${import.meta.env.BASE_URL}admin`} className="block text-center text-sm text-fuchsia-100/75 underline decoration-dotted underline-offset-4 hover:text-fuchsia-100">כניסה לפאנל המנהל</a>
        </div>
      </main>
    </div>;
  }

  return <div dir="rtl" className="min-h-screen bg-[#100b17] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#100b17]/90 backdrop-blur-xl">
      <div className="mx-auto flex flex-wrap max-w-[1500px] items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-300/15 p-2.5 text-fuchsia-200"><Network size={22}/></div><p className="bg-gradient-to-r from-fuchsia-200 to-violet-200 bg-clip-text font-serif text-lg font-bold tracking-[0.1em] text-transparent">OSINT Search</p></div>
        <div className="flex items-center gap-2"><PwaControls/><a href={`${import.meta.env.BASE_URL}admin`} className="inline-flex items-center rounded-xl border border-fuchsia-200/20 px-3 py-2 text-xs text-fuchsia-100/80 hover:bg-fuchsia-200/10">פאנל מנהל</a><button type="button" onClick={lock} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10"><LogOut size={15}/>נעילה</button></div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-7 sm:py-9">
      <section className="search-hero overflow-hidden rounded-[28px] border border-fuchsia-200/10 bg-[#20102b] px-5 py-6 shadow-[0_24px_80px_rgba(46,24,61,0.3)] sm:px-9 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">חיפוש בשלושת מקורות הנתונים</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">חיפוש אדם</h1></div><div className="hidden rounded-2xl border border-fuchsia-100/10 bg-black/10 px-4 py-3 text-xs text-white/45 sm:block"><UsersRound size={15} className="ml-2 inline text-fuchsia-200"/>19.6 מיליון רשומות במקורות</div></div>

        <div className="mt-5 space-y-4" aria-label="חיפוש לפי מקור">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3" aria-label="בחירת מקור החיפוש">
            <p className="mb-2 text-xs font-semibold text-white/60">בחר מקור לחיפוש</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {SOURCE_OPTIONS.map(({ id, label }) => <button key={id} type="button" aria-pressed={sourceFilter === id} onClick={() => selectSource(id)} className={`min-h-10 rounded-xl border px-4 text-sm font-semibold transition ${sourceFilter === id ? "border-cyan-200/50 bg-cyan-200/15 text-cyan-100" : "border-white/10 bg-white/[0.035] text-white/65 hover:bg-white/10"}`}>{label}</button>)}
            </div>
          </div>

          {sourceFilter !== "facebook" ? <>
            <form onSubmit={runDetailSearch} className="space-y-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5" aria-label="חיפוש לפי פרטים">
              <div><h2 className="text-base font-semibold">חיפוש לפי פרטים</h2><p className="mt-1 text-xs leading-relaxed text-white/50">יש למלא שם פרטי או שם משפחה לפחות. שאר השדות לבחירתך.{sourceFilter === "elector" ? " חיפוש גיל אינו זמין באלקטור." : ""}</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm text-white/75" htmlFor="search-first-name"><span>שם פרטי</span><input id="search-first-name" autoComplete="off" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="לדוגמה: דוד" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label>
                <label className="block space-y-1.5 text-sm text-white/75" htmlFor="search-last-name"><span>שם משפחה</span><input id="search-last-name" autoComplete="off" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="לדוגמה: כהן" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label>
                <label className="block space-y-1.5 text-sm text-white/75 sm:col-span-2" htmlFor="search-location"><span>עיר, שכונה, רחוב או כתובת</span><input id="search-location" autoComplete="off" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="מיקום או חלק מהכתובת" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label>
                {(sourceFilter === "all" || sourceFilter === "agron2006") && <label className="block space-y-1.5 text-sm text-white/75" htmlFor="search-age"><span>גיל או טווח גילאים</span><input id="search-age" inputMode="numeric" autoComplete="off" value={age} onChange={(event) => setAge(event.target.value)} placeholder="למשל: 30 או 30-40" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label>}
              </div>
              <div className="flex flex-col gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-end sm:justify-between">
                <TextMatchModeSelector mode={textMatchMode} onChange={setTextMatchMode}/>
                <button type="submit" disabled={isSearching} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2"/>חפש פרטים</>}</button>
              </div>
            </form>

            <form onSubmit={runNationalIdSearch} className="space-y-3 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.04] p-4 sm:p-5" aria-label="חיפוש נפרד לפי תעודת זהות">
              <div><h2 className="text-base font-semibold">חיפוש לפי תעודת זהות</h2><p className="mt-1 text-xs text-white/50">חיפוש עצמאי — אין צורך למלא פרטים נוספים.</p></div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="search-national-id" className="sr-only">תעודת זהות</label><input id="search-national-id" inputMode="numeric" autoComplete="off" value={nationalIdQuery} onChange={(event) => setNationalIdQuery(event.target.value)} placeholder="מספר תעודת זהות" className="h-12 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/>
                <button type="submit" disabled={isSearching} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl border border-cyan-100/20 bg-cyan-200/15 px-7 font-semibold text-cyan-50 transition hover:bg-cyan-200/25 disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2"/>חפש לפי ת״ז</>}</button>
              </div>
            </form>
          </> : <form onSubmit={runDetailSearch} className="space-y-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5" aria-label="חיפוש Facebook">
            <div><h2 className="text-base font-semibold">חיפוש ב־Facebook</h2><p className="mt-1 text-xs text-white/50">בחר דרך חיפוש אחת בכל פעם.</p></div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="סוג חיפוש Facebook">
              {([{ id: "phone", label: "טלפון" }, { id: "name", label: "שם ושם משפחה" }, { id: "facebook-id", label: "מזהה Facebook" }] as const).map((option) => <button key={option.id} type="button" aria-pressed={facebookMode === option.id} onClick={() => setFacebookMode(option.id)} className={`min-h-10 rounded-xl border px-2 text-xs font-semibold transition sm:px-4 sm:text-sm ${facebookMode === option.id ? "border-cyan-200/50 bg-cyan-200/15 text-cyan-100" : "border-white/10 bg-white/[0.035] text-white/65 hover:bg-white/10"}`}>{option.label}</button>)}
            </div>
            {facebookMode === "phone" ? <div className="space-y-3"><label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-phone"><span>טלפון</span><input id="facebook-phone" inputMode="tel" autoComplete="off" value={facebookPhone} onChange={(event) => setFacebookPhone(event.target.value)} placeholder="מספר טלפון" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label><button type="button" role="switch" aria-checked={internetSearchEnabled} onClick={() => { setInternetSearchEnabled((enabled) => !enabled); setWebSearchError(""); }} className={`inline-flex min-h-10 items-center gap-3 rounded-xl border px-3 text-sm font-semibold transition ${internetSearchEnabled ? "border-violet-200/50 bg-violet-200/15 text-violet-100" : "border-white/10 bg-white/[0.035] text-white/65 hover:bg-white/10"}`}><span className={`relative h-5 w-9 rounded-full transition ${internetSearchEnabled ? "bg-violet-300" : "bg-white/20"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${internetSearchEnabled ? "right-0.5" : "left-0.5"}`}/></span>חיפוש גם באינטרנט</button>{internetSearchEnabled && <p className="text-xs leading-relaxed text-violet-100/65">כאשר מופעל, תוצאות האינטרנט יופיעו מתחת לתוצאות Facebook.</p>}</div>
              : facebookMode === "facebook-id" ? <label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-id"><span>מזהה Facebook</span><input id="facebook-id" inputMode="numeric" autoComplete="off" value={facebookIdQuery} onChange={(event) => setFacebookIdQuery(event.target.value)} placeholder="מזהה Facebook מספרי" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label>
                : <><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-first-name"><span>שם פרטי</span><input id="facebook-first-name" autoComplete="off" value={facebookFirstName} onChange={(event) => setFacebookFirstName(event.target.value)} placeholder="שם פרטי" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label><label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-last-name"><span>שם משפחה</span><input id="facebook-last-name" autoComplete="off" value={facebookLastName} onChange={(event) => setFacebookLastName(event.target.value)} placeholder="שם משפחה" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/></label></div><TextMatchModeSelector mode={textMatchMode} onChange={setTextMatchMode}/></>}
            <div className="flex justify-end"><button type="submit" disabled={isSearching} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2"/>חפש ב־Facebook</>}</button></div>
          </form>}
        </div>
        {searchError && <p role="alert" className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{searchError}</p>}
        <div className="mt-4 text-xs text-white/45">„הכול” מחפש בכל המקורות ומאחד רשומות; בחירת מקור אחר מגבילה את החיפוש אליו בלבד.</div>
      </section>

      {isSearching && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">החיפוש מתבצע…</p><p className="mt-1 text-sm text-white/50">נבדקים האינדקסים המלאים של המקורות ונשלפות רק שורות מתאימות.</p></div></section>}

      {searched && !isSearching && <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div><h2 className="font-semibold">תוצאות חיפוש</h2><p className="mt-1 text-sm text-white/55">{results.length ? `נמצאו ${results.length} התאמות עבור ${lastQuery}` : `לא נמצאה התאמה עבור ${lastQuery}`}</p>{searchDurationMs !== null && <p className="mt-1 text-xs text-cyan-100/70">משך החיפוש: {formatSearchDuration(searchDurationMs)}</p>}</div>{results.length > 0 && <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="search-export-format">סוג קובץ לייצוא</label><select id="search-export-format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as SearchExportFormat)} className="min-h-10 rounded-xl border border-white/15 bg-[#17101f] px-3 text-xs text-white"><option value="csv">CSV — Excel / Sheets</option><option value="tsv">TSV — טבלה</option><option value="json">JSON — נתונים</option><option value="jsonl">JSONL — שורה לרשומה</option><option value="txt">TXT — טקסט</option><option value="html">HTML — דף טבלה</option><option value="xml">XML — נתונים</option><option value="xlsx">XLSX — Excel</option></select><button type="button" onClick={() => void exportSearchResults()} disabled={isExporting} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f2a9d2] px-4 text-xs font-semibold text-[#30123e] hover:bg-[#f7c2e0] disabled:opacity-60">{isExporting ? <LoaderCircle size={15} className="animate-spin"/> : <Download size={15}/>}ייצא</button></div>}{results.length > 0 && <p className="w-full text-xs text-white/40">הקובץ עשוי לכלול מידע אישי — שמרו אותו במקום מוגן.</p>}{exportError && <p role="alert" className="w-full text-xs text-rose-200">{exportError}</p>}</div>
        {results.length > 0 ? <div className="grid gap-3 xl:grid-cols-2">{results.map((hit, index) => <article key={`${hit.nationalId}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-200/70">מקור: {hit.sourceNames?.join(" · ") || hit.source}</p><h3 className="mt-1 text-lg font-semibold">{hit.fullName}</h3></div><span className={`rounded-full px-3 py-1 text-xs ${hit.confidence === "exact-id" || hit.confidence === "phone-match" || hit.confidence === "facebook-id-match" ? "border border-emerald-200/20 bg-emerald-200/10 text-emerald-100" : "border border-amber-200/20 bg-amber-200/10 text-amber-100"}`}>{hit.confidence === "exact-id" ? "התאמה מדויקת" : hit.confidence === "phone-match" ? "טלפון מדויק" : hit.confidence === "facebook-id-match" ? "מזהה Facebook מדויק" : hit.confidence === "approximate-text-match" ? "התאמה דומה" : hit.confidence === "text-match" ? "התאמת טקסט" : "התאמה אפשרית"}</span></div>
          <div className="mt-4 space-y-3">{searchHitDetailGroups(hit).map((group) => <section key={group.title} className="rounded-xl border border-white/10 bg-black/10 p-3"><h4 className="mb-2 text-xs font-semibold text-fuchsia-100/80">{group.title}</h4><dl className="grid gap-2 text-sm sm:grid-cols-2">{group.rows.map(([label, value]) => <div key={label} className={`min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 ${label.includes("כתובת") ? "sm:col-span-2" : ""}`}><dt className="text-xs text-white/55">{label}</dt><dd dir="auto" className={`mt-1 break-words text-sm font-medium leading-relaxed text-white/90 ${label.includes("זהות") || label.includes("Facebook") ? "font-mono" : ""}`}>{label === "מזהה Facebook" && hit.sourceKey === "facebook" ? <><span>{value}</span><a href={facebookProfileUrl(value)} target="_blank" rel="noopener noreferrer" className="mt-1 block font-sans text-xs font-medium text-cyan-200 underline decoration-dotted underline-offset-4 hover:text-cyan-100">פרופיל Facebook: {facebookProfileUrl(value)}</a></> : value}</dd></div>)}</dl></section>)}</div>
          {(hit.fatherId || hit.motherId || hit.spouseId) && <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-xs text-white/45">מזהים קשורים הרשומים במקור:</p><div className="flex flex-wrap gap-2">{hit.fatherId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">אב · {hit.fatherId}</span>}{hit.motherId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">אם · {hit.motherId}</span>}{hit.spouseId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">בן/בת זוג · {hit.spouseId}</span>}</div></div>}
          {hit.nationalId && <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void openFamily(hit)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#f2a9d2]/30 bg-[#f2a9d2]/10 px-4 text-sm font-semibold text-[#ffc1dc] transition hover:bg-[#f2a9d2]/20"><UsersRound size={16}/>פתיחת עץ משפחה</button><button type="button" onClick={() => void exportPersonWithFamily(hit)} disabled={Boolean(exportingFamilyId)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60">{exportingFamilyId === normalizeId(hit.nationalId) ? <LoaderCircle size={15} className="animate-spin"/> : <Download size={15}/>}הורד אדם + עץ משפחה</button></div>}
        </article>)}</div> : !searchError ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center text-sm text-white/55">אין התאמות באינדקסים הנוכחיים. ודא שהפרטים הוקלדו נכון ונסה שוב.</div> : null}
      </section>}

      {sourceFilter === "facebook" && facebookMode === "phone" && internetSearchEnabled && searched && !isSearching && <section className="space-y-4 rounded-2xl border border-violet-200/15 bg-violet-200/[0.04] p-4 sm:p-5" aria-label="תוצאות חיפוש באינטרנט"><div><h2 className="text-base font-semibold text-violet-100">תוצאות מהאינטרנט</h2><p className="mt-1 text-xs leading-relaxed text-white/50">תוצאות אלה נוספו לחיפוש Facebook עבור אותו מספר. הן מציינות אזכור ציבורי בלבד ואינן הוכחה לבעלות או לזהות.</p></div>{webPhoneIntelligence && <div className="grid gap-2 rounded-xl border border-violet-100/10 bg-white/[0.03] p-3 text-xs text-white/65 sm:grid-cols-3"><div><span className="text-white/40">מספר מקומי</span><p className="mt-1 font-mono text-white/85">{webPhoneIntelligence.local}</p></div><div><span className="text-white/40">פורמט בינלאומי</span><p className="mt-1 font-mono text-white/85">{webPhoneIntelligence.international}</p></div><div><span className="text-white/40">סוג קו משוער</span><p className="mt-1 text-white/85">{webPhoneIntelligence.likelyLineType === "mobile" ? "נייד" : webPhoneIntelligence.likelyLineType === "landline" ? "נייח" : "לא ידוע"} · {webPhoneIntelligence.country}</p></div></div>}{webSearchAnalysis && <div className="rounded-xl border border-amber-200/15 bg-amber-200/[0.04] p-3 text-sm text-amber-50"><p className="font-semibold">ניתוח קשרים</p><p className="mt-1 text-xs leading-relaxed text-white/65">{webSearchAnalysis}</p></div>}<WebIntelligencePanel groups={webSearchGroups} />{isWebSearching && <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-violet-100/10 bg-white/[0.03] p-3 text-sm text-white/70"><LoaderCircle size={18} className="animate-spin text-violet-200"/>מחפש עמודים ציבוריים ומוודא שהמספר מופיע בטקסט…</div>}{webSearchError && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{webSearchError}</p>}{webSearchResults.length > 0 && <div className="space-y-3"><p className="text-xs leading-relaxed text-white/55">נמצאו {webSearchResults.length} עמודים עם הופעה מפורשת של המספר · {webSearchSourceCount} מקורות{webSearchIncomplete ? " · חלק מהחיפושים לא הושלמו" : ""}{webSearchLimited ? " · מוצגות 100 התוצאות הראשונות" : ""}{webSearchDurationMs !== null ? ` · ${formatSearchDuration(webSearchDurationMs)}` : ""}</p>{webSearchResults.map((result) => <article key={result.url} className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><a href={result.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-100 hover:underline">{result.title}</a><span className="rounded-full border border-violet-200/15 bg-violet-200/10 px-2 py-1 text-[10px] text-violet-100">הקשר {result.relevanceLabel}</span></div><p className="mt-1 text-xs leading-5 text-white/65">{result.snippet}</p>{result.context && <p className="mt-1 rounded-lg border border-white/[0.06] bg-black/10 p-2 text-[11px] leading-5 text-white/55">הקשר שנמצא: {result.context}</p>}{result.socialProfiles.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{result.socialProfiles.map((profile) => <a key={`${profile.platform}-${profile.url}`} href={profile.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-cyan-200/15 px-2.5 py-1.5 text-[11px] text-cyan-100 hover:bg-cyan-200/10">{profile.platform}{profile.username ? ` · @${profile.username}` : ""}</a>)}</div>}<p className="mt-1 text-[11px] text-emerald-200/75">{result.matchLocation === "page-text" ? "המספר נמצא בטקסט המלא של העמוד" : "המספר נמצא בקטע תוכן שסופק על ידי מנוע החיפוש"} · {result.matchedPhone}</p><p className="mt-1 break-all text-[11px] text-white/35">{result.source} · {result.url}</p></article>)}</div>}{webSearchCompleted && webSearchResults.length === 0 && !webSearchError && <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-white/55">לא נמצאו עמודים שבהם המספר מופיע בטקסט שנשלף.{webSearchIncomplete ? " חלק מהחיפושים לא הושלמו, לכן התוצאה חלקית." : ""}</p>}</section>}
      {familyError && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{familyError}</p>}
      {isLoadingFamily && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">טוען קשרים משפחתיים…</p><p className="mt-1 text-sm text-white/50">המידע נבנה מהקשרים המתועדים במאגר המקור.</p></div></section>}
      {familyData && familyCentralId && <section id="family-tree" className="scroll-mt-24 space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">Family relationship map</p><h2 className="mt-1 text-2xl font-bold text-white">עץ קשרים משפחתיים</h2><p className="mt-1 text-sm text-white/50">מרכז העץ: ת״ז {familyCentralId}{familyDurationMs !== null ? ` · זמן טעינה: ${formatSearchDuration(familyDurationMs)}` : ""}</p></div><div className="flex flex-wrap gap-2 text-xs text-white/45"><span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2"><MapPin size={13}/> יישוב וכתובת לפי זמינות</span><span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2"><CalendarDays size={13}/> פרטי מקור</span></div></div><FamilyTree data={familyData} centralId={familyCentralId} onSelect={(id) => void changeFamilyCenter(id)}/></section>}
    </main>
    <footer className="border-t border-white/10 px-4 py-5 text-center font-serif text-xs tracking-[0.12em] text-white/35">OSINT Search</footer>
  </div>;
}
