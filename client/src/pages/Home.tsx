import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Search, Database, Network, ShieldCheck, Upload, Sparkles, Activity, ChevronRight, X, FileUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const demoQueries = ["100000003", "050-1234567", "יוסי", "הרצל 10"];
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
  const results = trpc.search.useQuery({ query, type }, { enabled: query.length > 0 });
  const person = trpc.person.useQuery({ id: selected ?? "" }, { enabled: Boolean(selected) });
  const family = trpc.family.useQuery({ id: selected ?? "", depth: 2 }, { enabled: Boolean(selected) });
  const sources = trpc.sources.useQuery();
  const importMutation = trpc.import.useMutation();
  const ai = trpc.ai.useMutation();

  const runSearch = (value = query) => {
    setQuery(value);
    if (value === "100000003") setType("national_id");
    else if (/\d/.test(value)) setType("phone");
    else if (value.includes("הרצל")) setType("address");
    else setType("name");
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
      setUpload({ name: file.name, size: file.size, progress: 0, status: "Enter the upload access code first" });
      return;
    }
    if (file.size === 0) {
      setUpload({ name: file.name, size: file.size, progress: 0, status: "Empty files cannot be imported" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUpload({ name: file.name, size: file.size, progress: 0, status: "File exceeds the 2GB limit" });
      return;
    }

    setUpload({ name: file.name, size: file.size, progress: 0, status: "Checking for a resumable upload…", resumable: false });
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
      setUpload({ name: file.name, size: file.size, progress: Math.round((uploadedChunks / meta.totalChunks) * 100), status: pending.length ? `Uploading ${pending.length} chunks · ${PARALLEL_UPLOADS} parallel` : "Upload already complete", resumable: uploadedChunks > 0 });
      let cursor = 0;
      const worker = async () => {
        while (cursor < pending.length) {
          const index = pending[cursor++];
          await uploadChunk(meta!, file, index, uploadCode);
          uploadedChunks++;
          setUpload((current) => current ? { ...current, progress: Math.round((uploadedChunks / meta!.totalChunks) * 100), status: `Uploading · ${uploadedChunks}/${meta!.totalChunks} chunks` } : current);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, Math.max(1, pending.length)) }, () => worker()));

      const done = await fetch(`/api/uploads/${meta.id}/complete`, { method: "POST", headers: { "x-upload-code": uploadCode } });
      if (!done.ok) throw new Error(await responseError(done, "Upload completion failed"));
      const queued = await done.json() as { jobId: string };
      setUpload({ name: file.name, size: file.size, progress: 100, status: `Upload complete · import queued`, resumable: false });

      for (let attempt = 0; attempt < 300; attempt++) {
        await sleep(2000);
        const statusResponse = await fetch(`/api/import-jobs/${queued.jobId}`, { headers: { "x-upload-code": uploadCode } });
        if (!statusResponse.ok) break;
        const status = await statusResponse.json() as { state: string; progress?: { processed?: number } };
        const processed = status.progress?.processed ?? 0;
        setUpload((current) => current ? { ...current, progress: 100, status: status.state === "completed" ? `Import completed · ${processed} records` : status.state === "failed" ? "Import failed" : `Import running · ${processed} records processed` } : current);
        if (status.state === "completed" || status.state === "failed") {
          if (status.state === "completed") localStorage.removeItem(RESUME_STORAGE_KEY);
          break;
        }
      }
    } catch (error) {
      setUpload((current) => current ? { ...current, status: error instanceof Error ? error.message : "Upload failed", resumable: true } : current);
    }
  };

  const chooseFile = (file?: File) => { if (file) void uploadFile(file); };

  return <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#102a43] p-2 text-white"><Network size={20}/></div><div><p className="text-lg font-semibold tracking-tight">Unified Data Intelligence</p><p className="text-xs text-slate-500">Synthetic Data Lab · Evidence-first discovery</p></div></div><Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500"/> DEMO MODE · synthetic only</Badge></div></header>
    <main className="mx-auto max-w-[1440px] space-y-6 px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden border-0 shadow-sm"><CardContent className="p-0"><div className="bg-[#102a43] px-7 py-6 text-white"><div className="flex items-start justify-between"><div><p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-sky-200">Cross-source search</p><h1 className="text-2xl font-semibold">Find the signal across every source.</h1><p className="mt-2 max-w-xl text-sm text-slate-300">Normalized IDs, phones, names and addresses — with provenance preserved at every step.</p></div><Search className="text-sky-200" size={28}/></div><div className="mt-6 flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} placeholder="ID, phone, name or address" className="h-12 border-0 bg-white text-slate-900 placeholder:text-slate-400"/><Button onClick={() => runSearch()} className="h-12 bg-[#e6b566] text-[#102a43] hover:bg-[#f0c37b]"><Search size={16} className="mr-2"/> Search</Button></div><div className="mt-3 flex flex-wrap gap-2">{demoQueries.map((q) => <button key={q} onClick={() => runSearch(q)} className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200 transition hover:bg-white/20">Try {q}</button>)}</div></div>{results.data && <div className="p-6"><div className="mb-4 flex items-center justify-between"><div><p className="font-semibold">{results.data.total} result{results.data.total !== 1 ? "s" : ""}</p><p className="text-xs text-slate-500">Confidence: {results.data.confidence} · paginated</p></div><Badge variant="outline">{results.data.sources.length} source links</Badge></div>{results.data.items.map((p) => <button key={p.id} onClick={() => setSelected(p.id)} className="mb-3 flex w-full items-center justify-between rounded-xl border bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm"><div><p className="font-medium">{p.fullName}</p><p className="mt-1 text-xs text-slate-500">ID {p.nationalId ?? "—"} · {p.phone ?? "No phone"} · {p.address ?? "No address"}</p></div><ChevronRight size={18} className="text-slate-400"/></button>)}</div>}</CardContent></Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{[{icon:Database,label:"Unified records",value:dashboard.data?.rawRecords ?? "—",tone:"bg-sky-50 text-sky-700"},{icon:Network,label:"Verified relationships",value:dashboard.data?.relationships ?? "—",tone:"bg-violet-50 text-violet-700"},{icon:ShieldCheck,label:"Evidence coverage",value:"100%",tone:"bg-emerald-50 text-emerald-700"}].map(({icon:Icon,label,value,tone}) => <Card key={label} className="border-0 shadow-sm"><CardContent className="flex items-center gap-4 p-5"><div className={`rounded-xl p-3 ${tone}`}><Icon size={20}/></div><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div></CardContent></Card>)}</div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="border-0 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Source health</CardTitle><Activity size={18} className="text-slate-400"/></CardHeader><CardContent className="space-y-4">{sources.data?.map((s) => <div key={s.name}><div className="mb-1 flex justify-between text-sm"><span>{s.name}</span><span className="text-xs text-emerald-600">ready · {s.records} records</span></div><Progress value={100}/></div>)}<Button variant="outline" className="mt-2 w-full" onClick={() => importMutation.mutate({ source: "SYNTHETIC_UPLOAD", batchSize: 2 })}><Upload size={16} className="mr-2"/> {importMutation.isPending ? "Importing…" : "Run synthetic demo import"}</Button></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Upload data file</CardTitle><Upload size={18} className="text-sky-600"/></CardHeader><CardContent>
          <p className="mb-3 text-sm text-slate-500">Upload up to <strong>2GB</strong>. Files are split into 8MB pieces and sent in parallel with automatic retry. Supported data formats include CSV, TSV, TXT, JSON, JSONL, NDJSON, XLSX, XLS, ODS, ZIP and GZIP.</p>
          <Input value={uploadCode} onChange={(e) => setUploadCode(e.target.value)} type="password" inputMode="numeric" placeholder="Upload access code" className="mb-3"/>
          <input ref={inputRef} type="file" className="hidden" onChange={(e) => { chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }}/>
          <button type="button" onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }} disabled={!uploadCode || upload?.status.startsWith("Uploading") === true} className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${dragging ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50"} disabled:cursor-not-allowed disabled:opacity-60`}><FileUp size={25} className="mb-2 text-sky-600"/><span className="text-sm font-medium">Choose a file or drag it here</span><span className="mt-1 text-xs text-slate-500">The server validates the format and size before upload</span></button>
          {upload && <div className="mt-4 space-y-2"><div className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2"><Upload size={14} className="shrink-0 text-sky-600"/><span className="truncate">{upload.name} · {formatBytes(upload.size)}</span></span><button aria-label="Clear upload status" onClick={() => setUpload(null)}><X size={15}/></button></div><Progress value={upload.progress}/><div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{upload.status}</span>{upload.resumable && <span className="flex shrink-0 items-center gap-1 text-sky-700"><RefreshCw size={12}/> Resume available</span>}</div></div>}
        </CardContent></Card>
        <Card className="border-0 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">AI evidence assistant</CardTitle><Sparkles size={18} className="text-[#b7791f"/></CardHeader><CardContent><p className="mb-4 text-sm text-slate-500">Ask in natural language. The orchestrator can only call allowlisted deterministic tools.</p><div className="flex gap-2"><Input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="מי האחים של יוסי?"/><Button onClick={() => ai.mutate({ prompt: aiPrompt })} disabled={!aiPrompt || ai.isPending}>Ask</Button></div>{ai.data && <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="font-medium">{ai.data.answer}</p><p className="mt-2 text-xs text-slate-500">{ai.data.confidence} · {ai.data.sources.join(", ") || "No source"}</p></div>}</CardContent></Card>
      </div>
      {selected && person.data && <Card className="border-0 shadow-sm"><CardHeader><CardTitle>{person.data.person.fullName}</CardTitle></CardHeader><CardContent className="grid gap-6 lg:grid-cols-3"><div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Identity</p><p className="text-sm">National ID: {person.data.person.nationalId}</p><p className="text-sm">Phone: {person.data.person.phone}</p><p className="text-sm">Address: {person.data.person.address}</p></div><div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Family graph · depth 2</p><div className="flex flex-wrap gap-2">{family.data?.people.map((p) => <button key={p.id} onClick={() => setSelected(p.id)} className={`rounded-lg border px-3 py-2 text-xs ${p.id === selected ? "border-sky-400 bg-sky-50" : "bg-white"}`}>{p.fullName}</button>)}</div></div><div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Provenance</p>{person.data.person.sourceNames.map((s) => <Badge key={s} variant="outline" className="mr-2">{s}</Badge>)}<p className="mt-3 text-xs text-slate-500">Deterministic evidence is preserved per source.</p></div></CardContent></Card>}
    </main>
  </div>;
}
