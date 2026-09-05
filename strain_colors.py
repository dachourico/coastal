"""Stable, readable colors for strains in room layouts."""

from __future__ import annotations

import colorsys
import hashlib


def strain_color(strain: str) -> tuple[str, str]:
    """Return deterministic background and readable foreground hex colors."""
    digest = hashlib.blake2s(strain.strip().casefold().encode("utf-8"), digest_size=8).digest()
    hue = int.from_bytes(digest[:2], "big") / 65535
    saturation = 0.58 + (digest[2] / 255) * 0.18
    value = 0.72 + (digest[3] / 255) * 0.16
    red, green, blue = colorsys.hsv_to_rgb(hue, saturation, value)
    channels = tuple(round(channel * 255) for channel in (red, green, blue))
    background = "#{:02x}{:02x}{:02x}".format(*channels)

    def linear(channel: int) -> float:
        value = channel / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    luminance = sum(weight * linear(channel) for weight, channel in zip((0.2126, 0.7152, 0.0722), channels))
    black_contrast = (luminance + 0.05) / 0.05
    white_contrast = 1.05 / (luminance + 0.05)
    foreground = "#000000" if black_contrast >= white_contrast else "#ffffff"
    return background, foreground


def strain_css_class(strain: str) -> str:
    """Return a CSS-safe, stable class name for a strain."""
    key = hashlib.blake2s(strain.strip().casefold().encode("utf-8"), digest_size=6).hexdigest()
    return f"strain-{key}"
