"""Çırak Video Engine orchestration.

Pipeline: prompt -> story plan -> AI scene media (when configured) or local
assets -> Turkish narration -> Remotion -> verified MP4.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from cirak_ai_media import generate_story_media
from cirak_visuals import resolve_story_assets

ROOT = Path(__file__).resolve().parent
COMPOSER = ROOT / "remotion-composer"
PROPS_DIR = COMPOSER / "public" / "demo-props"
AUDIO_DIR = COMPOSER / "public" / "audio"
OUTPUT_DIR = ROOT / "projects" / "demos" / "renders"
MEDIA_DIR = ROOT / "projects" / "demos" / "generated" / "scenes"


def run_ollama(prompt: str) -> str:
    result = subprocess.run(
        ["ollama", "run", os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b"), prompt],
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
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Model geçerli JSON üretmedi.")
    return json.loads(text[start : end + 1])


def _normalize_duration(scenes: list[dict[str, Any]]) -> None:
    durations = [max(4.0, float(s.get("duration", 7))) for s in scenes]
    total = sum(durations)
    if total < 45:
        durations[-1] += 45 - total
    elif total > 90:
        factor = 90 / total
        durations = [max(4.0, round(d * factor, 1)) for d in durations]
    for scene, duration in zip(scenes, durations):
        scene["duration"] = duration


def plan_story(user_prompt: str) -> dict[str, Any]:
    system = """
Sen Çırak'ın kıdemli video yönetmeni, storyboard sanat yönetmeni ve kısa hikâye yazarıısın.
Kullanıcı isteğini 45-90 saniyelik, 6-8 sahneli kaliteli bir kısa videoya dönüştür.
Ana karakterin görünümü, kıyafeti, renkleri ve oranları tüm sahnelerde aynı kalmalı.
Her sahnede somut İngilizce görsel/video promptu; karakter, mekân, ışık, saat,
kamera, hareket, kompozisyon ve duygu içermeli. Türkçe anlatım doğal olmalı.
İlk sahne ilk 2 saniyede güçlü merak uyandırsın. Son sahne tatmin edici bir kapanış yapsın.
Ağırlıklı olarak video sahneleri üret; yalnızca sakin/duygusal sahnelerde image kullan.
Çocuk içeriğinde şiddet, korku, tehlikeli davranış özendirmesi kullanma.
SADECE JSON döndür:
{
  "title": "...",
  "style": "storybook 3D animation, warm cinematic lighting",
  "aspect_ratio": "16:9",
  "resolution": "1080p",
  "character_bible": "...",
  "scenes": [
    {
      "id": "scene-1",
      "duration": 7,
      "visual_prompt": "...",
      "narration": "...",
      "camera": "slow_push",
      "mood": "curious",
      "visual_type": "video"
    }
  ]
}
"""
    data = extract_json(run_ollama(system + "\n\nKULLANICI İSTEĞİ:\n" + user_prompt))
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Hikâyede sahne bulunamadı.")
    _normalize_duration(scenes)
    return data


def piper_model() -> tuple[Path, Path]:
    base = ROOT / "models" / "piper"
    models = list(base.rglob("*.onnx")) if base.exists() else []
    if not models:
        raise FileNotFoundError("Piper Türkçe model bulunamadı.")
    model = models[0]
    config = Path(str(model) + ".json")
    if not config.exists():
        raise FileNotFoundError(f"Piper config bulunamadı: {config}")
    return model, config


def synthesize_voice(story: dict[str, Any], name: str) -> Path:
    model, config = piper_model()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    audio = AUDIO_DIR / f"{name}.wav"
    narration = "\n\n".join(str(s.get("narration", "")).strip() for s in story["scenes"])
    subprocess.run(
        [sys.executable, "-m", "piper", "-m", str(model), "-c", str(config), "-f", str(audio)],
        input=narration,
        text=True,
        encoding="utf-8",
        check=True,
    )
    if not audio.exists() or audio.stat().st_size < 10_000:
        raise RuntimeError("Piper ses çıktısı oluşmadı veya çok küçük.")
    return audio


def resolve_scene_assets(story: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate real scene media through the existing provider stack when configured."""
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    keys = (
        "FAL_KEY", "FAL_AI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
        "KLING_API_KEY", "REPLICATE_API_TOKEN", "XAI_API_KEY", "OPENAI_API_KEY",
    )
    if any(os.environ.get(key) for key in keys):
        try:
            generated = generate_story_media(story, MEDIA_DIR)
            return [
                {**item, "source_kind": "ai_generated", "scene": story["scenes"][index - 1]}
                for index, item in enumerate(generated, 1)
            ]
        except Exception as exc:
            print(f"Uyarı: AI sahne üretimi başarısız; yerel fallback kullanılıyor: {exc}")
    return resolve_story_assets(story)


def make_props(story: dict[str, Any], audio: Path, name: str) -> Path:
    PROPS_DIR.mkdir(parents=True, exist_ok=True)
    assets = resolve_scene_assets(story)
    asset_by_id = {a["id"]: a for a in assets}
    cuts: list[dict[str, Any]] = []
    current = 0.0
    animations = ["zoom-in", "pan-left", "pan-right", "ken-burns", "zoom-out"]
    degraded = []

    for index, scene in enumerate(story["scenes"], 1):
        duration = float(scene.get("duration", 7))
        scene_id = str(scene.get("id", f"scene-{index}"))
        asset = asset_by_id[scene_id]
        source_path = Path(asset["path"]).resolve()
        if not source_path.exists():
            raise FileNotFoundError(f"Sahne varlığı bulunamadı: {source_path}")
        ext = source_path.suffix.lower()
        is_video = ext in {".mp4", ".mov", ".webm", ".mkv", ".avi"}
        if asset.get("source_kind") in {"svg_fallback", "local_asset"}:
            degraded.append(scene_id)
        cuts.append({
            "id": scene_id,
            "source": str(source_path),
            "type": "video_scene" if is_video else "image_scene",
            "in_seconds": current,
            "out_seconds": current + duration,
            "animation": str(scene.get("camera") or animations[(index - 1) % len(animations)]),
            "source_in_seconds": 0,
            "transition_in": "fade",
            "transition_out": "fade",
            "transition_duration": 0.35,
        })
        current += duration

    props = {
        "theme": "anime-ghibli",
        "cuts": cuts,
        "overlays": [{
            "type": "hero_title",
            "in_seconds": 0,
            "out_seconds": min(3.5, current),
            "text": story["title"],
            "subtitle": "Çırak ile çocuk hikâyesi",
            "accentColor": "#FFB347",
        }],
        "captions": [],
        "audio": {"narration": {"src": f"audio/{audio.name}", "volume": 1}},
        "metadata": {
            "character_bible": story.get("character_bible", ""),
            "style": story.get("style", ""),
            "degraded_visual_scenes": degraded,
        },
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
    if not output.exists() or output.stat().st_size < 100_000:
        raise RuntimeError(f"Render başarısız veya çıktı şüpheli: {output}")
    return output


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Kullanım: python cirak_video_pipeline.py <konu>")
    prompt = " ".join(sys.argv[1:])
    print("Çırak: hikâye planlanıyor...")
    story = plan_story(prompt)
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(story.get("title", "video"))).strip("-").lower()[:50]
    name = f"cirak-{safe or 'video'}"
    print("Çırak: Türkçe ses oluşturuluyor...")
    audio = synthesize_voice(story, name)
    print("Çırak: AI sahneleri hazırlanıyor...")
    props = make_props(story, audio, name)
    print("Çırak: final video render ediliyor...")
    video = render(name, props)
    print(json.dumps({"ok": True, "title": story["title"], "scenes": len(story["scenes"]), "audio": str(audio), "video": str(video)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
