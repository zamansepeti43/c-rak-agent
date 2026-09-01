"""AI media generation bridge for the Çırak video pipeline."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent


def _registry():
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from tools.tool_registry import registry
    registry.ensure_discovered()
    return registry


def generate_scene_media(
    scene: dict[str, Any], story: dict[str, Any], output_dir: Path, index: int
) -> dict[str, Any]:
    registry = _registry()
    selector = registry.get("video_selector")
    if selector is None:
        raise RuntimeError("video_selector aracı bulunamadı.")

    prompt = str(scene.get("visual_prompt") or scene.get("visual") or "").strip()
    character_bible = str(story.get("character_bible") or "").strip()
    style = str(story.get("style") or "").strip()
    full_prompt = "\n".join(
        part for part in [
            prompt,
            f"Character continuity: {character_bible}" if character_bible else "",
            f"Visual style: {style}" if style else "",
            "Maintain character identity, outfit, proportions and scene geography. Cinematic children's animation.",
        ] if part
    )

    duration = str(max(4, min(8, int(round(float(scene.get("duration", 7)))))))
    aspect_ratio = str(story.get("aspect_ratio") or "16:9")

    ranked = selector.execute({
        "prompt": full_prompt,
        "operation": "rank",
        "target_operation": "text_to_video",
        "aspect_ratio": aspect_ratio,
        "duration": duration,
    })
    if not ranked.success:
        raise RuntimeError(ranked.error or "Uygun video sağlayıcısı bulunamadı.")

    ranking_data = ranked.data or {}
    rankings = ranking_data.get("rankings") or []
    selected_name = None
    if rankings:
        first = rankings[0]
        if isinstance(first, dict):
            selected_name = first.get("tool_name") or first.get("name")
    provider = registry.get(selected_name) if selected_name else None

    if provider is None:
        provider_name = ranking_data.get("selected_provider") or ranking_data.get("provider")
        if provider_name:
            for candidate in registry.get_by_capability("video_generation"):
                if candidate.provider == provider_name and candidate.get_status().value == "available":
                    provider = candidate
                    break

    if provider is None:
        available = [
            f"{tool.name} ({tool.provider})"
            for tool in registry.get_by_capability("video_generation")
            if tool.get_status().value == "available"
        ]
        raise RuntimeError(
            "Video sağlayıcısı seçilemedi. Kullanılabilir: " + (", ".join(available) or "yok")
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"scene-{index:02d}.mp4"
    request: dict[str, Any] = {
        "prompt": full_prompt,
        "operation": "text_to_video",
        "aspect_ratio": aspect_ratio,
        "duration": duration,
        "resolution": str(story.get("resolution") or "1080p"),
        "generate_audio": False,
        "output_path": str(output),
        "auto_fix": True,
    }

    reference = scene.get("reference_image_path") or scene.get("asset_path")
    if reference:
        request["operation"] = "image_to_video"
        request["image_path"] = str(reference)

    result = provider.execute(request)
    if not result.success:
        raise RuntimeError(result.error or f"{provider.name} sahne üretimi başarısız.")

    artifact_paths = [Path(str(p)) for p in (result.artifacts or [])]
    final_path = output if output.exists() else next((p for p in artifact_paths if p.exists()), None)
    if final_path is None:
        returned = (result.data or {}).get("output_path")
        if returned and Path(str(returned)).exists():
            final_path = Path(str(returned))
    if final_path is None:
        raise RuntimeError("Sağlayıcı başarılı döndü ancak video dosyası bulunamadı.")

    return {
        "path": str(final_path.resolve()),
        "provider": provider.name,
        "operation": request["operation"],
        "cost_usd": float(result.cost_usd or 0),
    }


def generate_story_media(story: dict[str, Any], output_dir: Path) -> list[dict[str, Any]]:
    return [
        generate_scene_media(scene, story, output_dir, index)
        for index, scene in enumerate(story.get("scenes", []), 1)
    ]
