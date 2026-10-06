import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Download, Info, KeyRound, LoaderCircle, LockKeyhole, LogOut, MapPin, Network, Search, UsersRound } from "lucide-react";
import FamilyTree from "@/components/FamilyTree";
import FacebookIdLink from "@/components/FacebookIdLink";
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

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
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

type SearchDetailGroup = { title: string; rows: [string, string | React.ReactNode][] };

function searchHitDetailGroups(hit: SearchHit): SearchDetailGroup[] {
  const personalRows: [string, string | React.ReactNode][] = [
    hit.nationalId ? ["תעודת זהות", hit.nationalId] : undefined,
    hit.facebookId ? ["מזהה Facebook", <FacebookIdLink key={`fb-${hit.facebookId}`} facebookId={hit.facebookId} />] : undefined,
    hit.birthDate ? ["תאריך לידה", hit.birthDate] : undefined,
    hit.age ? ["גיל", hit.age] : undefined,
    hit.maritalStatus ? ["מצב אישי", hit.maritalStatus] : undefined,
  ].filter((row): row is [string, string | React.ReactNode] => Boolean(row?.[1]));
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

function TextMatchModeSelector({ mode, onChange }: { mode: TextMatchMode; onChange: (mode: TextMatchMode) => void }) {
  return <section className="rounded-2xl border border-white/10 bg-black/10 p-3" aria-label="מצב התאמת שם ומיקום">
    <p className="mb-2 text-xs font-semibold text-white/75">התאמת שם ומיקום</p>
    <div className="grid max-w-[360px] grid-cols-2 gap-3">
      {(["exact", "similar"] as const).map((option) => <div key={option} className="flex flex-col items-stretch gap-1.5">
        <Popover>
          <PopoverTrigger asChild><button type="button" className="inline-flex min-h-8 items-center justify-center gap-1 text-xs text-white/60 underline decoration-dotted underline-offset-4 hover:[...]
          <PopoverContent dir="rtl" side="top" className="w-64 max-w-[calc(100vw-2rem)] border-white/15 bg-[#211528] text-right text-xs leading-relaxed text-white/85">
            {option === "exact" ? <><p className="font-semibold text-fuchsia-100">חיפוש מדויק</p><p className="mt-1">מחפש לפי האותיות שהקלדת. למשל „כהו" ל[...]
          </PopoverContent>
        </Popover>
        <button type="button" aria-pressed={mode === option} onClick={() => onChange(option)} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${mode === option ? "bord[...]
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
  const [webSearchResults, setWebSearchResults] = useState<{ title: string; url: string; snippet: string; source: string; matchedPhone: string; matchLocation: "page-text" | "provider-snippet"; rel[...]
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
      const person = { id: centralId, fullName: hit.fullName, nationalId: hit.nationalId, phone: hit.phone, address: hit.address, city: hit.city, birthDate: hit.birthDate, sourceNames: hit.source[...]
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
    try {
      const response = await fetch(`${API_BASE}/api/access/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ password }) })[...]
      const payload = await response.json() as { expiresAt?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "הכניסה נכשלה.");
      }
      const startedAt = Date.now();
      setPassword(""); setSessionStartedAt(startedAt); setSessionExpiresAt(payload.expiresAt ? Date.parse(payload.expiresAt) : null);
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
      await executeSearch(`${first} ${last} · ${textMatchMode === "exact" ? "מדויק" : "דומה"}`, () => searchFullDatasetsByText({ firstName: first, lastName: last }, textMatchMode, "face[...]
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
    if (query.replace(/\D/g, "").length < 7) { setWebSearchResults([]); setWebSearchCompleted(false); setWebSearchError("יש להזין מספר טלפון בן 7 ספרות לפחות."); retur[...]
    const startedAt = performance.now();
    setWebSearchDurationMs(null);
    webSearchStartedAtRef.current = Date.now();
    sessionStorage.setItem("maagarim-pending-web-phone-search", query);
    setIsWebSearching(true); setWebSearchResults([]); setWebSearchRoute(""); setWebSearchCompleted(false); setWebSearchIncomplete(false); setWebSearchLimited(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
      if (!base && window.location.hostname.endsWith("github.io")) throw new Error("חיפוש אינטרנטי פנימי דורש חיבור Backend. יש להגדיר VITE_API_BASE_URL לכת…");
      const response = await fetch(`${base}/api/web-phone-search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: query }), signal: controller.si[...]
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json") ? await response.json() as { results?: typeof webSearchResults; route?: string; incomplete?: boolean; limited?: boolean; error?: str[...]
      if (!response.ok) throw new Error(payload.error || "חיפוש האינטרנט נכשל.");
      setWebSearchResults(payload.results ?? []); setWebSearchRoute(payload.route ?? "direct"); setWebSearchIncomplete(Boolean(payload.incomplete)); setWebSearchLimited(Boolean(payload.limited));[...]
    } catch (error) {
      setWebSearchError(error instanceof DOMException && error.name === "AbortError"
        ? "שרת החיפוש לא הגיב בתוך 35 שניות. ייתכן ששירות Render עדיין מתעורר או שהחיפוש דרך הספק אינו זמין. נסה שוב ב[...]
        : error instanceof Error ? error.message : "חיפוש האינטרנט נכשל.");
    } finally { window.clearTimeout(timeout); setWebSearchDurationMs(performance.now() - startedAt); setIsWebSearching(false); webSearchStartedAtRef.current = null; sessionStorage.removeItem("maa[...]
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
          <h1 className="mt-5 text-center"><span className="bg-gradient-to-r from-fuchsia-200 via-white to-violet-200 bg-clip-text font-serif text-3xl font-bold tracking-[0.12em] text-transparent[...]
          <form onSubmit={unlock} className="mt-7 space-y-3">
            <label htmlFor="site-password" className="sr-only">סיסמה</label>
            <input id="site-password" autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="סיסמה" cla[...]
            {passwordError && <p role="alert" className="text-sm text-rose-200">{passwordError}</p>}
            <button type="submit" className="h-12 w-full rounded-xl bg-[#f2a9d2] px-5 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0]"><KeyRound size={17} className="ml-2 inline"/>כנ[...]
          </form>
        </div>
      </main>
    </div>;
  }

  return <div dir="rtl" className="min-h-screen bg-[#100b17] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#100b17]/90 backdrop-blur-xl">
      <div className="mx-auto flex flex-wrap max-w-[1500px] items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-300/15 p-2.5 text-fuchsia-200"><Network size={22}/></div><p className="bg-gradient-to-r from-fuchsia-200 to[...]
        <div className="flex items-center gap-2"><PwaControls/><button type="button" onClick={lock} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs t[...]
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-7 sm:py-9">
      <section className="search-hero overflow-hidden rounded-[28px] border border-fuchsia-200/10 bg-[#20102b] px-5 py-6 shadow-[0_24px_80px_rgba(46,24,61,0.3)] sm:px-9 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">חיפוש בשלושת מקו[...]

        <div className="mt-5 space-y-4" aria-label="חיפוש לפי מקור">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3" aria-label="בחירת מקור החיפוש">
            <p className="mb-2 text-xs font-semibold text-white/60">בחר מקור לחיפוש</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {SOURCE_OPTIONS.map(({ id, label }) => <button key={id} type="button" aria-pressed={sourceFilter === id} onClick={() => selectSource(id)} className={`min-h-10 rounded-xl border px-4[...]
            </div>
          </div>

          {sourceFilter !== "facebook" ? <>
            <form onSubmit={runDetailSearch} className="space-y-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5" aria-label="חיפוש לפי פרטים">
              <div><h2 className="text-base font-semibold">חיפוש לפי פרטים</h2><p className="mt-1 text-xs leading-relaxed text-white/50">יש למלא שם פרטי או שם משפ[...]
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm text-white/75" htmlFor="search-first-name"><span>שם פרטי</span><input id="search-first-name" autoComplete="off" value={firstName}[...]
                <label className="block space-y-1.5 text-sm text-white/75" htmlFor="search-last-name"><span>שם משפחה</span><input id="search-last-name" autoComplete="off" value={lastName} [...]
                <label className="block space-y-1.5 text-sm text-white/75 sm:col-span-2" htmlFor="search-location"><span>עיר, שכונה, רחוב או כתובת</span><input id="search-locat[...]
                {(sourceFilter === "all" || sourceFilter === "agron2006") && <label className="block space-y-1.5 text-sm text-white/75" htmlFor="search-age"><span>גיל או טווח גילאי[...]
              </div>
              <div className="flex flex-col gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-end sm:justify-between">
                <TextMatchModeSelector mode={textMatchMode} onChange={setTextMatchMode}/>
                <button type="submit" disabled={isSearching} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transit[...]
              </div>
            </form>

            <form onSubmit={runNationalIdSearch} className="space-y-3 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.04] p-4 sm:p-5" aria-label="חיפוש נפרד לפי תעודת זהו[...]
              <div><h2 className="text-base font-semibold">חיפוש לפי תעודת זהות</h2><p className="mt-1 text-xs text-white/50">חיפוש עצמאי — אין צורך למלא [...]
              <div className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="search-national-id" className="sr-only">תעודת זהות</label><input id="search-national-id" inputMode="numeric" autoComplete="off" value={nationalIdQuery} on[...]
                <button type="submit" disabled={isSearching} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl border border-cyan-100/20 bg-cyan-200/15 px-7 font-sem[...]
              </div>
            </form>
          </> : <form onSubmit={runDetailSearch} className="space-y-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5" aria-label="חיפוש Facebook">
            <div><h2 className="text-base font-semibold">חיפוש ב־Facebook</h2><p className="mt-1 text-xs text-white/50">בחר דרך חיפוש אחת בכל פעם.</p></div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="סוג חיפוש Facebook">
              {([{ id: "phone", label: "טלפון" }, { id: "name", label: "שם ושם משפחה" }, { id: "facebook-id", label: "מזהה Facebook" }] as const).map((option) => <button key={o[...]
            </div>
            {facebookMode === "phone" ? <div className="space-y-3"><label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-phone"><span>טלפון</span><input id="facebook-p[...]
              : facebookMode === "facebook-id" ? <label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-id"><span>מזהה Facebook</span><input id="facebook-id" inputMode="[...]
                : <><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5 text-sm text-white/75" htmlFor="facebook-first-name"><span>שם פרטי</span><input id="facebo[...]
            <div className="flex justify-end"><button type="submit" disabled={isSearching} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#f2a9d2] px-7 font-semibold t[...]
          </form>}
        </div>
        {searchError && <p role="alert" className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{searchError}</p>}
        <div className="mt-4 text-xs text-white/45">„הכול" מחפש בכל המקורות ומאחד רשומות; בחירת מקור אחר מגבילה את החיפוש אליו בל[...]
      </section>

      {isSearching && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" clas[...]

      {searched && !isSearching && <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div><h2 className="font-semibold">תוצאות חיפוש</h2><p[...]
        {results.length > 0 ? <div className="grid gap-3 xl:grid-cols-2">{results.map((hit, index) => <article key={`${hit.nationalId}-${index}`} className="rounded-2xl border border-white/10 bg-[...]
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-200/70">מקור: {hit.sourceNames?.join[...]
          <div className="mt-4 space-y-3">{searchHitDetailGroups(hit).map((group) => <section key={group.title} className="rounded-xl border border-white/10 bg-black/10 p-3"><h4 className="mb-2 t[...]
          {(hit.fatherId || hit.motherId || hit.spouseId) && <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-xs text-white/45">מזהים קשורים הרשומים [...]
          {hit.nationalId && <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void openFamily(hit)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bo[...]
        </article>)}</div> : !searchError ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center text-sm text-white/55">אין התאמות באינדקסים הנו[...]
      </section>}

      {sourceFilter === "facebook" && facebookMode === "phone" && internetSearchEnabled && searched && !isSearching && <section className="space-y-4 rounded-2xl border border-violet-200/15 bg-vio[...]
      {familyError && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{familyError}</p>}
      {isLoadingFamily && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" [...]
      {familyData && familyCentralId && <section id="family-tree" className="scroll-mt-24 space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs fon[...]
    </main>
    <footer className="border-t border-white/10 px-4 py-5 text-center font-serif text-xs tracking-[0.12em] text-white/35">OSINT Search</footer>
  </div>;
}
