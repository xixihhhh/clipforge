# KittenTTS 2 Mini 本机配音

ClipForge 的可选 CPU 配音服务，提供法语（`fr`）与德语（`de`）。适用于桌面版或直接在同一台机器运行的 ClipForge 源码版。Docker 容器中的 `127.0.0.1` 指向容器自身。

## 安装

准备 Python 3.12，以及包含 `libmp3lame` 编码器、可在终端运行的 FFmpeg。进入本目录，在独立环境中安装。以下命令适用于 macOS / Linux，Windows 使用 `py -3.12 -m venv .venv` 和 PowerShell 的 `.venv\Scripts\Activate.ps1` 激活环境。

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install --no-deps "https://github.com/KittenML/KittenTTS/archive/5802f6b956844919ecf210f4e55f4750a6ad7c6f.zip"
python server.py
```

服务首次启动从 Hugging Face 下载指定版本的 int4 ONNX 模型、词表和两个音色包，合计约 58.5 MB。上面的 `--no-deps` 配合本目录的依赖清单，只安装法德语 CPU 推理所需的运行时。已有这五个文件时，可以用 `python server.py --model-dir /path/to/model` 完全离线启动。

## 使用

1. 等终端显示 `KittenTTS ready`。保持终端运行，打开 ClipForge 设置中的「配音 TTS」，启用并选择 **KittenTTS 2 Mini (CPU)**。
2. 在音色中选择 **Français** 或 **Deutsch** 并试听。语种由音色决定，译制脚本与音色需一致。金额、单位或缩写容易误读时，可将口播里的单位写全，例如法语 `500 millilitres`。
3. 回到项目的「视频」步骤合成。每个需要配音的镜头只向本机发送口播文本；服务在 `127.0.0.1:9882` 上返回 MP3，无需 API Key。退出服务可按 Ctrl+C。其他云端生成步骤仍使用各自的设置。

本集成开放并验证了法、德两种音色。上游 Mini 模型卡列出 16 种语言，包含日语，不含普通话。其余语种没有在本集成开放或验证。[模型卡与音色表](https://huggingface.co/KittenML/kitten-tts-2-mini)

## Local setup (English)

Use Python 3.12 and FFmpeg with `libmp3lame`. From this directory run the installation commands above. On Windows use `py -3.12 -m venv .venv` and activate with `.venv\Scripts\Activate.ps1`. The initial download includes the int4 model, vocabulary and French/German voice packs (about 58.5 MB). To start offline, point `--model-dir` at an existing copy of the five files listed in `server.py`.

With the server running, enable TTS in ClipForge Settings, select **KittenTTS 2 Mini (CPU)** and choose **Français** or **Deutsch**. Preview the voice, then compose from the Video step. The selected voice determines the language. Match it to the script before composing. The loopback adapter accepts `POST /v1/audio/speech` with model `kitten-tts-2-mini`, voice `fr` or `de`, text in `input`, and optional `speed` (0.5–2); it returns MP3. Narration synthesis uses your CPU and requires no key. Run ClipForge and this service on the same host; a separate Docker network namespace has its own loopback interface.

## 署名与许可证 / Attribution

KittenML authored the inference software, model and voice packs. The application downloads these assets separately. This directory contains the ClipForge adapter; the upstream runtime and model weights retain their own Apache-2.0 license. [KittenML runtime and license](https://github.com/KittenML/KittenTTS/blob/5802f6b956844919ecf210f4e55f4750a6ad7c6f/LICENSE) · [Model and voice-pack license](https://huggingface.co/KittenML/kitten-tts-2-mini#license)
