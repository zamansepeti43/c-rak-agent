
import sys
import json
import subprocess
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / "piper" / "tr_TR-dfki-medium"
MODEL = next(MODEL_DIR.rglob("*.onnx"))
CONFIG = Path(str(MODEL) + ".json")

COMPOSER = ROOT / "remotion-composer"
PROPS_DIR = COMPOSER / "public" / "demo-props"
OUTPUT_DIR = ROOT / "projects" / "demos" / "renders"
AUDIO_DIR = COMPOSER / "public" / "audio"

def clean_json(text):
    text = text.strip()

    # Markdown fence temizle
    text = re.sub(r"^```json\s*", "", text, flags=re.I)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    # ?lk JSON nesnesini bul
    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1 or end <= start:
        raise RuntimeError(
            "Ollama ge?erli bir JSON nesnesi ?retmedi."
        )

    text = text[start:end + 1]

    # JSON i?indeki stringlerde bulunan ger?ek kontrol
    # karakterlerini g?venli bi?imde escape et.
    out = []
    in_string = False
    escaped = False

    for ch in text:
        if ch == '"' and not escaped:
            in_string = not in_string
            out.append(ch)
            continue

        if in_string:
            code = ord(ch)

            if code < 32:
                if ch == "\n":
                    out.append("\\n")
                elif ch == "\r":
                    out.append("\\r")
                elif ch == "\t":
                    out.append("\\t")
                else:
                    out.append("\\u%04x" % code)
                continue

        out.append(ch)

        if ch == "\\" and not escaped:
            escaped = True
        else:
            escaped = False

    return "".join(out).strip()

def ask_story(prompt):
    system = """
Sen profesyonel bir ?ocuk hik?yesi yazar? ve video senaristisin.

Kullan?c?n?n istedi?i konuya g?re 45-90 saniyelik,
?ocuklara uygun, s?cak, anla??l?r ve tutarl? bir hik?ye olu?tur.

Hik?yeyi 6-8 sahneye b?l.

Her sahnede:
- k?sa g?rsel a??klamas?
- anlat?c? metni
- sahne s?resi

bulunsun.

SADECE JSON D?ND?R:

{
  "title": "...",
  "style": "warm colorful children's storybook animation",
  "scenes": [
    {
      "visual": "...",
      "narration": "...",
      "duration": 8
    }
  ]
}

?iddet, korku, uygunsuz i?erik veya tehlikeli davran??lar? ?ocuklara ?zendirme.
"""

    full = system + "\n\nKULLANICI ?STE??:\n" + prompt

    result = subprocess.run(
        ["ollama", "run", "qwen2.5-coder:7b", full],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr)

    cleaned = clean_json(result.stdout)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        # ?lk cevap bozuksa Ollama'dan ikinci kez yaln?zca
        # ge?erli JSON istemek yerine ayn? bozuk ??kt?y?
        # tekrar parse etmeye ?al??ma.
        retry_prompt = full + """

?NCEK? CEVAP JSON OLARAK GE?ERS?ZD?.

?imdi tekrar ?ret.

?OK ?NEML?:
- SADECE JSON d?nd?r.
- Stringlerin i?inde ger?ek sat?r sonu kullanma.
- String i?inde t?rnak gerekiyorsa escape et.
- Her sahne tek sat?rl?k JSON string de?erleri kullans?n.
- Markdown kullanma.
- A??klama yazma.
"""

        retry = subprocess.run(
            ["ollama", "run", "qwen2.5-coder:7b", retry_prompt],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace"
        )

        if retry.returncode != 0:
            raise RuntimeError(retry.stderr)

        retry_cleaned = clean_json(retry.stdout)

        try:
            data = json.loads(retry_cleaned)
        except json.JSONDecodeError as retry_exc:
            raise RuntimeError(
                f"Hik?ye JSON'u iki denemede de okunamad?: {retry_exc}"
            ) from retry_exc

    if not isinstance(data.get("scenes"), list) or not data["scenes"]:
        raise RuntimeError("Hik?yede sahne bulunamad?.")

    return data

def make_audio(story, name):
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    narration = "\n\n".join(
        str(scene.get("narration", ""))
        for scene in story["scenes"]
    )

    # Ollama bazen JSON i?inde ge?ersiz Unicode surrogate karakterleri
    # ?retebilir. Piper/espeak bunlar? kabul etmez.
    narration = (
        narration
        .encode("utf-8", errors="replace")
        .decode("utf-8")
    )

    # Piper i?in emoji ve kontrol karakterlerini temizle.
    narration = "".join(
        ch for ch in narration
        if ch == "\n" or ch == "\t" or ord(ch) >= 32
    )

    audio = AUDIO_DIR / f"{name}.wav"

    subprocess.run(
        [
            sys.executable,
            "-m", "piper",
            "-m", str(MODEL),
            "-c", str(CONFIG),
            "-f", str(audio)
        ],
        input=narration,
        text=True,
        encoding="utf-8",
        check=True
    )

    return audio

def make_props(story, audio, name):
    PROPS_DIR.mkdir(parents=True, exist_ok=True)

    cuts = []
    current = 0

    for index, scene in enumerate(story["scenes"], 1):
        duration = float(scene.get("duration", 8))

        cuts.append({
            "id": f"story-scene-{index}",
            "source": "",
            "type": "text_card",
            "in_seconds": current,
            "out_seconds": current + duration,
            "text": scene["visual"],
            "color": "#FFFFFF",
            "backgroundColor": "#172554"
        })

        current += duration

    props = {
        "theme": "flat-motion-graphics",
        "cuts": cuts,
        "overlays": [
            {
                "type": "hero_title",
                "in_seconds": 0,
                "out_seconds": min(4, current),
                "text": story["title"],
                "subtitle": "??rak ile ?ocuk hik?yesi",
                "accentColor": "#FBBF24"
            }
        ],
        "captions": [],
        "audio": {
            "narration": {
                "src": f"audio/{audio.name}",
                "volume": 1
            }
        }
    }

    props_path = PROPS_DIR / f"{name}.json"
    props_path.write_text(
        json.dumps(props, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    return props_path, current

def render(name):
    output = OUTPUT_DIR / f"{name}.mp4"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            "npx.cmd",
            "remotion",
            "render",
            "src/index.tsx",
            "Explainer",
            str(output),
            "--props",
            str(PROPS_DIR / f"{name}.json"),
            "--codec",
            "h264"
        ],
        cwd=COMPOSER,
        check=True
    )

    return output

def main():
    if len(sys.argv) < 2:
        raise SystemExit("Hik?ye konusu gerekli.")

    prompt = " ".join(sys.argv[1:])

    print("Hik?ye yaz?l?yor...")
    story = ask_story(prompt)

    print(f"Hik?ye: {story['title']}")
    print(f"Sahne say?s?: {len(story['scenes'])}")

    safe = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "-",
        story["title"]
    ).strip("-").lower()[:45]

    name = f"story-{safe or 'video'}"

    print("T?rk?e anlat?m olu?turuluyor...")
    audio = make_audio(story, name)

    print("Video plan? olu?turuluyor...")
    make_props(story, audio, name)

    print("Video render ediliyor...")
    output = render(name)

    print(json.dumps({
        "ok": True,
        "title": story["title"],
        "scenes": len(story["scenes"]),
        "audio": str(audio),
        "video": str(output)
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
