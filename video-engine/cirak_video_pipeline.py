"""Çırak için yerel, deterministik video üretim pipeline'ı.

Amaç: tek bir kullanıcı prompt'unu güvenli bir şekilde storyboard'a,
Piper anlatıma ve Remotion render props'una dönüştürmek. Harici video üreticileri
ayrı adaptörler olarak kullanılabilir; bu dosya sağlayıcıdan bağımsız orkestrasyon
katmanıdır.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
COMPOSER = ROOT / "remotion-composer"
PROPS_DIR = COMPOSER / "public" / "demo-props"
AUDIO_DIR = COMPOSER / "public" / "audio"
OUTPUT_DIR = ROOT / "projects" / "demos" / "renders"


def run_ollama(prompt: str) -> str:
    result = subprocess.run(
        ["ollama", "run", "qwen2.5-coder:7b", prompt],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Ollama çalıştırılamadı.")
    return result.stdout


def extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Model geçerli JSON üretmedi.")
    return json.loads(text[start : end + 1])


def plan_story(user_prompt: str) -> dict[str, Any]:
    system = """
Sen profesyonel bir çocuk video yönetmenisin.
Kullanıcı isteğini 45-90 saniyelik kısa bir hikâye videosuna dönüştür.
6-8 sahne üret. Her sahnede aynı ana karakter özelliklerini koru.
Her sahne için İngilizce görsel üretim promptu, Türkçe anlatıcı metni,
saniye cinsinden süre, kamera hareketi, duygu ve görsel tipini döndür.
Görsel tipleri yalnızca "image" veya "video" olsun.
Toplam süre 45-90 saniye aralığında olsun.
Çocuklara uygun, sıcak ve pozitif içerik üret.
SADECE JSON döndür:
{
  "title": "...",
  "style": "storybook 3D animation, warm cinematic lighting",
  "character_bible": "...",
  "scenes": [
    {
      "id": "scene-1",
      "duration": 7,
      "visual_prompt": "...",
      "narration": "...",
      "camera": "slow_push",
      "mood": "warm",
      "visual_type": "image"
    }
  ]
}
"""
    data = extract_json(run_ollama(system + "\n\nKULLANICI İSTEĞİ:\n" + user_prompt))
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Hikâyede sahne bulunamadı.")
    total = sum(max(3.0, float(s.get("duration", 7))) for s in scenes)
    if total < 45:
        scenes[-1]["duration"] = float(scenes[-1].get("duration", 7)) + (45 - total)
    elif total > 90:
        factor = 90 / total
        for scene in scenes:
            scene["duration"] = max(3, round(float(scene.get("duration", 7)) * factor, 1))
    return data


def piper_model() -> tuple[Path, Path]:
    base = ROOT / "models" / "piper"
    models = list(base.rglob("*.onnx")) if base.exists() else []
    if not models:
        raise FileNotFoundError("Piper Türkçe model bulunamadı: models/piper altında .onnx yok.")
    model = models[0]
    config = Path(str(model) + ".json")
    if not config.exists():
        raise FileNotFoundError(f"Piper model config bulunamadı: {config}")
    return model, config


def build_narration(story: dict[str, Any]) -> str:
    return "\n\n".join(str(scene.get("narration", "")).strip() for scene in story["scenes"])


def synthesize_voice(story: dict[str, Any], name: str) -> Path:
    model, config = piper_model()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    audio = AUDIO_DIR / f"{name}.wav"
    narration = build_narration(story)
    subprocess.run(
        [sys.executable, "-m", "piper", "-m", str(model), "-c", str(config), "-f", str(audio)],
        input=narration,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return audio


def make_props(story: dict[str, Any], audio: Path, name: str) -> Path:
    PROPS_DIR.mkdir(parents=True, exist_ok=True)
    cuts = []
    current = 0.0
    for scene in story["scenes"]:
        duration = float(scene.get("duration", 7))
        prompt = str(scene.get("visual_prompt", "")).strip()
        cuts.append({
            "id": str(scene.get("id", f"scene-{len(cuts)+1}")),
            "source": "",
            "type": "text_card",
            "in_seconds": current,
            "out_seconds": current + duration,
            "text": prompt,
            "color": "#FFFFFF",
            "backgroundColor": "#111827",
            "animation": str(scene.get("camera", "ken-burns")),
        })
        current += duration
    props = {
        "theme": "anime-ghibli",
        "cuts": cuts,
        "overlays": [{
            "type": "hero_title",
            "in_seconds": 0,
            "out_seconds": min(4, current),
            "text": story["title"],
            "subtitle": "Çırak ile çocuk hikâyesi",
            "accentColor": "#FFB347",
        }],
        "captions": [],
        "audio": {"narration": {"src": f"audio/{audio.name}", "volume": 1}},
    }
    path = PROPS_DIR / f"{name}.json"
    path.write_text(json.dumps(props, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def render(name: str, props: Path) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / f"{name}.mp4"
    subprocess.run(
        ["npx.cmd", "remotion", "render", "src/index.tsx", "Explainer", str(output), "--props", str(props), "--codec", "h264"],
        cwd=COMPOSER,
        check=True,
    )
    return output


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Kullanım: python cirak_video_pipeline.py <konu>")
    prompt = " ".join(sys.argv[1:])
    story = plan_story(prompt)
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(story.get("title", "video"))).strip("-").lower()[:50]
    name = f"cirak-{safe or 'video'}"
    audio = synthesize_voice(story, name)
    props = make_props(story, audio, name)
    video = render(name, props)
    print(json.dumps({"ok": True, "title": story["title"], "scenes": len(story["scenes"]), "audio": str(audio), "video": str(video)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
