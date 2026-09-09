"""Interactive wrapper for Coastal's harvest CSV generator."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from coastal_core import generate_harvest  # noqa: E402


def main() -> None:
    print("\033[34mHey sexy, another harvest in the books, huh?\n\033[0m")
    harvest_info = input("\033[34mWhat harvest even is this? \n\033[0m")
    input_csv = Path(input("\033[34mWow, already? Gimme dat juicy CSV: \033[0m").strip("'\""))

    output = generate_harvest(harvest_info, input_csv)
    print("\033[1;32m\nAll done! See you in 5 weeks I guess...\n\033[0m")
    print(f"\033[1;32mOh yeah, I put it over here btw:\n\033[0m{output}\n")


if __name__ == "__main__":
    main()
