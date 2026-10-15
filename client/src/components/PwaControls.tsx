import { useCallback, useEffect, useRef, useState } from "react";
import { Download, HardDriveDownload, Info, RefreshCw, Smartphone, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  deleteOfflineData,
  formatBytes as formatOfflineBytes,
  getOfflineState,
  pauseOfflineDownload,
  refreshOfflineState,
  startOfflineDownload,
  subscribeOfflineDownload,
  type OfflineDownloadState,
} from "@/lib/offline-data";

const BUILD_ID = String(import.meta.env.VITE_BUILD_ID ?? "dev");
const APP_BASE = import.meta.env.BASE_URL;

type ReleaseInfo = { buildId: string; version: string; builtAt: string; appBytes: number; downloadBytes: number };
type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type StorageEstimate = { usage?: number; quota?: number };

type Progress = { completed: number; total: number };

function formatBytes(bytes?: number) {
  if (!Number.isFinite(bytes) || !bytes || bytes < 0) return "לא זמין";
  if (bytes < 1024) return `${bytes} בתים`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function versionedWorkerUrl(buildId: string) {
  return `${APP_BASE}service-worker-${encodeURIComponent(buildId)}.js`;
}

function waitForReleaseWorker(registration: ServiceWorkerRegistration, buildId: string): Promise<ServiceWorker> {
  const targetUrl = new URL(versionedWorkerUrl(buildId), window.location.href).href;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("לא ניתן להכין את העדכון. בדקו את החיבור ונסו שוב.")), 60_000);
    const finish = (worker: ServiceWorker) => {
      window.clearTimeout(timeout);
      resolve(worker);
    };
    const check = () => {
      const candidates = [registration.waiting, registration.installing, registration.active];
      const worker = candidates.find((candidate) => candidate?.scriptURL === targetUrl);
      if (worker && (worker.state === "installed" || worker.state === "activated")) finish(worker);
    };
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", check);
      check();
    });
    registration.installing?.addEventListener("statechange", check);
    check();
  });
}

export default function PwaControls() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [manualInstructionsOpen, setManualInstructionsOpen] = useState(false);
  const [updateAccepted, setUpdateAccepted] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Progress | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineState, setOfflineState] = useState<OfflineDownloadState>(getOfflineState());
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const refreshStorageEstimate = useCallback(async () => {
    if (navigator.storage?.estimate) {
      try { setStorage(await navigator.storage.estimate()); } catch { setStorage(null); }
    }
  }, []);

  useEffect(() => {
    setIsInstalled(isStandalone());
    void refreshStorageEstimate();

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as DeferredInstallPrompt;
      setDeferredPrompt(promptEvent);
      setCanPromptInstall(true);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setCanPromptInstall(false);
      setDeferredPrompt(null);
      setInstallDialogOpen(false);
    };
    const onDisplayModeChange = () => setIsInstalled(isStandalone());
    const displayMode = window.matchMedia("(display-mode: standalone)");

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener?.("change", onDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener?.("change", onDisplayModeChange);
    };
  }, [refreshStorageEstimate]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineDownload(setOfflineState);
    void refreshOfflineState();
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;

    const checkLatestRelease = async (showPrompt = true) => {
      try {
        const response = await fetch(`${APP_BASE}pwa-version.json`, { cache: "no-store" });
        if (!response.ok) return;
        const release = await response.json() as ReleaseInfo;
        if (disposed) return;
        setLatestRelease(release);
        if (release.buildId !== BUILD_ID) {
          setUpdateAvailable(true);
          const wasDismissed = sessionStorage.getItem(`pwa-update-dismissed-${release.buildId}`) === "1";
          if (showPrompt && !wasDismissed) setUpdateDialogOpen(true);
        }
      } catch {
        // If the repository is temporarily unavailable, the cached app remains usable.
      }
    };

    const rollbackToCurrentRelease = async () => {
      try {
        registrationRef.current = await navigator.serviceWorker.register(versionedWorkerUrl(BUILD_ID), {
          scope: APP_BASE,
          updateViaCache: "none",
        });
      } catch {
        // Keep the current worker/cache; this rollback is best-effort after a failed download.
      }
    };

    const onWorkerMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; completed?: number; total?: number };
      if (message.type === "OSINT_CACHE_PROGRESS" || message.type === "OSINT_UPDATE_PROGRESS") {
        setDownloadProgress({ completed: message.completed ?? 0, total: message.total ?? 0 });
      }
      if (message.type === "OSINT_CACHE_READY") {
        setDownloadProgress(null);
        setStatusMessage("קובצי הממשק נשמרו במכשיר. נתוני החיפוש עצמם דורשים חיבור לאינטרנט.");
        void refreshStorageEstimate();
      }
      if (message.type === "OSINT_CACHE_FAILED") {
        setDownloadProgress(null);
        setStatusMessage("שמירת הממשק נכשלה. אפשר לנסות שוב כשהחיבור יציב.");
      }
      if (message.type === "OSINT_UPDATE_FAILED") {
        setDownloadProgress(null);
        setUpdateAccepted(false);
        setStatusMessage("העדכון לא הושלם. הגרסה הנוכחית נשארה פעילה; אפשר לנסות שוב.");
        void rollbackToCurrentRelease();
      }
      if (message.type === "OSINT_UPDATE_READY") {
        setStatusMessage("הקבצים החדשים מוכנים. האפליקציה נפתחת כעת בגרסה שאישרת.");
        window.setTimeout(() => window.location.reload(), 1200);
      }
    };
    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void (async () => {
      try {
        await checkLatestRelease();
        const existing = await navigator.serviceWorker.getRegistration(APP_BASE);
        registrationRef.current = existing ?? await navigator.serviceWorker.register(versionedWorkerUrl(BUILD_ID), {
          scope: APP_BASE,
          updateViaCache: "none",
        });
      } catch {
        // PWA features are progressive enhancement; the web app works without them.
      }
    })();

    const onReturn = () => {
      if (document.visibilityState === "visible") void checkLatestRelease();
    };
    document.addEventListener("visibilitychange", onReturn);
    const interval = window.setInterval(() => void checkLatestRelease(), 6 * 60 * 60 * 1000);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onReturn);
      window.clearInterval(interval);
      navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [refreshStorageEstimate]);

  const cacheCurrentRelease = async () => {
    if (!("serviceWorker" in navigator)) {
      setStatusMessage("הדפדפן אינו תומך בשמירת גרסת אפליקציה. אפשר להמשיך להשתמש באתר כשהוא מקוון.");
      return;
    }
    let worker = registrationRef.current?.active ?? navigator.serviceWorker.controller;
    if (!worker) {
      try {
        const registration = await navigator.serviceWorker.ready;
        registrationRef.current = registration;
        worker = registration.active;
      } catch { worker = null; }
    }
    if (!worker) {
      setStatusMessage("האפליקציה תישמר ברגע שה-Service Worker יהיה מוכן. השאירו את החלון פתוח לרגע.");
      return;
    }
    setDownloadProgress({ completed: 0, total: 0 });
    worker.postMessage({ type: "OSINT_CACHE_CURRENT" });
  };

  const confirmInstall = async () => {
    const promptEvent = deferredPrompt;
    if (!promptEvent) {
      setInstallDialogOpen(false);
      setManualInstructionsOpen(true);
      return;
    }
    setStatusMessage("");
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setDeferredPrompt(null);
      setCanPromptInstall(false);
      if (choice.outcome === "accepted") {
        setInstallDialogOpen(false);
        setDownloadProgress({ completed: 0, total: 0 });
        window.setTimeout(cacheCurrentRelease, 0);
      }
    } catch {
      setStatusMessage("הדפדפן לא פתח את בקשת ההתקנה. נסו דרך תפריט הדפדפן.");
    }
  };

  const confirmUpdate = async () => {
    if (!latestRelease || latestRelease.buildId === BUILD_ID || updateAccepted) return;
    setUpdateAccepted(true);
    setStatusMessage("");
    setDownloadProgress({ completed: 0, total: 0 });
    try {
      const registration = await navigator.serviceWorker.register(versionedWorkerUrl(latestRelease.buildId), {
        scope: APP_BASE,
        updateViaCache: "none",
      });
      registrationRef.current = registration;
      const worker = await waitForReleaseWorker(registration, latestRelease.buildId);
      worker.postMessage({ type: "OSINT_PREPARE_UPDATE" });
    } catch {
      setUpdateAccepted(false);
      setDownloadProgress(null);
      setStatusMessage("לא הצלחנו להכין את העדכון. הגרסה הקיימת נשארה פעילה; בדקו חיבור ונסו שוב.");
      try {
        registrationRef.current = await navigator.serviceWorker.register(versionedWorkerUrl(BUILD_ID), {
          scope: APP_BASE,
          updateViaCache: "none",
        });
      } catch { /* keep the previous release */ }
    }
  };

  const beginOfflineDownload = async () => {
    try {
      await startOfflineDownload();
      await refreshStorageEstimate();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatusMessage(error instanceof Error ? error.message : "הורדת נתוני האופליין נכשלה.");
      }
    }
  };

  const openOfflineDialog = () => {
    setOfflineDialogOpen(true);
    void refreshOfflineState();
  };

  const availableBytes = storage?.quota && storage.usage !== undefined
    ? Math.max(0, storage.quota - storage.usage)
    : undefined;
  const usedPercent = storage?.quota && storage.usage !== undefined
    ? Math.min(100, Math.round(storage.usage / storage.quota * 100))
    : null;
  const installBytes = latestRelease?.appBytes;
  const downloadBytes = latestRelease?.downloadBytes;
  const updateBytes = latestRelease?.appBytes;

  return <>
    <div className="flex items-center gap-2">
      <button type="button" onClick={openOfflineDialog} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200/25 bg-emerald-200/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-200/20"><HardDriveDownload size={15}/><span>נתוני אופליין</span></button>
      {!isInstalled && <button type="button" onClick={() => { setStatusMessage(""); setInstallDialogOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-fuchsia-200/25 bg-fuchsia-200/10 px-3 py-2 text-xs font-medium text-fuchsia-100 transition hover:bg-fuchsia-200/20">
        <Smartphone size={15}/><span>הורדה כאפליקציה</span>
      </button>}
      {updateAvailable && <button type="button" onClick={() => setUpdateDialogOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-200/20">
        <Download size={15}/><span>עדכון זמין</span>
      </button>}
    </div>

    {statusMessage && <p role="status" className="fixed bottom-4 left-4 z-[60] max-w-sm rounded-xl border border-white/15 bg-[#20102b] px-4 py-3 text-sm text-white shadow-2xl">{statusMessage}</p>}

    <Dialog open={offlineDialogOpen} onOpenChange={(open) => { if (offlineState.status !== "downloading") setOfflineDialogOpen(open); }}>
      <DialogContent dir="rtl" className="max-w-lg border-white/10 bg-[#20102b] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><HardDriveDownload className="text-emerald-200"/>חיפוש ללא אינטרנט</DialogTitle>
          <DialogDescription className="text-white/65">ההורדה אינה מתחילה אוטומטית. היא שומרת את מקורות הנתונים ואת כל האינדקסים הדרושים לחיפוש מלא גם אם האתר יימחק.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-4 text-sm">
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">גודל כולל להורדה</span><strong>{formatOfflineBytes(offlineState.totalBytes)}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">כבר נשמר במכשיר</span><strong>{formatOfflineBytes(offlineState.downloadedBytes)}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">מקום פנוי משוער</span><strong>{formatOfflineBytes(availableBytes)}</strong></p>
        </div>
        {offlineState.status === "downloading" && <div className="space-y-2" role="status"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300 transition-all" style={{ width: `${offlineState.totalBytes ? Math.min(100, offlineState.downloadedBytes / offlineState.totalBytes * 100) : 4}%` }}/></div><p className="text-xs text-white/70">מוריד {formatOfflineBytes(offlineState.downloadedBytes)} מתוך {formatOfflineBytes(offlineState.totalBytes)}{offlineState.currentPath ? ` · ${offlineState.currentPath}` : ""}</p></div>}
        {offlineState.status === "complete" ? <p className="rounded-lg bg-emerald-400/10 p-3 text-sm leading-6 text-emerald-100">כל הנתונים נשמרו. החיפוש יכול לעבוד ללא חיבור לאינטרנט כל עוד הנתונים המקומיים לא נמחקו.</p> : <p className="text-xs leading-6 text-white/55">מי שלא יוריד את הנתונים יוכל להתקין את האפליקציה, אבל החיפוש ימשיך להיות תלוי באתר ובחיבור לאינטרנט. ההורדה היא בערך 7.1GB וניתנת להשהיה ולהמשך.</p>}
        {offlineState.error && <p role="alert" className="rounded-lg bg-rose-400/10 p-3 text-sm text-rose-200">{offlineState.error}</p>}
        <DialogFooter className="gap-2 sm:justify-start">
          {offlineState.status === "complete" ? <button type="button" onClick={() => void deleteOfflineData()} className="min-h-11 rounded-xl border border-rose-200/20 px-4 text-rose-100 hover:bg-rose-400/10">מחק נתונים מהמכשיר</button> : offlineState.status === "downloading" ? <button type="button" onClick={pauseOfflineDownload} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-200 px-4 font-semibold text-[#143b2a] hover:bg-emerald-100">השהה הורדה</button> : <button type="button" onClick={() => void beginOfflineDownload()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-200 px-4 font-semibold text-[#143b2a] hover:bg-emerald-100">{offlineState.downloadedBytes ? "המשך הורדה" : "התחל הורדה"}</button>}
          <button type="button" disabled={offlineState.status === "downloading"} onClick={() => setOfflineDialogOpen(false)} className="min-h-11 rounded-xl border border-white/15 px-4 text-white/75 hover:bg-white/5 disabled:opacity-50">סגור</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
      <DialogContent dir="rtl" className="max-w-md border-white/10 bg-[#20102b] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><Smartphone className="text-fuchsia-200"/>התקנת OSINT Search</DialogTitle>
          <DialogDescription className="text-white/65">לפני בקשת ההתקנה, הנה גודל קובצי האפליקציה שיישמרו מקומית.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-4 text-sm">
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">הורדה מוערכת (נתונים דחוסים)</span><strong>{formatBytes(downloadBytes)}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">מקום שיידרש לאחר התקנה</span><strong>{formatBytes(installBytes)}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">מקום פנוי לאתר באחסון הדפדפן</span><strong>{formatBytes(availableBytes)}</strong></p>
          {usedPercent !== null && <p className="flex items-center justify-between gap-4"><span className="text-white/60">שימוש נוכחי באחסון הדפדפן</span><strong>{usedPercent}%</strong></p>}
        </div>
        <p className="text-xs leading-6 text-white/55">ההתקנה שומרת את קובצי הממשק והגרסה הנוכחית. מאגרי החיפוש עצמם נשארים מקוונים ואינם כלולים בהורדה. מחיקת נתוני האתר/הדפדפן או פינוי אוטומטי של אחסון עלולים להסיר את העותק המקומי.</p>
        <DialogFooter className="gap-2 sm:justify-start">
          <button type="button" onClick={() => void confirmInstall()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f2a9d2] px-4 font-semibold text-[#30123e] hover:bg-[#f7c2e0]"><Download size={16}/>{canPromptInstall ? "המשך להתקנה" : "הצג הוראות התקנה"}</button>
          <button type="button" onClick={() => setInstallDialogOpen(false)} className="min-h-11 rounded-xl border border-white/15 px-4 text-white/75 hover:bg-white/5">ביטול</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={manualInstructionsOpen} onOpenChange={setManualInstructionsOpen}>
      <DialogContent dir="rtl" className="max-w-md border-white/10 bg-[#20102b] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><Smartphone className="text-fuchsia-200"/>הוספה למסך הבית</DialogTitle>
          <DialogDescription className="text-white/65">ההתקנה נעשית מתוך תפריט הדפדפן במכשיר.</DialogDescription>
        </DialogHeader>
        <ol className="list-inside list-decimal space-y-2 text-sm leading-6 text-white/85">
          <li>ב-Chrome באנדרואיד: פתחו את תפריט ⋮ ובחרו „התקנת אפליקציה” או „הוספה למסך הבית”.</li>
          <li>ב-Safari באייפון: לחצו על שיתוף ואז „הוסף למסך הבית”.</li>
          <li>אשרו את ההתקנה בחלון של הדפדפן.</li>
        </ol>
        <p className="text-xs leading-6 text-white/55">לאחר ההתקנה, פתחו את האפליקציה והשאירו אותה פתוחה עד שיופיע שהממשק נשמר. בדפדפנים שאינם תומכים בהתקנה, אפשר להמשיך להשתמש באתר כרגיל.</p>
        <DialogFooter>
          <button type="button" onClick={() => { setManualInstructionsOpen(false); setInstallDialogOpen(false); cacheCurrentRelease(); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f2a9d2] px-4 font-semibold text-[#30123e] hover:bg-[#f7c2e0]">הבנתי, סיימתי התקנה</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={updateDialogOpen} onOpenChange={(open) => {
      if (updateAccepted) return;
      setUpdateDialogOpen(open);
      if (!open && latestRelease) sessionStorage.setItem(`pwa-update-dismissed-${latestRelease.buildId}`, "1");
    }}>
      <DialogContent dir="rtl" className="max-w-md border-white/10 bg-[#20102b] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><RefreshCw className="text-fuchsia-200"/>האפליקציה התעדכנה</DialogTitle>
          <DialogDescription className="text-white/65">קיימת גרסה חדשה. היא לא תותקן בלי אישורך; אם תבחר/י לא לעדכן, הגרסה הקיימת תישאר פעילה.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-4 text-sm">
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">גרסה נוכחית</span><strong dir="ltr">{BUILD_ID.slice(0, 7)}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">גרסה חדשה</span><strong dir="ltr">{latestRelease?.version ?? latestRelease?.buildId.slice(0, 7) ?? "—"}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">הורדה מוערכת (נתונים דחוסים)</span><strong>{formatBytes(downloadBytes)}</strong></p>
          <p className="flex items-center justify-between gap-4"><span className="text-white/60">מקום נוסף שיידרש זמנית</span><strong>{formatBytes(updateBytes)}</strong></p>
          {availableBytes !== undefined && updateBytes !== undefined && updateBytes > availableBytes && <p className="rounded-lg bg-rose-400/10 p-2 text-xs leading-5 text-rose-200">נראה שאין כרגע מספיק מקום פנוי באתר בדפדפן. פנו מקום ונסו שוב.</p>}
          {usedPercent !== null && <p className="flex items-center justify-between gap-4"><span className="text-white/60">שימוש נוכחי באחסון הדפדפן</span><strong>{usedPercent}%</strong></p>}
        </div>
        <p className="text-xs leading-6 text-white/55">רק קובצי הממשק והאייקונים מתעדכנים ונשמרים מקומית; מאגרי החיפוש נשארים מקוונים. העותק הישן נשאר עד שהחדש מוכן. אחרי אישור והתקנה מוצלחת, האפליקציה תיפתח מחדש והמטמון הישן יוסר. דחיית העדכון משאירה את גרסת האפליקציה הנוכחית קבועה, גם אחרי סגירה.</p>
        {downloadProgress && <div className="space-y-2" role="status"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-fuchsia-300 transition-all" style={{ width: `${downloadProgress.total ? downloadProgress.completed / downloadProgress.total * 100 : 8}%` }}/></div><p className="text-xs text-white/70">מוריד קובצי גרסה: {downloadProgress.completed}/{downloadProgress.total || "…"}</p></div>}
        {statusMessage && <p role="status" className="text-sm text-amber-200">{statusMessage}</p>}
        <DialogFooter className="gap-2 sm:justify-start">
          <button type="button" onClick={() => void confirmUpdate()} disabled={updateAccepted || (availableBytes !== undefined && updateBytes !== undefined && updateBytes > availableBytes)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f2a9d2] px-4 font-semibold text-[#30123e] hover:bg-[#f7c2e0] disabled:cursor-not-allowed disabled:opacity-50"><HardDriveDownload size={16}/>{updateAccepted ? "מוריד ומעדכן…" : "הורד ועדכן"}</button>
          <button type="button" onClick={() => setUpdateDialogOpen(false)} disabled={updateAccepted} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-white/75 hover:bg-white/5 disabled:opacity-50"><X size={15}/>לא עכשיו</button>
        </DialogFooter>
        {!updateAccepted && <p className="flex items-start gap-2 text-xs leading-5 text-white/45"><Info size={14} className="mt-0.5 shrink-0"/>הבחירה „לא עכשיו” משאירה את הגרסה המותקנת במטמון. העדכון יוצע שוב כשתבחר/י לפתוח אותו.</p>}
      </DialogContent>
    </Dialog>
  </>;
}
