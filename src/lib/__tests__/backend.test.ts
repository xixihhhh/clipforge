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
    expect(cmd).toContain("h*0.82"); // bottom 位置（带半透明底框，略上移）
    expect(cmd).toContain("box=1:boxcolor=black@0.45"); // 字幕底框
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

  it("输出文件路径正确", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("test-project-001");
    expect(cmd).toMatch(/final_\d+\.mp4/);
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
