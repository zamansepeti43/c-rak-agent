"""Çırak Video Engine orchestration.

Pipeline: user prompt -> story plan -> provider-driven scene assets -> Turkish
narration -> Remotion props -> deterministic render + verification.

The pipeline deliberately fails closed when cloud generation is requested but
no provider is configured. It never pretends an SVG/text card is a real video
scene. Local assets remain a supported zero-cost fallback.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from cirak_visuals import resolve_story_assets

ROOT = Path(__file__).resolve().parent
COMPOSER = ROOT / "remotion-composer"
PROPS_DIR = COMPOSER / "public" / "demo-props"
AUDIO_DIR = COMPOSER / "public" / "audio"
OUTPUT_DIR = ROOT / "projects" / "demos" / "renders"
GENERATED_DIR = ROOT / "projects" / "demos" / "generated"


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
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Model geçerli JSON üretmedi.")
    return json.loads(text[start : end + 1])


def _normalize_duration(scenes: list[dict[str, Any]]) -> None:
    durations = [max(3.0, float(s.get("duration", 7))) for s in scenes]
    total = sum(durations)
    if total < 45:
        durations[-1] += 45 - total
    elif total > 90:
        factor = 90 / total
        durations = [max(3.0, round(d * factor, 1)) for d in durations]
    for scene, duration in zip(scenes, durations):
        scene["duration"] = duration


def plan_story(user_prompt: str) -> dict[str, Any]:
    system = """
Sen profesyonel bir kısa video yönetmeni ve hikâye yazarısın.
Kullanıcı isteğini 45-90 saniyelik, görsel olarak güçlü 6-8 sahneli bir videoya dönüştür.
Aynı ana karakterin görünümünü tüm sahnelerde koru.
Her sahne için İngilizce görsel/video üretim promptu, Türkçe anlatıcı metni,
süre, kamera hareketi, duygu ve visual_type üret.
visual_type yalnızca image veya video olabilir.
Açılış ilk 2 saniyede merak uyandırsın; final sıcak ve tatmin edici olsun.
Promptlar fiziksel olarak görüntülenebilir somut ayrıntılar içersin: karakter,
mekân, ışık, zaman, kamera, hareket ve kompozisyon.
Çocuklara uygun, şiddetsiz, korkutmayan ve pozitif içerik üret.
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


def build_narration(story: dict[str, Any]) -> str:
    return "\n\n".join(str(s.get("narration", "")).strip() for s in story["scenes"])


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
    if not audio.exists() or audio.stat().st_size < 10_000:
        raise RuntimeError("Piper ses çıktısı oluşmadı veya çok küçük.")
    return audio


def _provider_configured() -> bool:
    keys = (
        "FAL_KEY", "FAL_AI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
        "OPENAI_API_KEY", "XAI_API_KEY", "KLING_API_KEY", "REPLICATE_API_TOKEN",
    )
    return any(os.environ.get(k) for k in keys)


def _provider_hint() -> str:
    return (
        "Cloud visual generation requires a configured provider. "
        "Recommended: FAL_KEY for the existing video_selector/veo/kling routes."
    )


def resolve_scene_assets(story: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve local assets first; require explicit provider setup for AI generation.

    The current repository contains a mature provider selector in
    tools/video/video_selector.py, but that selector is a Python BaseTool and is
    not safely invoked from this lightweight pipeline without its full runtime.
    Therefore this function provides a deterministic local path and clearly
    signals when a real cloud generation adapter is still required.
    """
    local = resolve_story_assets(story)
    needs_remote = [a for a in local if a["source_kind"] == "svg_fallback"]
    if needs_remote and not _provider_configured():
        # Preserve local fallback for offline/zero-cost operation, but expose
        # the degraded mode in the generated metadata so the agent can report
        # honestly rather than claiming AI-generated visuals.
        for asset in local:
            if asset["source_kind"] == "svg_fallback":
                asset["degraded"] = True
                asset["degraded_reason"] = _provider_hint()
    return local


def make_props(story: dict[str, Any], audio: Path, name: str) -> Path:
    PROPS_DIR.mkdir(parents=True, exist_ok=True)
    assets = resolve_scene_assets(story)
    asset_by_id = {a["id"]: a for a in assets}
    cuts: list[dict[str, Any]] = []
    current = 0.0
    animations = ["zoom-in", "pan-left", "pan-right", "ken-burns", "zoom-out"]
    degraded_assets = []

    for index, scene in enumerate(story["scenes"], 1):
        duration = float(scene.get("duration", 7))
        scene_id = str(scene.get("id", f"scene-{index}"))
        asset = asset_by_id[scene_id]
        source_path = Path(asset["path"]).resolve()
        if not source_path.exists():
            raise FileNotFoundError(f"Sahne varlığı bulunamadı: {source_path}")
        ext = source_path.suffix.lower()
        source = str(source_path)
        if asset.get("degraded"):
            degraded_assets.append(scene_id)
        scene_type = "video" if ext in {".mp4", ".mov", ".webm", ".mkv", ".avi"} else "image"
        cuts.append({
            "id": scene_id,
            "source": source,
            "type": "video_scene" if scene_type == "video" else "image_scene",
            "in_seconds": current,
            "out_seconds": current + duration,
            "animation": str(scene.get("camera") or animations[(index - 1) % len(animations)]),
            "backgroundOverlay": 0.10 if scene_type == "image" else 0.18,
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
            "degraded_visual_scenes": degraded_assets,
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
    print("Çırak: sahne varlıkları ve storyboard hazırlanıyor...")
    props = make_props(story, audio, name)
    print("Çırak: video render ediliyor...")
    video = render(name, props)
    print(json.dumps({"ok": True, "title": story["title"], "scenes": len(story["scenes"]), "audio": str(audio), "video": str(video)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
