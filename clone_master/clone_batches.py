"""Interactive wrapper for Coastal's clone-batch CSV generator."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from coastal_core import generate_clone_batches, normalize_strain  # noqa: E402


def get_strain(raw_strain: str) -> str:
    """Preserve the legacy helper while using shared strain validation."""
    try:
        return normalize_strain(raw_strain)
    except ValueError:
        raise ValueError(f"Sorry dude {raw_strain} ain't real") from None


def main() -> None:
    print("\033[34mHey sexy, another buncha clones, huh?\n\033[0m")
    batch_info = input("\033[34mWhat batch even is this? \n\033[0m")
    input_csv = Path(input("\033[34mThe strains and count csv goes here please: \033[0m").strip("'\""))
    inventory_csv = Path(input(
        "\033[34mAlso give me the current inventory csv since METRC hates us and doesn't "
        "let us use their API: \033[0m"
    ).strip("'\""))

    output = generate_clone_batches(batch_info, input_csv, inventory_csv)
    print("\033[1;32m\nAll done! See you in 5 weeks I guess...\n\033[0m")
    print(f"\033[1;32mOh yeah, I put it over here btw:\n\033[0m{output}\n")


if __name__ == "__main__":
    main()
