"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { LuWand, LuClock, LuImage, LuArrowRight, LuBookmarkPlus, LuLoaderCircle } from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { Shot } from "@/lib/db/schema";
import { useTemplateStore } from "@/lib/stores/template-store";
import { useSettingsStore } from "@/lib/stores/settings-store";

// 镜头类型标签
const shotTypeLabels: Record<Shot["type"], { label: string; color: string }> = {
  hook: { label: "钩子", color: "bg-red-500/20 text-red-400" },
  pain_point: { label: "痛点", color: "bg-orange-500/20 text-orange-400" },
  product_reveal: { label: "产品", color: "bg-blue-500/20 text-blue-400" },
  demo: { label: "演示", color: "bg-green-500/20 text-green-400" },
  social_proof: { label: "背书", color: "bg-purple-500/20 text-purple-400" },
  cta: { label: "转化", color: "bg-amber-500/20 text-amber-400" },
};

const styleLabels: Record<string, string> = {
  pain_point: "痛点种草",
  scene: "场景安利",
  comparison: "对比测评",
  story: "剧情故事",
};

// 后端 scripts 表返回的脚本结构
interface DbScript {
  id: string;
  title: string | null;
  styleType: string;
  totalDuration: number | null;
  shots: Shot[];
  selected: boolean | null;
}

export default function ScriptPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedScript, setSelectedScript] = useState(0);
  const [scripts, setScripts] = useState<
    { id: string; title: string; styleType: string; totalDuration: number; shots: Shot[] }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  // 项目元信息：空态「重新生成脚本」时复用
  const [projectMeta, setProjectMeta] = useState<{
    productName: string;
    category: string;
    description: string;
    productImages: string[];
    videoMode: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const { llm } = useSettingsStore();

  // 按 projectId 拉取真实脚本（落库于 scripts 表）
  const loadScripts = async () => {
    setLoading(true);
    try {
      const [scriptsRes, projectRes] = await Promise.all([
        fetch(`/api/project/${id}/scripts`),
        fetch(`/api/project/${id}`),
      ]);
      const dbScripts: DbScript[] = scriptsRes.ok ? await scriptsRes.json() : [];
      if (projectRes.ok) {
        const proj = await projectRes.json();
        setProjectName(proj.name ?? proj.productName ?? "");
        setProjectMeta({
          productName: proj.productName ?? "",
          category: proj.productCategory ?? "",
          description: proj.productDescription ?? "",
          productImages: Array.isArray(proj.productImages) ? proj.productImages : [],
          videoMode: proj.videoMode ?? "product_closeup",
        });
      }
      if (Array.isArray(dbScripts) && dbScripts.length > 0) {
        setScripts(
          dbScripts.map((s) => ({
            id: s.id,
            title: s.title ?? "未命名脚本",
            styleType: s.styleType,
            totalDuration: s.totalDuration ?? 0,
            shots: s.shots ?? [],
          }))
        );
        const selIdx = dbScripts.findIndex((s) => s.selected);
        setSelectedScript(selIdx >= 0 ? selIdx : 0);
      } else {
        // 无真实脚本：保持空，由渲染层显示「去生成」空态
        // （修复 issue #3：旧逻辑回退到德宝示例数据，导致用户进自己项目却看到别人的 demo，
        //  误以为「找不到我自己创建的任务」）
        setScripts([]);
      }
    } catch {
      setScripts([]);
    } finally {
      setLoading(false);
    }
  };

  // 空态点击「生成脚本」：用项目已存的商品信息 + 设置里的 LLM 重新生成
  const handleGenerate = async () => {
    if (!projectMeta) return;
    if (!llm.apiKey) {
      setGenError("尚未配置 LLM，请先到「设置」填写 API Key");
      return;
    }
    setIsGenerating(true);
    setGenError("");
    try {
      const res = await fetch("/api/llm/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          productName: projectMeta.productName,
          category: projectMeta.category,
          productDescription: projectMeta.description,
          targetDuration: 30,
          styleType: "auto",
          videoMode: projectMeta.videoMode,
          productImages: projectMeta.productImages,
          llmConfig: {
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model: llm.model,
            visionModel: llm.visionModel,
          },
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "脚本生成失败，请检查 LLM 设置");
      }
      await loadScripts();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "脚本生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [scriptsRes, projectRes] = await Promise.all([
          fetch(`/api/project/${id}/scripts`),
          fetch(`/api/project/${id}`),
        ]);
        const dbScripts: DbScript[] = scriptsRes.ok ? await scriptsRes.json() : [];
        if (projectRes.ok) {
          const proj = await projectRes.json();
          if (!cancelled) {
            setProjectName(proj.name ?? proj.productName ?? "");
            setProjectMeta({
              productName: proj.productName ?? "",
              category: proj.productCategory ?? "",
              description: proj.productDescription ?? "",
              productImages: Array.isArray(proj.productImages) ? proj.productImages : [],
              videoMode: proj.videoMode ?? "product_closeup",
            });
          }
        }
        if (cancelled) return;
        if (Array.isArray(dbScripts) && dbScripts.length > 0) {
          setScripts(
            dbScripts.map((s) => ({
              id: s.id,
              title: s.title ?? "未命名脚本",
              styleType: s.styleType,
              totalDuration: s.totalDuration ?? 0,
              shots: s.shots ?? [],
            }))
          );
          // 默认选中已标记 selected 的方案
          const selIdx = dbScripts.findIndex((s) => s.selected);
          setSelectedScript(selIdx >= 0 ? selIdx : 0);
        } else {
          // 无真实脚本：保持空，由渲染层显示「去生成」空态
          // （修复 issue #3：旧逻辑回退到德宝示例数据，导致用户进自己项目却看到别人的 demo，
          //  误以为「找不到我自己创建的任务」）
          setScripts([]);
        }
      } catch {
        if (!cancelled) setScripts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentScript = scripts[selectedScript];

  // 模板相关状态
  const { addTemplate } = useTemplateStore();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savedTip, setSavedTip] = useState(false);

  /** 点击"存为模板"按钮 */
  const handleSaveAsTemplate = () => {
    setTemplateName("");
    setShowSaveDialog(true);
  };

  /** 确认保存模板 */
  const doSaveTemplate = () => {
    if (!templateName.trim() || !currentScript) return;
    addTemplate({
      id: crypto.randomUUID(),
      name: templateName.trim(),
      styleType: currentScript.styleType,
      shots: currentScript.shots as Shot[],
      totalDuration: currentScript.totalDuration,
      useCount: 0,
      createdAt: new Date(),
    });
    setShowSaveDialog(false);
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 3000);
  };

  // 顶部导航（空态/正常态共用）
  const headerBar = (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">带货剪手</span>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">{projectName || "带货项目"}</span>
        </div>
      </div>
    </header>
  );

  // 加载中
  if (loading) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
          <LuLoaderCircle className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">正在加载脚本...</p>
        </div>
      </div>
    );
  }

  // 空态：该项目还没有真实脚本（修复 #3：不再展示德宝示例，给出可恢复的「生成脚本」入口）
  if (scripts.length === 0) {
    return (
      <div className="min-h-screen grid-bg">
        {headerBar}
        <div className="mx-auto max-w-md flex flex-col items-center justify-center py-28 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 mb-5">
            <LuWand className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-2">还没有生成脚本</h2>
          <p className="text-sm text-muted-foreground mb-6">
            「{projectName || "该项目"}」尚未生成脚本，或上次生成失败。点击下方按钮，AI 将根据你的商品信息重新生成。
          </p>
          {genError && (
            <p className="text-sm text-destructive mb-4">{genError}</p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={isGenerating} className="brand-gradient text-white">
              {isGenerating ? (
                <>
                  <LuLoaderCircle className="w-4 h-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <LuWand className="w-4 h-4 mr-2" />
                  生成脚本
                </>
              )}
            </Button>
            <Link href="/">
              <Button variant="outline">返回项目列表</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <span className="text-lg font-bold tracking-tight">带货剪手</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{projectName || "带货项目"}</span>
          </div>

          {/* 步骤进度 */}
          <div className="flex items-center gap-1">
            {["脚本", "素材", "视频", "导出"].map((step, i) => (
              <div key={step} className="flex items-center">
                <div className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${i === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === 0 ? "bg-white/20" : "bg-muted"}`}>
                    {i + 1}
                  </span>
                  {step}
                </div>
                {i < 3 && <div className="mx-1 h-px w-4 bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：脚本方案选择 */}
          <div className="lg:col-span-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">脚本方案</h2>
              <div className="flex items-center gap-2">
                {savedTip && (
                  <span className="text-xs text-green-400 animate-in fade-in">已保存为模板</span>
                )}
                <Button variant="outline" size="sm" className="text-xs" onClick={handleSaveAsTemplate}>
                  <LuBookmarkPlus className="w-3.5 h-3.5 mr-1" />
                  存为模板
                </Button>
                <Button variant="outline" size="sm" disabled={isGenerating} className="text-xs">
                  <LuWand className="w-3.5 h-3.5 mr-1" />
                  重新生成
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {scripts.map((script, index) => (
                <Card
                  key={script.id}
                  className={`cursor-pointer transition-all ${selectedScript === index ? "ring-2 ring-primary neon-glow" : "glass-card card-hover"}`}
                  onClick={() => setSelectedScript(index)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-sm">{script.title}</h3>
                      <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                        {styleLabels[script.styleType]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{script.shots.length} 个镜头</span>
                      <span>{script.totalDuration}s</span>
                    </div>
                    {/* 镜头类型预览条 */}
                    <div className="mt-3 flex gap-0.5 h-1.5 rounded-full overflow-hidden">
                      {script.shots.map((shot) => {
                        const colors: Record<string, string> = {
                          hook: "bg-red-500", pain_point: "bg-orange-500",
                          product_reveal: "bg-blue-500", demo: "bg-green-500",
                          social_proof: "bg-purple-500", cta: "bg-amber-500",
                        };
                        return (
                          <div
                            key={shot.shotId}
                            className={`${colors[shot.type]} opacity-70`}
                            style={{ flex: shot.duration }}
                          />
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* 右侧：分镜详情编辑 */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="timeline" className="w-full">
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  <TabsTrigger value="timeline">分镜时间线</TabsTrigger>
                  <TabsTrigger value="text">文案编辑</TabsTrigger>
                </TabsList>
                <Link href={`/project/${id}/assets`}>
                  <Button className="brand-gradient text-white text-sm">
                    下一步：生成素材
                    <LuArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>

              <TabsContent value="timeline" className="mt-0">
                <div className="space-y-3">
                  {currentScript?.shots.map((shot, index) => {
                    const typeInfo = shotTypeLabels[shot.type];
                    return (
                      <Card key={shot.shotId} className="glass-card overflow-hidden">
                        <CardContent className="p-0">
                          <div className="flex">
                            {/* 左侧序号和类型 */}
                            <div className="flex flex-col items-center justify-center w-16 py-4 border-r border-border/50 shrink-0">
                              <span className="text-lg font-bold text-muted-foreground/50">{String(index + 1).padStart(2, "0")}</span>
                              <Badge className={`${typeInfo.color} border-0 text-[10px] mt-1`}>{typeInfo.label}</Badge>
                              <span className="text-[10px] text-muted-foreground mt-1">{shot.duration}s</span>
                            </div>
                            {/* 右侧内容 */}
                            <div className="flex-1 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <p className="text-sm leading-relaxed mb-2">{shot.description}</p>
                                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <LuClock className="w-3 h-3" />
                                      {shot.camera}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      {shot.visualSource === "product_image" ? "📷 商品原图" : shot.visualSource === "ai_generate" ? "✨ AI 生成" : "📁 用户上传"}
                                    </span>
                                  </div>
                                </div>
                                {/* 画面预览区 */}
                                <div className="w-20 h-14 bg-muted/30 rounded-md shrink-0 flex items-center justify-center border border-border/30">
                                  {shot.visualSource === "product_image" ? (
                                    <span className="text-[10px] text-muted-foreground">商品图</span>
                                  ) : (
                                    <LuImage className="w-4 h-4 text-muted-foreground/40" />
                                  )}
                                </div>
                              </div>
                              {/* 配音文案 */}
                              {shot.voiceover && (
                                <div className="mt-3 p-2.5 bg-muted/30 rounded-md">
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    🎙 {shot.voiceover}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="text" className="mt-0">
                <Card className="glass-card">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="font-medium text-sm mb-2">完整配音文案</h3>
                    <Textarea
                      className="min-h-[300px] bg-background/50 text-sm leading-relaxed"
                      defaultValue={currentScript?.shots.map((s) => s.voiceover).filter(Boolean).join("\n\n")}
                    />
                    <p className="text-xs text-muted-foreground">
                      总字数：{currentScript?.shots.reduce((sum, s) => sum + (s.voiceover?.length || 0), 0)} 字 ·
                      预计时长：{currentScript?.totalDuration}s ·
                      语速：约 {Math.round((currentScript?.shots.reduce((sum, s) => sum + (s.voiceover?.length || 0), 0) || 0) / (currentScript?.totalDuration || 1) * 10) / 10} 字/秒
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      {/* 保存模板弹窗 */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="glass-card w-full max-w-md mx-4">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-base font-semibold">保存为模板</h3>
              <p className="text-xs text-muted-foreground">保存当前脚本结构为模板，下次可直接套用到其他商品</p>
              <Input
                placeholder="模板名称，如：痛点种草-美妆通用"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>取消</Button>
                <Button size="sm" className="brand-gradient text-white" onClick={doSaveTemplate} disabled={!templateName.trim()}>保存</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
