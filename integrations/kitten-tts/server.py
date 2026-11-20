"""Serve KittenTTS 2 Mini French and German voices on loopback for ClipForge."""

import argparse
import io
import json
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import soundfile as sf
from huggingface_hub import snapshot_download
from kittenml.kittentts2_tiny import KittenTTS2Tiny

MODEL = "kitten-tts-2-mini"
REVISION = "8e89ae2a718ee4bb893c67d67657e520e6112faf"
FILES = ["config.json", "vocab.json", "kitten_tts_2_mini_int4.onnx", "voices_fr.npz", "voices_de.npz"]
PORT = 9882


class SpeechHandler(BaseHTTPRequestHandler):
    def reply(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def error(self, status, message):
        self.reply(status, json.dumps({"error": {"message": message}}).encode(), "application/json")

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self.error(404, "Use POST /v1/audio/speech")
        if self.headers.get("Host") not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}") or self.headers.get("Origin"):
            return self.error(403, "Local server requests only")
        if self.headers.get_content_type() != "application/json":
            return self.error(415, "Expected application/json")
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 65536:
                return self.error(413, "Expected a JSON request of at most 64 KiB")
            self.connection.settimeout(15)
            body = json.loads(self.rfile.read(size))
        except (ValueError, TimeoutError):
            return self.error(400, "Invalid JSON request")
        if not isinstance(body, dict) or body.get("model") != MODEL:
            return self.error(400, f"Expected model {MODEL}")
        text, voice, speed = body.get("input"), body.get("voice"), body.get("speed", 1)
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            return self.error(400, "Expected 1 to 4000 characters of narration")
        if voice not in ("fr", "de") or body.get("response_format", "mp3") != "mp3":
            return self.error(400, "Choose voice fr or de and use mp3 format")
        if type(speed) not in (int, float) or not 0.5 <= speed <= 2:
            return self.error(400, "Speed must be between 0.5 and 2")
        try:
            samples = self.server.model.generate(text.strip(), language=voice, speed=speed)
            wav = io.BytesIO()
            sf.write(wav, samples, self.server.model.sample_rate, format="WAV")
            encoded = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", "pipe:0", "-codec:a", "libmp3lame", "-f", "mp3", "pipe:1"],
                input=wav.getvalue(), capture_output=True, timeout=60, check=True,
            )
        except Exception:
            return self.error(500, "Local synthesis failed. Check the model files and FFmpeg with libmp3lame.")
        self.reply(200, encoded.stdout, "audio/mpeg")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, help="Use model files already on disk without accessing Hugging Face")
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        parser.exit(1, "Install FFmpeg and make it available on PATH.\n")
    directory = args.model_dir or Path(snapshot_download(
        repo_id=f"KittenML/{MODEL}", revision=REVISION, allow_patterns=FILES, token=False,
    ))
    for filename in FILES:
        if not (directory / filename).is_file():
            parser.exit(1, f"Missing model resource: {directory / filename}\n")
    model = KittenTTS2Tiny(str(directory.resolve()), weights="int4", device="cpu", threads=4)
    with HTTPServer(("127.0.0.1", PORT), SpeechHandler) as server:
        server.model = model
        print(f"KittenTTS ready at http://127.0.0.1:{PORT}/v1 (voices: fr, de)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
