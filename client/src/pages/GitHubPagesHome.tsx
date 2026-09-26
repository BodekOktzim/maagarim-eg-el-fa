import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, KeyRound, LoaderCircle, LockKeyhole, LogOut, MapPin, Network, Phone, Search, UserRound, UsersRound } from "lucide-react";
import FamilyTree from "@/components/FamilyTree";
import {
  searchFamilyTreeById,
  searchFullDatasetsById,
  searchFullDatasetsByFacebookId,
  searchFullDatasetsByPhone,
  searchFullDatasetsByText,
  type FamilyTreeData,
  type SearchHit,
} from "@/lib/full-dataset-search";

const PASSWORD_HASH = "3f46bdea034f311a14efe877f5592d84a7a6c97d9b917be3f55573311e6cdda7";
const SESSION_KEY = "maagarim-pages-unlocked-v2";
type SearchMode = "national-id" | "phone" | "facebook-id" | "details";
const normalizeId = (value: string) => value.replace(/\D/g, "");

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function GitHubPagesHome() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [mode, setMode] = useState<SearchMode>("national-id");
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState({ firstName: "", lastName: "", city: "", age: "" });
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [familyData, setFamilyData] = useState<FamilyTreeData | null>(null);
  const [familyCentralId, setFamilyCentralId] = useState("");
  const [isLoadingFamily, setIsLoadingFamily] = useState(false);
  const [familyError, setFamilyError] = useState("");

  const normalizedDigits = useMemo(() => normalizeId(query), [query]);
  const clearTree = () => { setFamilyData(null); setFamilyCentralId(""); setFamilyError(""); };
  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    if (!password) { setPasswordError("יש להזין סיסמה."); return; }
    if (await sha256(password) !== PASSWORD_HASH) { setPasswordError("הסיסמה לא נכונה."); return; }
    sessionStorage.setItem(SESSION_KEY, "1");
    setPassword("");
    setUnlocked(true);
  };

  const lock = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setUnlocked(false);
    setResults([]);
    setSearched(false);
    setLastQuery("");
    clearTree();
  };

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
        setResults(await searchFullDatasetsById(normalizedDigits));
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
        setLastQuery([searchCriteria.firstName, searchCriteria.lastName, searchCriteria.city, searchCriteria.age && `גיל ${searchCriteria.age}`].filter(Boolean).join(" · "));
        setResults(await searchFullDatasetsByText(searchCriteria));
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
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-300/15 p-2.5 text-fuchsia-200"><Network size={22}/></div><p className="bg-gradient-to-r from-fuchsia-200 to-violet-200 bg-clip-text font-serif text-lg font-bold tracking-[0.1em] text-transparent">OSINT Search</p></div>
        <button type="button" onClick={lock} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10"><LogOut size={15}/>נעילה</button>
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
          {mode === "details" && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input autoComplete="off" value={criteria.firstName} onChange={(event) => setCriteria((prev) => ({ ...prev, firstName: event.target.value }))} placeholder="שם פרטי" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
            <input autoComplete="off" value={criteria.lastName} onChange={(event) => setCriteria((prev) => ({ ...prev, lastName: event.target.value }))} placeholder="שם משפחה" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
            <input autoComplete="off" value={criteria.city} onChange={(event) => setCriteria((prev) => ({ ...prev, city: event.target.value }))} placeholder="יישוב" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
            <input type="number" min="1" max="120" inputMode="numeric" value={criteria.age} onChange={(event) => setCriteria((prev) => ({ ...prev, age: event.target.value }))} placeholder="גיל" className="h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400"/>
            <button type="submit" disabled={isSearching} className="h-12 rounded-xl bg-[#f2a9d2] px-6 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50 sm:col-span-2 lg:col-span-4">{isSearching ? <><LoaderCircle size={17} className="ml-2 inline animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2 inline"/>חיפוש לפי פרטים</>}</button>
          </div>}
        </form>
        {searchError && <p role="alert" className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{searchError}</p>}
        <div className="mt-4 text-xs text-white/45">התוצאות מאוחדות לרשומה אחת; פרטי כתובת וטלפון מוצגים לפי השנה הזמינה.</div>
      </section>

      {isSearching && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">החיפוש מתבצע…</p><p className="mt-1 text-sm text-white/50">נבדקים האינדקסים המלאים של המקורות ונשלפות רק שורות מתאימות.</p></div></section>}

      {searched && !isSearching && <section className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><h2 className="font-semibold">תוצאות חיפוש</h2><p className="mt-1 text-sm text-white/55">{results.length ? `נמצאו ${results.length} התאמות עבור ${lastQuery}` : `לא נמצאה התאמה עבור ${lastQuery}`}</p></div>
        {results.length > 0 ? <div className="grid gap-3 xl:grid-cols-2">{results.map((hit, index) => <article key={`${hit.nationalId}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div>{mode === "phone" && <p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-200/70">{hit.sourceKey === "facebook" ? "תוצאות Facebook" : "תוצאות מאוחדות — AGRON + Elector"}</p>}<h3 className="mt-1 text-lg font-semibold">{hit.fullName}</h3></div><span className={`rounded-full px-3 py-1 text-xs ${hit.confidence === "exact-id" || hit.confidence === "phone-match" || hit.confidence === "facebook-id-match" ? "border border-emerald-200/20 bg-emerald-200/10 text-emerald-100" : "border border-amber-200/20 bg-amber-200/10 text-amber-100"}`}>{hit.confidence === "exact-id" ? "התאמה מדויקת" : hit.confidence === "phone-match" ? "טלפון מדויק" : hit.confidence === "facebook-id-match" ? "מזהה Facebook מדויק" : hit.confidence === "text-match" ? "התאמת טקסט" : "התאמה אפשרית"}</span></div>
          <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-white/45">תעודת זהות</dt><dd className="font-mono">{hit.nationalId || "לא נמצא"}</dd></div>{hit.facebookId && <div><dt className="text-xs text-white/45">מזהה Facebook</dt><dd className="font-mono">{hit.facebookId}</dd></div>}{hit.phone && <div><dt className="text-xs text-white/45">טלפון {hit.phoneYear && <span>({hit.phoneYear})</span>}</dt><dd dir="auto">{hit.phone}</dd></div>}{hit.address && <div><dt className="text-xs text-white/45">כתובת {hit.addressYear && <span>({hit.addressYear})</span>}</dt><dd>{hit.address}</dd></div>}{hit.city && <div><dt className="text-xs text-white/45">יישוב</dt><dd>{hit.city}</dd></div>}{hit.cityCode && <div><dt className="text-xs text-white/45">קוד יישוב</dt><dd>{hit.cityCode}</dd></div>}{hit.age && <div><dt className="text-xs text-white/45">גיל</dt><dd>{hit.age}</dd></div>}{hit.birthDate && <div><dt className="text-xs text-white/45">תאריך לידה</dt><dd>{hit.birthDate}</dd></div>}</dl>
          {(hit.fatherId || hit.motherId || hit.spouseId) && <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-xs text-white/45">מזהים קשורים הרשומים במקור:</p><div className="flex flex-wrap gap-2">{hit.fatherId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">אב · {hit.fatherId}</span>}{hit.motherId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">אם · {hit.motherId}</span>}{hit.spouseId && <span className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">בן/בת זוג · {hit.spouseId}</span>}</div></div>}
          {hit.nationalId && <button type="button" onClick={() => void openFamily(hit)} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#f2a9d2]/30 bg-[#f2a9d2]/10 px-4 text-sm font-semibold text-[#ffc1dc] transition hover:bg-[#f2a9d2]/20"><UsersRound size={16}/>פתיחת עץ משפחה</button>}
        </article>)}</div> : !searchError ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center text-sm text-white/55">אין התאמות באינדקסים הנוכחיים. ודא שהפרטים הוקלדו נכון ונסה שוב.</div> : null}
      </section>}

      {familyError && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{familyError}</p>}
      {isLoadingFamily && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">טוען קשרים משפחתיים…</p><p className="mt-1 text-sm text-white/50">המידע נבנה מהקשרים המתועדים במאגר המקור.</p></div></section>}
      {familyData && familyCentralId && <section id="family-tree" className="scroll-mt-24 space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">Family relationship map</p><h2 className="mt-1 text-2xl font-bold text-white">עץ קשרים משפחתיים</h2><p className="mt-1 text-sm text-white/50">מרכז העץ: ת״ז {familyCentralId}</p></div><div className="flex flex-wrap gap-2 text-xs text-white/45"><span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2"><MapPin size={13}/> יישוב וכתובת לפי זמינות</span><span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2"><CalendarDays size={13}/> פרטי מקור</span></div></div><FamilyTree data={familyData} centralId={familyCentralId} onSelect={(id) => void changeFamilyCenter(id)}/></section>}
    </main>
    <footer className="border-t border-white/10 px-4 py-5 text-center font-serif text-xs tracking-[0.12em] text-white/35">OSINT Search</footer>
  </div>;
}
