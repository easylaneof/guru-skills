#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Render a creative brief to PNG (still) or MP4 (video) using Remotion CLI.

Usage:
  render.py <brief_path> [--still] [--video] [--frame N]

Exit codes: 0 = success, 1 = error
Stdout (on success): absolute path to the rendered output file
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

BASE_DIR    = Path(__file__).parent.parent
REMOTION_DIR = BASE_DIR / "remotion"
OUTPUT_DIR  = BASE_DIR / "output"
FORMAT_KEYS = {"16x9", "1x1", "9x16"}

# Группы верхнего уровня: креативы одного визуала лежат вместе.
# Ключ — имя группы, значения — префиксы ID. Новый визуал = новая строка здесь.
GROUPS = {
    "autumn":             ["autumn-"],
    "school":             ["school-"],
    "animals-birthday":   ["animals-birthday"],
    "rain-editorial":     ["rain-editorial"],
    "gold-birthday":      ["gold-birthday"],
    "zolotoy-chas":       ["zolotoy-chas"],
    "buket-roz":          ["buket-roz"],
    "nochnoy-portret":    ["nochnoy-portret"],
    "sredi-roz":          ["sredi-roz"],
    "cartoon":            ["cartoon"],
    "daisy-field":        ["daisy-field"],
    "women-4-hairstyles": ["women-4-hairstyles", "2026-06-11-style-grid"],
    "personas":           ["anna-", "nataly-", "sofia-"],
    "cvety":              ["piony-v-nebo", "bugenvilleya", "amarillis", "zakat-piony",
                           "belye-rozy", "nezhnoe-utro", "nochnaya-elegantnost"],
}
_PREFIXES = sorted(((p, g) for g, ps in GROUPS.items() for p in ps), key=lambda x: -len(x[0]))

# Текст-варианты копирайта (см. copy-presets.md). Уезжают из имени папки в имя файла,
# чтобы все вариации одного визуала лежали рядом, а не расползались по папкам.
VARIANT_KEYS = ("2foto-cvety", "2foto", "versiya", "minuta")

# Семейства: вариации одной сцены (возрасты, слайдшоу) ложатся подпапками внутрь общей папки,
# напр. cvety/belye-rozy/{base,mid,mature,3-vozrasta}. Визуал вне семейств — папка сам себе.
FAMILIES = ("belye-rozy",)


def group_for(creative_id: str) -> str:
    """Группа визуала по ID; всё неопознанное — в prochee."""
    return next((g for p, g in _PREFIXES if creative_id.startswith(p)), "prochee")


def split_visual(visual: str) -> tuple[str, ...]:
    """Визуал → части пути. `belye-rozy-mid` → (`belye-rozy`, `mid`), сам `belye-rozy` → (…, `base`)."""
    fam = next((f for f in FAMILIES if visual == f or visual.startswith(f + "-")), "")
    if not fam:
        return (visual,)
    return (fam, visual[len(fam) + 1:] or "base")


def split_id(creative_id: str, platform: str = "") -> tuple[str, str]:
    """ID креатива → (папка визуала, имя файла без расширения).

    `piony-v-nebo-2foto-cvety-16x9` → (`piony-v-nebo`, `2foto-cvety-16x9`).
    Legacy-ID без текст-варианта в конце остаются как были: папка = ID, файл = формат.
    """
    fmt = platform if platform in FORMAT_KEYS and creative_id.endswith(f"-{platform}") else ""
    stem_id = creative_id[: -len(fmt) - 1] if fmt else creative_id
    variant = next((v for v in VARIANT_KEYS if stem_id.endswith(f"-{v}")), "")
    visual = stem_id[: -len(variant) - 1] if variant else stem_id
    name = "-".join(part for part in (variant, fmt) if part) or stem_id
    return visual, name


def render(brief_path: str, mode: str = "still", frame: int | None = None) -> str:
    brief_file = Path(brief_path)
    if not brief_file.is_absolute():
        brief_file = BASE_DIR / brief_file

    with open(brief_file, encoding="utf-8") as f:
        brief = json.load(f)

    template = brief.get("template")
    if not template:
        print("ERROR: brief missing 'template' field", file=sys.stderr)
        sys.exit(1)

    creative_id = brief.get("id", brief_file.stem)

    render_options = brief.get("render_options", {})
    output_format  = render_options.get("output_format", "png")
    still_frame    = frame if frame is not None else render_options.get("frame_for_still", 0)

    # <группа>/<визуал>/<текст-вариант>-<формат>.<ext>
    # напр. zolotoy-chas/zolotoy-chas-young/2foto-1x1.png — все вариации визуала в одной папке
    folder, stem = split_id(creative_id, brief.get("platform", ""))
    out_dir = OUTPUT_DIR.joinpath(group_for(folder), *split_visual(folder))
    out_dir.mkdir(parents=True, exist_ok=True)

    if mode == "still":
        output_file = out_dir / f"{stem}.{output_format}"
        cmd = [
            "npx", "remotion", "still",
            "--props", json.dumps(brief, ensure_ascii=False),
            "--frame", str(still_frame),
            "--output", str(output_file),
            "src/index.ts",
            template,
        ]
    else:
        output_file = out_dir / f"{stem}.mp4"
        cmd = [
            "npx", "remotion", "render",
            "--props", json.dumps(brief, ensure_ascii=False),
            "--output", str(output_file),
            "src/index.ts",
            template,
        ]

    result = subprocess.run(
        cmd,
        cwd=str(REMOTION_DIR),
        capture_output=False,
        text=True,
    )

    if result.returncode != 0:
        sys.exit(1)

    print(str(output_file))
    return str(output_file)


def _cli() -> None:
    parser = argparse.ArgumentParser(prog="render.py")
    parser.add_argument("brief_path", help="Path to brief JSON (relative to creatives-pipeline/ or absolute)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--still", action="store_true", default=True, help="Render a single frame (default)")
    group.add_argument("--video", action="store_true", default=False, help="Render full video")
    parser.add_argument("--frame", type=int, default=None, help="Frame number for still (overrides brief render_options.frame_for_still)")

    args = parser.parse_args()
    mode = "video" if args.video else "still"
    render(args.brief_path, mode=mode, frame=args.frame)


if __name__ == "__main__":
    _cli()
