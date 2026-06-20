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

const MEDIA_OPTIONS: { value: GenMediaType; label: string }[] = [
  { value: "image", label: "生图" },
  { value: "video", label: "生视频" },
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
        placeholder={placeholder ?? "平台默认"}
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
  const {
    customModels,
    addCustomModel,
    removeCustomModel,
    imageParams,
    videoParams,
    setImageParams,
    setVideoParams,
  } = useSettingsStore();

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
            <h3 className="font-semibold text-sm">自定义模型接入点</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              在已有平台上挂任意 model id，添加后即可在上方「默认生图/生视频模型」里选用（平台 Key 复用「AI 平台」配置）。
            </p>
          </div>

          {/* 新增表单 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">归属平台</Label>
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
              <Label className="text-xs text-muted-foreground">类型</Label>
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
              <Label className="text-xs text-muted-foreground">model id</Label>
              <Input value={form.modelId} onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))} placeholder="如 fal-ai/flux-pro/v1.1" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">显示名（选填）</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="不填则用 model id" className="text-xs" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            {form.mediaType === "video" ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={form.supportsAudio} onChange={(e) => setForm((f) => ({ ...f, supportsAudio: e.target.checked }))} />
                该视频模型原生带音频（可省 TTS）
              </label>
            ) : <span />}
            <Button variant="outline" size="sm" onClick={handleAdd} disabled={!canAdd} className="text-xs">
              <LuPlus className="size-3.5 mr-1" /> 添加模型
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
                      {labelOf(PROVIDER_OPTIONS, m.provider)} · {m.mediaType === "image" ? "生图" : "生视频"} · {m.modelId}
                      {m.supportsAudio ? " · 带音频" : ""}
                    </p>
                  </div>
                  <button onClick={() => removeCustomModel(m.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" title="删除">
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
            <h3 className="font-semibold text-sm">生成参数（全局默认）</h3>
            <p className="text-xs text-muted-foreground mt-0.5">生成图片/动态镜头时统一使用，留空的数值项走对应模型默认。</p>
          </div>

          {/* 图片参数 */}
          <div className="space-y-3">
            <p className="text-xs font-medium">图片</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">画面比例</Label>
                <Select value={imageParams.aspectRatio} onValueChange={(v) => setImageParams({ ...imageParams, aspectRatio: (v ?? "9:16") as typeof imageParams.aspectRatio })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => labelOf(ASPECT_RATIO_OPTIONS, value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIO_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="生成数量" value={imageParams.count} onChange={(v) => setImageParams({ ...imageParams, count: v ?? 1 })} placeholder="1" />
              <NumberField label="推理步数" value={imageParams.steps} onChange={(v) => setImageParams({ ...imageParams, steps: v })} />
              <NumberField label="引导系数" value={imageParams.guidanceScale} onChange={(v) => setImageParams({ ...imageParams, guidanceScale: v })} step="0.1" />
              <NumberField label="随机种子" value={imageParams.seed} onChange={(v) => setImageParams({ ...imageParams, seed: v })} placeholder="随机" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">反向提示词（选填）</Label>
              <Textarea value={imageParams.negativePrompt ?? ""} onChange={(e) => setImageParams({ ...imageParams, negativePrompt: e.target.value || undefined })} rows={2} placeholder="不希望出现的元素，如 模糊、文字、水印" className="text-xs resize-none" />
            </div>
          </div>

          {/* 视频参数 */}
          <div className="space-y-3 pt-2 border-t border-border/50">
            <p className="text-xs font-medium">视频（转动态镜头）</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">画面比例</Label>
                <Select value={videoParams.aspectRatio} onValueChange={(v) => setVideoParams({ ...videoParams, aspectRatio: (v ?? "9:16") as typeof videoParams.aspectRatio })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => labelOf(ASPECT_RATIO_OPTIONS, value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIO_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">分辨率</Label>
                <Select value={videoParams.resolution} onValueChange={(v) => setVideoParams({ ...videoParams, resolution: (v ?? "1080p") as typeof videoParams.resolution })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => labelOf(RESOLUTION_OPTIONS, value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="时长（秒）" value={videoParams.duration} onChange={(v) => setVideoParams({ ...videoParams, duration: v })} placeholder="5" />
              <NumberField label="帧率 fps" value={videoParams.fps} onChange={(v) => setVideoParams({ ...videoParams, fps: v })} />
              <NumberField label="运动强度" value={videoParams.motionStrength} onChange={(v) => setVideoParams({ ...videoParams, motionStrength: v })} step="0.1" />
              <NumberField label="随机种子" value={videoParams.seed} onChange={(v) => setVideoParams({ ...videoParams, seed: v })} placeholder="随机" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">反向提示词（选填）</Label>
              <Textarea value={videoParams.negativePrompt ?? ""} onChange={(e) => setVideoParams({ ...videoParams, negativePrompt: e.target.value || undefined })} rows={2} placeholder="不希望出现的元素" className="text-xs resize-none" />
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
