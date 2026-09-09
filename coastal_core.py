"""CSV generation logic shared by the Coastal desktop app."""

import csv
from datetime import date
from pathlib import Path

from clone_master.strains import strain_abbreviations


BATCH_TYPE = "clone"
CLONE_LOCATION = "clone room"
DRYING_LOCATION = "Dry room"
SUBLOCATION = ""
CULT_LICENSE = "B122507"
UNITS = "Grams"


def normalize_strain(raw_strain: str) -> str:
    value = raw_strain.strip()
    try:
        return _strain_index()[value.casefold()]
    except KeyError:
        raise ValueError(f"Unknown strain: {value or '(blank)'}") from None


_STRAIN_INDEX: dict[str, str] = {}


def _strain_index() -> dict[str, str]:
    """Return an O(1) case-insensitive index, rebuilding after runtime additions."""
    if len(_STRAIN_INDEX) != len(strain_abbreviations):
        _STRAIN_INDEX.clear()
        _STRAIN_INDEX.update((strain.casefold(), strain) for strain in strain_abbreviations)
    return _STRAIN_INDEX


def generate_clone_batches(
    batch_info: str,
    input_csv: Path,
    inventory_csv: Path,
    today: date | None = None,
) -> Path:
    batch_info = batch_info.strip()
    if not batch_info:
        raise ValueError("Batch name is required")

    today = today or date.today()
    source_tags: dict[str, str] = {}

    with Path(inventory_csv).open("r", newline="", encoding="utf-8-sig") as inventory:
        reader = csv.DictReader(inventory)
        required = {"Strain", "Tag"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("Inventory CSV must contain Strain and Tag columns")
        for row in reader:
            strain = normalize_strain(row["Strain"])
            source_tags.setdefault(strain, row["Tag"].strip())

    output_csv = Path(input_csv).parent / f"{batch_info}_{today.isoformat()}.csv"
    rows: list[list[object]] = []
    with Path(input_csv).open("r", newline="", encoding="utf-8-sig") as infile:
        for line_number, row in enumerate(csv.reader(infile), start=1):
            if not row or not any(field.strip() for field in row):
                continue
            if len(row) < 2:
                raise ValueError(f"Clone input row {line_number} needs strain and plant count")
            strain = normalize_strain(row[0])
            try:
                plant_count = int(row[1])
            except ValueError as exc:
                raise ValueError(f"Invalid plant count on row {line_number}: {row[1]}") from exc
            if not 1 <= plant_count <= 100:
                raise ValueError(f"Plant count on row {line_number} must be between 1 and 100")
            if strain not in source_tags:
                raise ValueError(f"No active source plant found for {strain}")
            rows.append([
                source_tags[strain],
                f"{batch_info}-{strain_abbreviations[strain]}-{today:%Y%m%d}",
                BATCH_TYPE,
                plant_count,
                strain,
                CLONE_LOCATION,
                SUBLOCATION,
                CULT_LICENSE,
                today.isoformat(),
            ])

    if not rows:
        raise ValueError("Clone input CSV contains no data")
    with output_csv.open("w", newline="", encoding="utf-8") as outfile:
        csv.writer(outfile).writerows(rows)
    return output_csv


def generate_harvest(
    harvest_info: str,
    input_csv: Path,
    today: date | None = None,
) -> Path:
    harvest_info = harvest_info.strip()
    if not harvest_info:
        raise ValueError("Harvest name is required")

    today = today or date.today()
    output_csv = Path(input_csv).parent / f"{harvest_info}_{today.isoformat()}.csv"
    rows: list[list[str]] = []
    with Path(input_csv).open("r", newline="", encoding="utf-8-sig") as infile:
        for line_number, row in enumerate(csv.reader(infile), start=1):
            if not row or not any(field.strip() for field in row):
                continue
            if len(row) < 3:
                raise ValueError(f"Harvest input row {line_number} needs tag, weight, and strain")
            tag, weight, strain = (field.strip() for field in row[:3])
            if not tag or not weight or not strain:
                raise ValueError(f"Harvest input row {line_number} has a blank required value")
            rows.append([
                tag,
                weight,
                UNITS,
                DRYING_LOCATION,
                SUBLOCATION,
                f"{harvest_info}-{strain}-{today:%Y%m%d}",
                CULT_LICENSE,
                today.isoformat(),
            ])

    if not rows:
        raise ValueError("Harvest input CSV contains no data")
    with output_csv.open("w", newline="", encoding="utf-8") as outfile:
        csv.writer(outfile).writerows(rows)
    return output_csv
