"use client";

/**
 * New "act first, configure later" landing page (dark studio direction).
 * Lives as an independent route /start, leaving the homepage (currently being rewritten for i18n) untouched.
 * Users land and act immediately: upload a product image or describe a topic → kick off generation right away;
 * only prompted to configure a Key when AI is actually needed (Atlas one-click recommended).
 */

import { randomUUID } from "@/lib/uuid";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { ProductionProfilePicker } from "@/components/production-profile-picker";
import { useProductLibraryStore } from "@/lib/stores/product-library-store";
import { useCharacterStore } from "@/lib/stores/project-store";
import { getExampleProducts, type ExampleProduct } from "@/lib/examples";
import { useT, useLocale } from "@/lib/i18n";
import { ATLAS_KEYS_URL } from "@/lib/atlas-onekey";
import { formatRelativeTime } from "@/lib/relative-time";
import { classifyTrendTitle, pickDailyTrend, TREND_CATEGORY_IDS } from "@/lib/trends";
import type { TrendTopic, TrendCategoryId } from "@/lib/trends";

/** How many trend chips are shown at once; "shuffle" pages through the full board. */
const TRENDS_PAGE_SIZE = 8;

/** localStorage keys for the daily-persona picker (device-local, no account concept) */
const DAILY_PERSONA_KEY = "clipforge_daily_persona";
const DAILY_LAST_KEY = "clipforge_daily_last";

/** Local calendar date (YYYY-MM-DD) — "today" for the daily-pick marker follows the user's clock. */
function localDateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Mode = "upload" | "topic" | "link";

/** AI-mode commerce form → engine vocab: beginner-facing words map onto script style + video mode */
const FORM_PRESETS = {
  auto: { styleType: "auto", videoMode: "product_closeup" },
  presenter: { styleType: "talking_head", videoMode: "live_presenter" },
  drama: { styleType: "drama", videoMode: "live_presenter" },
  montage: { styleType: "auto", videoMode: "graphic_montage" },
} as const;
type FormId = keyof typeof FORM_PRESETS;

interface PickedImage {
  id: string;
  url: string;
  file: File;
}
interface RecentProject {
  id: string;
  name: string;
  productName: string | null;
  status: string;
  updatedAt: string | null;
}

export default function StartPage() {
  const router = useRouter();
  const t = useT("start");
  const locale = useLocale();
  const { llm } = useSettingsStore();
  const applyAtlasOneKey = useSettingsStore((s) => s.applyAtlasOneKey);
  const llmReady = llm.apiKey.trim().length > 0;
  // example products follow the UI language
  const examples = getExampleProducts(locale);

  const [mode, setMode] = useState<Mode>("upload");
  // generation-task mode: the free/paid fork, explicit with cost up front
  // (open-source BYOK — AI charges go to the user's own model platform, never to us)
  const [genMode, setGenMode] = useState<"free" | "ai">("free");
  // commerce form (AI mode only): what the finished video looks like
  const [form, setForm] = useState<FormId>("auto");
  const { characters } = useCharacterStore();
  const [presenterId, setPresenterId] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [topic, setTopic] = useState("");
  const [link, setLink] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  // which step of the busy takeover is running (index into busySteps)
  const [stageIdx, setStageIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const [atlasKey, setAtlasKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [trends, setTrends] = useState<TrendTopic[]>([]);
  const [trendsSource, setTrendsSource] = useState<string>("");
  const [trendsPage, setTrendsPage] = useState(0);
  const [trendsCat, setTrendsCat] = useState<"all" | TrendCategoryId>("all");
  // daily-persona picker state (persisted per device)
  const [dailyPersona, setDailyPersona] = useState("");
  const [dailyLast, setDailyLast] = useState<{ date: string; topic: string } | null>(null);
  const [dailyMsg, setDailyMsg] = useState<string>("");
  // first-visit guide card (dismiss persists per device; read after mount to keep SSR stable)
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    // deferred to a microtask: same pattern as the daily-persona loader (no sync setState in effect)
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        if (localStorage.getItem("clipforge_guide_dismissed") !== "1") setShowGuide(true);
      } catch { /* storage unavailable → keep hidden */ }
    });
    return () => { cancelled = true; };
  }, []);
  const dismissGuide = () => {
    setShowGuide(false);
    try { localStorage.setItem("clipforge_guide_dismissed", "1"); } catch { /* ignore */ }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const keyformRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // product-library hand-off: /start?productId=x pre-fills the upload tab, so the
  // library's "make video" button lands beginners on the same single creation path
  const { products: libraryProducts } = useProductLibraryStore();
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    const productId = new URLSearchParams(window.location.search).get("productId");
    if (!productId) return;
    const product = libraryProducts.find((p) => p.id === productId);
    if (!product) return; // store not hydrated yet (effect re-runs) or stale id
    prefilledRef.current = true;
    queueMicrotask(() => {
      setMode("upload");
      setProductName(product.name);
      if (product.description) setSellingPoints(product.description);
    });
    // fetch library images into File objects; local blob URLs from other pages may be dead — text stays filled either way
    (async () => {
      const files: PickedImage[] = [];
      for (const [i, src] of product.images.slice(0, 5).entries()) {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          const file = new File([blob], `product-${i}.png`, { type: blob.type || "image/png" });
          files.push({ id: randomUUID(), url: URL.createObjectURL(file), file });
        } catch {
          /* non-fatal per image */
        }
      }
      if (files.length) {
        setImages((prev) => {
          prev.forEach((p) => URL.revokeObjectURL(p.url));
          return files;
        });
      }
    })();
  }, [libraryProducts]);

  // fetch recent projects to give returning users a "continue" entry point (replaces the old homepage project list so they are not left stranded)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/project");
        const data = res.ok ? await res.json() : [];
        const list: RecentProject[] = Array.isArray(data) ? data : [];
        // sort by updatedAt desc so "recent" truly reflects last-edited order (null/invalid timestamps sink to the end)
        const ts = (p: RecentProject) => {
          if (!p.updatedAt) return 0;
          const time = new Date(p.updatedAt).getTime();
          return Number.isFinite(time) ? time : 0;
        };
        if (!cancelled) setRecent([...list].sort((a, b) => ts(b) - ts(a)).slice(0, 4));
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // trend radar ("what to post today"): Chinese UI reads domestic boards, English UI reads Google Trends.
  // Failure or an empty board silently hides the section — the landing page must never block on it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(locale === "zh" ? "/api/trends?source=cn&limit=48" : "/api/trends?geo=US&limit=48");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.topics)) return;
        // Curate for sellable content: keep only topics that classify into a creator
        // category, and drop "society" (news/incidents/politics) — raw boards lead with
        // headlines that make no sense as commerce videos and are a compliance risk for
        // AI-generated content.
        setTrends(
          data.topics.filter((tp: TrendTopic) => {
            if (typeof tp?.title !== "string" || !tp.title.trim()) return false;
            const cat = classifyTrendTitle(tp.title);
            return cat !== null && cat !== "society";
          })
        );
        setTrendsSource(typeof data.source === "string" ? data.source : "");
        setTrendsPage(0);
      } catch {
        /* keyless free endpoint — silent degradation */
      }
    })();
    return () => { cancelled = true; };
  }, [locale]);

  // load the persisted daily persona + today's marker once on mount
  // (deferred to a microtask: hydrating from localStorage after paint keeps SSR markup stable
  // and satisfies the no-sync-setState-in-effect rule)
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setDailyPersona(localStorage.getItem(DAILY_PERSONA_KEY) || "");
        const last = JSON.parse(localStorage.getItem(DAILY_LAST_KEY) || "null");
        if (last && typeof last.date === "string" && typeof last.topic === "string") setDailyLast(last);
      } catch {
        /* corrupted storage → start fresh */
      }
    });
    return () => { cancelled = true; };
  }, []);

  // categories present on the current board (chips render only for non-empty ones; hidden entirely when nothing classifies)
  const trendsCats = TREND_CATEGORY_IDS.filter((id) => trends.some((tp) => classifyTrendTitle(tp.title) === id));
  const catFiltered = trendsCat === "all" ? trends : trends.filter((tp) => classifyTrendTitle(tp.title) === trendsCat);

  // current slice of the filtered board; "shuffle" cycles through pages
  const trendsPageCount = Math.max(1, Math.ceil(catFiltered.length / TRENDS_PAGE_SIZE));
  const trendsShown = catFiltered.slice(
    (trendsPage % trendsPageCount) * TRENDS_PAGE_SIZE,
    (trendsPage % trendsPageCount) * TRENDS_PAGE_SIZE + TRENDS_PAGE_SIZE
  );
  const trendsSourceLabel =
    trendsSource === "douyin" ? t("trendsSourceDouyin") : trendsSource === "toutiao" ? t("trendsSourceToutiao") : "Google Trends";

  // tap a trend → prefill it as a one-sentence topic and bring the action card into view
  const pickTrend = (tp: TrendTopic) => {
    setMode("topic");
    setTopic(tp.title);
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  // daily pick: score the full board against the persona keywords, prefill the winner, remember today's pick
  const runDailyPick = () => {
    const pick = pickDailyTrend(trends, dailyPersona);
    if (!pick) return;
    pickTrend(pick.topic);
    setDailyMsg(t(pick.matched ? "dailyPickedMatched" : "dailyPickedFallback").replace("{topic}", pick.topic.title));
    const last = { date: localDateStamp(), topic: pick.topic.title };
    setDailyLast(last);
    try {
      localStorage.setItem(DAILY_LAST_KEY, JSON.stringify(last));
    } catch {
      /* storage full/blocked — the marker is a convenience, not a requirement */
    }
  };

  const onPersonaChange = (v: string) => {
    setDailyPersona(v);
    try {
      localStorage.setItem(DAILY_PERSONA_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // navigate to the appropriate step based on project status
  const stepFor = (status: string) =>
    status === "done" || status === "composing" || status === "video" ? "video" : status === "assets" ? "assets" : "script";

  // map project status to the short stage-label i18n key shown on recent-project cards
  const stageKeyFor = (status: string) =>
    status === "done" ? "pjStageDone" : status === "video" || status === "composing" ? "pjStageVideo" : status === "assets" ? "pjStageAssets" : "pjStageScript";

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    setImages((prev) => {
      const remaining = 5 - prev.length;
      if (remaining <= 0) return prev;
      const next = Array.from(files)
        .slice(0, remaining)
        .filter((f) => f.type.startsWith("image/"))
        .map((file) => ({ id: randomUUID(), url: URL.createObjectURL(file), file }));
      return [...prev, ...next];
    });
  }, []);

  const removeImage = (id: string) =>
    setImages((prev) => {
      const t = prev.find((i) => i.id === id);
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((i) => i.id !== id);
    });

  // one-click fill example: fetch the example image as a File into the upload zone + populate name/selling points
  const fillExample = useCallback(async (ex: ExampleProduct) => {
    setMode("upload");
    setProductName(ex.name);
    setSellingPoints(ex.sellingPoints);
    try {
      const res = await fetch(ex.image);
      const blob = await res.blob();
      const file = new File([blob], `${ex.id}.png`, { type: blob.type || "image/png" });
      setImages((prev) => {
        prev.forEach((i) => URL.revokeObjectURL(i.url));
        return [{ id: randomUUID(), url: URL.createObjectURL(file), file }];
      });
    } catch {
      /* image fetch failure is fine; the text fields are already filled */
    }
  }, []);

  const canStart =
    mode === "topic"
      ? topic.trim().length >= 2
      : mode === "link"
      ? /^https?:\/\/.+/i.test(link.trim())
      : images.length >= 1 && productName.trim().length > 0;

  // read LLM config live from the store: after one-click setup the newly written Key is immediately available in the same tick, avoiding stale closure values
  const llmConfig = () => {
    const l = useSettingsStore.getState().llm;
    return { baseUrl: l.baseUrl, apiKey: l.apiKey, model: l.model, visionModel: l.visionModel };
  };

  // creation-time choices flow into script generation and the script page's finishing gate
  const creationPreset = () => (genMode === "ai" ? FORM_PRESETS[form] : FORM_PRESETS.auto);
  const genQuery = () => {
    if (genMode !== "ai") return "";
    const p =
      (form === "presenter" || form === "drama") && presenterId
        ? `&presenter=${encodeURIComponent(presenterId)}`
        : "";
    return `&gen=ai${p}`;
  };
  const creationCharacter = () => {
    if (genMode !== "ai" || (form !== "presenter" && form !== "drama") || !presenterId) return null;
    const c = characters.find((x) => x.id === presenterId);
    return c ? { id: c.id, name: c.name, appearance: c.appearance || "", voiceStyle: c.voiceProfile?.style } : null;
  };

  // step labels for the busy takeover, per entry mode (rendered as a live checklist)
  const busySteps =
    mode === "upload"
      ? [t("stageCreate"), t("stageUpload"), t("stageScript")]
      : mode === "link"
      ? [t("stageIngest"), t("stageScript")]
      : [t("stageScript")];

  const startTopic = async () => {
    setStageIdx(0);
    setStage(t("stageScript"));
    const res = await fetch("/api/topic/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic.trim(), narrationStyle: "knowledge", targetDuration: 25, llmConfig: llmConfig() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.projectId) throw new Error(data.error || t("errTopicScript"));
    router.push(`/project/${data.projectId}/script?auto=1${genQuery()}`);
  };

  const startUpload = async () => {
    setStageIdx(0);
    setStage(t("stageCreate"));
    const projectRes = await fetch("/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: t("projectName", { name: productName }), productName, productCategory: "other", productDescription: sellingPoints, productImages: [] }),
    });
    if (!projectRes.ok) {
      const errData = await projectRes.json().catch(() => ({}));
      throw new Error(errData.error ? `${t("errProjectCreate")}: ${errData.error}` : t("errProjectCreate"));
    }
    const project = await projectRes.json();

    setStageIdx(1);
    setStage(t("stageUpload"));
    const fd = new FormData();
    images.forEach((i) => fd.append("files", i.file));
    fd.append("projectId", project.id);
    const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
    if (!uploadRes.ok) throw new Error(t("errUpload"));
    const { paths } = await uploadRes.json();
    await fetch(`/api/project/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productImages: paths }),
    });

    setStageIdx(2);
    setStage(t("stageScript"));
    const scriptRes = await fetch("/api/llm/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        productName,
        category: "other",
        productDescription: sellingPoints,
        targetDuration: 30,
        styleType: creationPreset().styleType,
        videoMode: creationPreset().videoMode,
        productImages: paths,
        llmConfig: llmConfig(),
        ...(creationCharacter() && { character: creationCharacter() }),
      }),
    });
    if (!scriptRes.ok) {
      const errData = await scriptRes.json().catch(() => ({}));
      throw new Error(errData.error ? `${t("errScript")}: ${errData.error}` : t("errScript"));
    }
    router.push(`/project/${project.id}/script?auto=1${genQuery()}`);
  };

  // paste a product URL → ingest (fetch page, parse title/price/images, create project) → auto-generate script → script page
  const startLink = async () => {
    setStageIdx(0);
    setStage(t("stageIngest"));
    const ingestRes = await fetch("/api/ingest/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: link.trim(), createProject: true }),
    });
    const data = await ingestRes.json().catch(() => ({}));
    if (!ingestRes.ok || !data.projectId) throw new Error(data.error || t("errIngest"));
    const p = data.product || {};
    setStageIdx(1);
    setStage(t("stageScript"));
    // even if script gen fails, the project exists with product data — the script page offers retry
    await fetch("/api/llm/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: data.projectId,
        productName: p.title || t("linkProductFallback"),
        category: "other",
        productDescription: p.description || "",
        targetDuration: 30,
        styleType: creationPreset().styleType,
        videoMode: creationPreset().videoMode,
        productImages: data.productImages || [],
        llmConfig: llmConfig(),
        ...(creationCharacter() && { character: creationCharacter() }),
      }),
    });
    router.push(`/project/${data.projectId}/script?auto=1${genQuery()}`);
  };

  // actually run generation (shared by all modes); restore busy/stage on failure
  const runGeneration = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "topic") await startTopic();
      else if (mode === "link") await startLink();
      else await startUpload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errGeneric"));
      setBusy(false);
      setStage("");
      setStageIdx(0);
    }
  };

  const onStart = () => {
    if (!canStart || busy) return;
    // no LLM configured: expand the Atlas one-click setup panel inline (no navigation, no loss of filled content)
    if (!llmReady) {
      setNeedKey(true);
      // the panel may be mounting this very tick — defer the scroll until React has committed it to the DOM
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          keyformRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      });
      return;
    }
    runGeneration();
  };

  // paste an Atlas Key → validate → write full config → immediately continue with generation
  const connectAtlasAndStart = async () => {
    const key = atlasKey.trim();
    if (!key || connecting || busy) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/ai/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "atlas-cloud", apiKey: key }),
      });
      const data = await res.json().catch(() => ({ status: "unknown" }));
      // only block on "explicitly invalid"; unknown (network/endpoint uncertainty) passes through and lets generation attempt proceed
      if (data.status === "invalid") {
        setConnectError(t("atlasKeyInvalid"));
        setConnecting(false);
        return;
      }
      applyAtlasOneKey(key);
      setConnecting(false);
      setNeedKey(false);
      await runGeneration();
    } catch {
      setConnectError(t("atlasConnectFailed"));
      setConnecting(false);
    }
  };

  return (
    <div className="cf-root">
      <style>{`
        .cf-root{--teal:#a78bfa;--ink:#ffffff;--text:#EDEFF4;--dim:#98A2B3;--muted:#5A6473;--surface:rgba(255,255,255,.035);--surface2:rgba(255,255,255,.06);--bd:rgba(255,255,255,.08);--bd2:rgba(255,255,255,.14);
          min-height:100vh;background:#0B0D12;color:var(--text);position:relative;overflow-x:hidden;
          font-family:ui-sans-serif,"PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;}
        .cf-amb{position:absolute;inset:0;pointer-events:none;background:radial-gradient(900px 420px at 50% -8%,rgba(139,92,246,.10),transparent 70%),radial-gradient(700px 500px at 85% 0%,rgba(124,92,255,.07),transparent 65%);}
        .cf-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(var(--bd) 1px,transparent 1px),linear-gradient(90deg,var(--bd) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(circle at 50% 22%,#000,transparent 72%);mask-image:radial-gradient(circle at 50% 22%,#000,transparent 72%);}
        .cf-wrap{position:relative;max-width:980px;margin:0 auto;padding:0 24px}
        .cf-hero{padding:52px 0 56px;text-align:center}
        .cf-eyebrow{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--teal);opacity:.85;margin-bottom:18px}
        .cf-h1{font-weight:700;font-size:clamp(34px,5.6vw,60px);line-height:1.04;letter-spacing:-.02em;margin-bottom:16px}
        .cf-h1 .hl{color:var(--teal);text-shadow:0 0 34px rgba(139,92,246,.35)}
        .cf-sub{color:var(--dim);font-size:16px;line-height:1.7;max-width:560px;margin:0 auto 34px}
        .cf-card{max-width:620px;margin:0 auto;background:var(--surface);border:1px solid var(--bd);border-radius:20px;padding:14px;backdrop-filter:blur(14px);box-shadow:0 30px 80px -40px rgba(0,0,0,.8);text-align:left}
        .cf-tabs{display:flex;gap:6px;background:rgba(0,0,0,.25);border-radius:13px;padding:5px;margin-bottom:14px}
        .cf-tab{flex:1;height:40px;border:0;border-radius:9px;background:transparent;color:var(--dim);font:inherit;font-size:14px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:.18s}
        .cf-tab.on{background:var(--surface2);color:var(--text);box-shadow:inset 0 0 0 1px var(--bd2)}
        .cf-drop{position:relative;border:1.5px dashed rgba(139,92,246,.40);border-radius:14px;background:radial-gradient(420px 160px at 50% 30%,rgba(139,92,246,.16),transparent 70%);padding:34px 24px 26px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;animation:cfBreathe 4.6s ease-in-out infinite;transition:border-color .18s}
        .cf-drop.drag{border-color:var(--teal)}
        @keyframes cfBreathe{0%,100%{box-shadow:0 0 46px -16px rgba(139,92,246,.30)}50%{box-shadow:0 0 78px -14px rgba(139,92,246,.5)}}
        .cf-dic{width:50px;height:50px;border-radius:16px;background:var(--surface2);border:1px solid var(--bd2);display:grid;place-items:center;color:var(--teal);margin-bottom:6px}
        .cf-dt{font-size:16px;font-weight:500}
        .cf-ds{font-size:13px;color:var(--muted)}
        .cf-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
        .cf-thumb{position:relative;width:62px;height:62px;border-radius:10px;overflow:hidden;border:1px solid var(--bd2)}
        .cf-thumb img{width:100%;height:100%;object-fit:cover}
        .cf-thumb button{position:absolute;top:2px;right:2px;width:18px;height:18px;border:0;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:12px;line-height:1;display:grid;place-items:center}
        .cf-field{margin-top:12px}
        .cf-input,.cf-area{width:100%;background:rgba(0,0,0,.25);border:1px solid var(--bd);border-radius:11px;color:var(--text);font:inherit;font-size:14px;padding:11px 13px;outline:none;transition:.18s}
        .cf-input:focus,.cf-area:focus{border-color:rgba(139,92,246,.45)}
        .cf-area{resize:none;min-height:84px;line-height:1.6}
        .cf-cta-row{display:flex;align-items:center;gap:14px;margin-top:14px;padding:2px 2px 2px}
        .cf-cta{height:48px;padding:0 24px;border:0;border-radius:12px;background:linear-gradient(100deg,#6366f1,#8b5cf6 55%,#d946ef);color:var(--ink);font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;box-shadow:0 12px 30px -12px rgba(139,92,246,.4);transition:.18s}
        .cf-cta:hover:not(:disabled){transform:translateY(-1px)}
        .cf-cta:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
        .cf-reassure{font-size:12.5px;color:var(--muted);line-height:1.5}
        .cf-reassure b{color:var(--dim);font-weight:600}
        .cf-genrow{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
        .cf-gen{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:rgba(0,0,0,.2);font:inherit;text-align:left;cursor:pointer;transition:.18s}
        .cf-gen b{font-size:13.5px;font-weight:600;color:var(--text)}
        .cf-gen span{font-size:11.5px;line-height:1.5;color:var(--muted)}
        .cf-gen:hover{border-color:var(--bd2)}
        .cf-gen.on{border-color:rgba(139,92,246,.55);background:rgba(139,92,246,.08)}
        .cf-gen.on b{color:var(--teal)}
        .cf-formrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}
        .cf-form-lbl{font-size:12px;color:var(--muted);flex:none;margin-right:2px}
        .cf-fchip{padding:5px 11px;border:1px solid var(--bd);border-radius:999px;background:transparent;color:var(--dim);font:inherit;font-size:12.5px;cursor:pointer;transition:.18s}
        .cf-fchip:hover{border-color:var(--bd2);color:var(--text)}
        .cf-fchip.on{border-color:rgba(139,92,246,.5);background:rgba(139,92,246,.1);color:var(--text)}
        .cf-form-select{background:rgba(0,0,0,.25);border:1px solid var(--bd);border-radius:9px;color:var(--text);font:inherit;font-size:12.5px;padding:5px 9px;outline:none}
        .cf-keybox{margin-top:12px;border:1px solid rgba(139,92,246,.3);background:rgba(139,92,246,.07);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--dim);display:flex;align-items:center;justify-content:space-between;gap:12px}
        .cf-keybox a{color:var(--ink);background:linear-gradient(100deg,#6366f1,#8b5cf6);padding:7px 13px;border-radius:9px;font-weight:600;text-decoration:none;white-space:nowrap}
        .cf-keyform{margin-top:12px;border:1px solid rgba(139,92,246,.32);background:rgba(139,92,246,.06);border-radius:14px;padding:14px}
        .cf-keyhead{font-size:14.5px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:9px;margin-bottom:5px}
        .cf-keyhead .badge{font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--ink);background:linear-gradient(100deg,#6366f1,#8b5cf6);border-radius:6px;padding:2px 8px}
        .cf-keyclose{margin-left:auto;width:26px;height:26px;flex:none;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center;transition:.18s}
        .cf-keyclose:hover{color:var(--text);border-color:var(--bd2);background:var(--surface2)}
        .cf-keydesc{font-size:12.5px;color:var(--dim);line-height:1.55;margin-bottom:11px}
        .cf-keydesc a{color:var(--teal);text-decoration:none;white-space:nowrap}
        .cf-keydesc a:hover{text-decoration:underline;text-underline-offset:2px}
        .cf-keyrow{display:flex;gap:8px}
        .cf-keyinput{flex:1;min-width:0;background:rgba(0,0,0,.3);border:1px solid var(--bd);border-radius:10px;color:var(--text);font:inherit;font-size:14px;padding:11px 13px;outline:none;transition:.18s}
        .cf-keyinput:focus{border-color:rgba(139,92,246,.5)}
        .cf-keybtn{padding:0 18px;border:0;border-radius:10px;background:linear-gradient(100deg,#6366f1,#8b5cf6 55%,#d946ef);color:var(--ink);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:7px;transition:.18s}
        .cf-keybtn:hover:not(:disabled){transform:translateY(-1px)}
        .cf-keybtn:disabled{opacity:.5;cursor:not-allowed}
        .cf-keyalt{margin-top:10px;font-size:12px}
        .cf-keyalt a{color:var(--muted);text-decoration:none;border-bottom:1px dashed var(--bd2);padding-bottom:1px}
        .cf-keyalt a:hover{color:var(--dim)}
        .cf-keyerr{margin-top:9px;color:#FCA5A5;font-size:12.5px}
        .cf-err{margin-top:12px;color:#FCA5A5;font-size:13px}
        .cf-prog{padding:30px 18px 22px;display:flex;flex-direction:column;align-items:center;gap:18px}
        .cf-prog-title{font-size:16px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:10px}
        .cf-spin{width:18px;height:18px;flex:none;border-radius:999px;border:2px solid rgba(139,92,246,.25);border-top-color:var(--teal);animation:cfSpin .8s linear infinite}
        .cf-spin.sm{width:10px;height:10px;border-width:1.5px}
        @keyframes cfSpin{to{transform:rotate(360deg)}}
        .cf-prog-steps{display:flex;flex-direction:column;gap:10px;width:min(320px,100%)}
        .cf-prog-step{display:flex;align-items:center;gap:11px;font-size:13.5px;color:var(--muted);transition:color .2s}
        .cf-prog-step.on{color:var(--text)}
        .cf-prog-step.done{color:var(--dim)}
        .cf-prog-step .ic{width:20px;height:20px;flex:none;display:grid;place-items:center;border-radius:999px;border:1px solid var(--bd2);font-size:11px;font-style:normal}
        .cf-prog-step.on .ic{border-color:rgba(139,92,246,.6)}
        .cf-prog-step.done .ic{border-color:rgba(139,92,246,.5);color:var(--teal)}
        .cf-prog-hint{font-size:12px;color:var(--muted);text-align:center;line-height:1.6}
        .cf-guide{max-width:620px;margin:14px auto 0;text-align:left;background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.25);border-radius:16px;padding:14px 16px;position:relative}
        .cf-guide-title{font-size:13.5px;font-weight:600;color:var(--text);margin-bottom:10px}
        .cf-guide-close{position:absolute;top:10px;right:10px;width:24px;height:24px;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;display:grid;place-items:center;transition:.15s}
        .cf-guide-close:hover{color:var(--text);background:var(--surface2)}
        .cf-guide-steps{display:flex;flex-direction:column;gap:7px}
        .cf-guide-step{display:flex;align-items:baseline;gap:9px;font-size:13px;color:var(--dim);line-height:1.55}
        .cf-guide-step b{flex:none;width:18px;height:18px;border-radius:999px;background:rgba(139,92,246,.18);color:var(--teal);font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transform:translateY(2px)}
        .cf-guide-foot{margin-top:10px;font-size:12px;color:var(--muted)}
        .cf-trends{max-width:620px;margin:26px auto 0;text-align:left;background:var(--surface);border:1px solid var(--bd);border-radius:16px;padding:14px 16px}
        .cf-trends-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
        .cf-trends-lbl{font-size:13px;font-weight:600;color:var(--dim);letter-spacing:.02em}
        .cf-trends-more{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid var(--bd);border-radius:999px;background:transparent;color:var(--muted);font:inherit;font-size:12px;cursor:pointer;transition:.18s}
        .cf-trends-more:hover{color:var(--dim);border-color:var(--bd2)}
        .cf-trend-list{display:flex;flex-direction:column;margin:0 -8px}
        .cf-trow{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:9px;transition:.15s}
        .cf-trow:hover{background:var(--surface2)}
        .cf-trow .trk{flex:none;width:18px;text-align:center;font-size:12px;font-style:normal;font-weight:700;color:var(--muted)}
        .cf-trow .trk.hot{color:#FDA4AF}
        .cf-trow .ttl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;background:none;border:0;color:var(--text);font:inherit;font-size:13.5px;cursor:pointer;padding:0}
        .cf-trow .ttl:hover{color:var(--teal)}
        .cf-trow .tv{flex:none;font-size:11px;color:var(--muted)}
        .cf-trow .tclone{flex:none;font-size:11.5px;color:var(--muted);text-decoration:none;padding:3px 9px;border:1px solid var(--bd);border-radius:999px;transition:.15s}
        .cf-trow .tclone:hover{color:var(--teal);border-color:rgba(139,92,246,.4)}
        .cf-trends-src{margin-top:9px;font-size:11.5px;color:var(--muted)}
        .cf-trends-cats{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}
        .cf-cat{padding:4px 10px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--muted);font:inherit;font-size:12px;cursor:pointer;transition:.18s}
        .cf-cat:hover{color:var(--dim)}
        .cf-cat.on{border-color:rgba(139,92,246,.4);background:rgba(139,92,246,.08);color:var(--text)}
        .cf-daily{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--bd)}
        .cf-daily-lbl{font-size:12.5px;font-weight:600;color:var(--dim);flex:none}
        .cf-daily-input{flex:1;min-width:0;background:rgba(0,0,0,.25);border:1px solid var(--bd);border-radius:9px;color:var(--text);font:inherit;font-size:13px;padding:7px 11px;outline:none;transition:.18s}
        .cf-daily-input:focus{border-color:rgba(139,92,246,.45)}
        .cf-daily-btn{padding:7px 14px;border:0;border-radius:9px;background:var(--surface2);color:var(--text);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:inset 0 0 0 1px var(--bd2);transition:.18s;flex:none}
        .cf-daily-btn:hover{box-shadow:inset 0 0 0 1px rgba(139,92,246,.45)}
        .cf-daily-msg{margin-top:8px;font-size:12px;color:var(--dim)}
        .cf-examples{margin-top:24px;font-size:13px;color:var(--muted);display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
        .cf-chip{padding:6px 12px;border:1px solid var(--bd);border-radius:999px;background:var(--surface);color:var(--dim);font:inherit;cursor:pointer;transition:.18s}
        .cf-chip:hover{border-color:rgba(139,92,246,.4);color:var(--text)}
        .cf-recent{max-width:620px;margin:22px auto 0;text-align:left}
        .cf-recent .lbl{font-size:12px;color:var(--muted);margin-bottom:8px;letter-spacing:.02em;display:flex;align-items:center;justify-content:space-between}
        .cf-recent .lbl-all{color:var(--muted);text-decoration:none;transition:.18s}
        .cf-recent .lbl-all:hover{color:var(--dim)}
        .cf-recent .row{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
        .cf-pj{display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid var(--bd);border-radius:12px;background:var(--surface);text-decoration:none;transition:.18s}
        .cf-pj:hover{border-color:var(--bd2);background:var(--surface2)}
        .cf-pj .dot{width:7px;height:7px;border-radius:999px;background:var(--teal);flex:none;box-shadow:0 0 8px var(--teal)}
        .cf-pj .col{min-width:0;display:flex;flex-direction:column;gap:2px}
        .cf-pj .nm{font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cf-pj-meta{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media (prefers-reduced-motion:reduce){.cf-drop{animation:none}}
      `}</style>

      <div className="cf-amb" />
      <div className="cf-grid" />
      <div className="cf-wrap">
        <section className="cf-hero">
          <div className="cf-eyebrow">{t("eyebrow")}</div>
          <h1 className="cf-h1">{t("h1Lead")}<span className="hl">{t("h1Highlight")}</span></h1>
          <p className="cf-sub">{t("sub")}</p>

          <div className="cf-card" ref={cardRef}>
            {busy ? (
              /* busy takeover: the whole card becomes a live checklist so the 20–60s
                 creation wait reads as progress, not a frozen button */
              <div className="cf-prog">
                <div className="cf-prog-title">
                  <span className="cf-spin" />
                  {t("progTitle")}
                </div>
                <div className="cf-prog-steps">
                  {busySteps.map((label, i) => (
                    <div key={label} className={`cf-prog-step${i < stageIdx ? " done" : i === stageIdx ? " on" : ""}`}>
                      <span className="ic">
                        {i < stageIdx ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l5 5L20 6" /></svg>
                        ) : i === stageIdx ? (
                          <span className="cf-spin sm" />
                        ) : (
                          i + 1
                        )}
                      </span>
                      {label}
                    </div>
                  ))}
                </div>
                <div className="cf-prog-hint">{t("progHint")}</div>
              </div>
            ) : (
              <>
            <div className="cf-tabs">
              <button className={`cf-tab${mode === "upload" ? " on" : ""}`} onClick={() => setMode("upload")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20" /></svg>
                {t("tabUpload")}
              </button>
              <button className={`cf-tab${mode === "link" ? " on" : ""}`} onClick={() => setMode("link")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                {t("tabLink")}
              </button>
              <button className={`cf-tab${mode === "topic" ? " on" : ""}`} onClick={() => setMode("topic")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19v3" /><path d="M8 22h8" /><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /></svg>
                {t("tabTopic")}
              </button>
            </div>

            {mode === "upload" ? (
              <>
                <div
                  className={`cf-drop${isDragging ? " drag" : ""}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
                >
                  <div className="cf-dic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg></div>
                  <div className="cf-dt">{t("dropTitle")}</div>
                  <div className="cf-ds">{t("dropSub")}</div>
                  <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
                </div>
                {images.length > 0 && (
                  <div className="cf-thumbs">
                    {images.map((i) => (
                      <div key={i.id} className="cf-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={i.url} alt={t("imgAlt")} />
                        <button onClick={(e) => { e.stopPropagation(); removeImage(i.id); }} aria-label={t("removeAria")}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="cf-field">
                  <input className="cf-input" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder={t("productNamePlaceholder")} />
                </div>
                <div className="cf-field">
                  <textarea className="cf-area" value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder={t("sellingPointsPlaceholder")} />
                </div>
              </>
            ) : mode === "link" ? (
              <div className="cf-field" style={{ marginTop: 0 }}>
                <input
                  className="cf-input"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canStart && !busy) runGeneration(); }}
                  placeholder={t("linkPlaceholder")}
                />
                <div className="cf-ds" style={{ marginTop: 8 }}>{t("linkHint")}</div>
              </div>
            ) : (
              <div className="cf-field" style={{ marginTop: 0 }}>
                <textarea className="cf-area" style={{ minHeight: 120 }} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("topicPlaceholder")} />
              </div>
            )}

            {/* generation-task mode: the free/paid fork every mature product makes explicit —
                cost and key requirements live ON the option, never behind it */}
            <div className="cf-genrow">
              {(["free", "ai"] as const).map((g) => (
                <button key={g} type="button" className={`cf-gen${genMode === g ? " on" : ""}`} onClick={() => setGenMode(g)}>
                  <b>{t(g === "free" ? "genFree" : "genAi")}</b>
                  <span>{t(g === "free" ? "genFreeDesc" : "genAiDesc")}</span>
                </button>
              ))}
            </div>
            {/* commerce form: only asked when it actually changes the outcome (AI visuals);
                the free quick cut uses generic stock footage where this choice is moot */}
            {genMode === "ai" && mode !== "topic" && (
              <div className="cf-formrow">
                <span className="cf-form-lbl">{t("formLabel")}</span>
                {(Object.keys(FORM_PRESETS) as FormId[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`cf-fchip${form === f ? " on" : ""}`}
                    title={t(`form_${f}_tip`)}
                    onClick={() => setForm(f)}
                  >
                    {t(`form_${f}`)}
                  </button>
                ))}
              </div>
            )}
            {/* presenter picking follows the domestic digital-human convention: face → lines → voice */}
            {genMode === "ai" && mode !== "topic" && (form === "presenter" || form === "drama") && characters.length > 0 && (
              <div className="cf-formrow">
                <span className="cf-form-lbl">{t("presenterLabel")}</span>
                <select className="cf-form-select" value={presenterId} onChange={(e) => setPresenterId(e.target.value)}>
                  <option value="">{t("presenterAuto")}</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {genMode === "ai" && <ProductionProfilePicker />}

            {needKey && !llmReady && (
              <div className="cf-keyform" ref={keyformRef}>
                <div className="cf-keyhead">
                  <span className="badge">{t("atlasBadge")}</span>
                  {t("atlasTitle")}
                  <button type="button" className="cf-keyclose" aria-label={t("atlasDismiss")} title={t("atlasDismiss")} onClick={() => setNeedKey(false)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="cf-keydesc">
                  {t("atlasDesc")}{" "}
                  <a href={ATLAS_KEYS_URL} target="_blank" rel="noreferrer">{t("atlasGetKey")} ↗</a>
                </div>
                <div className="cf-keyrow">
                  <input
                    className="cf-keyinput"
                    type="password"
                    value={atlasKey}
                    autoFocus
                    onChange={(e) => setAtlasKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") connectAtlasAndStart(); }}
                    placeholder={t("atlasKeyPlaceholder")}
                  />
                  <button className="cf-keybtn" onClick={connectAtlasAndStart} disabled={atlasKey.trim().length === 0 || connecting || busy}>
                    {connecting ? t("atlasConnecting") : busy ? (stage || t("busyDefault")) : t("atlasConnectStart")}
                    {!connecting && !busy && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
                  </button>
                </div>
                {connectError && <div className="cf-keyerr">{connectError}</div>}
                <div className="cf-keyalt">
                  <Link href="/settings?tab=llm">{t("atlasUseOther")}</Link>
                </div>
              </div>
            )}
            <div className="cf-cta-row">
              <button className="cf-cta" onClick={onStart} disabled={!canStart || busy}>
                {busy ? (stage || t("busyDefault")) : t("ctaStart")}
                {!busy && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
              </button>
              <div className="cf-reassure">{t("reassureLead")}<b>Atlas Cloud</b>{t("reassureTail")}</div>
            </div>
            {error && <div className="cf-err">{error}</div>}
              </>
            )}
          </div>

          {showGuide && (
            <div className="cf-guide">
              <button type="button" className="cf-guide-close" onClick={dismissGuide} aria-label={t("guideClose")}>✕</button>
              <div className="cf-guide-title">{t("guideTitle")}</div>
              <div className="cf-guide-steps">
                <div className="cf-guide-step"><b>1</b>{t("guideStep1")}</div>
                <div className="cf-guide-step"><b>2</b>{t("guideStep2")}</div>
                <div className="cf-guide-step"><b>3</b>{t("guideStep3")}</div>
              </div>
              <div className="cf-guide-foot">{t("guideFoot")}</div>
            </div>
          )}

          {recent.length > 0 && (
            <div className="cf-recent">
              <div className="lbl">
                {t("recentLabel")}
                <Link href="/projects" className="lbl-all">{t("recentAll")} →</Link>
              </div>
              <div className="row">
                {recent.map((p) => {
                  const rel = formatRelativeTime(p.updatedAt, locale);
                  return (
                    <Link key={p.id} href={`/project/${p.id}/${stepFor(p.status)}`} className="cf-pj">
                      <span className="dot" />
                      <span className="col">
                        <span className="nm">{p.name || p.productName || t("untitledProject")}</span>
                        <span className="cf-pj-meta">{t(stageKeyFor(p.status))}{rel ? ` · ${rel}` : ""}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {trends.length > 0 && (
            <div className="cf-trends">
              <div className="cf-trends-head">
                <span className="cf-trends-lbl">{t("trendsLabel")}</span>
                <button type="button" className="cf-trends-more" onClick={() => setTrendsPage((p) => p + 1)}>
                  {t("trendsRefresh")}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
                </button>
              </div>
              {trendsCats.length > 1 && (
                <div className="cf-trends-cats">
                  {(["all", ...trendsCats] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`cf-cat${trendsCat === id ? " on" : ""}`}
                      onClick={() => { setTrendsCat(id); setTrendsPage(0); }}
                    >
                      {id === "all" ? t("trendCatAll") : t(`trendCat_${id}`)}
                    </button>
                  ))}
                </div>
              )}
              {/* ranked list rows: scan-friendly, one action per row (was a wall of glued pills) */}
              <div className="cf-trend-list">
                {trendsShown.map((tp, i) => (
                  <div key={`${tp.source || "t"}-${tp.rank ?? tp.title}`} className="cf-trow">
                    <b className={`trk${typeof tp.rank === "number" && tp.rank <= 3 ? " hot" : ""}`}>
                      {typeof tp.rank === "number" ? tp.rank : i + 1}
                    </b>
                    <button
                      type="button"
                      className="ttl"
                      title={tp.context || tp.title}
                      onClick={() => pickTrend(tp)}
                    >
                      {tp.title}
                    </button>
                    {tp.traffic && <span className="tv">{tp.traffic}</span>}
                    <Link
                      href={`/project/clone?trend=${encodeURIComponent(tp.title)}`}
                      className="tclone"
                      title={t("trendCloneAria")}
                      aria-label={t("trendCloneAria")}
                    >
                      {t("trendCloneLabel")}
                    </Link>
                  </div>
                ))}
              </div>
              <div className="cf-trends-src">{t("trendsSourceNote", { source: trendsSourceLabel })}</div>

              <div className="cf-daily">
                <span className="cf-daily-lbl">{t("dailyLabel")}</span>
                <input
                  className="cf-daily-input"
                  value={dailyPersona}
                  onChange={(e) => onPersonaChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runDailyPick(); }}
                  placeholder={t("dailyPersonaPlaceholder")}
                />
                <button type="button" className="cf-daily-btn" onClick={runDailyPick}>{t("dailyPick")}</button>
              </div>
              {(dailyMsg || (dailyLast && dailyLast.date === localDateStamp())) && (
                <div className="cf-daily-msg">
                  {dailyMsg || t("dailyDoneHint").replace("{topic}", dailyLast?.topic ?? "")}
                </div>
              )}
            </div>
          )}

          <div className="cf-examples">
            {t("examplesLabel")}
            {examples.slice(0, 3).map((ex) => (
              <button key={ex.id} type="button" className="cf-chip" onClick={() => fillExample(ex)}>{ex.name} ¥{ex.price}</button>
            ))}
          </div>

        </section>
      </div>
    </div>
  );
}
