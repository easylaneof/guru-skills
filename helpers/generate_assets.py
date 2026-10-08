#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate a photo asset via nano-banana (Kie.ai) and save it to
remotion/public/assets/.

Usage:
  generate_assets.py --prompt "..." [--name filename.png] [--size 9:16] [--model nano-banana-pro]

Stdout (on success): relative asset path, e.g. "assets/generated_abc.png"
This path can be used directly in a brief's assets.before_image / assets.after_image.

Env (from .env):
  KIE_AI_API_KEY   — required
  KIE_AI_API_BASE  — default: https://api.kie.ai
  KIE_AI_MODEL     — default: nano-banana-pro
"""

import argparse
import json
import logging
import mimetypes
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

BASE_DIR    = Path(__file__).parent.parent
ENV_FILE    = BASE_DIR / ".env"
ASSETS_DIR  = BASE_DIR / "remotion" / "public" / "assets"

DEFAULT_BASE  = "https://api.kie.ai"
DEFAULT_MODEL = "nano-banana-pro"
POLL_INTERVAL = 4
POLL_MAX_WAIT = 300

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _load_env() -> None:
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def _cfg():
    base  = os.getenv("KIE_AI_API_BASE") or DEFAULT_BASE
    key   = os.getenv("KIE_AI_API_KEY")
    model = os.getenv("KIE_AI_MODEL") or DEFAULT_MODEL
    return base.rstrip("/"), key, model


def _create_task(
    client: httpx.Client,
    prompt: str,
    size: str,
    model: str,
    base: str,
    key: str,
    image_input_url: Optional[str] = None,
) -> Optional[str]:
    url     = f"{base}/api/v1/jobs/createTask"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    inp: dict = {
        "prompt": prompt[:5000],
        "output_format": "png",
        "aspect_ratio": size,
        "resolution": "1K",
    }
    if image_input_url:
        inp["image_input"] = [image_input_url]
    payload = {"model": model, "input": inp}
    resp = client.post(url, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 200:
        raise RuntimeError(f"createTask failed: {data.get('msg') or data.get('message')}")
    task_id = data.get("data", {}).get("taskId")
    logger.info("taskId: %s", task_id)
    return task_id


def _poll(client: httpx.Client, task_id: str, base: str, key: str) -> tuple[Optional[bytes], Optional[str]]:
    """Returns (image_bytes, cdn_url)."""
    url      = f"{base}/api/v1/jobs/recordInfo"
    headers  = {"Authorization": f"Bearer {key}"}
    deadline = time.monotonic() + POLL_MAX_WAIT

    while time.monotonic() < deadline:
        resp = client.get(url, params={"taskId": task_id}, headers=headers, timeout=30)
        resp.raise_for_status()
        response = resp.json()
        if response.get("code") != 200:
            raise RuntimeError(f"recordInfo failed: {response.get('msg') or response.get('message')}")
        data = response.get("data") or {}
        state = data.get("state", "processing")

        if state == "success":
            try:
                urls = json.loads(data.get("resultJson", "{}")).get("resultUrls", [])
                image_url = urls[0] if urls else None
            except Exception:
                image_url = None

            if image_url:
                logger.info("Downloading: %s", image_url)
                r = client.get(image_url, timeout=60)
                r.raise_for_status()
                return r.content, image_url

            logger.error("success state but no resultUrls")
            return None, None

        if state == "fail":
            logger.error("Generation failed: %s %s", data.get("failCode", ""), data.get("failMsg", ""))
            return None, None

        logger.info("State: %s — waiting...", state)
        time.sleep(POLL_INTERVAL)

    logger.error("Timeout after %ds", POLL_MAX_WAIT)
    return None, None


def _upload_image(client: httpx.Client, path: Path, key: str) -> str:
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("Исходник должен быть PNG, JPG или WebP.")
    base = os.getenv("KIE_AI_UPLOAD_BASE") or "https://kieai.redpandaai.co"
    with path.open("rb") as file:
        response = client.post(
            f"{base.rstrip('/')}/api/file-stream-upload",
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (path.name, file, mimetypes.guess_type(path.name)[0] or "application/octet-stream")},
            data={"uploadPath": "photo-creatives", "fileName": f"{uuid.uuid4().hex}{path.suffix.lower()}"},
            timeout=120,
        )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 200 or payload.get("success") is False:
        raise RuntimeError(f"Upload failed: {payload.get('msg') or payload.get('message')}")
    url = (payload.get("data") or {}).get("downloadUrl")
    if not url:
        raise RuntimeError("Upload response has no downloadUrl.")
    return url


def _resolve_image_input(image_input: Optional[str], client: httpx.Client, key: str) -> Optional[str]:
    """Resolve a URL, local photo, or sidecar; upload local originals afresh."""
    if not image_input:
        return None
    if image_input.startswith(("https://", "http://")):
        return image_input
    path = Path(image_input).expanduser()
    if not path.is_absolute():
        local = Path.cwd() / path
        path = local if local.exists() else ASSETS_DIR / path.name
    if path.suffix.lower() == ".json":
        metadata = json.loads(path.read_text(encoding="utf-8"))
        filename = metadata.get("filename")
        if filename and Path(filename).name == filename:
            original = path.parent / filename
            if original.is_file():
                return _upload_image(client, original, key)
        url = metadata.get("cdn_url")
        if not url or not url.startswith(("https://", "http://")):
            raise ValueError("В сайдкаре нет локального оригинала или HTTP(S) cdn_url.")
        return url
    if not path.is_file():
        raise FileNotFoundError(f"Исходное фото не найдено: {path}")
    return _upload_image(client, path, key)


def generate_asset(
    prompt: str,
    name: Optional[str] = None,
    size: str = "1:1",
    model: Optional[str] = None,
    image_input: Optional[str] = None,
) -> Optional[str]:
    """
    Generate an asset and save it to assets/.
    image_input: HTTP(S) URL, sidecar JSON, or local PNG/JPG/WebP — used for img2img.
    Returns relative asset path like "assets/filename.png", or None on failure.
    Saves sidecar JSON with prompt, cdn_url, model, size, task_id, date.
    """
    _load_env()
    base, key, default_model = _cfg()

    if not key:
        print("ERROR: KIE_AI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    model = model or default_model
    if not prompt.strip():
        raise ValueError("Промпт не должен быть пустым.")
    if name:
        if Path(name).name != name or "/" in name or "\\" in name or name in {".", ".."}:
            raise ValueError("--name должен быть именем файла, без папок.")
        name = name if name.endswith(".png") else f"{name}.png"
        if (ASSETS_DIR / name).exists() or (ASSETS_DIR / name).with_suffix(".json").exists():
            raise FileExistsError("Такой ассет уже существует. Выберите новое --name.")
    with httpx.Client(follow_redirects=True) as client:
        image_input_url = _resolve_image_input(image_input, client, key)
        task_id = _create_task(client, prompt, size, model, base, key, image_input_url)
        if not task_id:
            return None

        image_bytes, cdn_url = _poll(client, task_id, base, key)

    if not image_bytes:
        return None

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    if not name:
        name = f"gen_{task_id[:8]}.png"
    elif not name.endswith(".png"):
        name = f"{name}.png"

    output_path = ASSETS_DIR / name
    output_path.write_bytes(image_bytes)
    logger.info("Saved: %s (%d KB)", output_path, len(image_bytes) // 1024)

    sidecar = {
        "filename": name,
        "prompt": prompt,
        "model": model,
        "size": size,
        "task_id": task_id,
        "cdn_url": cdn_url,
        "image_input": image_input,
        "generated_at": datetime.now().strftime("%Y-%m-%d"),
    }
    sidecar_path = ASSETS_DIR / f"{name.removesuffix('.png')}.json"
    with open(sidecar_path, "w", encoding="utf-8") as f:
        json.dump(sidecar, f, ensure_ascii=False, indent=2)
    logger.info("Sidecar: %s", sidecar_path)

    return f"assets/{name}"


def _cli() -> None:
    parser = argparse.ArgumentParser(prog="generate_assets.py")
    parser.add_argument("--prompt",      required=True, help="Generation prompt")
    parser.add_argument("--name",        default=None,  help="Output filename (default: gen_<taskid>.png)")
    parser.add_argument("--size",        default="1:1", help="Aspect ratio: 1:1, 9:16, 16:9, 3:4, 4:3 (default: 1:1)")
    parser.add_argument("--model",       default=None,  help="Model (default: from .env or nano-banana-pro)")
    parser.add_argument("--image-input", default=None,  dest="image_input",
                        help="img2img source: HTTP(S) URL, local PNG/JPG/WebP, or sidecar JSON")

    args = parser.parse_args()

    logger.info("Prompt: %s...", args.prompt[:80])
    logger.info("Size: %s | Model: %s | img2img: %s", args.size, args.model or "from .env", args.image_input or "none")

    asset_path = generate_asset(
        prompt=args.prompt,
        name=args.name,
        size=args.size,
        model=args.model,
        image_input=args.image_input,
    )

    if asset_path:
        print(asset_path)
    else:
        print("ERROR: generation failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    _cli()
