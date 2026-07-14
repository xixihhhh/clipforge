import { describe, it, expect } from "vitest";
import { buildUserPrompt, buildBatchPrompt } from "@/lib/script-engine/prompts";
import type { ScriptGenerationInput } from "@/lib/script-engine/prompts";
import { extractJSON, parseScriptResponse, reasoningParams, batchCountFor } from "@/lib/script-engine/generator";
import { buildComposeCommand, buildComposeInvocation, resolveChineseFontFamily, wrapCaption, composeErrorMessage, buildDrawtext, type ComposeConfig } from "@/lib/video-composer/composer";

// ==================== Prompt build tests ====================

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
    // should not appear when no template is provided
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

  it("平台=tiktok 注入 TikTok Shop 官方结构指令（三段式 + 四范式）", () => {
    const prompt = buildUserPrompt({ ...baseInput, platforms: "tiktok" });
    expect(prompt).toContain("TikTok Shop");
    expect(prompt).toContain("三段式");
    expect(prompt).toContain("四范式");
    expect(prompt).toContain("橱窗");
    // non-tiktok platforms should not include the TikTok Shop four-pattern block
    expect(buildUserPrompt({ ...baseInput, platforms: "douyin" })).not.toContain("四范式");
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
    // should not contain a dedicated character description section (note: OUTPUT_FORMAT_PROMPT template may include a characterId field description, which is a format definition, not a character injection)
    expect(prompt).not.toContain("【出镜人物】");
    expect(prompt).not.toContain("人物名称");
    expect(prompt).not.toContain("外貌特征");
  });

  it("包含风格指令", () => {
    const prompt = buildUserPrompt(baseInput);
    // pain_point style should contain "痛点种草"
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

  it("英文商品：追加语言指令，要求旁白/标题用英文（海外带货，避免英文商品出中文旁白）", () => {
    const p = buildUserPrompt({ productName: "Glow Serum", category: "beauty", styleType: "pain_point", productDescription: "fades dark spots in 2 weeks" });
    expect(p).toContain("LANGUAGE");
    expect(p).toContain("NOT in Chinese");
  });

  it("中文商品：不追加英文语言指令（默认中文不变）", () => {
    expect(buildUserPrompt(baseInput)).not.toContain("NOT in Chinese");
  });
});

// ==================== FFmpeg command generation tests ====================

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

  it("字幕底距随商品卡自适应：无卡抬到 h*0.78（清出 2026 平台底部 UI 区）、有卡维持 h*0.83 紧贴卡下", () => {
    const sub = { texts: [{ text: "测试字幕", startTime: 0, endTime: 3 }], position: "bottom" as const };
    // no product card → not constrained by card-above-text stacking, caption bottom edge raised to h*0.78
    const noCard = buildComposeCommand({ ...baseConfig, subtitle: sub });
    expect(noCard).toContain("h*0.78-text_h");
    expect(noCard).not.toContain("h*0.83-text_h");
    // with product card → pinned to h*0.83 (going higher would collide with the product card at bottom offset 0.25)
    const withCard = buildComposeCommand({ ...baseConfig, subtitle: sub, productCard: { imagePath: "/data/prod.jpg", name: "测试", price: "¥9.9" } });
    expect(withCard).toContain("h*0.83-text_h");
    expect(withCard).not.toContain("h*0.78-text_h");
  });

  it("空 clips 抛可读错误（审计修复，否则 -map [v0] 指向不存在的流致 ffmpeg 晦涩失败）", () => {
    expect(() => buildComposeCommand({ ...baseConfig, clips: [] })).toThrow(/clips 为空|没有可合成/);
  });

  it("字体路径用路径转义器（审计修复：Windows C:\\ 路径反斜杠→正斜杠+冒号转义，而非 drawtext 文本转义器毁掉路径）", () => {
    const cmd = buildComposeCommand({
      ...baseConfig,
      subtitle: { texts: [{ text: "测试", startTime: 0, endTime: 3 }], fontFile: "C:\\fonts\\f.ttf", position: "bottom" },
    });
    expect(cmd).toContain("fontfile='C\\:/fonts/f.ttf'"); // escapeSubtitlesPath: \\ → / and : → \:
  });

  it("图片片段精确补齐到 clip.duration（zoompan+tpad+trim 防累计漂移）", () => {
    const cmd = buildComposeCommand(baseConfig);
    // image clip (img1, duration 3): zoompan camera motion + tpad clone last frame + trim to exact 3s
    expect(cmd).toContain("zoompan");
    expect(cmd).toContain("tpad=stop_mode=clone:stop_duration=3");
    expect(cmd).toContain("trim=duration=3");
  });

  it("有 BGM + 旁白时正确混音（normalize=0 不腰斩旁白、aloop 铺满）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      // audioPath triggers the voiceover audio track, goes through amix (voiceover+BGM) path
      clips: [
        { type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" },
        { type: "video", filePath: "/data/clip2.mp4", duration: 5, transition: "ffmpeg_fade" },
      ],
      output: { ...baseConfig.output, bgmPath: "/data/bgm.mp3", bgmVolume: 0.5 },
    };
    const cmd = buildComposeCommand(config);
    expect(cmd).toContain("/data/bgm.mp3");
    expect(cmd).toContain("volume=0.5");
    expect(cmd).toContain("audio_final");
    expect(cmd).toContain("amix=inputs=2");
    expect(cmd).toContain("normalize=0"); // don't cut voiceover volume to ~50%
    expect(cmd).toContain("aloop=loop=-1"); // BGM loops to fill the full video
    // BGM fade-out 3s at end, lands at total duration (3 + 5 - 0.5 = 7.5) tail → st=4.500
    expect(cmd).toContain("afade=t=out");
    expect(cmd).toContain("st=4.500");
    expect(cmd).not.toContain("atrim=start="); // intro skip is opt-in by default
  });

  it("BGM 前奏跳过为 opt-in（bgmIntroSkipSec 设了才出现 atrim=start）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [{ type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" }],
      output: { ...baseConfig.output, bgmPath: "/data/bgm.mp3", bgmIntroSkipSec: 2 },
    };
    expect(buildComposeCommand(config)).toContain("atrim=start=2");
  });

  it("BGM 旁白闪避 opt-in（bgmDuck → sidechaincompress + asplit 复制旁白作 sidechain 键）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [{ type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" }],
      output: { ...baseConfig.output, bgmPath: "/data/bgm.mp3", bgmDuck: true },
    };
    const cmd = buildComposeCommand(config);
    expect(cmd).toContain("sidechaincompress");
    expect(cmd).toContain("asplit=2[nar_mix][nar_key]");
    expect(cmd).toContain("normalize=0"); // mix core still normalize=0 (don't cut voiceover volume)
  });

  it("默认不开旁白闪避（无 sidechaincompress）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [{ type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" }],
      output: { ...baseConfig.output, bgmPath: "/data/bgm.mp3" },
    };
    expect(buildComposeCommand(config)).not.toContain("sidechaincompress");
  });

  it("bgmFadeOutSec=0 时不加结尾淡出", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [{ type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" }],
      output: { ...baseConfig.output, bgmPath: "/data/bgm.mp3", bgmFadeOutSec: 0 },
    };
    expect(buildComposeCommand(config)).not.toContain("afade=t=out");
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
    // first clip has native audio, should be extracted and aligned to its duration
    expect(cmd).toContain("[0:a]aresample=44100,apad,atrim=duration=3,asetpts=PTS-STARTPTS[a0]");
    // second clip has no audio, should generate silence
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
    // TTS audio as extra input (index 2, after the two image inputs), apad/atrim aligned to 4s
    expect(cmd).toContain('-i "/data/tts1.mp3"');
    expect(cmd).toContain("apad,atrim=duration=4");
    // second clip without voiceover generates silence
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
    expect(cmd).toContain("h*0.78-text_h"); // this config has no product card → caption raised to 0.22 bottom margin (h*0.78) to clear 2026 platform bottom UI area, measured from text block bottom edge upward
    expect(cmd).toContain("line_spacing="); // multi-line line spacing
    expect(cmd).toContain("box=1:boxcolor=black@0.45"); // caption background box
  });

  it("字幕/贴片含百分号：用 expansion=none + 字面 %（不转义成 \\%，否则 ffmpeg 8.0 Stray % 致整条空白）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      subtitle: { texts: [{ text: "立省50% 闭眼入", startTime: 0, endTime: 3 }], position: "bottom" },
      overlays: [{ text: "全场5折 直降30%", style: "price", startTime: 0, endTime: 3 }],
    };
    const cmd = buildComposeCommand(config);
    // all drawtext entries must include expansion=none (disable % expansion)
    const drawCount = (cmd.match(/drawtext=/g) || []).length;
    const expCount = (cmd.match(/expansion=none/g) || []).length;
    expect(drawCount).toBeGreaterThan(0);
    expect(expCount).toBe(drawCount);
    // text contains literal 50% / 30%, must not be escaped to 50\% / 30\%
    expect(cmd).toContain("50%");
    expect(cmd).toContain("30%");
    expect(cmd).not.toContain("50\\%");
    expect(cmd).not.toContain("30\\%");
  });

  it("长标签文本自动换行为多行居中（避免大字号贴片横向溢出画面）", () => {
    const short: ComposeConfig = {
      ...baseConfig,
      overlays: [{ text: "好物", style: "title", startTime: 0, endTime: 3 }],
    };
    const long: ComposeConfig = {
      ...baseConfig,
      overlays: [{ text: "同事以为我花了三千块做的脸其实只用了这一瓶精华", style: "title", startTime: 0, endTime: 3 }],
    };
    const shortLines = (buildComposeCommand(short).match(/drawtext=/g) || []).length;
    const longLines = (buildComposeCommand(long).match(/drawtext=/g) || []).length;
    // everything else identical → the extra drawtext entries are the wrapped lines of the long tag
    expect(longLines).toBeGreaterThan(shortLines);
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
    // double quotes and $ should be escaped
    expect(cmd).not.toContain('my "video"');
    expect(cmd).toContain('\\"');
    expect(cmd).toContain("\\$");
  });

  it("商品卡贴片（opt-in）：叠加商品图缩略 + 商品名", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      productCard: { imagePath: "/data/prod.jpg", name: "云柔抽纸", price: "¥39.9" },
    };
    const cmd = buildComposeCommand(config);
    expect(cmd).toContain("/data/prod.jpg"); // product image as input
    expect(cmd).toContain("[pcard]"); // thumbnail scale stream
    expect(cmd).toContain("overlay="); // overlay
    expect(cmd).toContain("云柔抽纸"); // product name drawtext
    expect(cmd).toContain("¥39.9"); // price drawtext
    // should not appear when productCard is not provided
    expect(buildComposeCommand(baseConfig)).not.toContain("[pcard]");
  });

  it("成片音频做响度归一（loudnorm EBU R128，~-14 LUFS）", () => {
    const config: ComposeConfig = {
      ...baseConfig,
      clips: [{ type: "image", filePath: "/data/img1.jpg", duration: 3, transition: "direct_concat", motion: "static", audioPath: "/data/tts1.mp3" }],
    };
    const cmd = buildComposeCommand(config);
    expect(cmd).toContain("loudnorm=I=-14");
    expect(cmd).toContain("[audio_norm]");
    expect(cmd).toContain('-map "[audio_norm]"');
  });

  it("成片写入 AIGC 隐式标识元数据（GB 45438），位置正确且不污染 filter_complex", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("-metadata comment=");
    expect(cmd).toContain("AIGC=1");
    expect(cmd).toContain("ClipForge");
    expect(cmd).toContain(baseConfig.projectId); // content production id = projectId
    // -metadata appears after -movflags and before the final output file
    expect(cmd.indexOf("-metadata")).toBeGreaterThan(cmd.indexOf("-movflags"));
    expect(cmd.lastIndexOf("-metadata")).toBeLessThan(cmd.lastIndexOf(".mp4"));
    // filter_complex is still intact (not corrupted by metadata)
    expect(cmd).toContain("-filter_complex");
  });

  it("xfade 转场正确设置 offset", () => {
    const cmd = buildComposeCommand(baseConfig);
    // ffmpeg_fade transition should include xfade
    expect(cmd).toContain("xfade=transition=fade");
    expect(cmd).toContain("duration=0.5");
    // offset = previous clip duration - fadeDuration = 3 - 0.5 = 2.5
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
    // first xfade (i=1): offset = cumulative 3 - 0.5 = 2.5
    expect(cmd).toContain("offset=2.5");
    // second xfade (i=3): cumulative = 3 + 4-0.5(fade) + 4(concat) = 10.5 → offset = 10.5 - 0.5 = 10
    expect(cmd).toContain("offset=10");
    // must never use the wrong algorithm of "previous clip duration - 0.5 = 2.5" causing second fade offset=2.5 again
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
    // short video frame-padding: tpad clones last frame then trim, ensuring video clip equals scene duration (free footage varies in length, no black tail)
    expect(cmd).toContain("tpad=stop_mode=clone:stop_duration=4");
    // audio track mirrors video xfade: ffmpeg_fade boundaries use acrossfade (not plain concat), synchronized with video to shorten by 0.5s per transition
    expect(cmd).toContain("acrossfade=d=0.5");
    // output capped to video real timeline accumulated = 4 + (4-0.5) + (3-0.5) = 10.0, avoiding tail audio covering frozen frame
    expect(cmd).toContain("-t 10.000");
  });

  it("输出文件路径正确", () => {
    const cmd = buildComposeCommand(baseConfig);
    expect(cmd).toContain("test-project-001");
    expect(cmd).toMatch(/final_\d+\.mp4/);
  });

  it("每个视频片段归一化像素格式/SAR/帧率/时基（避免混用真实素材时 xfade/concat 崩溃）", () => {
    const cmd = buildComposeCommand(baseConfig);
    // both clips (image + video) should have unified normalization suffix, otherwise mixed pixel format footage causes ffmpeg errors
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

// buildComposeInvocation is the shell-free form composeVideo actually runs (execFile + -filter_complex_script).
// It exists specifically to fix the Windows compose failure (issue #13): a real command is ~12k chars with
// embedded newlines, which overruns cmd.exe's 8191-char limit and breaks on newlines when run via a shell.
describe("buildComposeInvocation（shell-free 执行形态：修 Windows 合成必挂 issue #13）", () => {
  const cfg: ComposeConfig = {
    projectId: "p1",
    clips: [
      // Windows-style absolute path with a space + backslashes — must be passed RAW (no shell escaping/quoting)
      { type: "image", filePath: "C:\\clip forge\\data\\s0.png", duration: 3, transition: "direct_concat", motion: "static" },
    ],
    output: { resolution: "1080p", aspectRatio: "9:16" },
    // ASCII colon in subtitle text stresses the filtergraph escaping across the two forms
    subtitle: { texts: [{ text: "a:b", startTime: 0, endTime: 3 }], position: "bottom" },
  };

  it("输入路径作为独立 argv token 原样传入（不加引号、不做反斜杠转义）", () => {
    const inv = buildComposeInvocation(cfg);
    expect(inv.inputArgs[0]).toBe("-y");
    // raw path present verbatim as one token — not `"C:\\..."` shell-quoted, not backslash-doubled
    expect(inv.inputArgs).toContain("C:\\clip forge\\data\\s0.png");
    expect(inv.inputArgs).toContain("-i");
    // no argv token carries the giant filtergraph or an embedded newline (that lives in the script file)
    expect(inv.inputArgs.every((a) => !a.includes("\n"))).toBe(true);
    expect(inv.outputArgs.every((a) => !a.includes("\n"))).toBe(true);
  });

  it("视频流用原始 [vN] 映射、输出路径为最后一个 token（无 shell 引号）", () => {
    const inv = buildComposeInvocation(cfg);
    expect(inv.outputArgs).toContain("-map");
    expect(inv.outputArgs.some((a) => /^\[[^\]]+\]$/.test(a))).toBe(true); // e.g. "[sub_out]" — raw, unquoted
    expect(inv.outputArgs[inv.outputArgs.length - 1]).toBe(inv.outputPath);
    expect(inv.outputPath).toMatch(/final_\d+\.mp4$/);
  });

  it("filtergraph 用直连转义（冒号 \\: 单反斜杠），而命令串形态保留 shell 预留的 \\\\:", () => {
    const inv = buildComposeInvocation(cfg);
    const cmd = buildComposeCommand(cfg);
    // shell string form keeps the doubled backslash a real shell would halve
    expect(cmd).toContain("a\\\\:b");
    // script/execFile form is the post-shell direct form: single backslash before the colon
    expect(inv.filterComplex).toContain("a\\:b");
    expect(inv.filterComplex).not.toContain("a\\\\:b");
  });
});

// ==================== Script generator JSON parsing tests ====================

describe("reasoningParams（仅对 Pollinations 推理模型注入 reasoning_effort=low）", () => {
  it("Pollinations 端点 → 注入 reasoning_effort:low（否则推理模型耗尽输出预算、content 返空）", () => {
    expect(reasoningParams("https://text.pollinations.ai/openai")).toEqual({ reasoning_effort: "low" });
    expect(reasoningParams("https://TEXT.POLLINATIONS.AI/openai")).toEqual({ reasoning_effort: "low" });
  });
  it("其它端点（真 OpenAI/本地）→ 不注入（OpenAI 对非推理模型会 400 拒绝该参数）", () => {
    expect(reasoningParams("https://api.openai.com/v1")).toEqual({});
    expect(reasoningParams("http://localhost:11434/v1")).toEqual({});
    expect(reasoningParams("")).toEqual({});
  });
});

describe("batchCountFor（Pollinations 低输出上限 → 只生成1套,避免多套截断）", () => {
  it("Pollinations → 1（3套约7500字符会超输出上限被截断成非法JSON）", () => {
    expect(batchCountFor("https://text.pollinations.ai/openai")).toBe(1);
    expect(batchCountFor("https://text.pollinations.ai/openai", 5)).toBe(1); // 无视请求数,强制1
  });
  it("其它端点 → 保持请求的套数（默认3）", () => {
    expect(batchCountFor("https://api.openai.com/v1")).toBe(3);
    expect(batchCountFor("http://localhost:11434/v1", 5)).toBe(5);
    expect(batchCountFor("")).toBe(3);
  });
});

describe("extractJSON", () => {
  it("正常 JSON 可以解析", () => {
    const input = '{"title":"测试脚本","shots":[]}';
    const result = extractJSON(input);
    expect(result).toBe('{"title":"测试脚本","shots":[]}');
    // confirm it can be correctly parsed by JSON.parse
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
        { title: "残缺" }, // missing shots → should be discarded
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
    expect(scripts[0].shots[1].stockKeywords).toBeUndefined(); // absent if not present
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
    // invalid type should fall back to "demo"
    expect(shot.type).toBe("demo");
    // invalid duration should fall back to 3
    expect(shot.duration).toBe(3);
    // invalid visualSource should fall back to "ai_generate"
    expect(shot.visualSource).toBe("ai_generate");
    // invalid transition should fall back to "ai_start_end" (consistent with schema default and UI default)
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

  it("scripts 数组含 null 元素时跳过、不崩（LLM 偶发 [null, {...}]，修复前 validateScript(null) 抛错连累整次解析）", () => {
    const content = JSON.stringify({
      scripts: [null, { title: "有效脚本", shots: [{ duration: 3, voiceover: "测试旁白" }] }],
    });
    const scripts = parseScriptResponse(content, "pain_point");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].title).toBe("有效脚本");
  });

  it("截断的 JSON 报错带「截断」可操作提示（max_tokens 截断场景）", () => {
    const truncated = '{"scripts": [{"title": "X", "shots": [';
    expect(() => parseScriptResponse(truncated, "pain_point")).toThrow(/截断/);
  });

  it("截断在中间分镜、前一分镜已用 } 闭合时也识别为截断（括号计数，不被内部 } 骗过）", () => {
    // shot 1 is closed with }, shot 2 is cut off — the greedy extract ends with }, but brackets are unbalanced
    const truncated = '{"scripts": [{"title": "X", "totalDuration": 25, "shots": [{"shotId": 1, "type": "hook", "voiceover": "hi"}';
    expect(() => parseScriptResponse(truncated, "pain_point")).toThrow(/截断/);
  });
});

describe("内置全 CJK 字幕字体", () => {
  it("打包的 public/fonts/subtitle.otf(Noto CJK)被选中，卡拉OK族名为 Noto Sans CJK SC（韩/日字幕渲染前提）", () => {
    // bundled font is in the repo (public/fonts/subtitle.otf) and should take priority over system fonts;
    // karaoke uses libass matching by family name, must resolve to the font's real family name to use the bundled font (otherwise system PingFang lacks Hangul → tofu blocks)
    expect(resolveChineseFontFamily()).toBe("Noto Sans CJK SC");
  });
});

describe("字幕换行宽度估算（多语言）", () => {
  it("韩文谚文按 CJK 全宽估算换行，每行不溢出安全宽（否则当窄拉丁字→字幕溢出画面）", () => {
    const fontSize = 48, frameWidth = 720;
    const maxWidth = frameWidth * 0.86; // 619
    const ko = "정말 부드럽습니다 너무 좋아요 진짜 최고예요 강력 추천합니다";
    const lines = wrapCaption(ko, fontSize, frameWidth).split("\n");
    // recompute each line's actual width using "Hangul/CJK=fontSize, others=0.55*fontSize" — if isCJK misses Hangul, wrapCaption stuffs too many chars causing overflow here
    const w = (s: string) => [...s].reduce((acc, c) => acc + (/[가-힣一-鿿]/.test(c) ? fontSize : fontSize * 0.55), 0);
    for (const l of lines) expect(w(l)).toBeLessThanOrEqual(maxWidth + 1);
    expect(lines.length).toBeGreaterThan(1); // this long sentence should actually wrap
  });
});

describe("composeErrorMessage（ffmpeg 合成错误归类）", () => {
  it("超时(SIGTERM/killed) → 超时提示", () => {
    expect(composeErrorMessage({ killed: true, signal: "SIGTERM" })).toMatch(/超时/);
    expect(composeErrorMessage({ signal: "SIGTERM" })).toMatch(/超时/);
  });
  it("磁盘满(ENOSPC/no space) → 磁盘提示", () => {
    expect(composeErrorMessage({ stderr: "av_interleaved_write_frame(): No space left on device" })).toMatch(/磁盘/);
    expect(composeErrorMessage({ message: "ENOSPC: no space left" })).toMatch(/磁盘/);
  });
  it("其它错误 → null（原样抛）", () => {
    expect(composeErrorMessage({ message: "Invalid argument" })).toBeNull();
    expect(composeErrorMessage({})).toBeNull();
  });
});

describe("buildDrawtext（drawtext 构建器：强制转义 + 字段顺序）", () => {
  it("text 走 escapeDrawText、fontFile 走 escapeSubtitlesPath，% 字面保留", () => {
    const d = buildDrawtext({ fontFile: "C:\\fonts\\f.ttf", text: "立省50%", fontSize: 48, fontColor: "white", x: "(w-text_w)/2", y: "h*0.8" });
    expect(d.startsWith("drawtext=")).toBe(true);
    expect(d).toContain("fontfile='C\\:/fonts/f.ttf'"); // path escaper: \\ → / and : → \:
    expect(d).toContain("expansion=none");
    expect(d).toContain("立省50%"); // % is not escaped (literal under expansion=none)
    expect(d).toContain("fontsize=48");
    expect(d).toContain("x=(w-text_w)/2");
  });
  it("可选字段按需出现、缺省不输出", () => {
    const bare = buildDrawtext({ text: "x", fontSize: 40, fontColor: "white", x: "0", y: "0" });
    expect(bare).not.toContain("box=1");
    expect(bare).not.toContain("borderw");
    expect(bare).not.toContain("enable");
    const full = buildDrawtext({ text: "x", fontSize: 40, fontColor: "white", borderW: 3, lineSpacing: 10, box: { color: "black@0.45", borderW: 12 }, x: "0", y: "0", enable: "enable='between(t,0,3)'" });
    expect(full).toContain("borderw=3");
    expect(full).toContain("line_spacing=10");
    expect(full).toContain("box=1:boxcolor=black@0.45:boxborderw=12");
    expect(full).toContain("enable='between(t,0,3)'");
  });
});
