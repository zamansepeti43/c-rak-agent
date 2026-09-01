"""Non-network smoke checks for the Çırak video pipeline."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from cirak_video_pipeline import extract_json, _normalize_duration  # noqa: E402


def main() -> None:
    payload = extract_json('```json\n{"title":"Test","scenes":[{"id":"scene-1","duration":7,"visual_prompt":"test","narration":"Merhaba"}]}\n```')
    assert payload["title"] == "Test"
    scenes = payload["scenes"]
    _normalize_duration(scenes)
    assert sum(float(scene["duration"]) for scene in scenes) >= 45
    assert all(float(scene["duration"]) >= 4 for scene in scenes)
    print(json.dumps({"ok": True, "checks": ["json extraction", "duration normalization"]}))


if __name__ == "__main__":
    main()
