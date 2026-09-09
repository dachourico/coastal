"""Room definitions, layout data, and persistence for Coastal."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class TableSpec:
    label: str
    rows: int
    plants_per_row: int
    plant_count: int | None = None

    @property
    def capacity(self) -> int:
        return self.plant_count if self.plant_count is not None else self.rows * self.plants_per_row

    def positions_in_row(self, row: int) -> int:
        """Spread an exact capacity across rows, putting the remainder first."""
        if not 1 <= row <= self.rows:
            return 0
        quotient, remainder = divmod(self.capacity, self.rows)
        return quotient + (1 if row <= remainder else 0)

    def to_dict(self) -> dict[str, object]:
        value = asdict(self)
        if self.plant_count is None:
            value.pop("plant_count")
        return value

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "TableSpec":
        count = value.get("plant_count")
        table = cls(
            str(value["label"]), int(value["rows"]), int(value["plants_per_row"]),
            int(count) if count is not None else None,
        )
        if not table.label.strip() or table.rows < 1 or table.plants_per_row < 1 or table.capacity < 1:
            raise ValueError("Room tables need a name, rows, and plants per row")
        return table


@dataclass(frozen=True)
class RoomSpec:
    name: str
    levels: dict[int, dict[int, tuple[TableSpec, ...]]]

    @property
    def capacity(self) -> int:
        return sum(
            table.capacity
            for racks in self.levels.values()
            for tables in racks.values()
            for table in tables
        )

    def tables_for(self, level: int, rack: int) -> tuple[TableSpec, ...]:
        try:
            return self.levels[level][rack]
        except KeyError as exc:
            raise ValueError(f"{self.name} does not have level {level}, rack {rack}") from exc

    def slot_ids(self) -> list[str]:
        slots = []
        for level in sorted(self.levels):
            for rack in sorted(self.levels[level]):
                for table in self.levels[level][rack]:
                    for row in range(1, table.rows + 1):
                        for position in range(1, table.positions_in_row(row) + 1):
                            slots.append(slot_id(level, rack, table.label, row, position))
        return slots

    def level_slot_ids(self, level: int) -> list[str]:
        """Return one level in visual snake order: down each rack, then across."""
        if level not in self.levels:
            raise ValueError(f"{self.name} does not have level {level}")
        slots = []
        for rack in sorted(self.levels[level]):
            for table in self.levels[level][rack]:
                for row in range(1, table.rows + 1):
                    row_size = table.positions_in_row(row)
                    positions = range(1, row_size + 1)
                    if row % 2 == 0:
                        positions = range(row_size, 0, -1)
                    for position in positions:
                        slots.append(slot_id(level, rack, table.label, row, position))
        return slots

    def level_slots_from(self, level: int, starting_slot: str) -> list[str]:
        slots = self.level_slot_ids(level)
        try:
            start = slots.index(starting_slot)
        except ValueError as exc:
            raise ValueError("Starting position is not on that level") from exc
        return slots[start:] + slots[:start]

    def snake_slot_ids(self) -> list[str]:
        """Return every position in level order, using each level's visual snake order."""
        return [slot for level in sorted(self.levels) for slot in self.level_slot_ids(level)]

    def rack_slot_groups(self, level: int) -> list[list[str]]:
        """Return a level's rack-sized groups, each in visual snake order."""
        if level not in self.levels:
            raise ValueError(f"{self.name} does not have level {level}")
        groups = {rack: [] for rack in sorted(self.levels[level])}
        for slot in self.level_slot_ids(level):
            rack = int(slot.split("|", 2)[1][1:])
            groups[rack].append(slot)
        return list(groups.values())

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "levels": {
                str(level): {
                    str(rack): [table.to_dict() for table in tables]
                    for rack, tables in racks.items()
                }
                for level, racks in self.levels.items()
            },
        }

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "RoomSpec":
        name = str(value.get("name", "")).strip()
        if not name:
            raise ValueError("Room name is required")
        raw_levels = value.get("levels")
        if not isinstance(raw_levels, dict) or not raw_levels:
            raise ValueError("A room needs at least one level")
        levels = {}
        for level, raw_racks in raw_levels.items():
            if not isinstance(raw_racks, dict) or not raw_racks:
                raise ValueError("Each level needs at least one rack")
            levels[int(level)] = {
                int(rack): tuple(TableSpec.from_dict(table) for table in tables)
                for rack, tables in raw_racks.items()
            }
            if any(not tables for tables in levels[int(level)].values()):
                raise ValueError("Each rack needs at least one table")
        return cls(name, levels)


def _tables(prefix: str, count: int, rows: int, plants: int) -> tuple[TableSpec, ...]:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return tuple(TableSpec(f"{prefix} {letters[index]}", rows, plants) for index in range(count))


def _flower_4() -> RoomSpec:
    levels = {}
    for level in (1, 2, 3):
        levels[level] = {}
        for rack in range(1, 7):
            plants = 5 if level == 1 else 4
            tables = list(_tables("4x8", 2, 2, plants))
            if rack <= 4:
                tables.append(TableSpec("4x4", 2, 2))
            levels[level][rack] = tuple(tables)
    return RoomSpec("Flower 4", levels)


def _flower_3() -> RoomSpec:
    level_1 = {}
    for rack in range(1, 7):
        if rack in (1, 2, 3, 6):
            level_1[rack] = _tables("4x8", 4, 2, 5)
        else:
            level_1[rack] = _tables("4x8", 3, 2, 5) + (TableSpec("4x6", 2, 4),)
    level_2 = {rack: _tables("4x8", 4, 2, 4) for rack in range(1, 7)}
    return RoomSpec("Flower 3", {1: level_1, 2: level_2})


FLOWER_4 = _flower_4()
FLOWER_3 = _flower_3()
BUILTIN_ROOMS = {room.name: room for room in (FLOWER_3, FLOWER_4)}

# Backwards-compatible Flower 4 helpers.
ROOM_NAME = FLOWER_4.name
LEVELS = tuple(FLOWER_4.levels)


def tables_for(level: int, rack: int) -> tuple[tuple[str, int, int], ...]:
    return tuple((table.label, table.rows, table.plants_per_row) for table in FLOWER_4.tables_for(level, rack))


def slot_ids() -> list[str]:
    return FLOWER_4.slot_ids()


def level_slot_ids(level: int) -> list[str]:
    return FLOWER_4.level_slot_ids(level)


def level_slots_from(level: int, starting_slot: str) -> list[str]:
    return FLOWER_4.level_slots_from(level, starting_slot)


def slot_id(level: int, rack: int, table: str, row: int, position: int) -> str:
    return f"L{level}|R{rack}|{table}|row{row}|plant{position}"


def resize_table(room: RoomSpec, level: int, rack: int, label: str, rows: int, capacity: int) -> RoomSpec:
    """Return a room with one table resized while retaining its identity."""
    if rows < 1 or capacity < 1:
        raise ValueError("Rows and plant capacity must be at least 1")
    if level not in room.levels or rack not in room.levels[level]:
        raise ValueError("That table is not in this room")
    found = False
    levels = {level_id: {rack_id: list(tables) for rack_id, tables in racks.items()}
              for level_id, racks in room.levels.items()}
    for index, table in enumerate(levels[level][rack]):
        if table.label == label:
            columns = max(1, (capacity + rows - 1) // rows)
            levels[level][rack][index] = TableSpec(label, rows, columns, capacity)
            found = True
            break
    if not found:
        raise ValueError("That table is not in this room")
    return RoomSpec(room.name, {
        level_id: {rack_id: tuple(tables) for rack_id, tables in racks.items()}
        for level_id, racks in levels.items()
    })


def _rack_numbers(text: str) -> list[int]:
    racks = set()
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            start, end = (int(value.strip()) for value in part.split("-", 1))
            if start < 1 or end < start:
                raise ValueError(f"Invalid rack range: {part}")
            racks.update(range(start, end + 1))
        elif part:
            rack = int(part)
            if rack < 1:
                raise ValueError("Rack numbers must be positive")
            racks.add(rack)
    if not racks:
        raise ValueError("Each configuration needs at least one rack")
    return sorted(racks)


def build_room_spec(name: str, configuration: str) -> RoomSpec:
    """Build a room from pipe-delimited level/rack/table configuration lines."""
    name = name.strip()
    if not name:
        raise ValueError("Room name is required")
    levels: dict[int, dict[int, list[TableSpec]]] = {}
    data_lines = [line.strip() for line in configuration.splitlines() if line.strip()]
    if not data_lines:
        raise ValueError("Add at least one table configuration")
    for line_number, line in enumerate(data_lines, 1):
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != 6:
            raise ValueError(f"Configuration line {line_number} needs 6 fields separated by |")
        try:
            level, prefix, count, rows, plants = (
                int(fields[0]), fields[2], int(fields[3]), int(fields[4]), int(fields[5])
            )
            racks = _rack_numbers(fields[1])
        except ValueError as exc:
            raise ValueError(f"Invalid configuration line {line_number}: {exc}") from exc
        if level < 1 or not prefix or min(count, rows, plants) < 1:
            raise ValueError(f"Invalid values on configuration line {line_number}")
        if count > 26:
            raise ValueError("A configuration can contain at most 26 matching tables")
        for rack in racks:
            target = levels.setdefault(level, {}).setdefault(rack, [])
            existing = sum(table.label.startswith(f"{prefix} ") for table in target)
            if existing + count > 26:
                raise ValueError(f"Rack {rack} has more than 26 {prefix} tables")
            for index in range(count):
                target.append(TableSpec(f"{prefix} {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[existing + index]}", rows, plants))
    normalized = {
        level: {rack: tuple(tables) for rack, tables in racks.items()}
        for level, racks in levels.items()
    }
    return RoomSpec(name, normalized)


def load_custom_rooms(path: Path) -> dict[str, RoomSpec]:
    if not Path(path).exists():
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    rooms = [RoomSpec.from_dict(item) for item in payload.get("rooms", [])]
    return {room.name: room for room in rooms}


def save_custom_rooms(path: Path, rooms: dict[str, RoomSpec]) -> None:
    payload = {"version": 1, "rooms": [room.to_dict() for room in rooms.values()]}
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


@dataclass
class PlantBatch:
    id: int
    strain: str
    count: int


class RoomLayout:
    def __init__(self, room: RoomSpec = FLOWER_4) -> None:
        self.room = room
        self.batches: dict[int, PlantBatch] = {}
        self.assignments: dict[str, int] = {}
        self._placed_counts: dict[int, int] = {}
        self._next_batch_id = 1

    @property
    def capacity(self) -> int:
        return self.room.capacity

    @property
    def placed_total(self) -> int:
        return len(self.assignments)

    def add_batch(self, strain: str, count: int) -> PlantBatch:
        strain = strain.strip()
        if not strain:
            raise ValueError("Choose a strain")
        if count < 1:
            raise ValueError("Plant count must be at least 1")
        batch = PlantBatch(self._next_batch_id, strain, count)
        self.batches[batch.id] = batch
        self._next_batch_id += 1
        return batch

    def placed_count(self, batch_id: int) -> int:
        return self._placed_counts.get(batch_id, 0)

    def remaining_count(self, batch_id: int) -> int:
        return self.batches[batch_id].count - self.placed_count(batch_id)

    def place_across(self, batch_id: int, available_slots: list[str]) -> int:
        if batch_id not in self.batches:
            raise ValueError("That batch no longer exists")
        available = [slot for slot in available_slots if slot not in self.assignments]
        placed = min(len(available), self.remaining_count(batch_id))
        for slot in available[:placed]:
            self.assignments[slot] = batch_id
        self._placed_counts[batch_id] = self.placed_count(batch_id) + placed
        return placed

    def place_on_table(self, batch_id: int, table_slots: list[str]) -> int:
        return self.place_across(batch_id, table_slots)

    def autofill_batches(self) -> int:
        """Fill whole rack-level groups without carrying a batch across levels."""
        targets = {batch_id: self.remaining_count(batch_id) for batch_id in self.batches}
        return self._place_whole_rack_targets(targets)

    def suggested_split(self) -> int:
        """Fill whole rack groups proportionally without splitting batches across levels."""
        levels = sorted(self.room.levels)
        empty_capacity = sum(
            len(group)
            for level in levels
            for group in self.room.rack_slot_groups(level)
            if all(slot not in self.assignments for slot in group)
        )
        remaining = {batch_id: self.remaining_count(batch_id) for batch_id in self.batches}
        allocations = proportional_allocations(remaining, empty_capacity)
        return self._place_whole_rack_targets(allocations)

    def _place_whole_rack_targets(self, targets: dict[int, int]) -> int:
        """Place target counts into whole racks while keeping each batch on one level."""
        levels = sorted(self.room.levels)
        level_indexes = {level: index for index, level in enumerate(levels)}
        batch_levels: dict[int, set[int]] = {}
        batch_racks: dict[tuple[int, int], set[int]] = {}
        for slot, batch_id in self.assignments.items():
            level_text, rack_text = slot.split("|", 2)[:2]
            level = int(level_text[1:])
            batch_levels.setdefault(batch_id, set()).add(level)
            batch_racks.setdefault((batch_id, level), set()).add(int(rack_text[1:]))
        available_groups = {
            level: [
                group
                for group in self.room.rack_slot_groups(level)
                if all(slot not in self.assignments for slot in group)
            ]
            for level in levels
        }
        cursor = 0
        placed_total = 0

        for batch_id, target in targets.items():
            limit = min(target, self.remaining_count(batch_id))
            if limit == 0:
                continue
            assigned_levels = batch_levels.get(batch_id, set())
            if len(assigned_levels) > 1:
                continue
            candidates = [next(iter(assigned_levels))] if assigned_levels else levels[cursor:]
            for target_level in candidates:
                chosen = _largest_whole_groups(
                    available_groups[target_level],
                    limit,
                    adjacent_to=batch_racks.get((batch_id, target_level)),
                )
                if chosen:
                    cursor = max(cursor, level_indexes[target_level])
                    slots = [slot for group in chosen for slot in group]
                    placed_total += self.place_across(batch_id, slots)
                    chosen_ids = {id(group) for group in chosen}
                    available_groups[target_level] = [
                        group
                        for group in available_groups[target_level]
                        if id(group) not in chosen_ids
                    ]
                    break
        return placed_total

    def clear_slot(self, slot: str) -> None:
        batch_id = self.assignments.pop(slot, None)
        if batch_id is not None:
            self._placed_counts[batch_id] -= 1

    def remove_batch(self, batch_id: int) -> None:
        self.batches.pop(batch_id, None)
        self._placed_counts.pop(batch_id, None)
        self.assignments = {
            slot: assigned for slot, assigned in self.assignments.items() if assigned != batch_id
        }

    def clear(self) -> None:
        """Clear all plant placements while retaining the batch list."""
        self.assignments.clear()
        self._placed_counts.clear()

    def clear_batches(self) -> None:
        """Clear both the room layout and all plant batches."""
        self.batches.clear()
        self.assignments.clear()
        self._placed_counts.clear()
        self._next_batch_id = 1

    def save(self, path: Path) -> Path:
        payload = {
            "version": 2,
            "room": self.room.name,
            "room_spec": self.room.to_dict(),
            "batches": [asdict(batch) for batch in self.batches.values()],
            "assignments": self.assignments,
        }
        Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return Path(path)

    @classmethod
    def load(cls, path: Path) -> "RoomLayout":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if "room_spec" in payload:
            room = RoomSpec.from_dict(payload["room_spec"])
        else:
            room_name = payload.get("room")
            if room_name not in BUILTIN_ROOMS:
                raise ValueError("Saved layout has an unknown room definition")
            room = BUILTIN_ROOMS[room_name]
        valid_slots = set(room.slot_ids())
        layout = cls(room)
        for item in payload.get("batches", []):
            batch = PlantBatch(int(item["id"]), str(item["strain"]), int(item["count"]))
            if batch.count < 1:
                raise ValueError("Saved layout contains an invalid batch count")
            layout.batches[batch.id] = batch
        for slot, batch_id in payload.get("assignments", {}).items():
            batch_id = int(batch_id)
            if slot not in valid_slots or batch_id not in layout.batches:
                raise ValueError("Saved layout contains an invalid plant position")
            layout.assignments[slot] = batch_id
            layout._placed_counts[batch_id] = layout.placed_count(batch_id) + 1
        if any(layout.placed_count(batch.id) > batch.count for batch in layout.batches.values()):
            raise ValueError("Saved layout places more plants than a batch contains")
        layout._next_batch_id = max(layout.batches, default=0) + 1
        return layout

    def export_csv(self, path: Path) -> Path:
        with Path(path).open("w", newline="", encoding="utf-8") as outfile:
            writer = csv.writer(outfile)
            writer.writerow(["Room", "Level", "Rack", "Table", "Row", "Position", "Strain", "Batch"])
            for slot in self.room.slot_ids():
                batch_id = self.assignments.get(slot)
                if batch_id is None:
                    continue
                level, rack, table, row, position = slot.split("|")
                writer.writerow([
                    self.room.name, level[1:], rack[1:], table, row[3:], position[5:],
                    self.batches[batch_id].strain, batch_id,
                ])
        return Path(path)


def _largest_whole_groups(
    groups: list[list[str]], limit: int, adjacent_to: set[int] | None = None,
) -> list[list[str]]:
    """Choose the largest consecutive run of rack groups within the limit."""
    best: list[list[str]] = []
    best_size = 0
    for start in range(len(groups)):
        size = 0
        chosen: list[list[str]] = []
        previous_rack: int | None = None
        for group in groups[start:]:
            rack = int(group[0].split("|", 2)[1][1:])
            if previous_rack is not None and rack != previous_rack + 1:
                break
            if size + len(group) > limit:
                break
            chosen.append(group)
            size += len(group)
            previous_rack = rack
            occupied_racks = (adjacent_to or set()) | {
                int(item[0].split("|", 2)[1][1:]) for item in chosen
            }
            is_contiguous = max(occupied_racks) - min(occupied_racks) + 1 == len(occupied_racks)
            if is_contiguous and size > best_size:
                best = chosen.copy()
                best_size = size
    return best


def proportional_allocations(counts: dict[int, int], capacity: int) -> dict[int, int]:
    """Apportion capacity by count using the largest-remainder method."""
    positive = {key: max(0, count) for key, count in counts.items() if count > 0}
    total = sum(positive.values())
    target = min(max(0, capacity), total)
    if not total or not target:
        return {key: 0 for key in counts}
    if target == total:
        return {key: positive.get(key, 0) for key in counts}

    allocations = {key: (count * target) // total for key, count in positive.items()}
    insertion_order = {key: index for index, key in enumerate(positive)}
    remainders = sorted(
        positive,
        key=lambda key: (-(positive[key] * target % total), insertion_order[key]),
    )
    for key in remainders[:target - sum(allocations.values())]:
        allocations[key] += 1
    return {key: allocations.get(key, 0) for key in counts}


def parse_batch_csv(path: Path, valid_strains: list[str] | tuple[str, ...]) -> list[tuple[str, int]]:
    """Read validated strain/count rows, accepting an optional header."""
    canonical = {strain.casefold(): strain for strain in valid_strains}
    batches: list[tuple[str, int]] = []
    with Path(path).open(newline="", encoding="utf-8-sig") as infile:
        for line_number, row in enumerate(csv.reader(infile), 1):
            if not row or all(not value.strip() for value in row):
                continue
            if len(row) != 2:
                raise ValueError(f"CSV line {line_number} must contain strain,count")
            strain_text, count_text = (value.strip() for value in row)
            if not batches and strain_text.casefold() == "strain" and count_text.casefold() == "count":
                continue
            strain = canonical.get(strain_text.casefold())
            if strain is None:
                raise ValueError(f"Unknown strain on CSV line {line_number}: {strain_text}")
            try:
                count = int(count_text)
            except ValueError as exc:
                raise ValueError(f"Invalid plant count on CSV line {line_number}: {count_text}") from exc
            if count < 1:
                raise ValueError(f"Plant count on CSV line {line_number} must be at least 1")
            batches.append((strain, count))
    if not batches:
        raise ValueError("The CSV does not contain any strain,count rows")
    return batches


def add_strain_to_file(path: Path, strain: str, abbreviation: str) -> None:
    """Insert a strain into clone_master/strains.py without rewriting existing entries."""
    strain = strain.strip()
    abbreviation = abbreviation.strip().upper()
    if not strain:
        raise ValueError("Strain name is required")
    if not abbreviation:
        raise ValueError("Abbreviation is required")
    if not re.fullmatch(r"[A-Z0-9-]{1,12}", abbreviation):
        raise ValueError("Abbreviation must be 1-12 letters, numbers, or hyphens")

    namespace: dict[str, object] = {}
    source = Path(path).read_text(encoding="utf-8")
    exec(compile(source, str(path), "exec"), {}, namespace)
    strains = namespace.get("strain_abbreviations")
    if not isinstance(strains, dict):
        raise ValueError("Could not read the strain dictionary")
    if any(strain.casefold() == str(existing).casefold() for existing in strains):
        raise ValueError(f"{strain} is already in the strain dictionary")

    closing = source.rfind("}")
    if closing < 0:
        raise ValueError("Could not find the end of the strain dictionary")
    prefix = source[:closing].rstrip()
    separator = "," if prefix and not prefix.endswith(",") else ""
    entry = f'{separator}\n    {strain!r}: {abbreviation!r}\n'
    Path(path).write_text(prefix + entry + source[closing:], encoding="utf-8")
