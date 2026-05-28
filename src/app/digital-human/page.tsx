"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/stores/settings-store";

// ==================== 常量 ====================

// 内置数字人形象（用真实 SVG 占位，后续接入真实缩略图）
const PRESET_AVATARS = [
  { id: "female-pro", name: "职场女性", gender: "female" as const, style: "professional", emoji: "👩‍💼", desc: "商务/职场类带货", img: "/avatars/female-pro.jpg" },
  { id: "male-casual", name: "阳光男生", gender: "male" as const, style: "casual", emoji: "👨‍💻", desc: "数码/运动类带货", img: "/avatars/male-casual.jpg" },
  { id: "female-cute", name: "甜美主播", gender: "female" as const, style: "cute", emoji: "👧", desc: "美妆/食品类带货", img: "/avatars/female-cute.jpg" },
  { id: "male-mature", name: "成熟男士", gender: "male" as const, style: "mature", emoji: "👨‍💼", desc: "家居/金融类带货", img: "/avatars/male-mature.jpg" },
  { id: "female-elegant", name: "优雅女士", gender: "female" as const, style: "elegant", emoji: "👩", desc: "服饰/珠宝类带货", img: "/avatars/female-elegant.jpg" },
  { id: "male-tech", name: "科技达人", gender: "male" as const, style: "tech", emoji: "🧑‍💻", desc: "3C/数码类带货", img: "/avatars/male-tech.jpg" },
];

// 品类脚本模板
const SCRIPT_TEMPLATES: Record<string, { label: string; emoji: string; script: string }> = {
  beauty: { label: "美妆护肤", emoji: "💄", script: "姐妹们！这款精华我用了一个月，皮肤真的肉眼可见变好了！它含有高浓度玻尿酸和烟酰胺，上脸一点都不黏腻，吸收超快。之前换季脸总是起皮，用了它之后完全不会了。现在下单还有买一送一的活动，姐妹们赶紧冲！" },
  food: { label: "食品饮料", emoji: "🍜", script: "家人们看过来！这个螺蛳粉真的绝了！汤底是用猪骨熬了8小时的，料包超足，酸笋、腐竹、花生米一样不少。煮出来跟外面店里卖的一模一样，而且一包才不到10块钱！我自己已经回购三次了，今天直播间专属价更便宜，赶紧囤起来！" },
  digital: { label: "数码3C", emoji: "📱", script: "各位数码发烧友注意了！这款耳机我测试了一个星期，降噪效果真的没话说。地铁上、办公室里，一戴上整个世界都安静了。续航30小时，充一次电用一周没问题。音质方面低音浑厚、高音清澈，这个价位真的是性价比之王！" },
  home: { label: "家居日用", emoji: "🏠", script: "家里有宝宝的一定要看！这个除螨仪我用了之后才知道床单有多脏！紫外线杀菌加上强力拍打，第一次用就吸出来一堆脏东西。充一次电能用40分钟，整个家的床铺沙发都能搞定。为了家人的健康，这个真的不能省！" },
  fashion: { label: "服饰鞋包", emoji: "👗", script: "姐妹们这条裤子我吹爆！显瘦效果绝了，穿上腿直接长10厘米！面料是那种垂感很好的西装面料，不起球不变形。我158cm穿S码刚好，高个子矮个子都能驾驭。黑白两个颜色我都入了，配什么都好看！" },
  baby: { label: "母婴用品", emoji: "👶", script: "宝妈们看过来！这款婴儿湿巾我给宝宝用了半年了，真的超级温和。它是食品级成分，不含酒精不含荧光剂，宝宝啃到嘴里都不怕。而且很厚实不容易破，一张就能擦干净。现在买三送一，赶紧给宝宝囤起来！" },
  sports: { label: "运动健身", emoji: "💪", script: "健身的朋友们注意了！这款蛋白粉我喝了三个月，效果真的看得见！每份含25克优质乳清蛋白，巧克力味喝起来跟奶昔一样。训练后来一勺，恢复快增肌效果好。一桶能喝一个月，比健身房卖的便宜一半！" },
  pet: { label: "宠物用品", emoji: "🐱", script: "铲屎官们集合！这款猫粮我家主子吃了两个月，毛发变得超级顺滑！配方是鲜鸡肉+三文鱼，蛋白质含量38%以上。而且添加了益生菌，肠胃不好的猫咪也能吃。现在买5斤送1斤，赶紧给主子安排上！" },
};

// TTS 音色选项
const TTS_VOICES = [
  { id: "female-tianmei", name: "甜美女声", emoji: "👩" },
  { id: "female-wenyi", name: "文艺女声", emoji: "👩‍🎨" },
  { id: "female-dianya", name: "典雅女声", emoji: "👸" },
  { id: "male-qn-jingying", name: "精英男声", emoji: "👨‍💼" },
  { id: "male-qn-badao", name: "霸道男声", emoji: "🧑" },
  { id: "female-shaonv", name: "少女音", emoji: "👧" },
  { id: "female-yujie", name: "御姐音", emoji: "💃" },
  { id: "male-dongbei", name: "东北老铁", emoji: "🧊" },
  { id: "female-sichuan", name: "四川辣妹", emoji: "🌶️" },
  { id: "presenter_male", name: "男主持人", emoji: "🎤" },
  { id: "presenter_female", name: "女主持人", emoji: "🎙️" },
];

// 动作风格
const MOTION_STYLES = [
  { id: "talking", name: "自然口播", desc: "自然说话，适度手势", icon: "🗣️" },
  { id: "gesturing", name: "手势讲解", desc: "配合手势，增强表达", icon: "👋" },
  { id: "presenting", name: "专业展示", desc: "自信姿态，产品展示", icon: "🎯" },
];

// 平台尺寸
const PLATFORM_SIZES = [
  { id: "9:16", name: "抖音/快手", size: "1080×1920", icon: "📱" },
  { id: "16:9", name: "横屏/B站", size: "1920×1080", icon: "🖥️" },
  { id: "1:1", name: "小红书/朋友圈", size: "1080×1080", icon: "⬜" },
];

// ==================== 历史记录类型 ====================
interface GenerationRecord {
  id: string;
  avatarName: string;
  scriptPreview: string;
  videoUrl?: string;
  status: "generating" | "done" | "failed";
  createdAt: number;
  taskId?: string;
}

const MAX_TEXT_LENGTH = 500;
const STORAGE_KEY = "daihuo-dh-history";

// ==================== 页面组件 ====================

export default function DigitalHumanPage() {
  const settings = useSettingsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 状态
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_AVATARS[0].id);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [customAvatarFile, setCustomAvatarFile] = useState<File | null>(null);
  const [script, setScript] = useState("");
  const [motionStyle, setMotionStyle] = useState("talking");
  const [selectedVoice, setSelectedVoice] = useState("female-tianmei");
  const [selectedPlatform, setSelectedPlatform] = useState("9:16");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generatingRef = useRef(false);

  // 加载历史
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // 保存历史
  const saveHistory = useCallback((records: GenerationRecord[]) => {
    setHistory(records);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 20))); } catch { /* ignore */ }
  }, []);

  // 清理轮询
  const cleanupPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => cleanupPolling(), [cleanupPolling]);

  // 处理图片上传
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("图片不能超过 5MB"); return; }
    if (!file.type.startsWith("image/")) { setError("请选择图片文件"); return; }
    setCustomAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => { setCustomAvatar(ev.target?.result as string); setError(null); };
    reader.readAsDataURL(file);
  }, []);

  // 获取当前形象 URL
  const getAvatarUrl = useCallback((): string | null => {
    if (customAvatar) return customAvatar;
    const preset = PRESET_AVATARS.find((a) => a.id === selectedAvatar);
    return preset?.img || null;
  }, [customAvatar, selectedAvatar]);

  // 生成数字人视频
  const handleGenerate = useCallback(async () => {
    const apiKey = settings.providers["siliconflow"]?.apiKey;
    if (!apiKey) { setError("请先在设置中配置硅基流动 API Key"); return; }
    const avatarUrl = getAvatarUrl();
    if (!avatarUrl) { setError("请选择或上传数字人形象"); return; }
    if (!script.trim()) { setError("请输入口播脚本"); return; }
    if (script.length > MAX_TEXT_LENGTH) { setError(`脚本不能超过 ${MAX_TEXT_LENGTH} 字`); return; }

    setError(null);
    setIsGenerating(true);
    generatingRef.current = true;
    setResultUrl(null);
    setProgress(0);
    setCurrentTaskId(null);

    const recordId = Date.now().toString();
    const newRecord: GenerationRecord = {
      id: recordId, avatarName: customAvatar ? "自定义形象" : PRESET_AVATARS.find((a) => a.id === selectedAvatar)?.name || "",
      scriptPreview: script.slice(0, 30), status: "generating", createdAt: Date.now(),
    };
    saveHistory([newRecord, ...history]);

    try {
      const res = await fetch("/api/ai/digital-human", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarUrl, text: script, duration: 5, motionStyle,
          config: { apiKey, apiEndpoint: "https://api.siliconflow.cn/v1" },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "生成失败");

      setCurrentTaskId(data.taskId);
      setProgress(10);

      // P0-3: 用 ref 修复闭包 bug
      pollRef.current = setInterval(async () => {
        if (!generatingRef.current) { cleanupPolling(); return; }
        try {
          const statusRes = await fetch(`/api/ai/digital-human?action=status&taskId=${data.taskId}&apiKey=${apiKey}`);
          const status = await statusRes.json();
          if (status.status === "completed") {
            cleanupPolling();
            generatingRef.current = false;
            setIsGenerating(false);
            setProgress(100);
            const videoUrl = status.result?.videoUrl;
            setResultUrl(videoUrl);
            saveHistory(history.map((r) => r.id === recordId ? { ...r, status: "done", videoUrl } : r));
          } else if (status.status === "failed") {
            cleanupPolling();
            generatingRef.current = false;
            setIsGenerating(false);
            setError(status.error || "生成失败");
            saveHistory(history.map((r) => r.id === recordId ? { ...r, status: "failed" } : r));
          } else {
            setProgress((p) => Math.min(p + 5, 90));
          }
        } catch { /* 网络波动，下次重试 */ }
      }, 5000);

      // 超时处理
      setTimeout(() => {
        if (generatingRef.current) {
          cleanupPolling();
          generatingRef.current = false;
          setIsGenerating(false);
          setError("生成超时（5分钟），请重试");
          saveHistory(history.map((r) => r.id === recordId ? { ...r, status: "failed" } : r));
        }
      }, 300000);
    } catch (err) {
      generatingRef.current = false;
      setIsGenerating(false);
      setError(err instanceof Error ? err.message : "请求失败");
      saveHistory(history.map((r) => r.id === recordId ? { ...r, status: "failed" } : r));
    }
  }, [settings, getAvatarUrl, script, motionStyle, selectedAvatar, customAvatar, history, saveHistory, cleanupPolling]);

  // 取消生成
  const handleCancel = useCallback(() => {
    cleanupPolling();
    generatingRef.current = false;
    setIsGenerating(false);
    setProgress(0);
    setCurrentTaskId(null);
  }, [cleanupPolling]);

  // 下载视频
  const handleDownload = useCallback(() => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `digital-human-${Date.now()}.mp4`;
    a.click();
  }, [resultUrl]);

  // 脚本字数
  const charCount = script.length;
  const charPercent = Math.round((charCount / MAX_TEXT_LENGTH) * 100);

  // 选择品类模板
  const handleSelectTemplate = useCallback((key: string) => {
    const tpl = SCRIPT_TEMPLATES[key];
    if (tpl) { setScript(tpl.script); setError(null); }
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">🤖 AI 数字人口播</h1>
          <p className="text-sm text-muted-foreground mt-1">选择形象 → 输入脚本 → 一键生成数字人口播视频</p>
        </div>
        <Link href="/">
          <Button variant="outline" size="sm">← 返回首页</Button>
        </Link>
      </div>

      {/* 未配置提示 */}
      {!settings.providers["siliconflow"]?.apiKey && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span className="text-sm">请先配置硅基流动 API Key 才能使用数字人功能</span>
            </div>
            <Link href="/settings"><Button size="sm">去配置</Button></Link>
          </CardContent>
        </Card>
      )}

      {/* ===== Step 1: 选择形象 ===== */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">1</span>
          选择数字人形象
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {PRESET_AVATARS.map((avatar) => (
            <Card
              key={avatar.id}
              className={`cursor-pointer transition-all hover:scale-[1.02] ${selectedAvatar === avatar.id && !customAvatar ? "ring-2 ring-primary shadow-lg" : "hover:border-primary/50"}`}
              onClick={() => { setSelectedAvatar(avatar.id); setCustomAvatar(null); setCustomAvatarFile(null); }}
            >
              <CardContent className="p-3 text-center">
                <div className="w-full aspect-square rounded-lg bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mb-2 overflow-hidden">
                  <span className="text-5xl">{avatar.emoji}</span>
                </div>
                <p className="text-sm font-medium">{avatar.name}</p>
                <p className="text-xs text-muted-foreground">{avatar.desc}</p>
              </CardContent>
            </Card>
          ))}

          {/* 自定义上传 */}
          <Card
            className={`cursor-pointer transition-all hover:scale-[1.02] border-dashed ${customAvatar ? "ring-2 ring-primary shadow-lg" : "hover:border-primary/50"}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <CardContent className="p-3 text-center">
              <div className="w-full aspect-square rounded-lg bg-muted flex items-center justify-center mb-2 overflow-hidden">
                {customAvatar ? (
                  <img src={customAvatar} alt="自定义" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-3xl">📤</span>
                    <span className="text-xs text-muted-foreground">上传形象</span>
                  </div>
                )}
              </div>
              <p className="text-sm font-medium">{customAvatarFile?.name || "自定义形象"}</p>
              <p className="text-xs text-muted-foreground">支持 JPG/PNG，≤5MB</p>
            </CardContent>
          </Card>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>
      </section>

      {/* ===== Step 2: 输入脚本 ===== */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">2</span>
          输入口播脚本
        </h2>

        {/* 品类模板 */}
        <div>
          <p className="text-sm text-muted-foreground mb-2">快速填充品类模板：</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SCRIPT_TEMPLATES).map(([key, tpl]) => (
              <Button key={key} variant="outline" size="sm" onClick={() => handleSelectTemplate(key)} disabled={isGenerating}>
                {tpl.emoji} {tpl.label}
              </Button>
            ))}
          </div>
        </div>

        {/* 脚本输入框 */}
        <div className="relative">
          <textarea
            value={script}
            onChange={(e) => { if (e.target.value.length <= MAX_TEXT_LENGTH) setScript(e.target.value); }}
            placeholder="在这里输入数字人要讲的内容...&#10;&#10;例：家人们看过来！这款产品真的太好用了..."
            disabled={isGenerating}
            className="w-full min-h-[160px] rounded-xl border border-input bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          />
          {/* 字数统计 */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${charPercent > 90 ? "bg-red-500" : charPercent > 70 ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${charPercent}%` }}
              />
            </div>
            <span className={`text-xs ${charCount > MAX_TEXT_LENGTH ? "text-red-500" : "text-muted-foreground"}`}>
              {charCount}/{MAX_TEXT_LENGTH}
            </span>
          </div>
        </div>
      </section>

      {/* ===== Step 3: 配置选项 ===== */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">3</span>
          高级选项
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* TTS 音色 */}
          <div>
            <p className="text-sm font-medium mb-2">🎙️ 语音音色</p>
            <div className="flex flex-wrap gap-1.5">
              {TTS_VOICES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVoice(v.id)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-all ${selectedVoice === v.id ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/50"}`}
                >
                  {v.emoji} {v.name}
                </button>
              ))}
            </div>
          </div>

          {/* 动作风格 */}
          <div>
            <p className="text-sm font-medium mb-2">💃 动作风格</p>
            <div className="space-y-1.5">
              {MOTION_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setMotionStyle(s.id)}
                  className={`w-full px-3 py-2 rounded-lg text-left text-sm border transition-all ${motionStyle === s.id ? "bg-primary/10 border-primary" : "hover:border-primary/50"}`}
                >
                  {s.icon} <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground ml-1 text-xs">— {s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 平台尺寸 */}
          <div>
            <p className="text-sm font-medium mb-2">📐 目标平台</p>
            <div className="space-y-1.5">
              {PLATFORM_SIZES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlatform(p.id)}
                  className={`w-full px-3 py-2 rounded-lg text-left text-sm border transition-all ${selectedPlatform === p.id ? "bg-primary/10 border-primary" : "hover:border-primary/50"}`}
                >
                  {p.icon} <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground ml-1 text-xs">{p.size}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== 生成按钮 + 进度 ===== */}
      <section className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-500/5 px-4 py-3 text-sm text-red-500">
            <span>⚠️</span>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-xs underline">关闭</button>
          </div>
        )}

        {isGenerating && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">⏳ AI 正在生成数字人视频...</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            {currentTaskId && (
              <p className="text-xs text-muted-foreground text-center">任务 ID: {currentTaskId}</p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !script.trim() || !settings.providers["siliconflow"]?.apiKey}
            className="flex-1 h-12 text-base bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700"
          >
            {isGenerating ? "⏳ 生成中..." : "🚀 开始生成数字人视频"}
          </Button>
          {isGenerating && (
            <Button variant="outline" onClick={handleCancel} className="h-12">✕ 取消</Button>
          )}
        </div>
      </section>

      {/* ===== 视频预览 ===== */}
      {resultUrl && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">🎬 生成结果</h2>
          <Card>
            <CardContent className="p-4 space-y-4">
              <video src={resultUrl} controls className="w-full max-w-md mx-auto rounded-xl" />
              <div className="flex justify-center gap-3">
                <Button onClick={handleDownload}>📥 下载视频</Button>
                <Button variant="outline" onClick={() => { setResultUrl(null); setProgress(0); }}>🔄 重新生成</Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ===== 历史记录 ===== */}
      {history.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">📋 生成历史</h2>
            <Button variant="ghost" size="sm" onClick={() => { setHistory([]); localStorage.removeItem(STORAGE_KEY); }}>清空</Button>
          </div>
          <div className="space-y-2">
            {history.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
                <span>{r.status === "done" ? "✅" : r.status === "failed" ? "❌" : "⏳"}</span>
                <span className="font-medium">{r.avatarName}</span>
                <span className="text-muted-foreground truncate flex-1">{r.scriptPreview}...</span>
                {r.videoUrl && (
                  <Button variant="ghost" size="sm" onClick={() => setResultUrl(r.videoUrl!)}>▶ 查看</Button>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
