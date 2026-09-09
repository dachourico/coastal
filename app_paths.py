"""Writable user settings for the packaged desktop app."""
import os
from pathlib import Path
import shutil
import sys

RESOURCE_DIR = Path(__file__).resolve().parent


def settings_file(name):
    if not getattr(sys, "frozen", False):
        return RESOURCE_DIR / name
    directory = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "Coastal"
    target = directory / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() and (RESOURCE_DIR / name).exists():
        shutil.copy2(RESOURCE_DIR / name, target)
    return target
