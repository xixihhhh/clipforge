"use client";

import { randomUUID } from "@/lib/uuid";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LuUpload, LuX, LuCircleAlert, LuZap, LuUser, LuUserX, LuBox, LuLayoutGrid, LuEye, LuVideo, LuBookmark, LuLink2, LuLoader } from "react-icons/lu";
import { useCharacterStore } from "@/lib/stores/project-store";
import { useTemplateStore } from "@/lib/stores/template-store";
import { useProductLibraryStore, type ProductItem } from "@/lib/stores/product-library-store";
import { getExampleProducts, type ExampleProduct } from "@/lib/examples";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { AD_TEMPLATE_GROUPS, listAdTemplates, getAdTemplate, adTemplateScriptDirective, adTemplateStorageKey, recommendAdTemplates, encodeStoredAdTemplate, exportAdTemplateShare, exportAdTemplatePack, AD_TEMPLATE_EDIT_VOCAB, CUSTOM_AD_TEMPLATE_ID, type AdTemplate, type AdTemplateGroupId, type AdTemplateCategory } from "@/lib/ad-templates";
import { CAMERA_PRESETS } from "@/lib/camera-presets";
import { LOOK_PRESETS } from "@/lib/look-presets";
import { CAPTION_PRESET_IDS, type CaptionPresetId } from "@/lib/caption-presets";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT, useLocale } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

// product category options (label changed to i18n key, converted via t() at render time)
const categoryOptions = [
  { value: "beauty", labelKey: "categoryBeauty" },
  { value: "food", labelKey: "categoryFood" },
  { value: "home", labelKey: "categoryHome" },
  { value: "fashion", labelKey: "categoryFashion" },
  { value: "digital", labelKey: "categoryDigital" },
  { value: "other", labelKey: "categoryOther" },
];

// target duration options (label is a plain unit string, no translation needed)
const durationOptions = [
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// video mode options — the step-3 cards use value+label+icon; the recipe editor reuses value+label
const videoModeOptions = [
  { value: "product_closeup", labelKey: "modeCloseupLabel", descKey: "modeCloseupDesc", icon: LuBox },
  { value: "graphic_montage", labelKey: "modeMontageLabel", descKey: "modeMontageDesc", icon: LuLayoutGrid },
  { value: "scene_demo", labelKey: "modeSceneLabel", descKey: "modeSceneDesc", icon: LuEye },
  { value: "live_presenter", labelKey: "modePresenterLabel", descKey: "modePresenterDesc", icon: LuVideo },
];

// recipe-editor display labels for compose enums (bilingual data like the preset libraries, not i18n keys)
const BGM_LABELS: Record<string, { zh: string; en: string }> = {
  none: { zh: "无", en: "None" },
  upbeat: { zh: "轻快", en: "Upbeat" },
  chill: { zh: "舒缓", en: "Chill" },
  energetic: { zh: "动感", en: "Energetic" },
  emotional: { zh: "情感", en: "Emotional" },
};
const QUALITY_LABELS: Record<string, { zh: string; en: string }> = {
  fast: { zh: "快速", en: "Fast" },
  standard: { zh: "标准", en: "Standard" },
  hd: { zh: "高清", en: "HD" },
};
const CAPTION_LABELS: Record<CaptionPresetId, { zh: string; en: string }> = {
  standard: { zh: "标准", en: "Standard" },
  bold: { zh: "大字冲击", en: "Bold" },
  minimal: { zh: "极简", en: "Minimal" },
  karaoke: { zh: "卡拉OK", en: "Karaoke" },
};
// shot-type → i18n key for the camera-plan selects
const SHOT_LABEL_KEYS: Record<string, string> = {
  hook: "adTplShotHook",
  pain_point: "adTplShotPain",
  product_reveal: "adTplShotReveal",
  demo: "adTplShotDemo",
  social_proof: "adTplShotProof",
  cta: "adTplShotCta",
};
// shared input/select styling for the compact recipe editor
const EDITOR_INPUT_CLS =
  "w-full px-2 py-1.5 rounded-md text-xs border border-border/50 bg-background/60 outline-none focus:border-primary/60 placeholder:text-muted-foreground/60";

// script style options (label/desc changed to i18n keys, converted via t() at render time)
// Ordered by form (剧情形 → 物品形 → 口播形 → 场景形), smart-pick last — the full style system
const styleOptions = [
  { value: "drama", labelKey: "styleDramaLabel", descKey: "styleDramaDesc" },
  { value: "reversal", labelKey: "styleReversalLabel", descKey: "styleReversalDesc" },
  { value: "interview", labelKey: "styleInterviewLabel", descKey: "styleInterviewDesc" },
  { value: "story", labelKey: "styleStoryLabel", descKey: "styleStoryDesc" },
  { value: "unboxing", labelKey: "styleUnboxingLabel", descKey: "styleUnboxingDesc" },
  { value: "product_pov", labelKey: "styleProductPovLabel", descKey: "styleProductPovDesc" },
  { value: "comparison", labelKey: "styleComparisonLabel", descKey: "styleComparisonDesc" },
  { value: "talking_head", labelKey: "styleTalkingHeadLabel", descKey: "styleTalkingHeadDesc" },
  { value: "pain-point", labelKey: "stylePainPointLabel", descKey: "stylePainPointDesc" },
  { value: "scenario", labelKey: "styleScenarioLabel", descKey: "styleScenarioDesc" },
  { value: "auto", labelKey: "styleAutoLabel", descKey: "styleAutoDesc" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const t = useT("newProject");
  const locale = useLocale();

  // check LLM API configuration status
  const { llm, setVisualLook } = useSettingsStore();
  const isLLMConfigured = llm.apiKey.length > 0;

  // form state
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [duration, setDuration] = useState("30");
  const [scriptStyle, setScriptStyle] = useState("auto");
  const [videoMode, setVideoMode] = useState<string>("product_closeup");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  // additional field state
  const [priceRange, setPriceRange] = useState<string>("");
  const [targetAudience, setTargetAudience] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(["douyin"]);
  const [usageAdvantage, setUsageAdvantage] = useState("");

  // multi-select toggle helpers
  const toggleAudience = (tag: string) => {
    setTargetAudience(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };
  const togglePlatform = (p: string) => {
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  // template library
  const { templates, incrementUseCount } = useTemplateStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Ad template end-to-end recipe: pre-fills style/mode here,
  // injects the camera/look plan into script generation, and hands the compose recipe
  // to the video page via localStorage
  const [selectedAdTemplateId, setSelectedAdTemplateId] = useState<string>("");
  const [adTemplateGroup, setAdTemplateGroup] = useState<AdTemplateGroupId | "all" | "mine">("all");
  const [adTemplateQuery, setAdTemplateQuery] = useState("");
  // AI-generated custom template (one slot; lives in component state until project creation persists it)
  const [customAdTemplate, setCustomAdTemplate] = useState<AdTemplate | null>(null);
  const [aiTplLoading, setAiTplLoading] = useState(false);
  const [aiTplError, setAiTplError] = useState("");
  // user-owned templates (template economy): saved AI recipes + imported share files, DB-backed
  const [myTemplates, setMyTemplates] = useState<AdTemplate[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [mineNotice, setMineNotice] = useState("");
  const [aiTplSaved, setAiTplSaved] = useState(false);
  // recipe editor: fork any template (builtin/AI/mine) into an editable draft;
  // editorSourceId non-empty = a mine row being edited in place, empty = saving a new fork
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState<AdTemplate | null>(null);
  const [editorSourceId, setEditorSourceId] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  useEffect(() => {
    // best-effort: an empty "mine" list (fresh install / fetch failure) just hides the section
    fetch("/api/ad-template/mine")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.templates)) setMyTemplates(d.templates as AdTemplate[]);
      })
      .catch(() => {});
  }, []);
  /** Resolve any selectable template id: AI slot → my templates → builtin library */
  const resolveAdTemplate = (id: string): AdTemplate | null => {
    if (!id) return null;
    if (id === CUSTOM_AD_TEMPLATE_ID) return customAdTemplate;
    return myTemplates.find((m) => m.id === id) ?? getAdTemplate(id) ?? null;
  };
  // `known` bypasses resolveAdTemplate for templates just added in the same event —
  // the myTemplates closure is still stale there, so a lookup would miss the pre-fill
  const pickAdTemplate = (id: string, known?: AdTemplate | null) => {
    setSelectedAdTemplateId(id);
    const tpl = known ?? resolveAdTemplate(id);
    if (tpl) {
      // visible pre-fill: the user sees (and can still override) what the template chose
      setScriptStyle(tpl.styleType);
      setVideoMode(tpl.videoMode);
    }
  };
  /** Persist the current AI recipe into "my templates" (server re-validates + compliance-screens) */
  const saveAiTemplateToMine = async () => {
    if (!customAdTemplate || aiTplSaved) return;
    setMineNotice("");
    try {
      const res = await fetch("/api/ad-template/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: customAdTemplate }),
      });
      const data = await res.json();
      if (!res.ok || !data.template) throw new Error(data.error || t("adTemplateImportFailed"));
      setMyTemplates((prev) => [data.template as AdTemplate, ...prev]);
      setAiTplSaved(true);
      setMineNotice(t("adTemplateSaved"));
    } catch (e) {
      setMineNotice(e instanceof Error ? e.message : t("adTemplateImportFailed"));
    }
  };
  /** Import a shared template JSON (single OR pack); the server is the authoritative validator */
  const importAdTemplate = async () => {
    if (importBusy || !importText.trim()) return;
    setImportBusy(true);
    setMineNotice("");
    try {
      const res = await fetch("/api/ad-template/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share: importText }),
      });
      const data = await res.json();
      const imported = (Array.isArray(data.templates) ? data.templates : [data.template]).filter(
        Boolean
      ) as AdTemplate[];
      if (!res.ok || imported.length === 0) throw new Error(data.error || t("adTemplateImportFailed"));
      setMyTemplates((prev) => [...imported, ...prev]);
      setImportOpen(false);
      setImportText("");
      pickAdTemplate(imported[0].id, imported[0]);
      const notices: string[] = [];
      if (imported.length > 1) notices.push(t("adTemplateImportedMany").replace("{n}", String(imported.length)));
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        // multi-import already says "imported" — use the prefix-free warning to avoid saying it twice
        const warnKey = imported.length > 1 ? "adTemplateWarnOnly" : "adTemplateImportWarn";
        notices.push(`${t(warnKey)}${data.warnings.join("、")}`);
      }
      if (notices.length > 0) setMineNotice(notices.join(" "));
    } catch (e) {
      setMineNotice(e instanceof Error ? e.message : t("adTemplateImportFailed"));
    } finally {
      setImportBusy(false);
    }
  };
  const deleteMyTemplate = async (id: string) => {
    setMyTemplates((prev) => prev.filter((m) => m.id !== id));
    if (selectedAdTemplateId === id) setSelectedAdTemplateId("");
    // fire-and-forget: the optimistic removal above is the UX; a failed delete resurfaces on reload
    fetch(`/api/ad-template/mine?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  };
  /** Download the selected template as a shareable .json file (works for builtin/AI/my templates) */
  const exportSelectedTemplate = () => {
    const tpl = resolveAdTemplate(selectedAdTemplateId);
    if (!tpl) return;
    const blob = new Blob([exportAdTemplateShare(tpl)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `clipforge-template-${tpl.name.en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recipe"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  /** Download ALL my templates as one shareable pack file */
  const exportMinePack = () => {
    if (myTemplates.length === 0) return;
    const blob = new Blob([exportAdTemplatePack(myTemplates)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `clipforge-template-pack-${myTemplates.length}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  /** Open the recipe editor for the current selection: mine → edit in place, anything else → fork */
  const openTemplateEditor = () => {
    const tpl = resolveAdTemplate(selectedAdTemplateId);
    if (!tpl) return;
    const isMine = myTemplates.some((m) => m.id === tpl.id);
    // deep copy — the draft must never mutate the builtin library / store objects
    setEditorDraft(JSON.parse(JSON.stringify(tpl)) as AdTemplate);
    setEditorSourceId(isMine ? tpl.id : "");
    setEditorOpen(true);
    setImportOpen(false);
    setMineNotice("");
  };
  /** Persist the editor draft: PUT updates a mine row in place, POST saves a new fork */
  const saveEditorTemplate = async () => {
    if (!editorDraft || editorBusy) return;
    setEditorBusy(true);
    setMineNotice("");
    try {
      const res = await fetch("/api/ad-template/mine", {
        method: editorSourceId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editorSourceId
            ? { id: editorSourceId, template: editorDraft }
            : { template: editorDraft, source: "edit" }
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.template) throw new Error(data.error || t("adTplEditorSaveFailed"));
      const tpl = data.template as AdTemplate;
      setMyTemplates((prev) =>
        editorSourceId ? prev.map((m) => (m.id === tpl.id ? tpl : m)) : [tpl, ...prev]
      );
      setEditorOpen(false);
      setEditorDraft(null);
      pickAdTemplate(tpl.id, tpl);
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setMineNotice(`${t("adTemplateImportWarn")}${data.warnings.join("、")}`);
      }
    } catch (e) {
      setMineNotice(e instanceof Error ? e.message : t("adTplEditorSaveFailed"));
    } finally {
      setEditorBusy(false);
    }
  };
  // AI custom template: one cheap LLM call that PICKS from the real preset vocabularies (server-side clamped)
  const generateAiTemplate = async () => {
    if (aiTplLoading) return;
    setAiTplError("");
    setAiTplLoading(true);
    try {
      const res = await fetch("/api/ad-template/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          category,
          sellingPoints,
          llmConfig: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.template) throw new Error(data.error || t("adTemplateAiFailed"));
      setCustomAdTemplate(data.template as AdTemplate);
      setAiTplSaved(false); // a fresh recipe is savable again
      setSelectedAdTemplateId(CUSTOM_AD_TEMPLATE_ID);
      setScriptStyle((data.template as AdTemplate).styleType);
      setVideoMode((data.template as AdTemplate).videoMode);
    } catch (e) {
      setAiTplError(e instanceof Error ? e.message : t("adTemplateAiFailed"));
    } finally {
      setAiTplLoading(false);
    }
  };

  // character library
  const { characters } = useCharacterStore();

  // product library (used to pre-fill from the library when "make video" is triggered)
  const { products: libraryProducts } = useProductLibraryStore();

  // image upload state (local)
  const [images, setImages] = useState<{ id: string; url: string; file: File }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // paste product link for one-click import (standard 2026 commerce entry point)
  const [ingestUrl, setIngestUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState("");
  const [progress, setProgress] = useState<{
    step: string;
    percent: number;
    message: string;
  } | null>(null);

  // handle image selection
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const remaining = 5 - images.length;
      if (remaining <= 0) return;

      const newImages = Array.from(files)
        .slice(0, remaining)
        .filter((f) => f.type.startsWith("image/"))
        .map((file) => ({
          id: randomUUID(),
          url: URL.createObjectURL(file),
          file,
        }));

      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length]
  );

  // drag event handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // remove an image
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // one-click fill with example product (including a real sample image) to let beginners try without any setup
  const fillExample = useCallback(async (ex: ExampleProduct) => {
    setProductName(ex.name);
    setCategory(ex.category);
    setSellingPoints(ex.sellingPoints);
    try {
      const res = await fetch(ex.image);
      const blob = await res.blob();
      const file = new File([blob], `${ex.id}.png`, { type: blob.type || "image/png" });
      // revoke old preview URLs to avoid memory leaks
      setImages((prev) => {
        prev.forEach((img) => URL.revokeObjectURL(img.url));
        return [{ id: randomUUID(), url: URL.createObjectURL(file), file }];
      });
    } catch {
      // fetching the example image is non-fatal; the text fields are already filled and the user can upload manually
    }
  }, []);

  // product library "make video" pre-fill: populate product name / category / selling points by productId, and attempt to fetch product images as File objects
  const prefillFromProduct = useCallback(async (product: ProductItem) => {
    setProductName(product.name);
    // the product library's "tech" category maps to "digital" on this page; all other values are the same
    setCategory(product.category === "tech" ? "digital" : product.category);
    if (product.description) setSellingPoints(product.description);
    // fetch product images as File objects: works for example/server images; local blob URLs expire across pages so skip those (text is already filled, user can upload manually)
    const files: { id: string; url: string; file: File }[] = [];
    for (const [i, src] of product.images.slice(0, 5).entries()) {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const file = new File([blob], `product-${i}.png`, { type: blob.type || "image/png" });
        files.push({ id: randomUUID(), url: URL.createObjectURL(file), file });
      } catch {
        // non-fatal if the image cannot be fetched
      }
    }
    if (files.length) {
      setImages((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.url));
        return files;
      });
    }
  }, []);

  // on mount, if ?productId is present, pre-fill once from the product library (products are only available after the store hydrates, hence the dependency)
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    const productId = new URLSearchParams(window.location.search).get("productId");
    if (!productId) return;
    const product = libraryProducts.find((p) => p.id === productId);
    if (product) {
      prefilledRef.current = true;
      void prefillFromProduct(product);
    }
  }, [libraryProducts, prefillFromProduct]);

  // form validation
  const isValid = productName.trim().length > 0 && images.length >= 1;

  // summary badge for the folded templates drawer: surfaces what's currently applied while closed
  const pickedAdTpl = resolveAdTemplate(selectedAdTemplateId);
  const pickedViralTpl = selectedTemplateId ? templates.find((x) => x.id === selectedTemplateId) : null;
  const pickedTemplateNames = [
    pickedViralTpl?.name,
    pickedAdTpl ? (locale === "zh" ? pickedAdTpl.name.zh : pickedAdTpl.name.en) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // submission handler
  // paste product link → backend scrapes and parses (title / price / images) + creates a commerce project → navigate directly to the script page
  const handleIngest = async () => {
    const url = ingestUrl.trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      setIngestError(t("ingestErrorUrl"));
      return;
    }
    setIngestError("");
    setIngesting(true);
    try {
      const res = await fetch("/api/ingest/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, createProject: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.projectId) throw new Error(data.error || t("ingestErrorFail"));
      router.push(`/project/${data.projectId}/script`);
    } catch (e) {
      setIngestError(friendlyError(e, locale));
      setIngesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // step 1: create the project (get projectId first)
      setProgress({ step: "creating", percent: 15, message: t("progressCreating") });
      const projectRes = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${productName} 推广`,
          productName,
          productCategory: category,
          productDescription: sellingPoints,
          productImages: [],
        }),
      });
      if (!projectRes.ok) throw new Error(t("errorCreateFailed"));
      const project = await projectRes.json();

      // ad template: apply the global look now and hand the compose recipe to the
      // video page (localStorage, same client-side convention as the template store);
      // AI custom and "my templates" are stored inline (custom:<json>) since they have no builtin id
      const adTemplate = resolveAdTemplate(selectedAdTemplateId);
      if (adTemplate) {
        setVisualLook(adTemplate.look);
        try {
          localStorage.setItem(adTemplateStorageKey(project.id), encodeStoredAdTemplate(adTemplate));
        } catch {
          // storage full/unavailable only loses the compose pre-fill, never the flow
        }
      }

      // step 2: upload images (with projectId)
      setProgress({ step: "uploading", percent: 35, message: t("progressUploading") });
      const formData = new FormData();
      images.forEach((img) => formData.append("files", img.file));
      formData.append("projectId", project.id);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.error || t("errorUploadFailed"));
      }
      const { paths } = await uploadRes.json();

      // step 2.5: update the project's image paths
      await fetch(`/api/project/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productImages: paths }),
      });

      // step 3: generate the script
      setProgress({ step: "generating", percent: 60, message: t("progressGenerating") });
      // if a presenter character was selected, include their info
      const selectedCharacter = selectedCharacterId
        ? characters.find((c) => c.id === selectedCharacterId)
        : null;

      // apply template: serialize the selected template's shot structure as a reference for the AI to follow (actually consuming the template, not just decorative)
      const selectedTemplate = selectedTemplateId
        ? templates.find((t) => t.id === selectedTemplateId)
        : null;
      const referenceStructure = selectedTemplate
        ? selectedTemplate.shots
            .map((s, i) => `${i + 1}. [${s.type}] ${s.duration}s ${s.camera ?? ""} 口播参考：「${s.voiceover ?? ""}」`)
            .join("\n")
        : undefined;

      const scriptRes = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          productName,
          category,
          productDescription: sellingPoints,
          targetDuration: parseInt(duration),
          styleType: scriptStyle,
          videoMode,
          productImages: paths,
          llmConfig: {
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model: llm.model,
            visionModel: llm.visionModel,
          },
          priceRange,
          targetAudience: targetAudience.join(","),
          platforms: platforms.join(","),
          usageAdvantage,
          // pass the selected template ID + structure (so the AI genuinely follows the template rhythm)
          ...(selectedTemplateId && { templateId: selectedTemplateId }),
          ...(referenceStructure && { referenceStructure }),
          // ad-template creative direction: look + per-shot-type camera plan for the script LLM
          ...(adTemplate && { customRequirements: adTemplateScriptDirective(adTemplate) }),
          ...(selectedCharacter && {
            character: {
              id: selectedCharacter.id,
              name: selectedCharacter.name,
              appearance: selectedCharacter.appearance || "",
              voiceStyle: selectedCharacter.voiceProfile?.style,
            },
          }),
        }),
      });

      // increment use count when a template was applied
      if (selectedTemplateId) {
        incrementUseCount(selectedTemplateId);
      }
      if (!scriptRes.ok) throw new Error(t("errorScriptFailed"));

      // step 4: done
      setProgress({ step: "done", percent: 100, message: t("progressDone") });
      await new Promise((r) => setTimeout(r, 800));
      router.push(`/project/${project.id}/script`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"));
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen grid-bg">
      <main className="mx-auto max-w-2xl px-6 py-10">
        {/* page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("pageTitlePrefix")}<span className="brand-gradient-text">{t("pageTitleAccent")}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("pageSubtitle")}
          </p>
        </div>

        {/* LLM not configured warning */}
        {!isLLMConfigured && (
          <Link href="/settings?tab=llm">
            <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 cursor-pointer hover:bg-amber-500/15 transition-colors">
              <LuCircleAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">{t("llmWarnTitle")}</p>
                <p className="text-xs text-amber-300/80 mt-0.5">{t("llmWarnDesc")}<span className="underline">{t("llmWarnCta")}</span></p>
              </div>
            </div>
          </Link>
        )}

        <div className="space-y-6">
          {/* step 1 — product source: upload / paste a link / one-tap example, all in ONE card
              (was three stacked cards competing for the same "where do I start" decision) */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                  <span className="text-sm font-semibold">
                    {t("stepUploadTitle")}
                    <span className="text-destructive ml-0.5">*</span>
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("imageCount", { n: images.length })}
                </span>
              </div>

              {/* drag-and-drop upload zone */}
              {images.length < 5 && (
                <div
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-primary/50 hover:bg-muted/20"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
                      <LuUpload className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {t("dropHintPrefix")}
                        <span className="brand-gradient-text font-semibold">{t("dropHintClick")}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("dropHintFormats")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* uploaded image preview grid */}
              {images.length > 0 && (
                <div className={`grid grid-cols-3 sm:grid-cols-5 gap-3 ${images.length < 5 ? "mt-4" : ""}`}>
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted/20"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={t("imageAlt")}
                        className="h-full w-full object-cover"
                      />
                      {/* delete button */}
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                      >
                        <LuX className="w-3 h-3" />
                      </button>
                      {/* hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                  ))}
                </div>
              )}

              {/* alternative source: paste a product URL (auto-grabs title / price / images and creates the project) */}
              <div className="mt-4 pt-4 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                  <LuLink2 className="w-3.5 h-3.5" />
                  {t("sourceIngestLead")}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={ingestUrl}
                    onChange={(e) => setIngestUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleIngest();
                    }}
                    placeholder={t("ingestPlaceholder")}
                    disabled={ingesting}
                  />
                  <Button type="button" onClick={handleIngest} disabled={ingesting || !ingestUrl.trim()} className="shrink-0">
                    {ingesting ? <LuLoader className="w-4 h-4 animate-spin" /> : t("ingestBtn")}
                  </Button>
                </div>
                {ingestError && <p className="text-xs text-destructive mt-2">{ingestError}</p>}
              </div>

              {/* alternative source: one-tap example products (zero-barrier trial) */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("sourceExampleLead")}</span>
                {getExampleProducts(locale).map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => fillExample(ex)}
                    className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
                  >
                    {ex.name} ¥{ex.price}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* product info form */}
          <Card className="glass-card">
            <CardContent className="p-5 space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                <span className="text-sm font-semibold">{t("stepInfoTitle")}</span>
              </div>
              {/* product name */}
              <div className="space-y-2">
                <Label htmlFor="productName" className="text-sm font-medium">
                  {t("productNameLabel")}
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  id="productName"
                  placeholder={t("productNamePlaceholder")}
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="bg-muted/30 border-border/50 focus:border-primary"
                />
              </div>

              {/* product selling points */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sellingPoints" className="text-sm font-medium">
                    {t("sellingPointsLabel")}
                  </Label>
                  <span className="text-xs text-muted-foreground">{t("optional")}</span>
                </div>
                <Textarea
                  id="sellingPoints"
                  placeholder={t("sellingPointsPlaceholder")}
                  value={sellingPoints}
                  onChange={(e) => setSellingPoints(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>

              {/* optional detail fields folded away: they sharpen the script but must not
                  gate the flow — the default view stays name + selling points only */}
              <details className="group pt-1">
                <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <span>{t("moreInfoSummary")}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform group-open:rotate-180">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="mt-4 space-y-5">
                  <p className="text-xs text-muted-foreground">{t("moreInfoHint")}</p>

                  {/* product category */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("categoryLabel")}</Label>
                    <Select value={category} onValueChange={(val) => setCategory(val ?? "")}>
                      <SelectTrigger className="w-full bg-muted/30 border-border/50">
                        {/* Base UI's Select.Value shows the raw value by default; use a function child to map it to the translated label */}
                        <SelectValue>
                          {(value: string) => {
                            const opt = categoryOptions.find((o) => o.value === value);
                            return opt ? t(opt.labelKey) : t("categoryPlaceholder");
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

              {/* price range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("priceLabel")}</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "0-50", labelKey: "priceUnder50" },
                    { value: "50-200", labelKey: "price50to200" },
                    { value: "200-500", labelKey: "price200to500" },
                    { value: "500+", labelKey: "price500plus" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPriceRange(opt.value)}
                      className={`relative flex items-center justify-center h-11 rounded-lg border text-sm font-medium transition-all ${
                        priceRange === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* target audience (multi-select tags) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("audienceLabel")}</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    // value is the raw tag sent to the API (not translated); labelKey is used only for display
                    { value: "学生党", labelKey: "audienceStudent" },
                    { value: "上班族", labelKey: "audienceWorker" },
                    { value: "宝妈", labelKey: "audienceMom" },
                    { value: "精致白领", labelKey: "audienceWhiteCollar" },
                    { value: "中年群体", labelKey: "audienceMiddleAge" },
                    { value: "男性用户", labelKey: "audienceMale" },
                    { value: "健身人群", labelKey: "audienceFitness" },
                    { value: "数码爱好者", labelKey: "audienceTechFan" },
                  ].map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => toggleAudience(tag.value)}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                        targetAudience.includes(tag.value)
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-muted/20 text-muted-foreground border-border/50 hover:border-primary/30"
                      }`}
                    >
                      {t(tag.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* target platforms (multi-select) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("platformLabel")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "douyin", labelKey: "platformDouyin" },
                    { value: "kuaishou", labelKey: "platformKuaishou" },
                    { value: "xiaohongshu", labelKey: "platformXiaohongshu" },
                    { value: "tiktok", labelKey: "platformTiktok" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => togglePlatform(opt.value)}
                      className={`relative flex items-center justify-center h-11 rounded-lg border text-sm font-medium transition-all ${
                        platforms.includes(opt.value)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* usage and advantages */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="usageAdvantage" className="text-sm font-medium">{t("usageLabel")}</Label>
                  <span className="text-xs text-muted-foreground">{t("optional")}</span>
                </div>
                <Textarea
                  id="usageAdvantage"
                  placeholder={t("usagePlaceholder")}
                  value={usageAdvantage}
                  onChange={(e) => setUsageAdvantage(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>
                </div>
              </details>
            </CardContent>
          </Card>

          {/* video configuration (target duration + video mode) */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                <span className="text-sm font-semibold">{t("stepConfigTitle")}</span>
              </div>

              {/* target duration */}
              <Label className="text-sm font-medium mb-3 block">{t("durationLabel")}</Label>
              <div className="grid grid-cols-3 gap-3">
                {durationOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDuration(opt.value)}
                    className={`relative flex items-center justify-center h-11 rounded-lg border text-sm font-medium transition-all ${
                      duration === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                    {/* selected indicator */}
                    {duration === opt.value && (
                      <div className="absolute -top-px -right-px h-4 w-4 flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full brand-gradient" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* divider */}
              <div className="my-5 border-t border-border/40" />

              {/* video mode */}
              <Label className="text-sm font-medium mb-3 block">{t("videoModeLabel")}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {videoModeOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setVideoMode(opt.value);
                        // non-presenter mode: clear the character selection
                        if (opt.value !== "live_presenter") {
                          setSelectedCharacterId(null);
                        }
                      }}
                      className={`relative flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all ${
                        videoMode === opt.value
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${videoMode === opt.value ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <span className={`text-sm font-medium ${videoMode === opt.value ? "text-primary" : "text-foreground"}`}>
                          {t(opt.labelKey)}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5 block">{t(opt.descKey)}</span>
                      </div>
                      {videoMode === opt.value && (
                        <div className="absolute top-2.5 right-2.5">
                          <div className="h-2 w-2 rounded-full brand-gradient" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* presenter character lives right under the mode picker: choosing
                  "live presenter" reveals it in place instead of a far-away card */}
              {videoMode === "live_presenter" && characters.length > 0 && (
                <>
                  <div className="my-5 border-t border-border/40" />
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-medium">{t("characterTitle")}</Label>
                    <span className="text-xs text-muted-foreground">{t("characterOptional")}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {/* no character */}
                    <button
                      onClick={() => setSelectedCharacterId(null)}
                      className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                        selectedCharacterId === null
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <LuUserX className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div>
                        <span className="text-sm font-medium block">{t("characterNone")}</span>
                        <span className="text-[11px] text-muted-foreground">{t("characterNoneDesc")}</span>
                      </div>
                    </button>

                    {/* existing characters */}
                    {characters.map((char) => (
                      <button
                        key={char.id}
                        onClick={() => setSelectedCharacterId(char.id)}
                        className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                          selectedCharacterId === char.id
                            ? "border-primary bg-primary/10"
                            : "border-border/50 bg-muted/20 hover:border-primary/40"
                        }`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <LuUser className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium block truncate">{char.name}</span>
                          {char.description && (
                            <span className="text-[11px] text-muted-foreground truncate block">{char.description}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* script style */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
                <span className="text-sm font-semibold">{t("stepStyleTitle")}</span>
              </div>
              <Label className="text-sm font-medium mb-3 block">{t("scriptStyleLabel")}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {styleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setScriptStyle(opt.value)}
                    className={`relative flex flex-col items-start p-3.5 rounded-lg border text-left transition-all ${
                      scriptStyle === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border/50 bg-muted/20 hover:border-primary/40"
                    }`}
                  >
                    <span
                      className={`text-sm font-medium ${
                        scriptStyle === opt.value ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {t(opt.descKey)}
                    </span>
                    {/* selected indicator */}
                    {scriptStyle === opt.value && (
                      <div className="absolute top-2.5 right-2.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-primary">
                          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
                          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* templates drawer: hit-structure templates + ad recipes, folded by default —
              powerful but optional, so they no longer dominate the create flow */}
          <Card className="glass-card">
            <CardContent className="p-5">
              <details className="group">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <LuZap className="w-4 h-4 text-primary" />
                      {t("templatesSummary")}
                      {pickedTemplateNames && (
                        <Badge variant="secondary" className="text-[10px] max-w-48 truncate">{pickedTemplateNames}</Badge>
                      )}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">{t("templatesSummaryDesc")}</p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="mt-5 space-y-6">

          {/* use a viral template (shown only when templates exist) */}
          {templates.length > 0 && (
            <div>
                <div className="mb-3">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <LuBookmark className="w-4 h-4 text-primary" />
                    {t("templateTitle")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("templateDesc")}
                  </p>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {/* no template */}
                  <button
                    onClick={() => setSelectedTemplateId(null)}
                    className={`shrink-0 flex flex-col items-start p-3 rounded-lg border text-left transition-all min-w-[140px] ${
                      selectedTemplateId === null
                        ? "border-primary bg-primary/10"
                        : "border-border/50 bg-muted/20 hover:border-primary/40"
                    }`}
                  >
                    <span className={`text-sm font-medium ${selectedTemplateId === null ? "text-primary" : "text-foreground"}`}>
                      {t("templateNone")}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5">{t("templateNoneDesc")}</span>
                  </button>
                  {/* template list */}
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`shrink-0 flex flex-col items-start p-3 rounded-lg border text-left transition-all min-w-[140px] ${
                        selectedTemplateId === tpl.id
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <span className={`text-sm font-medium truncate max-w-[120px] ${selectedTemplateId === tpl.id ? "text-primary" : "text-foreground"}`}>
                        {tpl.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground mt-0.5">
                        {tpl.category || tpl.styleType || t("templateGeneric")} · {t("templateUsedCount", { n: tpl.useCount })}
                      </span>
                    </button>
                  ))}
                </div>
            </div>
          )}

          {/* One-click finished-video ad template recipes:
              picking one pre-fills style/mode/look/camera-plan/compose across the pipeline */}
          <div>
              <div className="mb-3">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <LuZap className="w-4 h-4 text-primary" />
                  {t("adTemplateTitle")}
                </Label>
                <p className="text-xs text-muted-foreground mt-1">{t("adTemplateDesc")}</p>
              </div>
              {/* product-aware recommendations: keyword signals + category tie, computed live from the form */}
              {(() => {
                const recommended = recommendAdTemplates({ category, productName, sellingPoints });
                if (recommended.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    <span className="text-xs text-muted-foreground">{t("adTemplateRecommended")}</span>
                    {recommended.map((tpl) => (
                      <button
                        key={`rec-${tpl.id}`}
                        onClick={() => pickAdTemplate(tpl.id)}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                          selectedAdTemplateId === tpl.id
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-primary/30 bg-primary/5 text-foreground hover:border-primary/60"
                        }`}
                      >
                        {tpl.emoji} {locale === "zh" ? tpl.name.zh : tpl.name.en}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* group filter chips — a large library needs a browse taxonomy, not one endless scroll row */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {[{ id: "all" as const, name: { zh: "全部", en: "All" } }, ...AD_TEMPLATE_GROUPS].map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setAdTemplateGroup(g.id)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                      adTemplateGroup === g.id
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {locale === "zh" ? g.name.zh : g.name.en}
                    {g.id !== "all" && (
                      <span className="ml-1 opacity-60">{listAdTemplates({ group: g.id }).length}</span>
                    )}
                  </button>
                ))}
                {/* user-owned templates get their own chip once any exist (template economy) */}
                {myTemplates.length > 0 && (
                  <button
                    onClick={() => setAdTemplateGroup("mine")}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                      adTemplateGroup === "mine"
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t("adTemplateMine")}
                    <span className="ml-1 opacity-60">{myTemplates.length}</span>
                  </button>
                )}
                {/* keyword search — at 100+ templates, browsing alone stops scaling */}
                <input
                  value={adTemplateQuery}
                  onChange={(e) => setAdTemplateQuery(e.target.value)}
                  placeholder={t("adTemplateSearch")}
                  className="w-48 px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
                />
                {/* AI custom recipe: one LLM call picks from the real preset vocabularies for THIS product */}
                <button
                  onClick={generateAiTemplate}
                  disabled={aiTplLoading || !productName.trim() || !isLLMConfigured}
                  title={!productName.trim() ? t("adTemplateAiNeedName") : !isLLMConfigured ? t("adTemplateAiNeedLlm") : undefined}
                  className="px-2.5 py-1 rounded-full text-xs border border-primary/40 bg-primary/5 text-primary hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {aiTplLoading ? t("adTemplateAiLoading") : t("adTemplateAiButton")}
                </button>
                {/* recipes travel: import a shared .json, export the current pick */}
                <button
                  onClick={() => { setImportOpen((v) => !v); setMineNotice(""); }}
                  className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-all"
                >
                  {t("adTemplateImportButton")}
                </button>
                {selectedAdTemplateId && resolveAdTemplate(selectedAdTemplateId) && (
                  <>
                    <button
                      onClick={exportSelectedTemplate}
                      className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-all"
                    >
                      {t("adTemplateExportButton")}
                    </button>
                    {/* fork/edit the selected recipe — builtin & AI save as new mine rows, mine edits in place */}
                    <button
                      onClick={openTemplateEditor}
                      className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-all"
                    >
                      {t("adTemplateEditButton")}
                    </button>
                  </>
                )}
                {/* pack export lives on the "mine" tab — everything I own, one share file */}
                {adTemplateGroup === "mine" && myTemplates.length > 0 && (
                  <button
                    onClick={exportMinePack}
                    className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-all"
                  >
                    {t("adTemplatePackExport")} ({myTemplates.length})
                  </button>
                )}
              </div>
              {importOpen && (
                <div className="mb-3 space-y-2">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={t("adTemplateImportPlaceholder")}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg text-xs font-mono border border-border/50 bg-muted/20 outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={importAdTemplate}
                      disabled={importBusy || !importText.trim()}
                      className="px-3 py-1 rounded-full text-xs border border-primary/40 bg-primary/5 text-primary hover:border-primary disabled:opacity-40 transition-all"
                    >
                      {t("adTemplateImportConfirm")}
                    </button>
                    <button
                      onClick={() => { setImportOpen(false); setImportText(""); setMineNotice(""); }}
                      className="px-3 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-all"
                    >
                      {t("adTemplateImportCancel")}
                    </button>
                  </div>
                </div>
              )}
              {/* recipe editor — every select is fed from the same vocabularies the server clamps to */}
              {editorOpen && editorDraft && (
                <div className="mb-3 p-3 rounded-lg border border-primary/30 bg-primary/[0.03] space-y-3">
                  <p className="text-xs font-medium text-primary">
                    {editorSourceId ? t("adTplEditorTitleEdit") : t("adTplEditorTitleFork")}
                  </p>
                  <div className="grid grid-cols-[3.5rem_1fr_1fr] gap-2">
                    <input
                      value={editorDraft.emoji}
                      onChange={(e) => setEditorDraft((d) => (d ? { ...d, emoji: e.target.value } : d))}
                      placeholder={t("adTplFieldEmoji")}
                      className={EDITOR_INPUT_CLS}
                    />
                    <input
                      value={editorDraft.name.zh}
                      onChange={(e) => setEditorDraft((d) => (d ? { ...d, name: { ...d.name, zh: e.target.value } } : d))}
                      placeholder={t("adTplFieldNameZh")}
                      className={EDITOR_INPUT_CLS}
                    />
                    <input
                      value={editorDraft.name.en}
                      onChange={(e) => setEditorDraft((d) => (d ? { ...d, name: { ...d.name, en: e.target.value } } : d))}
                      placeholder={t("adTplFieldNameEn")}
                      className={EDITOR_INPUT_CLS}
                    />
                  </div>
                  <input
                    value={editorDraft.tagline.zh}
                    onChange={(e) => setEditorDraft((d) => (d ? { ...d, tagline: { ...d.tagline, zh: e.target.value } } : d))}
                    placeholder={t("adTplFieldTagline")}
                    className={EDITOR_INPUT_CLS}
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplFieldStyle")}
                      <select
                        value={editorDraft.styleType}
                        onChange={(e) => setEditorDraft((d) => (d ? { ...d, styleType: e.target.value } : d))}
                        className={EDITOR_INPUT_CLS}
                      >
                        {styleOptions.map((o) => (
                          <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplFieldMode")}
                      <select
                        value={editorDraft.videoMode}
                        onChange={(e) =>
                          setEditorDraft((d) => (d ? { ...d, videoMode: e.target.value as AdTemplate["videoMode"] } : d))
                        }
                        className={EDITOR_INPUT_CLS}
                      >
                        {videoModeOptions.map((o) => (
                          <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplFieldLook")}
                      <select
                        value={editorDraft.look}
                        onChange={(e) => setEditorDraft((d) => (d ? { ...d, look: e.target.value } : d))}
                        className={EDITOR_INPUT_CLS}
                      >
                        {LOOK_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{locale === "zh" ? p.name.zh : p.name.en}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplFieldGroup")}
                      <select
                        value={editorDraft.group}
                        onChange={(e) =>
                          setEditorDraft((d) => (d ? { ...d, group: e.target.value as AdTemplateGroupId } : d))
                        }
                        className={EDITOR_INPUT_CLS}
                      >
                        {AD_TEMPLATE_GROUPS.map((g) => (
                          <option key={g.id} value={g.id}>{locale === "zh" ? g.name.zh : g.name.en}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">{t("adTplFieldCamera")}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {AD_TEMPLATE_EDIT_VOCAB.shotTypes.map((st) => (
                        <label key={st} className="text-[11px] text-muted-foreground">
                          {t(SHOT_LABEL_KEYS[st] ?? st)}
                          <select
                            value={editorDraft.cameraPlan[st] ?? ""}
                            onChange={(e) =>
                              setEditorDraft((d) => {
                                if (!d) return d;
                                const plan = { ...d.cameraPlan };
                                if (e.target.value) plan[st] = e.target.value;
                                else delete plan[st];
                                return { ...d, cameraPlan: plan };
                              })
                            }
                            className={EDITOR_INPUT_CLS}
                          >
                            <option value="">{t("adTplCameraAuto")}</option>
                            {CAMERA_PRESETS.map((p) => (
                              <option key={p.id} value={p.id}>{locale === "zh" ? p.name.zh : p.name.en}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplComposeCaption")}
                      <select
                        value={editorDraft.compose.captionPreset}
                        onChange={(e) =>
                          setEditorDraft((d) =>
                            d ? { ...d, compose: { ...d.compose, captionPreset: e.target.value as CaptionPresetId } } : d
                          )
                        }
                        className={EDITOR_INPUT_CLS}
                      >
                        {CAPTION_PRESET_IDS.map((id) => (
                          <option key={id} value={id}>{locale === "zh" ? CAPTION_LABELS[id].zh : CAPTION_LABELS[id].en}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplComposeBgm")}
                      <select
                        value={editorDraft.compose.bgm}
                        onChange={(e) =>
                          setEditorDraft((d) =>
                            d ? { ...d, compose: { ...d.compose, bgm: e.target.value as AdTemplate["compose"]["bgm"] } } : d
                          )
                        }
                        className={EDITOR_INPUT_CLS}
                      >
                        {AD_TEMPLATE_EDIT_VOCAB.bgm.map((b) => (
                          <option key={b} value={b}>{locale === "zh" ? BGM_LABELS[b]?.zh ?? b : BGM_LABELS[b]?.en ?? b}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      {t("adTplComposeQuality")}
                      <select
                        value={editorDraft.compose.quality ?? ""}
                        onChange={(e) =>
                          setEditorDraft((d) => {
                            if (!d) return d;
                            const compose = { ...d.compose };
                            if (e.target.value) compose.quality = e.target.value as NonNullable<AdTemplate["compose"]["quality"]>;
                            else delete compose.quality;
                            return { ...d, compose };
                          })
                        }
                        className={EDITOR_INPUT_CLS}
                      >
                        <option value="">{t("adTplComposeQualityDefault")}</option>
                        {AD_TEMPLATE_EDIT_VOCAB.quality.map((q) => (
                          <option key={q} value={q}>{locale === "zh" ? QUALITY_LABELS[q]?.zh ?? q : QUALITY_LABELS[q]?.en ?? q}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground pb-1.5">
                      <input
                        type="checkbox"
                        checked={editorDraft.compose.bgmDuck}
                        onChange={(e) =>
                          setEditorDraft((d) => (d ? { ...d, compose: { ...d.compose, bgmDuck: e.target.checked } } : d))
                        }
                      />
                      {t("adTplComposeDuck")}
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground pb-1.5">
                      <input
                        type="checkbox"
                        checked={editorDraft.compose.productCard ?? false}
                        onChange={(e) =>
                          setEditorDraft((d) => (d ? { ...d, compose: { ...d.compose, productCard: e.target.checked } } : d))
                        }
                      />
                      {t("adTplComposeCard")}
                    </label>
                  </div>
                  <textarea
                    value={editorDraft.scriptHint.zh}
                    onChange={(e) => setEditorDraft((d) => (d ? { ...d, scriptHint: { zh: e.target.value } } : d))}
                    placeholder={t("adTplFieldHint")}
                    rows={2}
                    className={EDITOR_INPUT_CLS}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveEditorTemplate}
                      disabled={editorBusy}
                      className="px-3 py-1 rounded-full text-xs border border-primary/40 bg-primary/5 text-primary hover:border-primary disabled:opacity-40 transition-all"
                    >
                      {editorSourceId ? t("adTplEditorSaveEdit") : t("adTplEditorSaveFork")}
                    </button>
                    <button
                      onClick={() => { setEditorOpen(false); setEditorDraft(null); setMineNotice(""); }}
                      className="px-3 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 transition-all"
                    >
                      {t("adTemplateImportCancel")}
                    </button>
                  </div>
                </div>
              )}
              {aiTplError && <p className="text-xs text-destructive mb-2">{aiTplError}</p>}
              {mineNotice && <p className="text-xs text-muted-foreground mb-2">{mineNotice}</p>}
              {/* wrapping grid capped in height — a 100-card library can't live on one scroll row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[30rem] overflow-y-auto pb-1 pr-1">
                <button
                  onClick={() => setSelectedAdTemplateId("")}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                    selectedAdTemplateId === ""
                      ? "border-primary bg-primary/10"
                      : "border-border/50 bg-muted/20 hover:border-primary/40"
                  }`}
                >
                  <span className={`text-sm font-medium ${selectedAdTemplateId === "" ? "text-primary" : "text-foreground"}`}>
                    {t("adTemplateNone")}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">{t("adTemplateNoneDesc")}</span>
                </button>
                {/* the AI-generated custom recipe renders as a first-class card at the front */}
                {customAdTemplate && adTemplateGroup !== "mine" && (
                  <button
                    onClick={() => pickAdTemplate(CUSTOM_AD_TEMPLATE_ID)}
                    className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                      selectedAdTemplateId === CUSTOM_AD_TEMPLATE_ID
                        ? "border-primary bg-primary/10"
                        : "border-primary/40 bg-primary/5 hover:border-primary"
                    }`}
                  >
                    <span className={`text-sm font-medium ${selectedAdTemplateId === CUSTOM_AD_TEMPLATE_ID ? "text-primary" : "text-foreground"}`}>
                      {customAdTemplate.emoji} {locale === "zh" ? customAdTemplate.name.zh : customAdTemplate.name.en}
                      <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-primary/15 text-primary align-middle">AI</span>
                      {/* save-for-reuse chip (span, not button — cards are buttons already) */}
                      {!aiTplSaved && (
                        <span
                          onClick={(e) => { e.stopPropagation(); saveAiTemplateToMine(); }}
                          className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 align-middle cursor-pointer"
                        >
                          {t("adTemplateSaveMine")}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {locale === "zh" ? customAdTemplate.tagline.zh : customAdTemplate.tagline.en}
                    </span>
                  </button>
                )}
                {/* user-owned templates: shown under "all" and their own chip, searchable like builtins */}
                {(adTemplateGroup === "all" || adTemplateGroup === "mine") &&
                  myTemplates
                    .filter((tpl) => {
                      const q = adTemplateQuery.trim().toLowerCase();
                      if (!q) return true;
                      return `${tpl.name.zh} ${tpl.name.en} ${tpl.tagline.zh} ${tpl.tagline.en}`.toLowerCase().includes(q);
                    })
                    .map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => pickAdTemplate(tpl.id)}
                        className={`relative flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                          selectedAdTemplateId === tpl.id
                            ? "border-primary bg-primary/10"
                            : "border-border/50 bg-muted/20 hover:border-primary/40"
                        }`}
                      >
                        <span className={`text-sm font-medium ${selectedAdTemplateId === tpl.id ? "text-primary" : "text-foreground"}`}>
                          {tpl.emoji} {locale === "zh" ? tpl.name.zh : tpl.name.en}
                          <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-primary/15 text-primary align-middle">
                            {t("adTemplateMine")}
                          </span>
                        </span>
                        <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {locale === "zh" ? tpl.tagline.zh : tpl.tagline.en}
                        </span>
                        <span
                          onClick={(e) => { e.stopPropagation(); deleteMyTemplate(tpl.id); }}
                          title={t("adTemplateDeleteTitle")}
                          className="absolute top-1.5 right-1.5 text-[11px] leading-none px-1 py-0.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                        >
                          ✕
                        </span>
                      </button>
                    ))}
                {adTemplateGroup !== "mine" && listAdTemplates({ group: adTemplateGroup, category, query: adTemplateQuery }).map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => pickAdTemplate(tpl.id)}
                    className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                      selectedAdTemplateId === tpl.id
                        ? "border-primary bg-primary/10"
                        : "border-border/50 bg-muted/20 hover:border-primary/40"
                    }`}
                  >
                    <span className={`text-sm font-medium ${selectedAdTemplateId === tpl.id ? "text-primary" : "text-foreground"}`}>
                      {tpl.emoji} {locale === "zh" ? tpl.name.zh : tpl.name.en}
                      {category && tpl.goodFor?.includes(category as AdTemplateCategory) && (
                        <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-primary/15 text-primary align-middle">
                          {t("adTemplateGoodMatch")}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {locale === "zh" ? tpl.tagline.zh : tpl.tagline.en}
                    </span>
                  </button>
                ))}
              </div>
          </div>
                </div>
              </details>
            </CardContent>
          </Card>

          {/* submit button */}
          <div className="pt-2 pb-10">
            {/* error message */}
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive flex items-center gap-2">
                  <LuCircleAlert className="w-4 h-4 shrink-0" />
                  {error}
                </p>
              </div>
            )}

            {/* progress bar */}
            {progress && (
              <div className="mb-4">
                <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full brand-gradient transition-all duration-500 rounded-full"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {progress.message}
                </p>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting || !isLLMConfigured}
              className="w-full h-12 brand-gradient text-white font-semibold text-base shadow-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin mr-2 h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {progress?.message || t("submitProcessing")}
                </>
              ) : (
                <>
                  <LuZap className="w-5 h-5 mr-2" />
                  {t("submitGenerate")}
                </>
              )}
            </Button>
            {!isSubmitting && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                {!isLLMConfigured
                  ? t("hintNeedLlm")
                  : !isValid
                    ? t("hintNeedInput")
                    : t("hintReady")}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
