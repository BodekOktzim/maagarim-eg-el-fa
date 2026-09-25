import { useMemo, useState } from "react";
import { Download, GitBranch, LoaderCircle, Network, Search, ShieldCheck } from "lucide-react";
import FamilyTree, { type FamilyTreeData } from "@/components/FamilyTree";
import { buildSearchResultsCsv } from "@/lib/search-export";

const demoPeople = [
  { id: "demo-100000001", nationalId: "100000001", fullName: "אבי כהן", firstName: "אבי", lastName: "כהן", phone: "050-1111111", address: "הרצל 10", birthDate: "1955-03-12", sourceNames: ["DB_2006"] },
  { id: "demo-100000002", nationalId: "100000002", fullName: "דינה כהן", firstName: "דינה", lastName: "כהן", phone: "050-2222222", address: "הרצל 10", birthDate: "1958-07-04", sourceNames: ["DB_2006"] },
  { id: "demo-100000003", nationalId: "100000003", fullName: "יוסי כהן", firstName: "יוסי", lastName: "כהן", phone: "050-1234567", address: "רחוב הרצל 10", birthDate: "1985-02-10", sourceNames: ["DB_2020"] },
  { id: "demo-100000004", nationalId: "100000004", fullName: "משה כהן", firstName: "משה", lastName: "כהן", phone: "050-4444444", address: "הרצל 10", birthDate: "1987-09-21", sourceNames: ["DB_2020"] },
  { id: "demo-100000005", nationalId: "100000005", fullName: "גבי כהן", firstName: "גבי", lastName: "כהן", phone: "+972501234568", address: "הרצל 10 דירה 2", birthDate: "1990-01-30", sourceNames: ["FACEBOOK_DEMO"] },
  { id: "demo-100000006", nationalId: "100000006", fullName: "נועה לוי", firstName: "נועה", lastName: "לוי", phone: "050-9999999", address: "הנביאים 4", birthDate: "1988-11-11", sourceNames: ["DB_2020"] },
];

const relations: FamilyTreeData["relationships"] = [
  { id: "parent-yossi-father", personAId: "demo-100000003", personBId: "demo-100000001", type: "PARENT", confidence: "VERIFIED", evidence: { field: "father" }, source: "DB_2020" },
  { id: "parent-yossi-mother", personAId: "demo-100000003", personBId: "demo-100000002", type: "PARENT", confidence: "VERIFIED", evidence: { field: "mother" }, source: "DB_2020" },
  { id: "parent-moshe-father", personAId: "demo-100000004", personBId: "demo-100000001", type: "PARENT", confidence: "VERIFIED", evidence: { field: "father" }, source: "DB_2020" },
  { id: "parent-moshe-mother", personAId: "demo-100000004", personBId: "demo-100000002", type: "PARENT", confidence: "VERIFIED", evidence: { field: "mother" }, source: "DB_2020" },
  { id: "parent-gabi-father", personAId: "demo-100000005", personBId: "demo-100000001", type: "PARENT", confidence: "VERIFIED", evidence: { field: "father" }, source: "FACEBOOK_DEMO" },
  { id: "parent-gabi-mother", personAId: "demo-100000005", personBId: "demo-100000002", type: "PARENT", confidence: "VERIFIED", evidence: { field: "mother" }, source: "FACEBOOK_DEMO" },
  { id: "sibling-yossi-moshe", personAId: "demo-100000003", personBId: "demo-100000004", type: "SIBLING", confidence: "VERIFIED", source: "DB_2020" },
  { id: "sibling-yossi-gabi", personAId: "demo-100000003", personBId: "demo-100000005", type: "SIBLING", confidence: "VERIFIED", source: "FACEBOOK_DEMO" },
];
const familyData: FamilyTreeData = { people: demoPeople, relationships: relations };
const normalize = (value: string) => value.toLocaleLowerCase("he").replace(/[׳'".,\- ()]/g, "").trim();

type Mode = "national_id" | "phone" | "facebook_id" | "name";

export default function GitHubPagesHome() {
  const [mode, setMode] = useState<Mode>("national_id");
  const [query, setQuery] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matches, setMatches] = useState<typeof demoPeople>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const selected = useMemo(() => demoPeople.find((person) => person.id === selectedId) ?? null, [selectedId]);
  const runSearch = () => {
    if (isSearching) return;
    const value = normalize(query);
    const first = normalize(firstName);
    const last = normalize(lastName);
    const cityValue = normalize(city);
    const ageValue = age ? Number(age) : undefined;
    if (mode === "name" ? !first && !last && !cityValue && !ageValue : !value) return;
    setSearched(true);
    setSelectedId(null);
    setIsSearching(true);
    window.setTimeout(() => {
      const found = demoPeople.filter((person) => {
        if (mode === "national_id") return normalize(person.nationalId ?? "") === value;
        if (mode === "phone") return normalize(person.phone ?? "") === value;
        if (mode === "facebook_id") return value === "fb003" && person.id === "demo-100000005";
        const birthDate = person.birthDate;
        const actualAge = birthDate ? new Date().getFullYear() - Number(birthDate.slice(0, 4)) - (new Date().toISOString().slice(5, 10) < birthDate.slice(5, 10) ? 1 : 0) : undefined;
        return (!first || normalize(person.firstName ?? "").includes(first)) && (!last || normalize(person.lastName ?? "").includes(last)) && (!cityValue || normalize(person.address ?? "").includes(cityValue)) && (!ageValue || actualAge === ageValue);
      });
      setMatches(found);
      setSelectedId(found[0]?.id ?? null);
      setIsSearching(false);
    }, 550);
  };

  const exportResults = () => {
    const csv = buildSearchResultsCsv(matches, selected ? familyData.people : [], selected ? relations : [], selected?.id);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `family-search-demo-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div dir="rtl" className="min-h-screen bg-[#100b17] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#100b17]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-300/15 p-2.5 text-fuchsia-200"><Network size={22}/></div><div><p className="font-bold tracking-tight">מפת קשרים משפחתית</p><p className="text-xs text-white/45">חיפוש מבוסס מקור · תצוגת הדגמה</p></div></div>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-100">נתוני דמו בלבד</span>
      </div>
    </header>

    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-7 sm:py-10">
      <section className="search-hero overflow-hidden rounded-[28px] border border-fuchsia-200/10 bg-[#20102b] px-5 py-7 shadow-[0_24px_80px_rgba(46,24,61,0.35)] sm:px-9 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/80"><GitBranch size={14}/> חיפוש מאוחד</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">מצא את האדם. ראה את הקשרים.</h1><p className="mt-3 text-sm leading-6 text-white/65 sm:text-base">דמו אינטראקטיבי של חיפוש ותצוגת עץ משפחה. המידע שמוצג כאן סינתטי ואינו מגיע למאגרים האמיתיים.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><ShieldCheck className="text-fuchsia-200" size={28}/><p className="mt-2 text-xs text-white/55">חיפוש בדפדפן בלבד<br/>ללא חיבור למסד נתונים</p></div></div>

        <div className="mt-7 space-y-4">
          <label className="block text-sm font-semibold text-white">סוג החיפוש</label>
          <div className="grid gap-2 sm:grid-cols-4">
            {([["national_id", "תעודת זהות"], ["phone", "מספר טלפון"], ["facebook_id", "מזהה Facebook"], ["name", "חיפוש לפי פרטים"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setMode(value); setMatches([]); setSearched(false); setSelectedId(null); }} className={`rounded-xl border px-3 py-3 text-sm transition ${mode === value ? "border-fuchsia-200 bg-fuchsia-200/20 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>{label}</button>)}
          </div>
          {mode === "name" ? <div className="grid gap-3 sm:grid-cols-4">
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="שם פרטי" className="h-12 rounded-xl border border-white/10 bg-white px-4 text-slate-900 placeholder:text-slate-400"/>
            <input value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="שם משפחה" className="h-12 rounded-xl border border-white/10 bg-white px-4 text-slate-900 placeholder:text-slate-400"/>
            <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="עיר / כתובת" className="h-12 rounded-xl border border-white/10 bg-white px-4 text-slate-900 placeholder:text-slate-400"/>
            <input type="number" min="1" max="120" value={age} onChange={(event) => setAge(event.target.value.replace(/\D/g, ""))} placeholder="גיל" className="h-12 rounded-xl border border-white/10 bg-white px-4 text-slate-900 placeholder:text-slate-400"/>
            <button type="button" onClick={runSearch} disabled={isSearching || (!firstName.trim() && !lastName.trim() && !city.trim() && !age.trim())} className="h-12 rounded-xl bg-[#f2a9d2] px-5 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50 sm:col-span-4"><Search size={17} className="ml-2 inline"/>חפש</button>
          </div> : <div className="flex flex-col gap-3 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }} placeholder={mode === "national_id" ? "לדוגמה: 100000003" : mode === "phone" ? "לדוגמה: 050-1234567" : "לדוגמה: fb-003"} className="h-14 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"/><button type="button" onClick={runSearch} disabled={isSearching || !query.trim()} className="h-14 rounded-xl bg-[#f2a9d2] px-7 font-semibold text-[#30123e] transition hover:bg-[#f7c2e0] disabled:opacity-50"><Search size={17} className="ml-2 inline"/>חיפוש</button></div>}
          <div className="flex flex-wrap gap-2 text-xs text-white/55"><span>חיפושים לדוגמה:</span>{(mode === "national_id" ? ["100000003", "100000001"] : mode === "phone" ? ["050-1234567", "050-1111111"] : mode === "facebook_id" ? ["fb-003"] : ["יוסי", "כהן"]).map((example) => <button key={example} type="button" onClick={() => { if (mode === "name") { setFirstName(example); setLastName(""); setCity(""); setAge(""); } else setQuery(example); }} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10">{example}</button>)}</div>
        </div>
      </section>

      {isSearching && <section role="status" aria-live="polite" className="flex items-center gap-4 rounded-2xl border border-fuchsia-200/20 bg-[#1a1122] p-5"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-fuchsia-300" size={24}/><div><p className="font-semibold">החיפוש מתבצע…</p><p className="mt-1 text-sm text-white/50">מחפשים בדוגמאות המקומיות.</p></div></section>}

      {searched && !isSearching && <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div><h2 className="font-semibold">תוצאות חיפוש</h2><p className="mt-1 text-sm text-white/50">{matches.length ? `${matches.length} תוצאות בדמו` : "לא נמצאה התאמה בדוגמאות"}</p></div>{matches.length > 0 && <button type="button" onClick={exportResults} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10"><Download size={16}/>ייצוא תוצאות CSV</button>}</div>
        {matches.length > 0 ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{matches.map((person) => <button type="button" key={person.id} onClick={() => setSelectedId(person.id)} aria-pressed={selectedId === person.id} className={`rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 hover:border-fuchsia-300/50 ${selectedId === person.id ? "border-fuchsia-300/60 bg-fuchsia-200/10" : "border-white/10 bg-white/[0.04]"}`}><div className="flex items-center justify-between"><span className="font-semibold">{person.fullName}</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-fuchsia-100">פתח עץ</span></div><p className="mt-2 text-xs text-white/45">ת״ז לדוגמה: {person.nationalId} · {person.phone}</p><p className="mt-1 text-xs text-white/40">מקור דמו: {person.sourceNames.join(" · ")}</p></button>)}</div> : <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center text-sm text-white/55">לא נמצאה תוצאה. נסו את אחת הדוגמאות המוצעות.</div>}
        {selected && <div className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/65">האדם במרכז העץ</p><h3 className="mt-1 text-xl font-bold">{selected.fullName}</h3></div><span className="text-xs text-white/45">כל הפרטים בעץ הם נתוני המחשה</span></div><FamilyTree data={familyData} centralId={selected.id} onSelect={setSelectedId}/></div>}
      </section>}

      <section className="rounded-2xl border border-amber-200/15 bg-amber-100/[0.04] p-5 text-sm leading-6 text-white/65"><p className="font-semibold text-amber-100">הבהרה לגבי האתר הציבורי</p><p className="mt-1">GitHub Pages מארח אתר סטטי בלבד. הגרסה הזו מציגה חיפוש דמו ואינה מחוברת לקבצים האמיתיים או למסד נתונים. כדי לאפשר חיפוש במאגרים אמיתיים נדרש שירות שרת ומסד נתונים פרטיים ומוגנים — לא העלאה של המידע האישי לדפדפן.</p></section>
    </main>
    <footer className="border-t border-white/10 px-4 py-5 text-center text-xs text-white/35">Unified Data Intelligence · GitHub Pages · Demo only</footer>
  </div>;
}
