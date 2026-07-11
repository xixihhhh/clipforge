"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LuPlus, LuTrash2, LuUser, LuStar, LuUpload, LuPalette, LuZap, LuCheck } from "react-icons/lu";
import { useT } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useCharacterStore, type Character } from "@/lib/stores/project-store";
import { useBrandStore } from "@/lib/stores/brand-store";
import {
  TTS_PROVIDERS,
  OPENAI_TTS_PRESETS,
  getTTSProviderMeta,
  resolveTTSConfig,
  isPaidTTSReady,
  type TTSProvider,
} from "@/lib/tts-presets";
import { mergeCustomModels } from "@/lib/gen-params";
import { GenerationSettings } from "@/components/generation-settings";

// default resolution options
const resolutionOptions = [
  { value: "720p", label: "720p (1280x720)" },
  { value: "1080p", label: "1080p (1920x1080)" },
];

// default aspect ratio options (labelKey is rendered per language inside the component)
const aspectRatioOptions = [
  { value: "9:16", labelKey: "aspect916" },
  { value: "16:9", labelKey: "aspect169" },
  { value: "1:1", labelKey: "aspect11" },
];

// AI platform configuration list
const AI_PROVIDERS = [
  {
    key: "atlas-cloud",
    name: "Atlas Cloud",
    descKey: "providerAtlasDesc",
    tipKey: "providerAtlasTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    ),
    iconBg: "from-blue-500 to-cyan-500",
  },
  {
    key: "fal-ai",
    name: "fal.ai",
    descKey: "providerFalDesc",
    tipKey: "providerFalTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    iconBg: "from-purple-500 to-pink-500",
  },
  {
    key: "replicate",
    name: "Replicate",
    descKey: "providerReplicateDesc",
    tipKey: "providerReplicateTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    iconBg: "from-slate-500 to-gray-700",
  },
  {
    key: "volcengine",
    name: "火山引擎",
    descKey: "providerVolcengineDesc",
    tipKey: "providerVolcengineTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      </svg>
    ),
    iconBg: "from-orange-500 to-red-500",
  },
  {
    key: "alibaba",
    name: "阿里百炼",
    descKey: "providerAlibabaDesc",
    tipKey: "providerAlibabaTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    iconBg: "from-amber-500 to-orange-500",
  },
  {
    key: "siliconflow",
    name: "硅基流动",
    descKey: "providerSiliconflowDesc",
    tipKey: "providerSiliconflowTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M15 2v2" />
        <path d="M15 20v2" />
        <path d="M2 15h2" />
        <path d="M2 9h2" />
        <path d="M20 15h2" />
        <path d="M20 9h2" />
        <path d="M9 2v2" />
        <path d="M9 20v2" />
      </svg>
    ),
    iconBg: "from-emerald-500 to-teal-500",
  },
  {
    key: "openai",
    name: "OpenAI",
    descKey: "providerOpenaiDesc",
    tipKey: "providerOpenaiTip",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4.5 4.5 0 0 1 4.27 3.08A4.5 4.5 0 0 1 19.5 12a4.5 4.5 0 0 1-3.23 6.92A4.5 4.5 0 0 1 12 22a4.5 4.5 0 0 1-4.27-3.08A4.5 4.5 0 0 1 4.5 12a4.5 4.5 0 0 1 3.23-6.92A4.5 4.5 0 0 1 12 2z" />
        <path d="M12 8.5v7M8.5 10.25l7 3.5M15.5 10.25l-7 3.5" />
      </svg>
    ),
    iconBg: "from-teal-600 to-green-700",
  },
];

// Map Chinese vendor names by key to i18n display names (English users would otherwise see hard-coded Chinese like "火山引擎/阿里百炼/硅基流动").
// Only overrides vendors with Chinese names; others (Atlas Cloud/OpenAI, etc.) already use English brand names and use platform.name directly.
// Note: platform.name is still used as the identity for enabledNames custom model filtering, so we only change the display, not name.
const PROVIDER_NAME_KEYS: Record<string, string> = {
  volcengine: "providerVolcengineName",
  alibaba: "providerAlibabaName",
  siliconflow: "providerSiliconflowName",
};

// password input field with show/hide toggle
function PasswordInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-xs"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? (
          // hide icon
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          </svg>
        ) : (
          // show icon
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

// custom toggle switch component
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const t = useT("settings");
  // read settings from store
  const {
    providers,
    llm,
    tts,
    defaultResolution,
    defaultAspectRatio,
    defaultImageModel,
    defaultVideoModel,
    customModels,
    setProvider,
    setLLM,
    setTTS,
    setDefaultResolution,
    setDefaultAspectRatio,
    setDefaultImageModel,
    setDefaultVideoModel,
    applyAtlasOneKey,
  } = useSettingsStore();

  // one-click Atlas onboarding: a single Key auto-configures LLM/image-gen/video-gen/TTS
  const [atlasOneKey, setAtlasOneKey] = useState("");
  const [atlasApplied, setAtlasApplied] = useState(false);
  const applyOneKey = () => {
    if (!atlasOneKey.trim()) return;
    applyAtlasOneKey(atlasOneKey.trim());
    setAtlasApplied(true);
  };

  // TTS preview playback state
  const [ttsTestStatus, setTtsTestStatus] = useState<"idle" | "testing" | "error">("idle");
  const testTTS = async () => {
    setTtsTestStatus("testing");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // send the fully resolved config (including per-platform reused Key / default baseUrl / model)
        body: JSON.stringify({ text: t("ttsSample"), ttsConfig: resolveTTSConfig(tts, providers) }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
      setTtsTestStatus("idle");
    } catch {
      setTtsTestStatus("error");
    }
  };

  // AI platform key connectivity test (real auth probe, not a fake test)
  const [providerTest, setProviderTest] = useState<Record<string, { state: "idle" | "testing" | "ok" | "invalid" | "unknown"; msg?: string }>>({});
  const testProvider = async (key: string) => {
    const p = providers[key];
    if (!p?.apiKey) return;
    setProviderTest((s) => ({ ...s, [key]: { state: "testing" } }));
    try {
      const res = await fetch("/api/ai/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: key, apiKey: p.apiKey, baseUrl: p.baseUrl }),
      });
      const data = await res.json();
      setProviderTest((s) => ({ ...s, [key]: { state: data.status ?? "unknown", msg: data.message } }));
    } catch {
      setProviderTest((s) => ({ ...s, [key]: { state: "unknown", msg: t("connectFailed") } }));
    }
  };

  // TTS provider metadata / ready state / reset model, voice, and baseUrl to provider defaults when switching providers
  const ttsMeta = getTTSProviderMeta(tts.provider);
  const ttsReady = isPaidTTSReady(tts, providers);
  const onChangeTTSProvider = (provider: TTSProvider) => {
    const meta = getTTSProviderMeta(provider);
    setTTS({ ...tts, provider, baseUrl: meta.baseUrl, model: meta.defaultModel, voice: meta.defaultVoice });
  };

  // save feedback state
  const [saved, setSaved] = useState(false);

  // available model list (fetched from backend aggregated by enabled providers)
  const [imageModels, setImageModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [videoModels, setVideoModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // providers that are enabled and have an API key (used to fetch model list)
  const enabledProviders = Object.entries(providers)
    .filter(([, p]) => p.enabled && p.apiKey)
    .map(([name, p]) => ({ name, apiKey: p.apiKey, baseUrl: p.baseUrl }));
  // use provider name set as dependency to avoid re-fetching on every render
  const enabledKey = enabledProviders.map((p) => p.name).sort().join(",");

  // fetch available image/video models when enabled providers change
  useEffect(() => {
    if (enabledProviders.length === 0) {
      setImageModels([]);
      setVideoModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    const fetchModels = async (mediaType: "image" | "video") => {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: enabledProviders, mediaType }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.models ?? [];
    };
    Promise.all([fetchModels("image"), fetchModels("video")])
      .then(([imgs, vids]) => {
        if (cancelled) return;
        setImageModels(imgs);
        setVideoModels(vids);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  // merge user custom models into dropdowns (enabled providers only), so custom models can be selected as default
  const enabledNames = new Set(enabledProviders.map((p) => p.name));
  const imageModelOptions = mergeCustomModels(imageModels, customModels, "image", enabledNames);
  const videoModelOptions = mergeCustomModels(videoModels, customModels, "video", enabledNames);

  // auto-select a default model after enabling a provider: if nothing is selected (or the selection is gone) and options exist, fall back to the first one
  // — prevents the beginner trap of "set up a Key but generation fails because no default model was chosen"
  const imageIds = imageModelOptions.map((m) => m.id).join(",");
  const videoIds = videoModelOptions.map((m) => m.id).join(",");
  useEffect(() => {
    if (imageModelOptions.length && !imageModelOptions.some((m) => m.id === defaultImageModel)) {
      setDefaultImageModel(imageModelOptions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds]);
  useEffect(() => {
    if (videoModelOptions.length && !videoModelOptions.some((m) => m.id === defaultVideoModel)) {
      setDefaultVideoModel(videoModelOptions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIds]);

  // LLM connection test state
  const [llmTestStatus, setLlmTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  // test LLM connection
  const [llmTestError, setLlmTestError] = useState("");
  const testLLMConnection = async () => {
    setLlmTestStatus("testing");
    setLlmTestError("");
    try {
      // use server-side test: browser direct calls to provider APIs would be blocked by CORS and falsely report failure
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: llm.baseUrl, apiKey: llm.apiKey }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setLlmTestStatus(data.ok ? "success" : "error");
      if (!data.ok) setLlmTestError(data.error || t("connectFailed"));
    } catch (e) {
      setLlmTestStatus("error");
      setLlmTestError(e instanceof Error ? e.message : t("connectFailed"));
    }
    setTimeout(() => setLlmTestStatus("idle"), 5000);
  };

  // compute AI provider configuration status
  const hasAnyProvider = Object.values(providers).some(p => p.enabled && p.apiKey);
  const enabledCount = Object.values(providers).filter(p => p.enabled && p.apiKey).length;

  // handle save (zustand persist saves automatically; this is mainly for UI feedback)
  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen grid-bg">
      {/* top navigation */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">ClipForge</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                <span className="ml-1.5">{t("backHome")}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {/* page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        {/* beginner one-click setup: a single Atlas Key auto-configures LLM/image-gen/video-gen/TTS, skipping manual item-by-item setup */}
        <div className="mb-8 rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2 mb-1">
            <LuZap className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">{t("oneKeyTitle")}</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t("oneKeyDesc")}</p>
          {atlasApplied ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <LuCheck className="w-4 h-4 shrink-0" />
              <span>{t("oneKeyDone")}</span>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="password"
                value={atlasOneKey}
                onChange={(e) => setAtlasOneKey(e.target.value)}
                placeholder={t("oneKeyPlaceholder")}
                className="flex-1"
              />
              <Button onClick={applyOneKey} disabled={!atlasOneKey.trim()} className="brand-gradient text-white border-0 shrink-0">
                <LuZap className="w-4 h-4 mr-1.5" />
                {t("oneKeyCta")}
              </Button>
            </div>
          )}
          <a href="https://www.atlascloud.ai" target="_blank" rel="noreferrer" className="inline-block mt-2 text-xs text-primary hover:underline">
            {t("oneKeyGetKey")}
          </a>
        </div>

        {/* tabs */}
        <Tabs defaultValue={0}>
          <TabsList className="mb-6 max-w-full overflow-x-auto">
            <TabsTrigger value={0}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M15 2v2" />
                <path d="M15 20v2" />
                <path d="M2 15h2" />
                <path d="M2 9h2" />
                <path d="M20 15h2" />
                <path d="M20 9h2" />
                <path d="M9 2v2" />
                <path d="M9 20v2" />
              </svg>
              {t("tabProviders")}
            </TabsTrigger>
            <TabsTrigger value={1}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {t("tabLlm")}
            </TabsTrigger>
            <TabsTrigger value={2}>
              <LuUser className="w-3.5 h-3.5" />
              {t("tabCharacters")}
            </TabsTrigger>
            <TabsTrigger value={3}>
              <LuPalette className="w-3.5 h-3.5" />
              {t("tabBrand")}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: AI provider configuration */}
          <TabsContent value={0}>
            <div className="space-y-4">
              {AI_PROVIDERS.map((platform) => {
                const provider = providers[platform.key] ?? {
                  enabled: false,
                  apiKey: "",
                };

                return (
                  <Card key={platform.key} className="glass-card">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        {/* provider info */}
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${platform.iconBg} text-white shadow-lg`}
                          >
                            {platform.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-sm">
                                {PROVIDER_NAME_KEYS[platform.key] ? t(PROVIDER_NAME_KEYS[platform.key]) : platform.name}
                              </h3>
                              {provider.enabled && (
                                <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                                  {t("providerEnabled")}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {t(platform.descKey)}
                            </p>
                            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t(platform.tipKey)}</p>
                          </div>
                        </div>

                        {/* enable toggle */}
                        <Toggle
                          checked={provider.enabled}
                          onChange={(enabled) =>
                            setProvider(platform.key, {
                              ...provider,
                              enabled,
                            })
                          }
                        />
                      </div>

                      {/* API Key input */}
                      <div className="mt-4">
                        <Label className="text-xs text-muted-foreground mb-1.5">
                          API Key
                        </Label>
                        <PasswordInput
                          value={provider.apiKey}
                          onChange={(apiKey) =>
                            setProvider(platform.key, {
                              ...provider,
                              apiKey,
                            })
                          }
                          placeholder={t("apiKeyPlaceholder", { name: platform.name })}
                        />
                        {/* Key connectivity test: real auth probe ✓/✗/⚠ */}
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            disabled={!provider.apiKey || providerTest[platform.key]?.state === "testing"}
                            onClick={() => testProvider(platform.key)}
                          >
                            {providerTest[platform.key]?.state === "testing" ? t("llmTestTesting") : t("llmTestButton")}
                          </Button>
                          {(() => {
                            const r = providerTest[platform.key];
                            if (!r || r.state === "idle" || r.state === "testing") return null;
                            const color = r.state === "ok" ? "text-emerald-500" : r.state === "invalid" ? "text-destructive" : "text-amber-500";
                            const icon = r.state === "ok" ? "✓" : r.state === "invalid" ? "✗" : "⚠";
                            return <span className={`text-xs ${color}`}>{icon} {r.msg}</span>;
                          })()}
                        </div>
                      </div>

                      {/* custom endpoint (proxy/self-hosted, optional) — collapsed by default so beginners are not disturbed */}
                      <details className="mt-3">
                        <summary className="text-xs text-muted-foreground/70 cursor-pointer list-none select-none hover:text-muted-foreground">
                          {t("providerBaseUrlLabel")}
                        </summary>
                        <div className="mt-2">
                          <Input
                            value={provider.baseUrl ?? ""}
                            onChange={(e) =>
                              setProvider(platform.key, {
                                ...provider,
                                baseUrl: e.target.value || undefined,
                              })
                            }
                            placeholder={t("providerBaseUrlPlaceholder")}
                            className="font-mono text-xs"
                          />
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Tab 2: LLM configuration */}
          <TabsContent value={1}>
            <div className="space-y-6">
              {/* LLM Provider configuration */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-sm">{t("llmProvider")}</h3>
                  </div>

                  {/* quick presets */}
                  <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border/50">
                    <p className="text-xs text-muted-foreground mb-2">{t("llmPresetHint")}</p>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { label: "Atlas Cloud", baseUrl: "https://api.atlascloud.ai/v1", model: "claude-sonnet-4-20250514", tip: t("presetAtlasTip") },
                        { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o", tip: t("presetOpenrouterTip") },
                        { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", tip: t("presetDeepseekTip") },
                        { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5", tip: t("presetKimiTip") },
                        { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5-turbo", tip: t("presetGlmTip") },
                        { label: "MiniMax", baseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M2.7", tip: t("presetMinimaxTip") },
                        { label: "豆包", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-0-pro-260215", tip: t("presetDoubaoTip") },
                        { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", tip: "" },
                        { label: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5", tip: t("presetOllamaTip"), apiKey: "ollama" },
                        { label: "Pollinations", baseUrl: "https://text.pollinations.ai/openai", model: "openai-fast", tip: t("presetPollinationsTip"), apiKey: "pollinations" },
                      ] as { label: string; baseUrl: string; model: string; tip: string; apiKey?: string }[]).map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => setLLM({ ...llm, baseUrl: preset.baseUrl, model: preset.model, visionModel: preset.model, ...(preset.apiKey ? { apiKey: preset.apiKey } : {}) })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/50 bg-background hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          {preset.label}
                          {preset.tip && <span className="text-[10px] text-muted-foreground/70">({preset.tip})</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4">
                    {/* API base URL */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("llmBaseUrlLabel")}
                      </Label>
                      <Input
                        value={llm.baseUrl}
                        onChange={(e) =>
                          setLLM({ ...llm, baseUrl: e.target.value })
                        }
                        placeholder="https://api.openai.com/v1"
                        className="font-mono text-xs"
                      />
                    </div>

                    {/* API Key */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("apiKeyLabel")}
                      </Label>
                      <PasswordInput
                        value={llm.apiKey}
                        onChange={(apiKey) => setLLM({ ...llm, apiKey })}
                        placeholder={t("llmApiKeyPlaceholder")}
                      />
                    </div>

                    {/* model name */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          {t("llmTextModel")}
                        </Label>
                        <Input
                          value={llm.model}
                          onChange={(e) =>
                            setLLM({ ...llm, model: e.target.value })
                          }
                          placeholder="gpt-4o"
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          {t("llmVisionModel")}
                        </Label>
                        <Input
                          value={llm.visionModel ?? ""}
                          onChange={(e) =>
                            setLLM({
                              ...llm,
                              visionModel: e.target.value || undefined,
                            })
                          }
                          placeholder="gpt-4o"
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>

                    {/* test connection button */}
                    <div className="pt-3 mt-3 border-t border-border/50">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={testLLMConnection}
                        disabled={!llm.apiKey || !llm.baseUrl || llmTestStatus === "testing"}
                        className={`text-xs ${
                          llmTestStatus === "success"
                            ? "text-emerald-600"
                            : llmTestStatus === "error"
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {llmTestStatus === "testing" ? t("llmTestTesting")
                         : llmTestStatus === "success" ? t("llmTestSuccess")
                         : llmTestStatus === "error" ? t("llmTestError")
                         : t("llmTestButton")}
                      </Button>
                      {!llm.apiKey && (
                        <span className="text-xs text-muted-foreground ml-2">{t("llmFillKeyFirst")}</span>
                      )}
                      {llmTestStatus === "error" && llmTestError && (
                        <p className="mt-2 text-xs text-destructive break-all">{llmTestError}</p>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground">{t("llmTestTip")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              {/* TTS voiceover */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 text-white">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{t("ttsTitle")}</h3>
                        <p className="text-xs text-muted-foreground">{t("ttsSubtitle")}</p>
                      </div>
                    </div>
                    <Toggle checked={tts.enabled} onChange={(v) => setTTS({ ...tts, enabled: v })} />
                  </div>

                  {tts.enabled && (
                    <div className="space-y-4">
                      {/* TTS provider selection */}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">{t("ttsProviderLabel")}</Label>
                        <Select value={tts.provider ?? "openai"} onValueChange={(v) => onChangeTTSProvider((v ?? "openai") as TTSProvider)}>
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(value: string) => TTS_PROVIDERS.find((p) => p.value === value)?.label ?? t("ttsProviderFallback")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TTS_PROVIDERS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {ttsMeta.hint && <p className="text-[11px] text-muted-foreground/80">{ttsMeta.hint}</p>}
                      </div>

                      {ttsMeta.value === "openai" ? (
                        <>
                          {/* OpenAI-compatible: quick presets + baseUrl + Key + free model/voice */}
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">{t("ttsPresetHint")}</p>
                            <div className="flex flex-wrap gap-2">
                              {OPENAI_TTS_PRESETS.map((p) => (
                                <button
                                  key={p.label}
                                  onClick={() => setTTS({ ...tts, baseUrl: p.baseUrl, model: p.model, voice: p.voice })}
                                  className="px-2.5 h-7 rounded-md border border-border/60 bg-muted/20 text-xs hover:border-primary/50 hover:text-primary transition-colors"
                                >
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("ttsBaseUrlLabel")}</Label>
                            <Input value={tts.baseUrl} onChange={(e) => setTTS({ ...tts, baseUrl: e.target.value })} placeholder="https://api.siliconflow.cn/v1" className="font-mono text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{t("apiKeyLabel")}</Label>
                            <PasswordInput value={tts.apiKey} onChange={(apiKey) => setTTS({ ...tts, apiKey })} placeholder={t("ttsApiKeyPlaceholder")} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsModelLabel")}</Label>
                              <Input value={tts.model} onChange={(e) => setTTS({ ...tts, model: e.target.value })} placeholder="tts-1" className="font-mono text-xs" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsVoiceLabel")}</Label>
                              <Input value={tts.voice} onChange={(e) => setTTS({ ...tts, voice: e.target.value })} placeholder="alloy" className="font-mono text-xs" />
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Atlas / MiniMax / fal: Key (reused or custom) + optional GroupId/baseUrl + model/voice dropdowns */}
                          {ttsMeta.keySource === "tts" ? (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("apiKeyLabel")}</Label>
                              <PasswordInput value={tts.apiKey} onChange={(apiKey) => setTTS({ ...tts, apiKey })} placeholder={t("ttsApiKeyPlaceholderShort")} />
                            </div>
                          ) : (
                            <div className="text-xs rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                              {providers[ttsMeta.keySource]?.apiKey ? (
                                <span className="text-emerald-500">{t("ttsKeyReused")}</span>
                              ) : (
                                <span className="text-amber-500">{t("ttsKeyMissing")}</span>
                              )}
                            </div>
                          )}
                          {ttsMeta.editableBaseUrl && (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsBaseUrlLabel")}</Label>
                              <Input value={tts.baseUrl} onChange={(e) => setTTS({ ...tts, baseUrl: e.target.value })} placeholder={ttsMeta.baseUrl} className="font-mono text-xs" />
                            </div>
                          )}
                          {ttsMeta.needsGroupId && (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsGroupIdLabel")}</Label>
                              <Input value={tts.groupId ?? ""} onChange={(e) => setTTS({ ...tts, groupId: e.target.value })} placeholder={t("ttsGroupIdPlaceholder")} className="font-mono text-xs" />
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {ttsMeta.models.length > 0 && (
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">{t("ttsModelLabel")}</Label>
                                <Select value={tts.model || ttsMeta.defaultModel} onValueChange={(v) => setTTS({ ...tts, model: v ?? ttsMeta.defaultModel })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue>{(value: string) => ttsMeta.models.find((o) => o.value === value)?.label ?? value}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ttsMeta.models.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">{t("ttsVoiceLabel")}</Label>
                              <Select value={tts.voice || ttsMeta.defaultVoice} onValueChange={(v) => setTTS({ ...tts, voice: v ?? ttsMeta.defaultVoice })}>
                                <SelectTrigger className="w-full">
                                  <SelectValue>{(value: string) => ttsMeta.voices.find((o) => o.value === value)?.label ?? value}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {ttsMeta.voices.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </>
                      )}

                      {/* preview playback */}
                      <div className="pt-3 mt-1 border-t border-border/50">
                        <Button variant="outline" size="sm" onClick={testTTS} disabled={!ttsReady || ttsTestStatus === "testing"} className={`text-xs ${ttsTestStatus === "error" ? "text-destructive" : ""}`}>
                          {ttsTestStatus === "testing" ? t("ttsTesting") : ttsTestStatus === "error" ? t("ttsTestError") : t("ttsTestButton")}
                        </Button>
                        {!ttsReady && <span className="ml-2 text-[11px] text-muted-foreground">{t("ttsFillKeyFirst")}</span>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Separator />

              {/* default settings */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-sm">{t("defaultsTitle")}</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* default resolution */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultResolution")}
                      </Label>
                      <Select
                        value={defaultResolution}
                        onValueChange={(val) =>
                          setDefaultResolution(val as "720p" | "1080p")
                        }
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI Select.Value shows the raw value by default; use a function child to map it to a label */}
                          <SelectValue>
                            {(value: string) => resolutionOptions.find((o) => o.value === value)?.label ?? value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {resolutionOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* default aspect ratio */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultAspectRatio")}
                      </Label>
                      <Select
                        value={defaultAspectRatio}
                        onValueChange={(val) =>
                          setDefaultAspectRatio(
                            val as "9:16" | "16:9" | "1:1"
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI Select.Value shows the raw value by default; use a function child to map it to a language-specific label */}
                          <SelectValue>
                            {(value: string) => {
                              const o = aspectRatioOptions.find((o) => o.value === value);
                              return o ? t(o.labelKey) : value;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {aspectRatioOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {t(o.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* default image generation model */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultImageModel")}
                      </Label>
                      <Select
                        value={defaultImageModel}
                        onValueChange={(val) => setDefaultImageModel(val ?? "")}
                        disabled={imageModelOptions.length === 0}
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI Select.Value shows the raw value by default; use a function child to map it to the model name */}
                          <SelectValue>
                            {(value: string) =>
                              imageModelOptions.find((m) => m.id === value)?.name ??
                              (modelsLoading ? t("modelsLoading") : enabledProviders.length === 0 ? t("enableProviderFirst") : t("selectImageModel"))
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {imageModelOptions.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}{m.custom ? t("customModelSuffix") : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* default video generation model */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("defaultVideoModel")}
                      </Label>
                      <Select
                        value={defaultVideoModel}
                        onValueChange={(val) => setDefaultVideoModel(val ?? "")}
                        disabled={videoModelOptions.length === 0}
                      >
                        <SelectTrigger className="w-full">
                          {/* Base UI Select.Value shows the raw value by default; use a function child to map it to the model name */}
                          <SelectValue>
                            {(value: string) =>
                              videoModelOptions.find((m) => m.id === value)?.name ??
                              (modelsLoading ? t("modelsLoading") : enabledProviders.length === 0 ? t("enableProviderFirst") : t("selectVideoModel"))
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {videoModelOptions.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}{m.custom ? t("customModelSuffix") : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* custom model endpoints + generation params (advanced, collapsed by default, does not disturb beginners) */}
              <details className="group rounded-xl border border-border/50 bg-card/30">
                <summary className="flex items-center justify-between cursor-pointer list-none select-none px-5 py-3.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <span>{t("advancedSection")}</span>
                  <svg className="size-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                </summary>
                <div className="px-1 pb-1 space-y-4">
                  <GenerationSettings />
                </div>
              </details>
            </div>
          </TabsContent>
          {/* Tab 3: character management */}
          <TabsContent value={2}>
            <CharacterManager />
          </TabsContent>
          {/* Tab 4: brand settings */}
          <TabsContent value={3}>
            <BrandSettings />
          </TabsContent>
        </Tabs>

        {/* bottom save button */}
        <div className="mt-8 flex items-center justify-between gap-3">
          {/* configuration status summary */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className={llm.apiKey ? "text-emerald-600" : "text-amber-600"}>
              {llm.apiKey ? t("llmConfigured") : t("llmNotConfigured")}
            </p>
            <p className={hasAnyProvider ? "text-emerald-600" : "text-amber-600"}>
              {hasAnyProvider ? t("providerCount", { n: enabledCount }) : t("noProvider")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-emerald-400 animate-in fade-in slide-in-from-right-2">
                {t("settingsSaved")}
              </span>
            )}
            <Button
              onClick={handleSave}
              className="brand-gradient text-white px-6"
              size="lg"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {t("saveSettings")}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

// ==================== character management component ====================

function CharacterManager() {
  const t = useT("settings");
  const { characters, addCharacter, updateCharacter, removeCharacter } = useCharacterStore();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", appearance: "", voiceStyle: "" });

  const resetForm = () => {
    setForm({ name: "", description: "", appearance: "", voiceStyle: "" });
    setIsCreating(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editingId) {
      updateCharacter(editingId, {
        name: form.name,
        description: form.description,
        appearance: form.appearance,
        voiceProfile: form.voiceStyle ? { style: form.voiceStyle } : undefined,
      });
    } else {
      addCharacter({
        id: crypto.randomUUID(),
        name: form.name,
        description: form.description,
        appearance: form.appearance,
        referenceImages: [],
        voiceProfile: form.voiceStyle ? { style: form.voiceStyle } : undefined,
        isDefault: characters.length === 0,
      });
    }
    resetForm();
  };

  const startEdit = (char: Character) => {
    setEditingId(char.id);
    setIsCreating(true);
    setForm({
      name: char.name,
      description: char.description || "",
      appearance: char.appearance || "",
      voiceStyle: char.voiceProfile?.style || "",
    });
  };

  const setAsDefault = (id: string) => {
    characters.forEach((c) => updateCharacter(c.id, { isDefault: c.id === id }));
  };

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("characterIntro")}
          </p>
        </CardContent>
      </Card>

      {characters.length > 0 && (
        <div className="space-y-3">
          {characters.map((char) => (
            <Card key={char.id} className={`glass-card ${char.isDefault ? "ring-1 ring-primary/50" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <LuUser className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm">{char.name}</h3>
                        {char.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                            <LuStar className="w-3 h-3" />
                            {t("characterDefault")}
                          </span>
                        )}
                      </div>
                      {char.description && <p className="text-xs text-muted-foreground mb-1">{char.description}</p>}
                      {char.appearance && <p className="text-xs text-muted-foreground/70 line-clamp-1">{t("characterAppearancePrefix", { appearance: char.appearance })}</p>}
                      {char.voiceProfile?.style && <p className="text-xs text-muted-foreground/70 mt-0.5">{t("characterVoicePrefix", { voice: char.voiceProfile.style })}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!char.isDefault && (
                      <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setAsDefault(char.id)}>
                        <LuStar className="w-3 h-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => startEdit(char)}>{t("characterEdit")}</Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-destructive hover:text-destructive" onClick={() => removeCharacter(char.id)}>
                      <LuTrash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isCreating ? (
        <Card className="glass-card ring-1 ring-primary/30">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold">{editingId ? t("characterFormEditTitle") : t("characterFormAddTitle")}</h3>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("characterNameLabel")}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("characterNamePlaceholder")} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("characterDescLabel")}</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={t("characterDescPlaceholder")} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("characterAppearanceLabel")}</Label>
              <Textarea value={form.appearance} onChange={(e) => setForm((f) => ({ ...f, appearance: e.target.value }))} placeholder={t("characterAppearancePlaceholder")} rows={3} className="text-sm resize-none" />
              <p className="text-[11px] text-muted-foreground/60">{t("characterAppearanceTip")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("characterVoiceLabel")}</Label>
              <Input value={form.voiceStyle} onChange={(e) => setForm((f) => ({ ...f, voiceStyle: e.target.value }))} placeholder={t("characterVoicePlaceholder")} className="text-sm" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={resetForm}>{t("characterCancel")}</Button>
              <Button size="sm" className="brand-gradient text-white" onClick={handleSave} disabled={!form.name.trim()}>
                {editingId ? t("characterSaveEdit") : t("characterAddSubmit")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" className="w-full h-12 border-dashed" onClick={() => setIsCreating(true)}>
          <LuPlus className="w-4 h-4 mr-2" />
          {t("characterAddButton")}
        </Button>
      )}
    </div>
  );
}

// ==================== brand settings component ====================

// watermark position options (labelKey is rendered per language inside the component)
const WATERMARK_POSITIONS = [
  { value: "top-left" as const, labelKey: "brandPositionTopLeft" },
  { value: "top-right" as const, labelKey: "brandPositionTopRight" },
  { value: "bottom-left" as const, labelKey: "brandPositionBottomLeft" },
  { value: "bottom-right" as const, labelKey: "brandPositionBottomRight" },
] as const;

function BrandSettings() {
  const t = useT("settings");
  const { brand, updateBrand, updateWatermark } = useBrandStore();

  return (
    <div className="space-y-6">
      {/* shop basic info */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h3 className="font-semibold text-sm">{t("brandShopTitle")}</h3>
          </div>

          <div className="grid gap-4">
            {/* shop name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("brandNameLabel")}</Label>
              <Input
                value={brand.name}
                onChange={(e) => updateBrand({ name: e.target.value })}
                placeholder={t("brandNamePlaceholder")}
                className="text-sm"
              />
            </div>

            {/* Logo upload area */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Logo</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 overflow-hidden">
                  {brand.logoUrl ? (
                    <img
                      src={brand.logoUrl}
                      alt={t("brandLogoAlt")}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          // convert the selected image to a Data URL for storage
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            updateBrand({ logoUrl: ev.target?.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                      <LuUpload className="w-3 h-3" />
                      {t("brandUploadLogo")}
                    </span>
                  </label>
                  {brand.logoUrl && (
                    <button
                      onClick={() => updateBrand({ logoUrl: undefined })}
                      className="text-xs text-destructive hover:underline text-left"
                    >
                      {t("brandRemove")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* brand color settings */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 text-white">
              <LuPalette className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm">{t("brandColorTitle")}</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* primary color */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("brandPrimaryColor")}</Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="color"
                    value={brand.primaryColor}
                    onChange={(e) => updateBrand({ primaryColor: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="h-9 w-9 rounded-lg border border-border shadow-sm"
                    style={{ backgroundColor: brand.primaryColor }}
                  />
                </div>
                <Input
                  value={brand.primaryColor}
                  onChange={(e) => updateBrand({ primaryColor: e.target.value })}
                  className="font-mono text-xs uppercase flex-1"
                  maxLength={7}
                />
              </div>
            </div>

            {/* secondary color */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("brandSecondaryColor")}</Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="color"
                    value={brand.secondaryColor}
                    onChange={(e) => updateBrand({ secondaryColor: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="h-9 w-9 rounded-lg border border-border shadow-sm"
                    style={{ backgroundColor: brand.secondaryColor }}
                  />
                </div>
                <Input
                  value={brand.secondaryColor}
                  onChange={(e) => updateBrand({ secondaryColor: e.target.value })}
                  className="font-mono text-xs uppercase flex-1"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* watermark settings */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="font-semibold text-sm">{t("brandWatermarkTitle")}</h3>
            </div>
            <Toggle
              checked={brand.watermark.enabled}
              onChange={(enabled) => updateWatermark({ enabled })}
            />
          </div>

          {brand.watermark.enabled && (
            <div className="space-y-4 pt-2">
              {/* watermark position */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("brandWatermarkPosition")}</Label>
                <div className="grid grid-cols-4 gap-2">
                  {WATERMARK_POSITIONS.map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => updateWatermark({ position: pos.value })}
                      className={`h-9 rounded-lg border text-xs font-medium transition-colors ${
                        brand.watermark.position === pos.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      {t(pos.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* opacity */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">{t("brandWatermarkOpacity")}</Label>
                  <span className="text-xs text-muted-foreground font-mono">
                    {Math.round(brand.watermark.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={Math.round(brand.watermark.opacity * 100)}
                  onChange={(e) =>
                    updateWatermark({ opacity: Number(e.target.value) / 100 })
                  }
                  className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                  <span>10%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* outro settings */}
      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <h3 className="font-semibold text-sm">{t("brandOutroTitle")}</h3>
            </div>
            <Toggle
              checked={brand.outroEnabled}
              onChange={(enabled) => updateBrand({ outroEnabled: enabled })}
            />
          </div>

          {brand.outroEnabled && (
            <div className="space-y-1.5 pt-2">
              <Label className="text-xs text-muted-foreground">{t("brandOutroTextLabel")}</Label>
              <Textarea
                value={brand.outroText ?? ""}
                onChange={(e) => updateBrand({ outroText: e.target.value })}
                placeholder={t("brandOutroTextPlaceholder")}
                rows={2}
                className="text-sm resize-none"
              />
              <p className="text-[11px] text-muted-foreground/60">
                {t("brandOutroTip")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
