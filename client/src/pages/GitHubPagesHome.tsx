import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Download, Info, KeyRound, LoaderCircle, LockKeyhole, LogOut, MapPin, Network, Phone, Search, UserRound, UsersRound } from "lucide-react";
import FamilyTree from "@/components/FamilyTree";
import PwaControls from "@/components/PwaControls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildSearchResultRows, buildSearchResultsCsv, createSearchExportBlob, SEARCH_EXPORT_FORMATS, type SearchExportFormat } from "@/lib/search-export";
import {
  searchFamilyTreeById,
  searchFullDatasetsByIdWithDetails,
  searchFullDatasetsByFacebookId,
  searchFullDatasetsByPhone,
  searchFullDatasetsByText,
  parseAgeRange,
  type FamilyTreeData,
  type SearchHit,
  type TextMatchMode,
} from "@/lib/full-dataset-search";

const PASSWORD_HASH = "3f46bdea034f311a14efe877f5592d84a7a6c97d9b917be3f55573311e6cdda7";
const SESSION_KEY = `maagarim-pages-unlocked-${import.meta.env.VITE_BUILD_ID ?? "dev"}`;
const AWAY_TTL_MS = 5 * 60 * 1000;
type SearchMode = "national-id" | "phone" | "facebook-id" | "details";
const normalizeId = (value: string) => value.replace(/\D/g, "");

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

function readSessionStart() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (raw === "1") {
    const migratedAt = Date.now();
    sessionStorage.setItem(SESSION_KEY, String(migratedAt));
    return migratedAt;
  }
  const startedAt = raw ? Number(raw) : NaN;
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
  return startedAt;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function GitHubPagesHome() {
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(() => readSessionStart());
  const unlocked = sessionStartedAt !== null;
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [mode, setMode] = useState<SearchMode>("national-id");
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState({ firstName: "", lastName: "", city: "", age: "" });
  const [textMatchMode, setTextMatchMode] = useState<TextMatchMode>("exact");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [exportFormat, setExportFormat] = useState<SearchExportFormat>("csv");
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFamilyId, setExportingFamilyId] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [familyData, setFamilyData] = useState<FamilyTreeData | null>(null);
  const [familyCentralId, setFamilyCentralId] = useState("");
  const [isLoadingFamily, setIsLoadingFamily] = useState(false);
  const [familyError, setFamilyError] = useState("");

  const normalizedDigits = useMemo(() => normalizeId(query), [query]);
  const clearTree = () => { setFamilyData(null); setFamilyCentralId(""); setFamilyError(""); };
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
    if (await sha256(password) !== PASSWORD_HASH) { setPasswordError("הסיסמה לא נכונה."); return; }
    const startedAt = Date.now();
    sessionStorage.setItem(SESSION_KEY, String(startedAt));
    setPassword("");
    setSessionStartedAt(startedAt);
  };

  const lock = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSessionStartedAt(null);
    setResults([]);
    setSearched(false);
    setLastQuery("");
    clearTree();
  };

  useEffect(() => {
    if (sessionStartedAt === null) return;
    let awaySince: number | null = null;
    const markAway = () => { if (awaySince === null) awaySince = Date.now(); };
    const checkReturn = () => {
      if (awaySince !== null && Date.now() - awaySince >= AWAY_TTL_MS) lock();
      awaySince = null;
    };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") markAway(); else checkReturn(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", checkReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", checkReturn);
    };
  }, [sessionStartedAt]);

  const switchMode = (next: SearchMode) => {
    setMode(next);
    setQuery("");
    setCriteria({ firstName: "", lastName: "", city: "", age: "" });
    setResults([]);
    setSearchError("");
    setSearched(false);
    clearTree();
  };

  const runSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (isSearching) return;
    setSearchError("");
    setResults([]);
    setSearched(true);
    clearTree();
    setIsSearching(true);
    try {
      if (mode === "national-id") {
        if (normalizedDigits.length < 5 || normalizedDigits.length > 9) throw new Error("יש להזין מספר תעודת זהות בן 5–9 ספרות.");
        setLastQuery(`ת״ז ${normalizedDigits}`);
        setResults(await searchFullDatasetsByIdWithDetails(normalizedDigits));
      } else if (mode === "phone") {
        if (query.replace(/\D/g, "").length < 7) throw new Error("יש להזין מספר טלפון בן 7 ספרות לפחות.");
        setLastQuery(`טלפון ${query.trim()}`);
        setResults(await searchFullDatasetsByPhone(query));
      } else if (mode === "facebook-id") {
        setLastQuery(`Facebook ID ${query.trim()}`);
        setResults(await searchFullDatasetsByFacebookId(query));
      } else {
        const searchCriteria = Object.fromEntries(Object.entries(criteria).map(([key, value]) => [key, value.trim()])) as typeof criteria;
        if (!Object.values(searchCriteria).some(Boolean)) throw new Error("יש למלא לפחות שדה אחד: שם פרטי, שם משפחה, יישוב או גיל.");
        if (searchCriteria.age) parseAgeRange(searchCriteria.age);
        setLastQuery([...([searchCriteria.firstName, searchCriteria.lastName, searchCriteria.city, searchCriteria.age && `גיל ${searchCriteria.age}`].filter(Boolean)), textMatchMode === "exact" ? "מדויק" : "דומה"].join(" · "));
        setResults(await searchFullDatasetsByText(searchCriteria, textMatchMode));
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "החיפוש נכשל. בדוק חיבור לאינטרנט ונסה שוב.");
    } finally {
      setIsSearching(false);
    }
  };

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
    try {
      setFamilyData(await searchFamilyTreeById(digits));
      window.setTimeout(() => document.getElementById("family-tree")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (error) {
      setFamilyError(error instanceof Error ? error.message : "לא ניתן לטעון את נתוני המשפחה.");
    } finally {
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
    try { setFamilyData(await searchFamilyTreeById(digits)); }
    catch (error) { setFamilyError(error instanceof Error ? error.message : "לא ניתן לטעון את נתוני המשפחה."); }
    finally { setIsLoadingFamily(false); }
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
            {passwordError && <p role="alert" className="text-sm text-rose-200">{passwordError}</p>}
            <button type="submit" className="h-12 w-full rounded-xl bg-[#f2a9d2] px-5 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0]"><KeyRound size={17} className="ml-2 inline"/>כניסה</button>
          </form>
        </div>
      </main>
    </div>;
  }

  const modes: { id: SearchMode; label: string; icon: typeof Search }[] = [
    { id: "national-id", label: "תעודת זהות", icon: UserRound },
    { id: "phone", label: "טלפון", icon: Phone },
    { id: "facebook-id", label: "מזהה Facebook", icon: Network },
    { id: "details", label: "שם · יישוב · גיל", icon: Search },
  ];

  return <div dir="rtl" className="min-h-screen bg-[#100b17] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#100b17]/90 backdrop-blur-xl">
      <div className="mx-auto flex flex-wrap max-w-[1500px] items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-300/15 p-2.5 text-fuchsia-200"><Network size={22}/></div><p className="bg-gradient-to-r from-fuchsia-200 to-violet-200 bg-clip-text font-serif text-lg font-bold tracking-[0.1em] text-transparent">OSINT Search</p></div>
        <div className="flex items-center gap-2"><PwaControls/><button type="button" onClick={lock} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10"><LogOut size={15}/>נעילה</button></div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-7 sm:py-9">
      <section className="search-hero overflow-hidden rounded-[28px] border border-fuchsia-200/10 bg-[#20102b] px-5 py-6 shadow-[0_24px_80px_rgba(46,24,61,0.3)] sm:px-9 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">חיפוש בשלושת מקורות הנתונים</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">חיפוש אדם</h1></div><div className="hidden rounded-2xl border border-fuchsia-100/10 bg-black/10 px-4 py-3 text-xs text-white/45 sm:block"><UsersRound size={15} className="ml-2 inline text-fuchsia-200"/>19.6 מיליון רשומות במקורות</div></div>

        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="מצב חיפוש">
          {modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => switchMode(id)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition ${mode === id ? "border-[#f2a9d2]/50 bg-[#f2a9d2] text-[#30123e]" : "border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/10"}`}><Icon size={16}/>{label}</button>)}
        </div>

        <form onSubmit={runSearch} className="mt-5 space-y-4">
          {mode === "national-id" && <div className="flex flex-col gap-3 sm:flex-row">
            <input inputMode="numeric" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="תעודת זהות — 5 עד 9 ספרות" className="h-14 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/>
            <button type="submit" disabled={isSearching || normalizedDigits.length < 5 || normalizedDigits.length > 9} className="h-14 rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 inline animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2 inline"/>חפש בכל המאגרים</>}</button>
          </div>}
          {mode === "phone" && <div className="flex flex-col gap-3 sm:flex-row">
            <input type="tel" inputMode="tel" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="מספר טלפון — אפשר עם קידומת" className="h-14 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/>
            <button type="submit" disabled={isSearching || query.replace(/\D/g, "").length < 7} className="h-14 rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 inline animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2 inline"/>חפש טלפון</>}</button>
          </div>}
          {mode === "facebook-id" && <div className="flex flex-col gap-3 sm:flex-row">
            <input inputMode="numeric" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="מזהה Facebook מספרי" className="h-14 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/>
            <button type="submit" disabled={isSearching || !/^\d{1,18}$/.test(query.replace(/\D/g, ""))} className="h-14 rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 inline animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2 inline"/>חפש מזהה</>}</button>
          </div>}
          {mode === "details" && <>
            <section className="rounded-2xl border border-white/10 bg-black/10 p-3 sm:col-span-2 lg:col-span-4" aria-label="מצב התאמת החיפוש">
              <p className="mb-2 text-xs font-semibold text-white/75">איך להתאים את החיפוש?</p>
              <div className="grid max-w-[420px] grid-cols-2 gap-3">
                <div className="flex flex-col items-stretch gap-1.5">
                  <Popover>
                    <PopoverTrigger asChild><button type="button" className="inline-flex min-h-8 items-center justify-center gap-1 text-xs text-white/60 underline decoration-dotted underline-offset-4 hover:text-white"><Info size={13}/>הסבר</button></PopoverTrigger>
                    <PopoverContent dir="rtl" side="top" className="w-64 max-w-[calc(100vw-2rem)] border-white/15 bg-[#211528] text-right text-xs leading-relaxed text-white/85"><p className="font-semibold text-fuchsia-100">חיפוש מדויק</p><p className="mt-1">מחפש לפי האותיות שהקלדת ובאותו סדר. לדוגמה, „כהו” לא יחזיר את „כהן”. מתאים כשחשוב לצמצם תוצאות.</p></PopoverContent>
                  </Popover>
                  <button type="button" aria-pressed={textMatchMode === "exact"} onClick={() => setTextMatchMode("exact")} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${textMatchMode === "exact" ? "border-[#f2a9d2]/60 bg-[#f2a9d2] text-[#30123e]" : "border-white/15 bg-white/[0.035] text-white/75 hover:bg-white/10"}`}>מדויק</button>
                </div>
                <div className="flex flex-col items-stretch gap-1.5">
                  <Popover>
                    <PopoverTrigger asChild><button type="button" className="inline-flex min-h-8 items-center justify-center gap-1 text-xs text-white/60 underline decoration-dotted underline-offset-4 hover:text-white"><Info size={13}/>הסבר</button></PopoverTrigger>
                    <PopoverContent dir="rtl" side="top" className="w-64 max-w-[calc(100vw-2rem)] border-white/15 bg-[#211528] text-right text-xs leading-relaxed text-white/85"><p className="font-semibold text-fuchsia-100">חיפוש דומה</p><p className="mt-1">מחפש גם כשיש טעות של אות אחת בשם או ביישוב. לדוגמה, „כהו” עשוי למצוא את „כהן”. הגיל, אם צוין, עדיין חייב להתאים בדיוק; ייתכנו תוצאות נוספות.</p></PopoverContent>
                  </Popover>
                  <button type="button" aria-pressed={textMatchMode === "similar"} onClick={() => setTextMatchMode("similar")} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${textMatchMode === "similar" ? "border-[#f2a9d2]/60 bg-[#f2a9d2] text-[#30123e]" : "border-white/15 bg-white/[0.035] text-white/75 hover:bg-white/10"}`}>דומה</button>
                </div>
              </div>
            </section>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input autoComplete="off" value={criteria.firstName} onChange={(event) => setCriteria((prev) => ({ ...prev, firstName: event.target.value }))} placeholder="שם פרטי" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
              <input autoComplete="off" value={criteria.lastName} onChange={(event) => setCriteria((prev) => ({ ...prev, lastName: event.target.value }))} placeholder="שם משפחה" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
              <input autoComplete="off" value={criteria.city} onChange={(event) => setCriteria((prev) => ({ ...prev, city: event.target.value }))} placeholder="יישוב" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
              <input type="text" inputMode="numeric" autoComplete="off" value={criteria.age} onChange={(event) => setCriteria((prev) => ({ ...prev, age: event.target.value }))} placeholder="גיל או טווח, למשל 20-30" aria-label="גיל או טווח גילאים" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
              <button type="submit" disabled={isSearching} className="h-12 rounded-xl bg-[#f2a9d2] px-6 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50 sm:col-span-2 lg:col-span-4">{isSearching ? <><LoaderCircle size={17} className="ml-2 inline animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2 inline"/>חיפוש לפי פרטים</>}</button>
            </div>
          </>}
        </form>
        {searchError && <p role="alert" className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{searchError}</p>}
        <div className="mt-4 text-xs text-white/45">התוצאות מאוחדות לרשומה אחת; פרטי כתובת וטלפון מוצגים לפי השנה הזמינה.</div>
      </section>

      {isSearching && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">החיפוש מתבצע…</p><p className="mt-1 text-sm text-white/50">נבדקים האינדקסים המלאים של המקורות ונשלפות רק שורות מתאימות.</p></div></section>}

      {searched && !isSearching && <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div><h2 className="font-semibold">תוצאות חיפוש</h2><p className="mt-1 text-sm text-white/55">{results.length ? `נמצאו ${results.length} התאמות עבור ${lastQuery}` : `לא נמצאה התאמה עבור ${lastQuery}`}</p></div>{results.length > 0 && <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="search-export-format">סוג קובץ לייצוא</label><select id="search-export-format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as SearchExportFormat)} className="min-h-10 rounded-xl border border-white/15 bg-[#17101f] px-3 text-xs text-white"><option value="csv">CSV — Excel / Sheets</option><option value="tsv">TSV — טבלה</option><option value="json">JSON — נתונים</option><option value="jsonl">JSONL — שורה לרשומה</option><option value="txt">TXT — טקסט</option><option value="html">HTML — דף טבלה</option><option value="xml">XML — נתונים</option><option value="xlsx">XLSX — Excel</option></select><button type="button" onClick={() => void exportSearchResults()} disabled={isExporting} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f2a9d2] px-4 text-xs font-semibold text-[#30123e] hover:bg-[#f7c2e0] disabled:opacity-60">{isExporting ? <LoaderCircle size={15} className="animate-spin"/> : <Download size={15}/>}ייצא</button></div>}{results.length > 0 && <p className="w-full text-xs text-white/40">הקובץ עשוי לכלול מידע אישי — שמרו אותו במקום מוגן.</p>}{exportError && <p role="alert" className="w-full text-xs text-rose-200">{exportError}</p>}</div>
        {results.length > 0 ? <div className="grid gap-3 xl:grid-cols-2">{results.map((hit, index) => <article key={`${hit.nationalId}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div>{mode === "phone" && <p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-200/70">{hit.sourceKey === "facebook" ? "תוצאות Facebook" : "תוצאות מאוחדות — AGRON + Elector"}</p>}<h3 className="mt-1 text-lg font-semibold">{hit.fullName}</h3></div><span className={`rounded-full px-3 py-1 text-xs ${hit.confidence === "exact-id" || hit.confidence === "phone-match" || hit.confidence === "facebook-id-match" ? "border border-emerald-200/20 bg-emerald-200/10 text-emerald-100" : "border border-amber-200/20 bg-amber-200/10 text-amber-100"}`}>{hit.confidence === "exact-id" ? "התאמה מדויקת" : hit.confidence === "phone-match" ? "טלפון מדויק" : hit.confidence === "facebook-id-match" ? "מזהה Facebook מדויק" : hit.confidence === "approximate-text-match" ? "התאמה דומה" : hit.confidence === "text-match" ? "התאמת טקסט" : "התאמה אפשרית"}</span></div>
          <div className="mt-4 space-y-3">{searchHitDetailGroups(hit).map((group) => <section key={group.title} className="rounded-xl border border-white/10 bg-black/10 p-3"><h4 className="mb-2 text-xs font-semibold text-fuchsia-100/80">{group.title}</h4><dl className="grid gap-2 text-sm sm:grid-cols-2">{group.rows.map(([label, value]) => <div key={label} className={`min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 ${label.includes("כתובת") ? "sm:col-span-2" : ""}`}><dt className="text-xs text-white/55">{label}</dt><dd dir="auto" className={`mt-1 break-words text-sm font-medium leading-relaxed text-white/90 ${label.includes("זהות") || label.includes("Facebook") ? "font-mono" : ""}`}>{value}</dd></div>)}</dl></section>)}</div>
          {(hit.fatherId || hit.motherId || hit.spouseId) && <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-xs text-white/45">מזהים קשורים הרשומים במקור:</p><div className="flex flex-wrap gap-2">{hit.fatherId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">אב · {hit.fatherId}</span>}{hit.motherId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">אם · {hit.motherId}</span>}{hit.spouseId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">בן/בת זוג · {hit.spouseId}</span>}</div></div>}
          {hit.nationalId && <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void openFamily(hit)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#f2a9d2]/30 bg-[#f2a9d2]/10 px-4 text-sm font-semibold text-[#ffc1dc] transition hover:bg-[#f2a9d2]/20"><UsersRound size={16}/>פתיחת עץ משפחה</button><button type="button" onClick={() => void exportPersonWithFamily(hit)} disabled={Boolean(exportingFamilyId)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60">{exportingFamilyId === normalizeId(hit.nationalId) ? <LoaderCircle size={15} className="animate-spin"/> : <Download size={15}/>}הורד אדם + עץ משפחה</button></div>}
        </article>)}</div> : !searchError ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center text-sm text-white/55">אין התאמות באינדקסים הנוכחיים. ודא שהפרטים הוקלדו נכון ונסה שוב.</div> : null}
      </section>}

      {familyError && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{familyError}</p>}
      {isLoadingFamily && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">טוען קשרים משפחתיים…</p><p className="mt-1 text-sm text-white/50">המידע נבנה מהקשרים המתועדים במאגר המקור.</p></div></section>}
      {familyData && familyCentralId && <section id="family-tree" className="scroll-mt-24 space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">Family relationship map</p><h2 className="mt-1 text-2xl font-bold text-white">עץ קשרים משפחתיים</h2><p className="mt-1 text-sm text-white/50">מרכז העץ: ת״ז {familyCentralId}</p></div><div className="flex flex-wrap gap-2 text-xs text-white/45"><span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2"><MapPin size={13}/> יישוב וכתובת לפי זמינות</span><span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2"><CalendarDays size={13}/> פרטי מקור</span></div></div><FamilyTree data={familyData} centralId={familyCentralId} onSelect={(id) => void changeFamilyCenter(id)}/></section>}
    </main>
    <footer className="border-t border-white/10 px-4 py-5 text-center font-serif text-xs tracking-[0.12em] text-white/35">OSINT Search</footer>
  </div>;
}
