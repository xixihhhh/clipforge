"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/stores/settings-store";
import {
  ASPECT_RATIO_OPTIONS,
  RESOLUTION_OPTIONS,
  type CustomModel,
  type GenMediaType,
} from "@/lib/gen-params";

// 可挂自定义模型的平台（与 settings.providers 的 key 一致）
const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: "atlas-cloud", label: "Atlas Cloud" },
  { value: "fal-ai", label: "fal.ai" },
  { value: "replicate", label: "Replicate" },
  { value: "volcengine", label: "火山引擎" },
  { value: "alibaba", label: "阿里百炼" },
  { value: "siliconflow", label: "硅基流动" },
];

const labelOf = (opts: { value: string; label: string }[], v: string) =>
  opts.find((o) => o.value === v)?.label ?? v;

/** 数字输入：留空=undefined（用平台默认），否则取数值 */
function NumberField({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
    </div>
  );
}

/**
 * 「自定义模型 + 生成参数」设置卡。自包含读写 settings store，
 * 让用户在已有平台上挂任意 model id，并设置图/视频生成的全局默认参数。
 */
export function GenerationSettings() {
  const t = useT("generationSettings");
  const {
    customModels,
    addCustomModel,
    removeCustomModel,
    imageParams,
    videoParams,
    setImageParams,
    setVideoParams,
  } = useSettingsStore();

  // 媒体类型选项（label 需随界面语言）
  const MEDIA_OPTIONS: { value: GenMediaType; label: string }[] = [
    { value: "image", label: t("mediaImage") },
    { value: "video", label: t("mediaVideo") },
  ];

  // 画面比例选项：复用 gen-params 的取值，label 走 i18n（与设置页「默认设置」一致）
  const ASPECT_KEY: Record<string, string> = { "9:16": "aspect916", "16:9": "aspect169", "1:1": "aspect11" };
  const ASPECT_OPTIONS = ASPECT_RATIO_OPTIONS.map((o) => ({ value: o.value, label: t(ASPECT_KEY[o.value] ?? o.value) }));

  // 新增自定义模型的表单
  const [form, setForm] = useState<{ provider: string; modelId: string; name: string; mediaType: GenMediaType; supportsAudio: boolean }>({
    provider: "fal-ai",
    modelId: "",
    name: "",
    mediaType: "image",
    supportsAudio: false,
  });

  const canAdd = form.modelId.trim().length > 0;
  const handleAdd = () => {
    if (!canAdd) return;
    const cm: CustomModel = {
      id: crypto.randomUUID(),
      provider: form.provider,
      modelId: form.modelId.trim(),
      name: form.name.trim() || form.modelId.trim(),
      mediaType: form.mediaType,
      ...(form.mediaType === "video" && form.supportsAudio ? { supportsAudio: true } : {}),
    };
    addCustomModel(cm);
    setForm((f) => ({ ...f, modelId: "", name: "", supportsAudio: false }));
  };

  return (
    <>
      {/* 自定义模型 */}
      <Card className="glass-card">
        <CardContent className="p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">{t("customModelTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("customModelDesc")}
            </p>
          </div>

          {/* 新增表单 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fieldProvider")}</Label>
              <Select value={form.provider} onValueChange={(v) => setForm((f) => ({ ...f, provider: v ?? f.provider }))}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => labelOf(PROVIDER_OPTIONS, value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fieldType")}</Label>
              <Select value={form.mediaType} onValueChange={(v) => setForm((f) => ({ ...f, mediaType: (v ?? "image") as GenMediaType }))}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => labelOf(MEDIA_OPTIONS, value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fieldModelId")}</Label>
              <Input value={form.modelId} onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))} placeholder={t("modelIdPlaceholder")} className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fieldName")}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("namePlaceholder")} className="text-xs" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            {form.mediaType === "video" ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={form.supportsAudio} onChange={(e) => setForm((f) => ({ ...f, supportsAudio: e.target.checked }))} />
                {t("audioCheckbox")}
              </label>
            ) : <span />}
            <Button variant="outline" size="sm" onClick={handleAdd} disabled={!canAdd} className="text-xs">
              <LuPlus className="size-3.5 mr-1" /> {t("addModel")}
            </Button>
          </div>

          {/* 已添加列表 */}
          {customModels.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              {customModels.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {labelOf(PROVIDER_OPTIONS, m.provider)} · {m.mediaType === "image" ? t("mediaImage") : t("mediaVideo")} · {m.modelId}
                      {m.supportsAudio ? t("audioSuffix") : ""}
                    </p>
                  </div>
                  <button onClick={() => removeCustomModel(m.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" title={t("delete")}>
                    <LuTrash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 生成参数 */}
      <Card className="glass-card">
        <CardContent className="p-5 space-y-5">
          <div>
            <h3 className="font-semibold text-sm">{t("genParamsTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t("genParamsDesc")}</p>
          </div>

          {/* 图片参数 */}
          <div className="space-y-3">
            <p className="text-xs font-medium">{t("imageSection")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("aspectRatio")}</Label>
                <Select value={imageParams.aspectRatio} onValueChange={(v) => setImageParams({ ...imageParams, aspectRatio: (v ?? "9:16") as typeof imageParams.aspectRatio })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => labelOf(ASPECT_OPTIONS, value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label={t("count")} value={imageParams.count} onChange={(v) => setImageParams({ ...imageParams, count: v ?? 1 })} placeholder="1" />
              <NumberField label={t("steps")} value={imageParams.steps} onChange={(v) => setImageParams({ ...imageParams, steps: v })} placeholder={t("platformDefault")} />
              <NumberField label={t("guidanceScale")} value={imageParams.guidanceScale} onChange={(v) => setImageParams({ ...imageParams, guidanceScale: v })} step="0.1" placeholder={t("platformDefault")} />
              <NumberField label={t("seed")} value={imageParams.seed} onChange={(v) => setImageParams({ ...imageParams, seed: v })} placeholder={t("seedPlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("negativePrompt")}</Label>
              <Textarea value={imageParams.negativePrompt ?? ""} onChange={(e) => setImageParams({ ...imageParams, negativePrompt: e.target.value || undefined })} rows={2} placeholder={t("imageNegativePlaceholder")} className="text-xs resize-none" />
            </div>
          </div>

          {/* 视频参数 */}
          <div className="space-y-3 pt-2 border-t border-border/50">
            <p className="text-xs font-medium">{t("videoSection")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("aspectRatio")}</Label>
                <Select value={videoParams.aspectRatio} onValueChange={(v) => setVideoParams({ ...videoParams, aspectRatio: (v ?? "9:16") as typeof videoParams.aspectRatio })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => labelOf(ASPECT_OPTIONS, value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("resolution")}</Label>
                <Select value={videoParams.resolution} onValueChange={(v) => setVideoParams({ ...videoParams, resolution: (v ?? "1080p") as typeof videoParams.resolution })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => labelOf(RESOLUTION_OPTIONS, value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label={t("duration")} value={videoParams.duration} onChange={(v) => setVideoParams({ ...videoParams, duration: v })} placeholder="5" />
              <NumberField label={t("fps")} value={videoParams.fps} onChange={(v) => setVideoParams({ ...videoParams, fps: v })} placeholder={t("platformDefault")} />
              <NumberField label={t("motionStrength")} value={videoParams.motionStrength} onChange={(v) => setVideoParams({ ...videoParams, motionStrength: v })} step="0.1" placeholder={t("platformDefault")} />
              <NumberField label={t("seed")} value={videoParams.seed} onChange={(v) => setVideoParams({ ...videoParams, seed: v })} placeholder={t("seedPlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("negativePrompt")}</Label>
              <Textarea value={videoParams.negativePrompt ?? ""} onChange={(e) => setVideoParams({ ...videoParams, negativePrompt: e.target.value || undefined })} rows={2} placeholder={t("videoNegativePlaceholder")} className="text-xs resize-none" />
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
