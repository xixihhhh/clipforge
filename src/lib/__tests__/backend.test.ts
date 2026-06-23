import { describe, it, expect } from "vitest";
import { buildUserPrompt, buildBatchPrompt } from "@/lib/script-engine/prompts";
import type { ScriptGenerationInput } from "@/lib/script-engine/prompts";
import { extractJSON, parseScriptResponse } from "@/lib/script-engine/generator";
import { buildComposeCommand, type ComposeConfig } from "@/lib/video-composer/composer";

// ==================== Prompt 构建测试 ====================

describe("buildUserPrompt", () => {
  const baseInput: ScriptGenerationInput = {
    productName: "氨基酸洁面乳",
    category: "beauty",
    styleType: "pain_point",
    targetDuration: 25,
  };

  it("套用模板时 prompt 含参考爆款结构块", () => {
    const withRef = buildBatchPrompt({ ...baseInput, referenceStructure: "1. [hook] 3s 口播参考：「你还在...」" }, 3);
    expect(withRef).toContain("参考爆款结构");
    expect(withRef).toContain("你还在...");
    // 未传模板时不应出现该块
    const noRef = buildBatchPrompt(baseInput, 3);
    expect(noRef).not.toContain("参考爆款结构");
  });

  it("基础参数生成正确的 prompt", () => {
    const prompt = buildUserPrompt(baseInput);
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("输出格式要求 LLM 产出 searchTerms（英文素材检索词）", () => {
    const prompt = buildUserPrompt(baseInput);
    expect(prompt).toContain("searchTerms");
  });

  it("包含商品名称和品类", () => {
    const prompt = buildUserPrompt(baseInput);
    expect(prompt).toContain("氨基酸洁面乳");
    expect(prompt).toContain("美妆护肤");
  });

  it("包含视频模式指令", () => {
    const input: ScriptGenerationInput = {
      ...baseInput,
      videoMode: "scene_demo",
    };
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("场景演示");
  });

  it("默认使用 product_closeup 视频模式", () => {
    const prompt = buildUserPrompt(baseInput);
    expect(prompt).toContain("产品特写");
  });

  it("有人物时注入人物描述", () => {
    const input: ScriptGenerationInput = {
      ...baseInput,
      videoMode: "live_presenter",
      character: {
        id: "char-001",
        name: "小美",
        appearance: "25岁女生，长发，白皙皮肤",
        voiceStyle: "温柔女声",
      },
    };
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("小美");
    expect(prompt).toContain("25岁女生，长发，白皙皮肤");
    expect(prompt).toContain("温柔女声");
    expect(prompt).toContain("char-001");
  });

  it("无人物时不包含人物部分", () => {
    const prompt = buildUserPrompt(baseInput);
    // 不应包含专门的人物描述 section（注意：OUTPUT_FORMAT_PROMPT 模板中会出现 characterId 字段说明，这属于格式定义不是人物注入）
    expect(prompt).not.toContain("【出镜人物】");
    expect(prompt).not.toContain("人物名称");
    expect(prompt).not.toContain("外貌特征");
  });

  it("包含风格指令", () => {
    const prompt = buildUserPrompt(baseInput);
    // pain_point 风格应包含"痛点种草"
    expect(prompt).toContain("痛点种草");
  });

  it("包含自定义要求", () => {
    const input: ScriptGenerationInput = {
      ...baseInput,
      customRequirements: "请重点强调成分安全",
    };
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("请重点强调成分安全");
  });

  it("包含目标时长", () => {
    const prompt = buildUserPrompt(baseInput);
    expect(prompt).toContain("25秒");
  });
});

// ==================== FFmpeg 命令生成测试 ====================

describe("buildComposeCommand", () => {
  const baseConfig: ComposeConfig = {
    projectId: "test-project-001",
    clips: [
      { type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "zoom_in_slow" },
      { type: "video", filePath: "/data/clip2.mp4", duration: 5, transition: "ffmpeg_fade" },
    ],
    output: {
      resolution: "1080p",
      aspectRatio: "9:16",
    },
  };

  it("基础合成命令格式正确", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("ffmpeg");
    expect(cmd).toContain("-filter_complex");
    expect(cmd).toContain("libx264");
    expect(cmd).toContain("1080");
    expect(cmd).toContain("1920");
  });

  it("包含所有输入文件", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("/data/img1.jpg");
    expect(cmd).toContain("/data/clip2.mp4");
  });

  it("图片输入使用 loop 参数", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("-loop 1 -t 3");
  });

  it("有 BGM 时正确混音", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      output: {
        ...baseConfig.output,
        bgmPath: "/data/bgm.mp3",
        bgmVolume: 0.5,
      },
    };
    const cmd = buildComposeCommand(config);
    expect(cmd).toContain("/data/bgm.mp3");
    expect(cmd).toContain("volume=0.5");
    expect(cmd).toContain("audio_final");
  });

  it("有音频片段时正确提取音轨", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [
        { type: "video", filePath: "/data/clip1.mp4", duration: 3, transition: "direct_concat", hasAudio: true },
        { type: "video", filePath: "/data/clip2.mp4", duration: 5, transition: "direct_concat", hasAudio: false },
      ],
    };
    const cmd = buildComposeCommand(config);
    // 第一个片段有原生音频，应提取并按时长对齐
    expect(cmd).toContain("[0:a]aresample=44100,apad,atrim=duration=3,asetpts=PTS-STARTPTS[a0]");
    // 第二个片段无音频，应生成静音
    expect(cmd).toContain("anullsrc");
  });

  it("TTS 配音片段优先于原生音频，作为额外输入按时长对齐", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [
        { type: "image", filePath: "/data/img1.jpg", duration: 4, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" },
        { type: "image", filePath: "/data/img2.jpg", duration: 3, transition: "direct_concat", motion: "static" },
      ],
    };
    const cmd = buildComposeCommand(config);
    // TTS 音频作为额外输入（索引 2，排在两个图片输入之后），apad/atrim 对齐到 4s
    expect(cmd).toContain('-i "/data/tts1.mp3"');
    expect(cmd).toContain("apad,atrim=duration=4");
    // 第二个无配音片段生成静音
    expect(cmd).toContain("anullsrc");
  });

  it("字幕渲染参数正确", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      subtitle: {
        texts: [
          { text: "限时特惠", startTime: 0, endTime: 3 },
          { text: "立即购买", startTime: 3, endTime: 5 },
        ],
        fontSize: 40,
        color: "yellow",
        position: "bottom",
      },
    };
    const cmd = buildComposeCommand(config);
    expect(cmd).toContain("drawtext");
    expect(cmd).toContain("fontsize=40");
    expect(cmd).toContain("fontcolor=yellow");
    expect(cmd).toContain("h*0.88-text_h"); // bottom 多行安全锚点（按文字块底边定位，向上生长）
    expect(cmd).toContain("line_spacing="); // 多行行距
    expect(cmd).toContain("box=1:boxcolor=black@0.45"); // 字幕底框
  });

  it("字幕/贴片含百分号：用 expansion=none + 字面 %（不转义成 \\%，否则 ffmpeg 8.0 Stray % 致整条空白）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      subtitle: { texts: [{ text: "立省50% 闭眼入", startTime: 0, endTime: 3 }], position: "bottom" },
      overlays: [{ text: "全场5折 直降30%", style: "price", startTime: 0, endTime: 3 }],
    };
    const cmd = buildComposeCommand(config);
    // 所有 drawtext 必须带 expansion=none（关闭 % 展开）
    const drawCount = (cmd.match(/drawtext=/g) || []).length;
    const expCount = (cmd.match(/expansion=none/g) || []).length;
    expect(drawCount).toBeGreaterThan(0);
    expect(expCount).toBe(drawCount);
    // 文本里是字面 50% / 30%，不能被转义成 50\% / 30\%
    expect(cmd).toContain("50%");
    expect(cmd).toContain("30%");
    expect(cmd).not.toContain("50\\%");
    expect(cmd).not.toContain("30\\%");
  });

  it("文件路径含特殊字符时正确转义", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [
        { type: "video", filePath: '/data/my "video".mp4', duration: 3, transition: "direct_concat" },
        { type: "video", filePath: "/data/file$name.mp4", duration: 5, transition: "direct_concat" },
      ],
    };
    const cmd = buildComposeCommand(config);
    // 双引号和 $ 应被转义
    expect(cmd).not.toContain('my "video"');
    expect(cmd).toContain('\\"');
    expect(cmd).toContain("\\$");
  });

  it("xfade 转场正确设置 offset", () => {
    const cmd = buildComposeCommand(baseConfig);
    // ffmpeg_fade 转场应包含 xfade
    expect(cmd).toContain("xfade=transition=fade");
    expect(cmd).toContain("duration=0.5");
    // offset = 前一个片段时长 - fadeDuration = 3 - 0.5 = 2.5
    expect(cmd).toContain("offset=2.5");
  });

  it("多片段混用转场时 xfade offset 相对累计流时长（不会截断已拼接画面）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [
        { type: "image", filePath: "/d/1.jpg", duration: 3, transition: "direct_concat", motion: "static" },
        { type: "image", filePath: "/d/2.jpg", duration: 4, transition: "ffmpeg_fade", motion: "static" },
        { type: "image", filePath: "/d/3.jpg", duration: 4, transition: "direct_concat", motion: "static" },
        { type: "image", filePath: "/d/4.jpg", duration: 3, transition: "ffmpeg_fade", motion: "static" },
      ],
    };
    const cmd = buildComposeCommand(config);
    // 第一个 xfade（i=1）：offset = 累计3 - 0.5 = 2.5
    expect(cmd).toContain("offset=2.5");
    // 第二个 xfade（i=3）：累计 = 3 +4-0.5(fade) +4(concat) = 10.5 → offset = 10.5 - 0.5 = 10
    expect(cmd).toContain("offset=10");
    // 绝不能再用「上一个片段时长 - 0.5 = 2.5」那种错误算法导致第二个 fade 也 offset=2.5
    expect(cmd).not.toContain("offset=2.5:");
  });

  it("ffmpeg_fade：视频补帧 tpad + 音轨 acrossfade 镜像 xfade + 输出限定真实时长（修音画失步）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [
        { type: "video", filePath: "/d/1.webm", duration: 4, transition: "direct_concat", audioPath: "/d/a1.mp3" },
        { type: "video", filePath: "/d/2.webm", duration: 4, transition: "ffmpeg_fade", audioPath: "/d/a2.mp3" },
        { type: "video", filePath: "/d/3.webm", duration: 3, transition: "ffmpeg_fade", audioPath: "/d/a3.mp3" },
      ],
    };
    const cmd = buildComposeCommand(config);
    // 短视频补帧：先 tpad 克隆末帧再 trim，保证视频段恒等于分镜时长（免费素材长度不一不留黑尾）
    expect(cmd).toContain("tpad=stop_mode=clone:stop_duration=4");
    // 音轨镜像视频 xfade：ffmpeg_fade 边界用 acrossfade（而非朴素 concat），与视频同步缩短 0.5s/转场
    expect(cmd).toContain("acrossfade=d=0.5");
    // 输出限定为视频真实时间轴 accumulated = 4 + (4-0.5) + (3-0.5) = 10.0，避免尾部音频盖冻结帧
    expect(cmd).toContain("-t 10.000");
  });

  it("输出文件路径正确", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("test-project-001");
    expect(cmd).toMatch(/final_\d+\.mp4/);
  });

  it("每个视频片段归一化像素格式/SAR/帧率/时基（避免混用真实素材时 xfade/concat 崩溃）", () => {
    const cmd = buildComposeCommand(baseConfig);
    // 两个片段（图片 + 视频）都应带统一归一化后缀，否则不同像素格式素材会让 ffmpeg 报错
    expect(cmd).toContain("format=yuv420p,setsar=1,fps=30,settb=AVTB[v0]");
    expect(cmd).toContain("format=yuv420p,setsar=1,fps=30,settb=AVTB[v1]");
  });

  it("渲染质量预设：使用 output 的 videoPreset/crf 编码参数", () => {
    const cmd = buildComposeCommand({
      ...baseConfig,
      output: { ...baseConfig.output, videoPreset: "slow", crf: 17 },
    });
    expect(cmd).toContain("-preset slow -crf 17");
  });

  it("缺省编码参数回退 medium/18", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("-preset medium -crf 18");
  });

  it("非法 videoPreset 被白名单兜底为 medium（防注入）", () => {
    const cmd = buildComposeCommand({
      ...baseConfig,
      output: { ...baseConfig.output, videoPreset: "evil; rm -rf /", crf: 20 },
    });
    expect(cmd).toContain("-preset medium -crf 20");
    expect(cmd).not.toContain("rm -rf");
  });
});

// ==================== 脚本生成器 JSON 解析测试 ====================

describe("extractJSON", () => {
  it("正常 JSON 可以解析", () => {
    const input = '{"title":"测试脚本","shots":[]}';
    const result = extractJSON(input);
    expect(result).toBe('{"title":"测试脚本","shots":[]}');
    // 确认可以被 JSON.parse 正确解析
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("markdown 代码块包裹的 JSON 可以解析", () => {
    const input = '```json\n{"title":"测试脚本","shots":[]}\n```';
    const result = extractJSON(input);
    expect(result).toBe('{"title":"测试脚本","shots":[]}');
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("无语言标记的 markdown 代码块也可以解析", () => {
    const input = '```\n{"title":"测试脚本","shots":[]}\n```';
    const result = extractJSON(input);
    expect(result).toBe('{"title":"测试脚本","shots":[]}');
  });

  it("带前缀文字的 JSON 可以提取", () => {
    const input = '好的，以下是生成的脚本：\n{"title":"测试脚本","shots":[]}';
    const result = extractJSON(input);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe("测试脚本");
  });

  it("数组格式的 JSON 可以提取", () => {
    const input = '[{"title":"脚本1"},{"title":"脚本2"}]';
    const result = extractJSON(input);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });
});

describe("parseScriptResponse", () => {
  it("解析单个脚本对象", () => {
    const content = JSON.stringify({
      title: "测试脚本",
      totalDuration: 20,
      shots: [
        { shotId: 1, type: "hook", duration: 3, description: "开场", camera: "特写", visualSource: "ai_generate", transition: "direct_concat", voiceover: "大家好" },
        { shotId: 2, type: "cta", duration: 3, description: "结尾", camera: "中景", visualSource: "product_image", transition: "direct_concat", voiceover: "快来买" },
      ],
    });
    const scripts = parseScriptResponse(content, "pain_point");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].title).toBe("测试脚本");
    expect(scripts[0].shots).toHaveLength(2);
  });

  it("解析 scripts 数组包裹格式", () => {
    const content = JSON.stringify({
      scripts: [
        { title: "脚本1", totalDuration: 20, shots: [{ shotId: 1, type: "hook", duration: 3, description: "a", camera: "b", visualSource: "ai_generate", transition: "direct_concat", voiceover: "c" }] },
        { title: "脚本2", totalDuration: 25, shots: [{ shotId: 1, type: "hook", duration: 3, description: "d", camera: "e", visualSource: "ai_generate", transition: "direct_concat", voiceover: "f" }] },
      ],
    });
    const scripts = parseScriptResponse(content, "scene");
    expect(scripts).toHaveLength(2);
    expect(scripts[0].title).toBe("脚本1");
    expect(scripts[1].title).toBe("脚本2");
  });

  it("无效 JSON 抛出合适的错误", () => {
    expect(() => parseScriptResponse("这不是JSON", "pain_point")).toThrow("合法 JSON");
  });

  it("无法识别的 JSON 结构抛出错误", () => {
    const content = JSON.stringify({ foo: "bar" });
    expect(() => parseScriptResponse(content, "pain_point")).toThrow("无法解析");
  });

  it("批量里只有 title、缺 shots 的残缺条目被丢弃，只保留有分镜的", () => {
    const content = JSON.stringify({
      scripts: [
        { title: "残缺" }, // 缺 shots → 应被丢弃
        { title: "完整", totalDuration: 6, shots: [{ shotId: 1, type: "hook", duration: 3, description: "a", camera: "b", visualSource: "ai_generate", transition: "direct_concat", voiceover: "c" }] },
      ],
    });
    const scripts = parseScriptResponse(content, "pain_point");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].title).toBe("完整");
  });

  it("所有脚本都没有分镜 → 抛错（不让零分镜脚本被当成功落库）", () => {
    expect(() => parseScriptResponse(JSON.stringify({ scripts: [{ title: "空1" }, { title: "空2", shots: [] }] }), "pain_point")).toThrow("有效分镜");
  });

  it("把 LLM 的 searchTerms 解析为 stockKeywords（去空、trim、最多3个）", () => {
    const content = JSON.stringify({
      title: "t",
      totalDuration: 6,
      shots: [
        { shotId: 1, type: "hook", duration: 3, description: "a", camera: "b", visualSource: "ai_generate", transition: "direct_concat", voiceover: "c",
          searchTerms: [" coffee morning ", "cozy cafe", "", "extra", "fifth"] },
        { shotId: 2, type: "cta", duration: 3, description: "d", camera: "e", visualSource: "ai_generate", transition: "direct_concat", voiceover: "f" },
      ],
    });
    const scripts = parseScriptResponse(content, "scene");
    expect(scripts[0].shots[0].stockKeywords).toEqual(["coffee morning", "cozy cafe", "extra"]);
    expect(scripts[0].shots[1].stockKeywords).toBeUndefined(); // 无则不带该字段
  });

  it("Shot 字段缺失时自动填充默认值", () => {
    const content = JSON.stringify({
      title: "测试",
      shots: [
        { shotId: 1, type: "invalid_type", duration: -1, description: "", camera: "", visualSource: "unknown", transition: "unknown", voiceover: "" },
      ],
    });
    const scripts = parseScriptResponse(content, "pain_point");
    const shot = scripts[0].shots[0];
    // 无效的 type 应该回退到 "demo"
    expect(shot.type).toBe("demo");
    // 无效的 duration 应该回退到 3
    expect(shot.duration).toBe(3);
    // 无效的 visualSource 应该回退到 "ai_generate"
    expect(shot.visualSource).toBe("ai_generate");
    // 无效的 transition 应该回退到 "ai_start_end"（与 schema 默认及 UI 默认一致）
    expect(shot.transition).toBe("ai_start_end");
  });

  it("totalDuration 缺失时自动从 shots 累加计算", () => {
    const content = JSON.stringify({
      title: "测试",
      shots: [
        { shotId: 1, type: "hook", duration: 3, description: "a", camera: "b", visualSource: "ai_generate", transition: "direct_concat", voiceover: "c" },
        { shotId: 2, type: "cta", duration: 5, description: "d", camera: "e", visualSource: "product_image", transition: "direct_concat", voiceover: "f" },
      ],
    });
    const scripts = parseScriptResponse(content, "pain_point");
    expect(scripts[0].totalDuration).toBe(8);
  });
});
