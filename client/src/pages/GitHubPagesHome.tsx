import { useMemo, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, LockKeyhole, LogOut, Network, Search } from "lucide-react";
import { searchFullDatasetsById, type SearchHit } from "@/lib/full-dataset-search";

const PASSWORD_HASH = "3f46bdea034f311a14efe877f5592d84a7a6c97d9b917be3f55573311e6cdda7";
const SESSION_KEY = "maagarim-pages-unlocked-v2";
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [lastQuery, setLastQuery] = useState("");

  const normalizedDigits = useMemo(() => normalizeId(query), [query]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    if (!password) {
      setPasswordError("יש להזין סיסמה.");
      return;
    }
    if (await sha256(password) !== PASSWORD_HASH) {
      setPasswordError("הסיסמה לא נכונה.");
      return;
    }
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
  };

  const runSearch = async (value = query) => {
    if (isSearching) return;
    const digits = normalizeId(value);
    if (digits.length < 5 || digits.length > 9) {
      setSearchError("יש להזין מספר תעודת זהות בן 5–9 ספרות.");
      setResults([]);
      setSearched(false);
      return;
    }
    setSearchError("");
    setIsSearching(true);
    setSearched(true);
    setResults([]);
    setLastQuery(digits);
    try {
      const response = await searchFullDatasetsById(digits);
      setResults(response.hits);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "החיפוש נכשל. בדוק חיבור לאינטרנט ונסה שוב.");
    } finally {
      setIsSearching(false);
    }
  };

  const linkSearch = (value?: string) => {
    if (!value) return;
    const digits = normalizeId(value);
    if (digits.length >= 5 && digits.length <= 9) {
      setQuery(digits);
      void runSearch(digits);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
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

  return <div dir="rtl" className="min-h-screen bg-[#100b17] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#100b17]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-300/15 p-2.5 text-fuchsia-200"><Network size={22}/></div><p className="bg-gradient-to-r from-fuchsia-200 to-violet-200 bg-clip-text font-serif text-lg font-bold tracking-[0.1em] text-transparent">OSINT Search</p></div>
        <button type="button" onClick={lock} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10"><LogOut size={15}/>נעילה</button>
      </div>
    </header>

    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-7 sm:py-10">
      <section className="overflow-hidden rounded-[28px] border border-fuchsia-200/10 bg-[#20102b] px-5 py-7 shadow-[0_24px_80px_rgba(46,24,61,0.35)] sm:px-9 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">חיפוש לפי תעודת זהות</h1></div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void runSearch(); }} className="mt-7 flex flex-col gap-3 sm:flex-row">
          <input inputMode="numeric" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="תעודת זהות — 5 עד 9 ספרות" className="h-14 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/>
          <button type="submit" disabled={isSearching || normalizedDigits.length < 5 || normalizedDigits.length > 9} className="h-14 rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50">{isSearching ? <><LoaderCircle size={17} className="ml-2 inline animate-spin"/>מחפש…</> : <><Search size={17} className="ml-2 inline"/>חפש בכל המאגרים</>}</button>
        </form>
        {searchError && <p role="alert" className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{searchError}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/55"><span>מקורות:</span><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">AGRON 2006 · ת״ז מדויקת</span><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Elector · ת״ז מדויקת</span><span className="rounded-full border border-amber-200/15 bg-amber-200/5 px-3 py-1.5">Facebook · התאמה מספרית לבדיקה</span></div>
      </section>

      {isSearching && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">החיפוש מתבצע…</p><p className="mt-1 text-sm text-white/50">נבדקים שלושת אינדקסי המקור ומורדות רק שורות תואמות.</p></div></section>}

      {searched && !isSearching && <section className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><h2 className="font-semibold">תוצאות חיפוש</h2><p className="mt-1 text-sm text-white/55">{results.length ? `נמצאו ${results.length} התאמות עבור ${lastQuery}` : `לא נמצאה התאמה עבור ${lastQuery}`}</p></div>
        {results.length > 0 ? <div className="grid gap-3 lg:grid-cols-2">{results.map((hit, index) => <article key={`${hit.source}-${hit.nationalId}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-200/70">מקור: {hit.source}</p><h3 className="mt-1 text-lg font-semibold">{hit.fullName}</h3></div><span className={`rounded-full px-3 py-1 text-xs ${hit.confidence === "exact-id" ? "border border-emerald-200/20 bg-emerald-200/10 text-emerald-100" : "border border-amber-200/20 bg-amber-200/10 text-amber-100"}`}>{hit.confidence === "exact-id" ? "ת״ז בעמודת המקור" : "התאמה מספרית — יש לאמת"}</span></div>
          <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-white/45">תעודת זהות</dt><dd className="font-mono">{hit.nationalId}</dd></div>{hit.phone && <div><dt className="text-xs text-white/45">טלפון</dt><dd dir="auto">{hit.phone}</dd></div>}{hit.address && <div><dt className="text-xs text-white/45">כתובת</dt><dd>{hit.address}</dd></div>}{hit.city && <div><dt className="text-xs text-white/45">יישוב</dt><dd>{hit.city}</dd></div>}{hit.cityCode && <div><dt className="text-xs text-white/45">קוד יישוב</dt><dd>{hit.cityCode}</dd></div>}{hit.age && <div><dt className="text-xs text-white/45">גיל במקור</dt><dd>{hit.age}</dd></div>}{hit.birthDate && <div><dt className="text-xs text-white/45">תאריך לידה במקור</dt><dd>{hit.birthDate}</dd></div>}</dl>
          {(hit.fatherId || hit.motherId || hit.spouseId) && <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-xs text-white/45">מזהים קשורים הרשומים במקור:</p><div className="flex flex-wrap gap-2">{hit.fatherId && <button type="button" onClick={() => linkSearch(hit.fatherId)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">אב · {hit.fatherId}</button>}{hit.motherId && <button type="button" onClick={() => linkSearch(hit.motherId)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">אם · {hit.motherId}</button>}{hit.spouseId && <button type="button" onClick={() => linkSearch(hit.spouseId)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">בן/בת זוג · {hit.spouseId}</button>}</div></div>}
        </article>)}</div> : <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center text-sm text-white/55">אין התאמות באינדקסים הנוכחיים. ודא שהמספר הוקלד נכון.</div>}
      </section>}
    </main>
    <footer className="border-t border-white/10 px-4 py-5 text-center font-serif text-xs tracking-[0.12em] text-white/35">OSINT Search</footer>
  </div>;
}
