"use client";

/**
 * New "act first, configure later" landing page (dark studio direction).
 * Lives as an independent route /start, leaving the homepage (currently being rewritten for i18n) untouched.
 * Users land and act immediately: upload a product image or describe a topic → kick off generation right away;
 * only prompted to configure a Key when AI is actually needed (Atlas one-click recommended).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { getExampleProducts, type ExampleProduct } from "@/lib/examples";
import { useT, useLocale, useSetLocale } from "@/lib/i18n";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";

type Mode = "upload" | "topic" | "link";
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
  const setLocale = useSetLocale();
  const { llm } = useSettingsStore();
  const applyAtlasOneKey = useSettingsStore((s) => s.applyAtlasOneKey);
  const llmReady = llm.apiKey.trim().length > 0;
  // example products follow the UI language
  const examples = getExampleProducts(locale);
  // language toggle (Chinese ⇄ English)
  const toggleLocale = () => setLocale(LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]);

  const [mode, setMode] = useState<Mode>("upload");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [topic, setTopic] = useState("");
  const [link, setLink] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const [atlasKey, setAtlasKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // fetch recent projects to give returning users a "continue" entry point (replaces the old homepage project list so they are not left stranded)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/project");
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setRecent(Array.isArray(data) ? data.slice(0, 4) : []);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // navigate to the appropriate step based on project status
  const stepFor = (status: string) =>
    status === "done" || status === "composing" || status === "video" ? "video" : status === "assets" ? "assets" : "script";

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    setImages((prev) => {
      const remaining = 5 - prev.length;
      if (remaining <= 0) return prev;
      const next = Array.from(files)
        .slice(0, remaining)
        .filter((f) => f.type.startsWith("image/"))
        .map((file) => ({ id: crypto.randomUUID(), url: URL.createObjectURL(file), file }));
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
        return [{ id: crypto.randomUUID(), url: URL.createObjectURL(file), file }];
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

  const startTopic = async () => {
    const res = await fetch("/api/topic/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic.trim(), narrationStyle: "knowledge", targetDuration: 25, llmConfig: llmConfig() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.projectId) throw new Error(data.error || t("errTopicScript"));
    router.push(`/project/${data.projectId}/script`);
  };

  const startUpload = async () => {
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
        styleType: "auto",
        videoMode: "product_closeup",
        productImages: paths,
        llmConfig: llmConfig(),
      }),
    });
    if (!scriptRes.ok) {
      const errData = await scriptRes.json().catch(() => ({}));
      throw new Error(errData.error ? `${t("errScript")}: ${errData.error}` : t("errScript"));
    }
    router.push(`/project/${project.id}/script`);
  };

  // paste a product URL → ingest (fetch page, parse title/price/images, create project) → auto-generate script → script page
  const startLink = async () => {
    setStage(t("stageIngest"));
    const ingestRes = await fetch("/api/ingest/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: link.trim(), createProject: true }),
    });
    const data = await ingestRes.json().catch(() => ({}));
    if (!ingestRes.ok || !data.projectId) throw new Error(data.error || t("errIngest"));
    const p = data.product || {};
    setStage(t("stageScript"));
    const scriptRes = await fetch("/api/llm/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: data.projectId,
        productName: p.title || t("linkProductFallback"),
        category: "other",
        productDescription: p.description || "",
        targetDuration: 30,
        styleType: "auto",
        videoMode: "product_closeup",
        productImages: data.productImages || [],
        llmConfig: llmConfig(),
      }),
    });
    // even if script gen fails, the project exists with product data — land on the script page so the user can retry
    if (!scriptRes.ok) {
      router.push(`/project/${data.projectId}/script`);
      return;
    }
    router.push(`/project/${data.projectId}/script`);
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
    }
  };

  const onStart = () => {
    if (!canStart || busy) return;
    // no LLM configured: expand the Atlas one-click setup panel inline (no navigation, no loss of filled content)
    if (!llmReady) {
      setNeedKey(true);
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
        .cf-root{--teal:#5EEAD4;--ink:#04221E;--text:#EDEFF4;--dim:#98A2B3;--muted:#5A6473;--surface:rgba(255,255,255,.035);--surface2:rgba(255,255,255,.06);--bd:rgba(255,255,255,.08);--bd2:rgba(255,255,255,.14);
          min-height:100vh;background:#0B0D12;color:var(--text);position:relative;overflow-x:hidden;
          font-family:ui-sans-serif,"PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;}
        .cf-amb{position:absolute;inset:0;pointer-events:none;background:radial-gradient(900px 420px at 50% -8%,rgba(94,234,212,.10),transparent 70%),radial-gradient(700px 500px at 85% 0%,rgba(124,92,255,.07),transparent 65%);}
        .cf-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(var(--bd) 1px,transparent 1px),linear-gradient(90deg,var(--bd) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(circle at 50% 22%,#000,transparent 72%);mask-image:radial-gradient(circle at 50% 22%,#000,transparent 72%);}
        .cf-wrap{position:relative;max-width:980px;margin:0 auto;padding:0 24px}
        .cf-nav{display:flex;align-items:center;justify-content:space-between;height:72px}
        .cf-brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:18px;letter-spacing:-.01em}
        .cf-mark{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--teal),#6CA8FF);display:grid;place-items:center;box-shadow:0 0 22px -6px rgba(94,234,212,.5)}
        .cf-gear{width:34px;height:34px;border-radius:999px;border:1px solid var(--bd);background:var(--surface);color:var(--dim);display:grid;place-items:center;transition:.18s}
        .cf-gear:hover{color:var(--text);border-color:var(--bd2)}
        .cf-hero{padding:46px 0 36px;text-align:center}
        .cf-eyebrow{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--teal);opacity:.85;margin-bottom:18px}
        .cf-h1{font-weight:700;font-size:clamp(34px,5.6vw,60px);line-height:1.04;letter-spacing:-.02em;margin-bottom:16px}
        .cf-h1 .hl{color:var(--teal);text-shadow:0 0 34px rgba(94,234,212,.35)}
        .cf-sub{color:var(--dim);font-size:16px;line-height:1.7;max-width:560px;margin:0 auto 34px}
        .cf-card{max-width:620px;margin:0 auto;background:var(--surface);border:1px solid var(--bd);border-radius:20px;padding:14px;backdrop-filter:blur(14px);box-shadow:0 30px 80px -40px rgba(0,0,0,.8);text-align:left}
        .cf-tabs{display:flex;gap:6px;background:rgba(0,0,0,.25);border-radius:13px;padding:5px;margin-bottom:14px}
        .cf-tab{flex:1;height:40px;border:0;border-radius:9px;background:transparent;color:var(--dim);font:inherit;font-size:14px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:.18s}
        .cf-tab.on{background:var(--surface2);color:var(--text);box-shadow:inset 0 0 0 1px var(--bd2)}
        .cf-drop{position:relative;border:1.5px dashed rgba(94,234,212,.40);border-radius:14px;background:radial-gradient(420px 160px at 50% 30%,rgba(94,234,212,.16),transparent 70%);padding:34px 24px 26px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;animation:cfBreathe 4.6s ease-in-out infinite;transition:border-color .18s}
        .cf-drop.drag{border-color:var(--teal)}
        @keyframes cfBreathe{0%,100%{box-shadow:0 0 46px -16px rgba(94,234,212,.30)}50%{box-shadow:0 0 78px -14px rgba(94,234,212,.5)}}
        .cf-dic{width:50px;height:50px;border-radius:16px;background:var(--surface2);border:1px solid var(--bd2);display:grid;place-items:center;color:var(--teal);margin-bottom:6px}
        .cf-dt{font-size:16px;font-weight:500}
        .cf-ds{font-size:13px;color:var(--muted)}
        .cf-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
        .cf-thumb{position:relative;width:62px;height:62px;border-radius:10px;overflow:hidden;border:1px solid var(--bd2)}
        .cf-thumb img{width:100%;height:100%;object-fit:cover}
        .cf-thumb button{position:absolute;top:2px;right:2px;width:18px;height:18px;border:0;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:12px;line-height:1;display:grid;place-items:center}
        .cf-field{margin-top:12px}
        .cf-input,.cf-area{width:100%;background:rgba(0,0,0,.25);border:1px solid var(--bd);border-radius:11px;color:var(--text);font:inherit;font-size:14px;padding:11px 13px;outline:none;transition:.18s}
        .cf-input:focus,.cf-area:focus{border-color:rgba(94,234,212,.45)}
        .cf-area{resize:none;min-height:84px;line-height:1.6}
        .cf-cta-row{display:flex;align-items:center;gap:14px;margin-top:14px;padding:2px 2px 2px}
        .cf-cta{height:48px;padding:0 24px;border:0;border-radius:12px;background:var(--teal);color:var(--ink);font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;box-shadow:0 12px 30px -12px rgba(94,234,212,.4);transition:.18s}
        .cf-cta:hover:not(:disabled){transform:translateY(-1px)}
        .cf-cta:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
        .cf-reassure{font-size:12.5px;color:var(--muted);line-height:1.5}
        .cf-reassure b{color:var(--dim);font-weight:600}
        .cf-keybox{margin-top:12px;border:1px solid rgba(94,234,212,.3);background:rgba(94,234,212,.07);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--dim);display:flex;align-items:center;justify-content:space-between;gap:12px}
        .cf-keybox a{color:var(--ink);background:var(--teal);padding:7px 13px;border-radius:9px;font-weight:600;text-decoration:none;white-space:nowrap}
        .cf-keyform{margin-top:12px;border:1px solid rgba(94,234,212,.32);background:rgba(94,234,212,.06);border-radius:14px;padding:14px}
        .cf-keyhead{font-size:14.5px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:9px;margin-bottom:5px}
        .cf-keyhead .badge{font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--ink);background:var(--teal);border-radius:6px;padding:2px 8px}
        .cf-keydesc{font-size:12.5px;color:var(--dim);line-height:1.55;margin-bottom:11px}
        .cf-keydesc a{color:var(--teal);text-decoration:none;white-space:nowrap}
        .cf-keydesc a:hover{text-decoration:underline;text-underline-offset:2px}
        .cf-keyrow{display:flex;gap:8px}
        .cf-keyinput{flex:1;min-width:0;background:rgba(0,0,0,.3);border:1px solid var(--bd);border-radius:10px;color:var(--text);font:inherit;font-size:14px;padding:11px 13px;outline:none;transition:.18s}
        .cf-keyinput:focus{border-color:rgba(94,234,212,.5)}
        .cf-keybtn{padding:0 18px;border:0;border-radius:10px;background:var(--teal);color:var(--ink);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:7px;transition:.18s}
        .cf-keybtn:hover:not(:disabled){transform:translateY(-1px)}
        .cf-keybtn:disabled{opacity:.5;cursor:not-allowed}
        .cf-keyalt{margin-top:10px;font-size:12px}
        .cf-keyalt a{color:var(--muted);text-decoration:none;border-bottom:1px dashed var(--bd2);padding-bottom:1px}
        .cf-keyalt a:hover{color:var(--dim)}
        .cf-keyerr{margin-top:9px;color:#FCA5A5;font-size:12.5px}
        .cf-err{margin-top:12px;color:#FCA5A5;font-size:13px}
        .cf-examples{margin-top:24px;font-size:13px;color:var(--muted);display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
        .cf-chip{padding:6px 12px;border:1px solid var(--bd);border-radius:999px;background:var(--surface);color:var(--dim);cursor:pointer;transition:.18s}
        .cf-chip:hover{border-color:rgba(94,234,212,.4);color:var(--text)}
        .cf-adv{display:flex;justify-content:center;padding:30px 0 50px}
        .cf-adv a{font-size:12.5px;color:var(--muted);text-decoration:none;padding:8px 14px;border:1px solid transparent;border-radius:999px;transition:.18s}
        .cf-adv a:hover{color:var(--dim);border-color:var(--bd)}
        .cf-nav-r{display:flex;align-items:center;gap:8px}
        .cf-nlink{font-size:13px;color:var(--dim);text-decoration:none;padding:7px 12px;border-radius:999px;border:1px solid transparent;transition:.18s}
        .cf-nlink:hover{color:var(--text);border-color:var(--bd)}
        .cf-recent{max-width:620px;margin:22px auto 0;text-align:left}
        .cf-recent .lbl{font-size:12px;color:var(--muted);margin-bottom:8px;letter-spacing:.02em}
        .cf-recent .row{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
        .cf-pj{display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid var(--bd);border-radius:12px;background:var(--surface);text-decoration:none;transition:.18s}
        .cf-pj:hover{border-color:var(--bd2);background:var(--surface2)}
        .cf-pj .dot{width:7px;height:7px;border-radius:999px;background:var(--teal);flex:none;box-shadow:0 0 8px var(--teal)}
        .cf-pj .nm{font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media (prefers-reduced-motion:reduce){.cf-drop{animation:none}}
      `}</style>

      <div className="cf-amb" />
      <div className="cf-grid" />
      <div className="cf-wrap">
        <nav className="cf-nav">
          <div className="cf-brand">
            <span className="cf-mark">
              <svg width="16" height="16" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7" fill="#04221E" /><rect x="1" y="5" width="15" height="14" rx="3" fill="#04221E" /></svg>
            </span>
            ClipForge
          </div>
          <div className="cf-nav-r">
            <button type="button" onClick={toggleLocale} className="cf-nlink" title={locale === "zh" ? "Switch to English" : "切换到中文"}>{LOCALE_LABELS[locale]}</button>
            <Link href="/products" className="cf-nlink">{t("navProducts")}</Link>
            <Link href="/batch" className="cf-nlink">{t("navBatch")}</Link>
            <Link href="/settings" className="cf-gear" aria-label={t("navSettings")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </Link>
          </div>
        </nav>

        <section className="cf-hero">
          <div className="cf-eyebrow">{t("eyebrow")}</div>
          <h1 className="cf-h1">{t("h1Lead")}<span className="hl">{t("h1Highlight")}</span></h1>
          <p className="cf-sub">{t("sub")}</p>

          <div className="cf-card">
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

            {needKey && !llmReady ? (
              <div className="cf-keyform">
                <div className="cf-keyhead">
                  <span className="badge">{t("atlasBadge")}</span>
                  {t("atlasTitle")}
                </div>
                <div className="cf-keydesc">
                  {t("atlasDesc")}{" "}
                  <a href="https://www.atlascloud.ai" target="_blank" rel="noreferrer">{t("atlasGetKey")} ↗</a>
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
                  <Link href="/settings">{t("atlasUseOther")}</Link>
                </div>
              </div>
            ) : (
              <div className="cf-cta-row">
                <button className="cf-cta" onClick={onStart} disabled={!canStart || busy}>
                  {busy ? (stage || t("busyDefault")) : t("ctaStart")}
                  {!busy && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
                </button>
                <div className="cf-reassure">{t("reassureLead")}<b>Atlas Cloud</b>{t("reassureTail")}</div>
              </div>
            )}
            {error && <div className="cf-err">{error}</div>}
          </div>

          <div className="cf-examples">
            {t("examplesLabel")}
            {examples.slice(0, 3).map((ex) => (
              <span key={ex.id} className="cf-chip" onClick={() => fillExample(ex)}>{ex.name} ¥{ex.price}</span>
            ))}
          </div>

          {recent.length > 0 && (
            <div className="cf-recent">
              <div className="lbl">{t("recentLabel")}</div>
              <div className="row">
                {recent.map((p) => (
                  <Link key={p.id} href={`/project/${p.id}/${stepFor(p.status)}`} className="cf-pj">
                    <span className="dot" />
                    <span className="nm">{p.name || p.productName || t("untitledProject")}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="cf-adv">
          <Link href="/settings">{t("advLink")}</Link>
        </div>
      </div>
    </div>
  );
}
