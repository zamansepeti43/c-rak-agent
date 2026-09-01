"""Deterministic visual-asset layer for Çırak Video Engine.

This module turns a storyboard into renderable scene assets without pretending
that a missing cloud provider can magically generate media. It prefers local
assets, accepts explicit image/video paths, and can create a clean SVG scene
card as a last-resort visual so the renderer never receives an empty source.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
ASSETS_DIR = ROOT / "assets"
GENERATED_DIR = ASSETS_DIR / "generated" / "cirak"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


def _slug(value: str, fallback: str = "scene") -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    return text[:60] or fallback


def _find_matching_asset(prompt: str) -> Path | None:
    """Best-effort local asset lookup by filename tokens."""
    if not ASSETS_DIR.exists():
        return None
    tokens = {
        token.lower()
        for token in re.findall(r"[a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_-]+", prompt)
        if len(token) >= 4
    }
    candidates = [
        p for p in ASSETS_DIR.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
    ]
    best: tuple[int, Path] | None = None
    for path in candidates:
        name_tokens = set(re.findall(r"[a-zA-Z0-9_-]+", path.stem.lower()))
        score = len(tokens & name_tokens)
        if score and (best is None or score > best[0]):
            best = (score, path)
    return best[1] if best else None


def _make_svg_card(title: str, prompt: str, style: str, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    title_esc = html.escape(title[:70])
    prompt_esc = html.escape(prompt[:170])
    style_esc = html.escape(style[:100])
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17324d"/>
      <stop offset="0.55" stop-color="#2d6174"/>
      <stop offset="1" stop-color="#6f915d"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="35%" r="60%">
      <stop offset="0" stop-color="#fff8d6" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect width="1920" height="1080" fill="url(#glow)"/>
  <circle cx="350" cy="240" r="95" fill="#f7e5a1" opacity="0.9"/>
  <circle cx="1670" cy="270" r="70" fill="#dcecff" opacity="0.25"/>
  <path d="M0 850 C360 760 620 920 920 830 C1240 735 1540 940 1920 790 L1920 1080 L0 1080 Z" fill="#173b28" opacity="0.75"/>
  <path d="M0 930 C360 860 720 990 1050 900 C1390 820 1600 970 1920 880 L1920 1080 L0 1080 Z" fill="#0f2c1e" opacity="0.9"/>
  <text x="110" y="150" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="#fff8df">{title_esc}</text>
  <text x="110" y="965" font-family="Arial, sans-serif" font-size="28" fill="#ffffff" opacity="0.9">{prompt_esc}</text>
  <text x="110" y="1015" font-family="Arial, sans-serif" font-size="22" fill="#ffffff" opacity="0.65">{style_esc}</text>
</svg>'''
    path.write_text(svg, encoding="utf-8")
    return path


def resolve_scene_asset(scene: dict[str, Any], index: int, style: str) -> tuple[Path, str]:
    """Resolve a usable local asset; otherwise generate a visual SVG fallback."""
    explicit = scene.get("asset_path") or scene.get("source")
    if explicit:
        candidate = Path(str(explicit))
        if not candidate.is_absolute():
            candidate = ROOT / candidate
        if candidate.exists() and candidate.is_file():
            return candidate.resolve(), "explicit"

    prompt = str(scene.get("visual_prompt") or scene.get("visual") or "").strip()
    found = _find_matching_asset(prompt)
    if found:
        return found.resolve(), "local_asset"

    title = str(scene.get("title") or f"Sahne {index}")
    filename = f"scene-{index:02d}-{_slug(title)}.svg"
    generated = _make_svg_card(title, prompt or "Çırak sahnesi", style, GENERATED_DIR / filename)
    return generated.resolve(), "svg_fallback"


def resolve_story_assets(story: dict[str, Any]) -> list[dict[str, Any]]:
    style = str(story.get("style") or "warm cinematic children's animation")
    result: list[dict[str, Any]] = []
    for index, scene in enumerate(story.get("scenes", []), 1):
        asset, source_kind = resolve_scene_asset(scene, index, style)
        result.append({
            "id": str(scene.get("id") or f"scene-{index}"),
            "path": str(asset),
            "source_kind": source_kind,
            "visual_prompt": str(scene.get("visual_prompt") or scene.get("visual") or ""),
        })
    return result
