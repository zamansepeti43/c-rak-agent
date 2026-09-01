"""AI media generation bridge for the Çırak video pipeline.

Uses OpenMontage's existing tool registry instead of hard-coding a provider.
For each scene, the selector chooses an available video/image provider. When
no external provider is configured, the pipeline returns an explicit blocker
rather than silently pretending a placeholder is generated media.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
TOOLS_ROOT = ROOT / "tools"


def _load_tools_registry():
    import sys
    tools_root = str(ROOT)
    if tools_root not in sys.path:
        sys.path.insert(0, tools_root)
    from tools.tool_registry import registry
    registry.ensure_discovered()
    return registry


def _tool_available(name: str):
    registry = _load_tools_registry()
    tool = registry.get(name)
    if tool is None:
        return None
    try:
        status = tool.get_status()
    except Exception:
        return None
    return tool if getattr(status, "value", status) == "available" else None


def generate_scene_media(scene: dict[str, Any], story: dict[str, Any], output_dir: Path, index: int) -> dict[str, Any]:
    """Generate one scene clip/image through existing OpenMontage providers."""
    registry = _load_tools_registry()
    selector = registry.get("video_selector")
    prompt = str(scene.get("visual_prompt") or scene.get("visual") or "").strip()
    aspect = str(story.get("aspect_ratio") or "16:9")
    duration = str(max(4, int(round(float(scene.get("duration", 7))))))
    visual_type = str(scene.get("visual_type") or "video").lower()

    if selector is None:
        raise RuntimeError("video_selector aracı bulunamadı.")

    # Video is the preferred path for a cinematic story. Image mode remains
    # available for providers that only expose image generation.
    operation = "text_to_video" if visual_type == "video" else "text_to_video"
    try:
        ranking = selector.execute({
            "prompt": prompt,
            "operation": "rank",
            "target_operation": operation,
            "aspect_ratio": aspect,
            "duration": duration,
        })
    except Exception as exc:
        raise RuntimeError(f"Video sağlayıcısı seçilemedi: {exc}") from exc

    if not getattr(ranking, "success", False):
        raise RuntimeError(getattr(ranking, "error", None) or "Uygun video sağlayıcısı bulunamadı.")

    data = getattr(ranking, "data", {}) or {}
    provider_name = data.get("selected_provider") or data.get("provider") or data.get("tool")
    if not provider_name:
        # Some registry versions return ranked candidates instead of one name.
        ranked = data.get("ranked_providers") or data.get("providers") or []
        if ranked:
            first = ranked[0]
            provider_name = first.get("name") if isinstance(first, dict) else str(first)

    provider = registry.get(str(provider_name)) if provider_name else None
    if provider is None:
        raise RuntimeError(f"Seçilen video sağlayıcısı çözümlenemedi: {provider_name!r}")

    output_dir.mkdir(parents=True, exist_ok=True)
    ext = ".mp4"
    output = output_dir / f"scene-{index:02d}{ext}"
    request: dict[str, Any] = {
        "prompt": prompt,
        "operation": operation,
        "aspect_ratio": aspect,
        "duration": duration,
        "output_path": str(output),
        "auto_fix": True,
    }

    # Use reference image(s) when the storyboard supplies one.
    reference_image = scene.get("reference_image_path") or scene.get("asset_path")
    if reference_image:
        request["image_path"] = str(reference_image)
        request["operation"] = "image_to_video"

    result = provider.execute(request)
    if not getattr(result, "success", False):
        raise RuntimeError(getattr(result, "error", None) or f"{provider.name} sahne üretilemedi.")

    artifacts = list(getattr(result, "artifacts", []) or [])
    if output.exists():
        final_path = output
    elif artifacts:
        final_path = Path(str(artifacts[0]))
    else:
        returned = (getattr(result, "data", {}) or {}).get("output_path")
        final_path = Path(str(returned)) if returned else output

    if not final_path.exists():
        raise RuntimeError(f"Sağlayıcı başarılı döndü ancak medya dosyası bulunamadı: {final_path}")

    return {
        "path": str(final_path.resolve()),
        "provider": provider.name,
        "operation": request["operation"],
        "cost_usd": float(getattr(result, "cost_usd", 0.0) or 0.0),
    }


def generate_story_media(story: dict[str, Any], output_dir: Path) -> list[dict[str, Any]]:
    results = []
    for index, scene in enumerate(story.get("scenes", []), 1):
        results.append(generate_scene_media(scene, story, output_dir, index))
    return results
