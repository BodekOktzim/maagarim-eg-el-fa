import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import FamilyTree from "@/components/FamilyTree";
import {
  Activity,
  BadgeCheck,
  Database,
  FileUp,
  GitBranch,
  MapPin,
  Network,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const demoQueries = [
  { label: "ת״ז לדוגמה", value: "100000003", type: "national_id" as const },
  { label: "טלפון לדוגמה", value: "050-1234567", type: "phone" as const },
  { label: "שם", value: "יוסי", type: "name" as const },
];
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const PARALLEL_UPLOADS = 4;
const RESUME_STORAGE_KEY = "maagarim-upload-resume";
const formatBytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type UploadState = { name: string; size: number; progress: number; status: string; resumable?: boolean };
type UploadMeta = { id: string; fileName: string; size: number; chunkSize: number; totalChunks: number; received: number[] };
type SavedUpload = { id: string; fileName: string; size: number; lastModified: number };

async function responseError(response: Response, fallback: string) {
  try { const body = await response.json() as { error?: string }; return body.error ?? fallback; }
  catch { return fallback; }
}

function detectType(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^\d{5,9}$/.test(digits) && digits.length === trimmed.length) return "national_id" as const;
  if (/^[+\d\- ()]+$/.test(trimmed) && digits.length >= 7) return "phone" as const;
  return trimmed.includes(" ") ? "name" as const : "name" as const;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"national_id" | "phone" | "name" | "address">("national_id");
  const [selected, setSelected] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [uploadCode, setUploadCode] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dashboard = trpc.dashboard.useQuery();
  const searchInput = useMemo(() => ({ query, type, page: 1, pageSize: 30 }), [query, type]);
  const results = trpc.search.useQuery(searchInput, { enabled: query.trim().length > 0 });
  const personInput = useMemo(() => ({ id: selected ?? "" }), [selected]);
  const familyInput = useMemo(() => ({ id: selected ?? "", depth: 3 as const }), [selected]);
  const person = trpc.person.useQuery(personInput, { enabled: Boolean(selected) });
  const family = trpc.family.useQuery(familyInput, { enabled: Boolean(selected) });
  const sources = trpc.sources.useQuery();
  const importMutation = trpc.import.useMutation();
  const ai = trpc.ai.useMutation();

  const runSearch = (value = query, forcedType?: typeof type) => {
    const nextType = forcedType ?? detectType(value);
    setQuery(value);
    setType(nextType);
  };

  const uploadChunk = async (meta: UploadMeta, file: File, index: number, code: string) => {
    const body = file.slice(index * meta.chunkSize, Math.min(file.size, (index + 1) * meta.chunkSize));
    let lastError = "Chunk upload failed";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(`/api/uploads/${meta.id}/chunks/${index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "x-upload-code": code },
          body,
        });
        if (response.ok) return;
        lastError = await responseError(response, lastError);
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
      if (attempt < 3) await sleep(500 * 2 ** attempt);
    }
    throw new Error(lastError);
  };

  const uploadFile = async (file: File) => {
    if (!uploadCode) {
      setUpload({ name: file.name, size: file.size, progress: 0, status: "יש להזין קוד העלאה" });
      return;
    }
    if (file.size === 0) {
      setUpload({ name: file.name, size: file.size, progress: 0, status: "לא ניתן לייבא קובץ ריק" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUpload({ name: file.name, size: file.size, progress: 0, status: "הקובץ גדול ממגבלת 2GB" });
      return;
    }

    setUpload({ name: file.name, size: file.size, progress: 0, status: "בודק אם קיימת העלאה שניתן להמשיך…", resumable: false });
    try {
      const headers = { "Content-Type": "application/json", "x-upload-code": uploadCode };
      let meta: UploadMeta | null = null;
      let saved: SavedUpload | null = null;
      try { saved = JSON.parse(localStorage.getItem(RESUME_STORAGE_KEY) ?? "null") as SavedUpload | null; } catch { saved = null; }
      if (saved && saved.fileName === file.name && saved.size === file.size && saved.lastModified === file.lastModified) {
        const statusResponse = await fetch(`/api/uploads/${saved.id}`, { headers: { "x-upload-code": uploadCode } });
        if (statusResponse.ok) meta = await statusResponse.json() as UploadMeta;
      }
      if (!meta) {
        const init = await fetch("/api/uploads/init", { method: "POST", headers, body: JSON.stringify({ fileName: file.name, size: file.size }) });
        if (!init.ok) throw new Error(await responseError(init, "Upload initialization failed"));
        meta = await init.json() as UploadMeta;
        localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify({ id: meta.id, fileName: file.name, size: file.size, lastModified: file.lastModified } satisfies SavedUpload));
      }

      const received = new Set(meta.received ?? []);
      const pending = Array.from({ length: meta.totalChunks }, (_, index) => index).filter((index) => !received.has(index));
      let uploadedChunks = meta.totalChunks - pending.length;
      setUpload({ name: file.name, size: file.size, progress: Math.round((uploadedChunks / meta.totalChunks) * 100), status: pending.length ? `מעלה ${pending.length} חלקים · ${PARALLEL_UPLOADS} במקביל` : "ההעלאה כבר הושלמה", resumable: uploadedChunks > 0 });
      let cursor = 0;
      const worker = async () => {
        while (cursor < pending.length) {
          const index = pending[cursor++];
          await uploadChunk(meta!, file, index, uploadCode);
          uploadedChunks++;
          setUpload((current) => current ? { ...current, progress: Math.round((uploadedChunks / meta!.totalChunks) * 100), status: `מעלה · ${uploadedChunks}/${meta!.totalChunks} חלקים` } : current);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, Math.max(1, pending.length)) }, () => worker()));

      const done = await fetch(`/api/uploads/${meta.id}/complete`, { method: "POST", headers: { "x-upload-code": uploadCode } });
      if (!done.ok) throw new Error(await responseError(done, "Upload completion failed"));
      const queued = await done.json() as { jobId: string };
      setUpload({ name: file.name, size: file.size, progress: 100, status: "העלאה הושלמה · הייבוא בתור", resumable: false });

      for (let attempt = 0; attempt < 300; attempt++) {
        await sleep(2000);
        const statusResponse = await fetch(`/api/import-jobs/${queued.jobId}`, { headers: { "x-upload-code": uploadCode } });
        if (!statusResponse.ok) break;
        const status = await statusResponse.json() as { state: string; progress?: { processed?: number } };
        const processed = status.progress?.processed ?? 0;
        setUpload((current) => current ? { ...current, progress: 100, status: status.state === "completed" ? `הייבוא הושלם · ${processed} רשומות` : status.state === "failed" ? "הייבוא נכשל" : `הייבוא פועל · ${processed} רשומות עובדו` } : current);
        if (status.state === "completed" || status.state === "failed") {
          if (status.state === "completed") localStorage.removeItem(RESUME_STORAGE_KEY);
          break;
        }
      }
    } catch (error) {
      setUpload((current) => current ? { ...current, status: error instanceof Error ? error.message : "ההעלאה נכשלה", resumable: true } : current);
    }
  };

  const chooseFile = (file?: File) => { if (file) void uploadFile(file); };
  const activePerson = person.data?.person;
  const familyData = family.data ? { people: family.data.people, relationships: family.data.relationships } : null;

  return <div dir="rtl" className="min-h-screen bg-[#f6f3f8] text-slate-900">
    <header className="sticky top-0 z-40 border-b border-white/50 bg-[#f6f3f8]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-2xl bg-[#20102b] p-2.5 text-fuchsia-200 shadow-lg shadow-fuchsia-950/20"><Network size={21}/></div>
          <div className="min-w-0" dir="ltr"><p className="text-sm font-bold tracking-tight text-[#20102b] sm:text-lg"><span className="hidden sm:inline">Unified Data Intelligence</span><span className="sm:hidden">Unified Intelligence</span></p><p className="hidden text-xs text-slate-500 sm:block">Evidence-first discovery · provenance preserved</p></div>
        </div>
        <Badge className="shrink-0 border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 hover:bg-emerald-50 sm:text-xs"><span className="ml-1.5 h-2 w-2 rounded-full bg-emerald-500"/> DEMO MODE</Badge>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-7 sm:py-8">
      <section className="search-hero overflow-hidden rounded-[28px] bg-[#20102b] px-5 py-7 text-white shadow-[0_24px_80px_rgba(46,24,61,0.2)] sm:px-9 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/80"><GitBranch size={14}/> חיפוש מאוחד</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">מצא את האדם. ראה את הקשרים.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-white/65 sm:text-base">חיפוש לפי תעודת זהות, טלפון, שם או כתובת — עם עץ משפחה ויזואלי שמבוסס רק על קשרים מאומתים.</p></div>
          <div className="hidden rounded-2xl border border-white/10 bg-white/5 p-4 sm:block"><ShieldCheck className="text-fuchsia-200" size={30}/><p className="mt-2 text-xs text-white/55">Zero Hallucination<br/>Source-backed only</p></div>
        </div>
        <div className="mt-7 flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} placeholder="הקלד ת״ז, טלפון, שם או כתובת" className="h-14 border-0 bg-white pr-12 text-base text-slate-900 placeholder:text-slate-400"/></div>
          <Button onClick={() => runSearch()} className="h-14 bg-[#f2a9d2] px-7 text-[#30123e] hover:bg-[#f7c2e0]"><Search size={17} className="ml-2"/> חיפוש</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="ml-1 text-xs text-white/45">סוג חיפוש:</span>
          {([ ["national_id", "תעודת זהות"], ["phone", "טלפון"], ["name", "שם"], ["address", "כתובת"] ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setType(value)} className={`rounded-full px-3 py-1.5 text-xs transition ${type === value ? "bg-white text-[#30123e]" : "bg-white/10 text-white/65 hover:bg-white/15"}`}>{label}</button>)}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">{demoQueries.map((item) => <button key={item.value} type="button" onClick={() => runSearch(item.value, item.type)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65 transition hover:bg-white/15">{item.label}: {item.value}</button>)}</div>
      </section>

      {results.data && <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-0 bg-white/80 shadow-sm"><CardHeader className="flex-row items-center justify-between border-b border-slate-100 pb-4"><div><CardTitle className="text-base">תוצאות חיפוש</CardTitle><p className="mt-1 text-xs text-slate-500">{results.data.total} תוצאות · סטטוס: {results.data.confidence === "VERIFIED" ? "התאמה מדויקת" : "התאמה אפשרית"}</p></div><Badge variant="outline" className="gap-1"><BadgeCheck size={13}/> {results.data.sources.length} מקורות</Badge></CardHeader><CardContent className="space-y-3 pt-5">{results.data.items.length ? results.data.items.map((p) => <button key={p.id} type="button" onClick={() => setSelected(p.id)} className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 hover:border-fuchsia-300 hover:shadow-md ${selected === p.id ? "border-fuchsia-300 bg-fuchsia-50/60" : "border-slate-100 bg-white"}`}><div className="min-w-0"><p className="font-semibold text-slate-900">{p.fullName}</p><p className="mt-1 truncate text-xs text-slate-500">ת״ז {p.nationalId ?? "לא נמצא"} · {p.phone ?? "טלפון לא נמצא"}</p><p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-400"><MapPin size={12}/>{p.address ?? "כתובת לא נמצאה"}</p></div><span className="shrink-0 rounded-full bg-[#20102b] px-3 py-2 text-xs text-white">פתח עץ</span></button>) : <div className="rounded-2xl bg-slate-50 p-7 text-center text-sm text-slate-500">לא נמצאה התאמה מדויקת. נסה טלפון, שם או ערך מנורמל.</div>}</CardContent></Card>
        <Card className="border-0 bg-white/80 shadow-sm"><CardHeader><CardTitle className="text-base">איך לקרוא את התוצאה</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-slate-600"><div className="flex gap-3"><ShieldCheck className="shrink-0 text-emerald-600" size={18}/><p><strong className="text-slate-900">Verified</strong> — התאמה לפי מזהה או קשר שמופיע במקור.</p></div><div className="flex gap-3"><GitBranch className="shrink-0 text-fuchsia-600" size={18}/><p>לחיצה על אדם פותחת אותו כמרכז עץ חדש.</p></div><div className="flex gap-3"><Database className="shrink-0 text-cyan-600" size={18}/><p>כל כרטיס מציג את המקורות שמאמתים את הנתון.</p></div></CardContent></Card>
      </section>}

      {selected && activePerson && familyData && <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700">Person details</p><h2 className="mt-1 text-2xl font-bold text-[#20102b]">{activePerson.fullName}</h2><p className="mt-1 text-sm text-slate-500">מרכז העץ · ת״ז {activePerson.nationalId ?? "לא נמצאה"}</p></div><div className="flex flex-wrap items-center gap-2">{activePerson.sourceNames.map((source) => <Badge key={source} variant="outline" className="bg-white">{source}</Badge>)}<Button variant="outline" size="sm" onClick={() => setSelected(null)}>סגור</Button></div></div>
        <FamilyTree data={familyData} centralId={selected} onSelect={setSelected}/>
        <div className="grid gap-4 md:grid-cols-3"><Card className="border-0 bg-white/80 shadow-sm"><CardContent className="p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Identity</p><p className="text-sm">ת״ז: {activePerson.nationalId ?? "לא נמצא"}</p><p className="mt-2 flex items-center gap-2 text-sm"><Phone size={14} className="text-fuchsia-600"/> {activePerson.phone ?? "טלפון לא נמצא"}</p><p className="mt-2 flex items-center gap-2 text-sm"><MapPin size={14} className="text-fuchsia-600"/> {activePerson.address ?? "כתובת לא נמצאה"}</p></CardContent></Card><Card className="border-0 bg-white/80 shadow-sm"><CardContent className="p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Provenance</p><p className="text-sm text-slate-600">הנתונים נשמרים לפי מקור ורשומה, ללא מחיקת ערכים היסטוריים.</p><p className="mt-3 text-xs text-slate-400">{person.data?.rawRecords.length ?? 0} רשומות מקור משויכות</p></CardContent></Card><Card className="border-0 bg-white/80 shadow-sm"><CardContent className="p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Relationships</p><p className="flex items-center gap-2 text-sm"><UsersRound size={15} className="text-cyan-600"/> {familyData.relationships.length} קשרים שנמצאו</p><p className="mt-2 text-xs text-slate-500">העץ ניתן להרחבה דרך בחירת כרטיס.</p></CardContent></Card></div>
      </section>}

      <section className="grid gap-6 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Card className="border-0 bg-white/80 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">מצב מקורות</CardTitle><Activity size={18} className="text-fuchsia-600"/></CardHeader><CardContent className="space-y-4">{sources.data?.map((source) => <div key={source.name}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{source.name}</span><span className="shrink-0 text-xs text-emerald-600">ready · {source.records}</span></div><Progress value={100}/></div>)}<Button variant="outline" className="mt-2 w-full" onClick={() => importMutation.mutate({ source: "SYNTHETIC_UPLOAD", batchSize: 2 })}><Upload size={16} className="ml-2"/> {importMutation.isPending ? "מייבא…" : "הרץ ייבוא דמו"}</Button></CardContent></Card>
        <Card className="border-0 bg-white/80 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">העלאת מקור חדש</CardTitle><Upload size={18} className="text-cyan-600"/></CardHeader><CardContent><p className="mb-3 text-sm leading-6 text-slate-500">העלאה בחתיכות, ניסיונות חוזרים והמשך אוטומטי. נתמך: CSV, TSV, TXT, JSON, JSONL, XLSX, ZIP ו־GZIP.</p><Input value={uploadCode} onChange={(e) => setUploadCode(e.target.value)} type="password" inputMode="numeric" placeholder="קוד גישה להעלאה" className="mb-3"/><input ref={inputRef} type="file" className="hidden" onChange={(e) => { chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }}/><button type="button" onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }} disabled={!uploadCode || upload?.status.includes("מעלה") === true} className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${dragging ? "border-cyan-500 bg-cyan-50" : "border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-cyan-50"} disabled:cursor-not-allowed disabled:opacity-60`}><FileUp size={24} className="mb-2 text-cyan-600"/><span className="text-sm font-semibold">בחר קובץ או גרור לכאן</span><span className="mt-1 text-xs text-slate-500">הקובץ המקורי אינו משתנה</span></button>{upload && <div className="mt-4 space-y-2"><div className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2"><Upload size={14} className="shrink-0 text-cyan-600"/><span className="truncate">{upload.name} · {formatBytes(upload.size)}</span></span><button aria-label="נקה סטטוס העלאה" onClick={() => setUpload(null)}><X size={15}/></button></div><Progress value={upload.progress}/><div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{upload.status}</span>{upload.resumable && <span className="flex shrink-0 items-center gap-1 text-cyan-700"><RefreshCw size={12}/> ניתן להמשיך</span>}</div></div>}</CardContent></Card>
        <Card className="border-0 bg-white/80 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">עוזר ראיות</CardTitle><Sparkles size={18} className="text-fuchsia-600"/></CardHeader><CardContent><p className="mb-4 text-sm leading-6 text-slate-500">שאל בשפה טבעית. התשובות מוגבלות לכלים דטרמיניסטיים ומציגות מקור.</p><div className="flex gap-2"><Input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="מי האחים של יוסי?"/><Button onClick={() => ai.mutate({ prompt: aiPrompt })} disabled={!aiPrompt || ai.isPending}>שאל</Button></div>{ai.data && <div className="mt-4 rounded-2xl bg-slate-50 p-4"><p className="font-medium">{ai.data.answer}</p><p className="mt-2 text-xs text-slate-500">{ai.data.confidence} · {ai.data.sources.join(", ") || "מקור לא נמצא"}</p></div>}</CardContent></Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">{[{icon: Database, label: "רשומות גולמיות", value: dashboard.data?.rawRecords ?? "—", tone: "bg-cyan-50 text-cyan-700"}, {icon: GitBranch, label: "קשרים מאומתים", value: dashboard.data?.relationships ?? "—", tone: "bg-fuchsia-50 text-fuchsia-700"}, {icon: Smartphone, label: "מותאם למובייל", value: "100%", tone: "bg-emerald-50 text-emerald-700"}].map(({ icon: Icon, label, value, tone }) => <Card key={label} className="border-0 bg-white/70 shadow-sm"><CardContent className="flex items-center gap-4 p-5"><div className={`rounded-xl p-3 ${tone}`}><Icon size={20}/></div><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div></CardContent></Card>)}</section>
    </main>
  </div>;
}
