import csv
import tempfile
import unittest
from pathlib import Path

from room_layout import (
    FLOWER_3,
    RoomLayout,
    add_strain_to_file,
    build_room_spec,
    level_slot_ids,
    level_slots_from,
    load_custom_rooms,
    save_custom_rooms,
    slot_ids,
    tables_for,
)


class RoomLayoutTests(unittest.TestCase):
    def test_flower_4_capacity_and_tables(self):
        self.assertEqual(len(slot_ids()), 360)
        self.assertEqual(sum(rows * columns for _, rows, columns in tables_for(1, 1)), 24)
        self.assertEqual(sum(rows * columns for _, rows, columns in tables_for(1, 5)), 20)
        self.assertEqual(sum(rows * columns for _, rows, columns in tables_for(2, 1)), 20)
        self.assertEqual(sum(rows * columns for _, rows, columns in tables_for(3, 6)), 16)

    def test_flower_3_capacity_and_mixed_racks(self):
        self.assertEqual(FLOWER_3.capacity, 428)
        self.assertEqual(len(FLOWER_3.level_slot_ids(1)), 236)
        self.assertEqual(len(FLOWER_3.level_slot_ids(2)), 192)
        self.assertEqual(len(FLOWER_3.tables_for(1, 1)), 4)
        self.assertEqual(len(FLOWER_3.tables_for(1, 4)), 4)
        self.assertEqual(FLOWER_3.tables_for(1, 4)[-1].label, "4x6")
        self.assertEqual(FLOWER_3.tables_for(1, 4)[-1].plants_per_row, 4)
        self.assertTrue(all(len(FLOWER_3.tables_for(2, rack)) == 4 for rack in range(1, 7)))

    def test_placement_is_limited_by_table_and_batch(self):
        layout = RoomLayout()
        batch = layout.add_batch("Wedding Cake", 12)
        table = slot_ids()[:10]
        self.assertEqual(layout.place_on_table(batch.id, table), 10)
        self.assertEqual(layout.place_on_table(batch.id, slot_ids()[10:20]), 2)
        self.assertEqual(layout.remaining_count(batch.id), 0)

    def test_snake_placement_stays_on_level_and_wraps(self):
        layout = RoomLayout()
        batch = layout.add_batch("Wedding Cake", 50)
        level = level_slot_ids(1)
        start = level[-20]
        ordered = level_slots_from(1, start)
        self.assertEqual(layout.place_across(batch.id, ordered), 50)
        placed = list(layout.assignments)
        self.assertEqual(placed, ordered[:50])
        self.assertTrue(all(slot.startswith("L1|") for slot in placed))
        self.assertIn(level[0], placed)

    def test_snake_reverses_second_row(self):
        slots = level_slot_ids(1)
        self.assertEqual(slots[0], "L1|R1|4x8 A|row1|plant1")
        self.assertEqual(slots[5], "L1|R1|4x8 A|row2|plant5")
        self.assertEqual(slots[9], "L1|R1|4x8 A|row2|plant1")

    def test_single_position_painting_decrements_remaining(self):
        layout = RoomLayout()
        batch = layout.add_batch("Wedding Cake", 3)
        positions = level_slot_ids(1)[:4]
        self.assertEqual(layout.place_across(batch.id, [positions[0]]), 1)
        self.assertEqual(layout.remaining_count(batch.id), 2)
        self.assertEqual(layout.place_across(batch.id, [positions[1]]), 1)
        self.assertEqual(layout.remaining_count(batch.id), 1)
        self.assertEqual(layout.place_across(batch.id, [positions[2]]), 1)
        self.assertEqual(layout.place_across(batch.id, [positions[3]]), 0)
        self.assertEqual(layout.remaining_count(batch.id), 0)
        self.assertEqual(layout.placed_total, 3)
        self.assertEqual(layout.capacity - layout.placed_total, 357)

    def test_save_load_and_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            layout = RoomLayout()
            batch = layout.add_batch("Wedding Cake", 2)
            layout.place_on_table(batch.id, slot_ids()[:10])
            saved = layout.save(root / "layout.json")
            loaded = RoomLayout.load(saved)
            self.assertEqual(loaded.assignments, layout.assignments)
            loaded.export_csv(root / "layout.csv")
            with (root / "layout.csv").open() as exported:
                rows = list(csv.reader(exported))
            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[1][6], "Wedding Cake")

    def test_custom_room_builder_and_persistence(self):
        room = build_room_spec(
            "Veg 1",
            "1 | 1-3,6 | 4x8 | 2 | 2 | 5\n1 | 4-5 | 4x6 | 1 | 2 | 4",
        )
        self.assertEqual(room.capacity, 96)
        self.assertEqual(len(room.levels[1]), 6)
        self.assertEqual(room.tables_for(1, 1)[1].label, "4x8 B")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rooms.json"
            save_custom_rooms(path, {room.name: room})
            loaded = load_custom_rooms(path)[room.name]
            self.assertEqual(loaded, room)
            layout_path = Path(directory) / "layout.json"
            RoomLayout(room).save(layout_path)
            self.assertEqual(RoomLayout.load(layout_path).room, room)

    def test_add_strain_preserves_valid_dictionary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strains.py"
            path.write_text("strain_abbreviations = {\n    'Old': 'OLD'\n}\n", encoding="utf-8")
            add_strain_to_file(path, "New Strain", "ns")
            namespace = {}
            exec(path.read_text(), {}, namespace)
            self.assertEqual(namespace["strain_abbreviations"]["New Strain"], "NS")
            with self.assertRaises(ValueError):
                add_strain_to_file(path, "new strain", "OTHER")


if __name__ == "__main__":
    unittest.main()
