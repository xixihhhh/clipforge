"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {LuWand, LuClock, LuImage, LuArrowRight, LuBookmarkPlus, LuLoader} from "react-icons/lu";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { Shot } from "@/lib/db/schema";
import { useTemplateStore } from "@/lib/stores/template-store";

// 模拟生成的脚本数据
const mockScripts = [
  {
    id: "s1",
    title: "湿水不破的秘密",
    styleType: "pain_point",
    totalDuration: 25,
    shots: [
      { shotId: 1, type: "hook" as const, duration: 3, description: "手持手机第一人称视角，快步走进房间，画面略有晃动", camera: "手持跟拍", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "你还在用产品核心卖点？", prompt: "First person POV walking into a bright modern room, slightly shaky handheld camera, cinematic" },
      { shotId: 2, type: "pain_point" as const, duration: 4, description: "桌上一堆廉价商品碎屑，手拿普通商品沾水后碎裂", camera: "俯拍特写", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "普通商品核心痛点，擦个嘴尴尬场景，太尴尬了", prompt: "Close-up overhead shot of cheap product paper disintegrating in water on a clean white table, dramatic lighting" },
      { shotId: 3, type: "product_reveal" as const, duration: 3, description: "通用商品包装正面特写，缓慢推进", camera: "缓慢推进", visualSource: "product_image" as const, transition: "ai_start_end" as const, voiceover: "惊喜发现通用品牌", prompt: "" },
      { shotId: 4, type: "demo" as const, duration: 5, description: "手拿通用商品浸入水中，拉扯展示韧性", camera: "中景固定", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "湿水都不破！自己一直在用这个！拉扯都不会烂", prompt: "Hands holding premium product paper submerged in clear water, pulling and stretching to show strength, bright studio lighting" },
      { shotId: 5, type: "cta" as const, duration: 3, description: "商品包装+价格标签+购物车图标", camera: "固定", visualSource: "product_image" as const, transition: "direct_concat" as const, voiceover: "限时特价！赶紧去抢！", prompt: "" },
    ],
  },
  {
    id: "s2",
    title: "商品推广演示",
    styleType: "comparison",
    totalDuration: 28,
    shots: [
      { shotId: 1, type: "hook" as const, duration: 3, description: "办公桌上并排放着5款不同品牌的商品", camera: "俯拍全景", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "预算投入买了5款商品，就为了告诉你哪款最值", prompt: "Overhead shot of 5 different product paper brands arranged neatly on a modern office desk, clean aesthetic" },
      { shotId: 2, type: "demo" as const, duration: 8, description: "逐一测试每款商品的湿水强度", camera: "特写对比", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "第一款，一碰水就烂...第二款也不行...这个居然还行？", prompt: "Split screen comparison of product papers being tested with water, some breaking apart, dramatic close-up" },
      { shotId: 3, type: "product_reveal" as const, duration: 4, description: "通用商品特写展示", camera: "推进", visualSource: "product_image" as const, transition: "ai_start_end" as const, voiceover: "最终胜出的是——通用品牌！脱颖而出", prompt: "" },
      { shotId: 4, type: "social_proof" as const, duration: 5, description: "展示销量数据和好评截图", camera: "固定", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "月销50万+，好评率99%，不是没有原因的", prompt: "Clean data visualization showing sales numbers and positive reviews, modern UI style, dark background" },
      { shotId: 5, type: "cta" as const, duration: 3, description: "商品展示+限时优惠信息", camera: "固定", visualSource: "product_image" as const, transition: "direct_concat" as const, voiceover: "链接在小黄车，今天下单还送湿巾！", prompt: "" },
    ],
  },
  {
    id: "s3",
    title: "约会救星",
    styleType: "story",
    totalDuration: 22,
    shots: [
      { shotId: 1, type: "hook" as const, duration: 3, description: "女生精心化好妆准备约会，镜头前自信微笑", camera: "正面中景", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "上周约会前发生了一件超尴尬的事", prompt: "Young Asian woman smiling confidently at camera after finishing makeup, warm bedroom lighting, cinematic" },
      { shotId: 2, type: "pain_point" as const, duration: 4, description: "餐厅里擦嘴后脸上满是纸屑的尴尬特写", camera: "特写", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "用餐厅的商品擦了一下嘴...尴尬状况", prompt: "Close-up of a woman's face with tiny paper residue near lips, embarrassed expression, restaurant lighting" },
      { shotId: 3, type: "product_reveal" as const, duration: 3, description: "轻松取出通用商品的动作", camera: "特写", visualSource: "product_image" as const, transition: "ai_start_end" as const, voiceover: "还好我包里有通用品牌", prompt: "" },
      { shotId: 4, type: "demo" as const, duration: 5, description: "用通用商品轻松完成，商品完整不掉屑", camera: "中景", visualSource: "ai_generate" as const, transition: "ai_start_end" as const, voiceover: "效果出众，商品完整不完美呈现，继续精彩！", prompt: "Woman elegantly using premium product, clean result, confident smile, warm restaurant ambiance" },
      { shotId: 5, type: "cta" as const, duration: 2, description: "商品展示+下单引导", camera: "固定", visualSource: "product_image" as const, transition: "direct_concat" as const, voiceover: "姐妹们快囤起来！", prompt: "" },
    ],
  },
];

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

export default function ScriptPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedScript, setSelectedScript] = useState(0);
  const [scripts, setScripts] = useState(mockScripts);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    // 优先从 sessionStorage 读取生成的脚本（从新建页面跳转而来）
    try {
      const stored = sessionStorage.getItem(`scripts_${id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 不删除 sessionStorage，素材页面还需要读取
        setScripts(parsed);
        return;
      }
    } catch {}
    setScripts(mockScripts);
  }, [id]);
  const currentScript = scripts[Math.min(selectedScript, scripts.length - 1)];

  // 模板相关状态
  const { addTemplate } = useTemplateStore();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savedTip, setSavedTip] = useState(false);

  const handleSaveAsTemplate = useCallback(() => {
    setTemplateName("");
    setShowSaveDialog(true);
  }, []);

  const handleRegenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/ai/script/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      if (!response.ok) throw new Error("生成失败");
      const data = await response.json();
      setScripts(data.scripts);
      sessionStorage.setItem(`scripts_${id}`, JSON.stringify(data.scripts));
    } catch (e) {
      console.error("生成脚本失败:", e);
      alert("生成失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  }, [id]);

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
              <span className="text-lg font-bold tracking-tight">萌萌的</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">通用品牌 通用商品推广</span>
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
                <Button variant="outline" size="sm" className="text-xs" onClick={handleSaveAsTemplate} disabled={isGenerating}>
                  <LuBookmarkPlus className="w-3.5 h-3.5 mr-1" />
                  存为模板
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={handleRegenerate} disabled={isGenerating}>
                  {isGenerating ? (
                    <>
                      <LuLoader className="w-3.5 h-3.5 mr-1 animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <LuWand className="w-3.5 h-3.5 mr-1" />
                      重新生成
                    </>
                  )}
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
                <div className="flex items-center gap-2">
                  <Link href={`/project/${id}/storyboard`}>
                    <Button variant="outline" size="sm">
                      分镜编辑器
                      <LuArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                  <Link href={`/project/${id}/assets`}>
                    <Button className="brand-gradient text-white text-sm">
                      下一步：生成素材
                      <LuArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>

              <TabsContent value="timeline" className="mt-0">
                <div className="space-y-3">
                  {currentScript?.shots.map((shot, index) => {
                    const typeInfo = shotTypeLabels[shot.type] || { label: "其他", color: "bg-gray-500/20 text-gray-400" };
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
