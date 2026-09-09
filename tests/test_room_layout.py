import csv
import tempfile
import unittest
from pathlib import Path

from room_layout import (
    FLOWER_3,
    FLOWER_4,
    RoomLayout,
    add_strain_to_file,
    build_room_spec,
    level_slot_ids,
    level_slots_from,
    load_custom_rooms,
    parse_batch_csv,
    proportional_allocations,
    save_custom_rooms,
    resize_table,
    slot_ids,
    tables_for,
)
from strain_colors import strain_color, strain_css_class


class RoomLayoutTests(unittest.TestCase):
    def test_strain_colors_are_stable_distinct_and_readable(self):
        wedding_cake = strain_color("Wedding Cake")
        self.assertEqual(wedding_cake, strain_color("wedding cake"))
        self.assertNotEqual(wedding_cake, strain_color("Apple Fritter"))
        self.assertRegex(wedding_cake[0], r"^#[0-9a-f]{6}$")
        self.assertIn(wedding_cake[1], ("#000000", "#ffffff"))
        self.assertRegex(strain_css_class("Wedding Cake"), r"^strain-[0-9a-f]{12}$")

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

    def test_whole_room_snake_order_advances_between_levels(self):
        slots = FLOWER_3.snake_slot_ids()
        level_one = FLOWER_3.level_slot_ids(1)
        level_two = FLOWER_3.level_slot_ids(2)
        self.assertEqual(slots, level_one + level_two)
        self.assertEqual(slots[0], "L1|R1|4x8 A|row1|plant1")
        self.assertEqual(slots[len(level_one)], "L2|R1|4x8 A|row1|plant1")

    def test_next_available_placement_skips_occupied_slots(self):
        layout = RoomLayout(FLOWER_3)
        first = layout.add_batch("Wedding Cake", 1)
        second = layout.add_batch("Apple Fritter", 3)
        ordered = FLOWER_3.snake_slot_ids()
        layout.place_across(first.id, ordered)
        self.assertEqual(layout.place_across(second.id, ordered), 3)
        self.assertEqual(
            [slot for slot, batch_id in layout.assignments.items() if batch_id == second.id],
            ordered[1:4],
        )

    def test_autofill_keeps_batches_on_single_levels(self):
        room = build_room_spec("Small", "1 | 1 | Tray | 1 | 1 | 4\n2 | 1 | Tray | 1 | 1 | 4")
        layout = RoomLayout(room)
        first = layout.add_batch("Wedding Cake", 4)
        second = layout.add_batch("Apple Fritter", 4)

        self.assertEqual(layout.autofill_batches(), 8)
        first_levels = {slot.split("|", 1)[0] for slot, value in layout.assignments.items() if value == first.id}
        second_levels = {slot.split("|", 1)[0] for slot, value in layout.assignments.items() if value == second.id}
        self.assertEqual(first_levels, {"L1"})
        self.assertEqual(second_levels, {"L2"})

    def test_autofill_leaves_excess_unplaced_instead_of_splitting(self):
        room = build_room_spec("Small", "1 | 1 | Tray | 1 | 1 | 4\n2 | 1 | Tray | 1 | 1 | 4")
        layout = RoomLayout(room)
        batch = layout.add_batch("Wedding Cake", 6)

        self.assertEqual(layout.autofill_batches(), 4)
        self.assertEqual(layout.remaining_count(batch.id), 2)
        assigned_levels = {slot.split("|", 1)[0] for slot in layout.assignments}
        self.assertEqual(assigned_levels, {"L1"})

    def test_autofill_only_fills_complete_rack_levels(self):
        room = build_room_spec("Four racks", "1 | 1-4 | Rack | 1 | 2 | 10")
        layout = RoomLayout(room)
        batch = layout.add_batch("Wedding Cake", 65)

        self.assertEqual(layout.autofill_batches(), 60)
        self.assertEqual(layout.remaining_count(batch.id), 5)
        occupied_by_rack = {
            rack: sum(slot.startswith(f"L1|R{rack}|") for slot in layout.assignments)
            for rack in range(1, 5)
        }
        self.assertEqual(sorted(occupied_by_rack.values()), [0, 20, 20, 20])

    def test_autofill_keeps_each_batch_in_consecutive_racks(self):
        room = build_room_spec(
            "Uneven racks",
            "1 | 1 | Rack | 1 | 1 | 4\n"
            "1 | 2 | Rack | 1 | 1 | 6\n"
            "1 | 3 | Rack | 1 | 1 | 4\n",
        )
        layout = RoomLayout(room)
        batch = layout.add_batch("Wedding Cake", 8)

        self.assertEqual(layout.autofill_batches(), 6)
        occupied_racks = {
            int(slot.split("|", 2)[1][1:])
            for slot, batch_id in layout.assignments.items()
            if batch_id == batch.id
        }
        self.assertEqual(occupied_racks, {2})

    def test_autofill_extends_a_batch_into_an_adjacent_rack(self):
        room = build_room_spec("Three racks", "1 | 1-3 | Rack | 1 | 1 | 4")
        layout = RoomLayout(room)
        blocker = layout.add_batch("Apple Fritter", 4)
        batch = layout.add_batch("Wedding Cake", 5)
        groups = room.rack_slot_groups(1)
        layout.place_across(blocker.id, groups[0])
        layout.place_across(batch.id, [groups[2][0]])

        self.assertEqual(layout.autofill_batches(), 4)
        occupied_racks = {
            int(slot.split("|", 2)[1][1:])
            for slot, batch_id in layout.assignments.items()
            if batch_id == batch.id
        }
        self.assertEqual(occupied_racks, {2, 3})

    def test_clear_layout_keeps_batches_and_clear_batches_removes_them(self):
        layout = RoomLayout()
        batch = layout.add_batch("Wedding Cake", 3)
        layout.place_across(batch.id, slot_ids()[:2])

        layout.clear()
        self.assertIn(batch.id, layout.batches)
        self.assertEqual(layout.placed_count(batch.id), 0)
        self.assertEqual(layout.remaining_count(batch.id), 3)

        layout.clear_batches()
        self.assertEqual(layout.batches, {})
        self.assertEqual(layout.assignments, {})

    def test_suggested_split_uses_proportional_batch_representation(self):
        room = build_room_spec(
            "Split room",
            "1 | 1-3 | Rack | 1 | 2 | 10\n2 | 1-2 | Rack | 1 | 2 | 10",
        )
        layout = RoomLayout(room)
        first = layout.add_batch("Wedding Cake", 120)
        second = layout.add_batch("Apple Fritter", 80)

        self.assertEqual(proportional_allocations({first.id: 120, second.id: 80}, 100), {first.id: 60, second.id: 40})
        self.assertEqual(layout.suggested_split(), 100)
        self.assertEqual(layout.placed_count(first.id), 60)
        self.assertEqual(layout.placed_count(second.id), 40)
        for batch in (first, second):
            levels = {
                slot.split("|", 1)[0]
                for slot, batch_id in layout.assignments.items()
                if batch_id == batch.id
            }
            self.assertEqual(len(levels), 1)
        for level in (1, 2):
            for group in room.rack_slot_groups(level):
                occupied = sum(slot in layout.assignments for slot in group)
                self.assertIn(occupied, (0, len(group)))

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

    def test_placement_count_index_stays_synchronized(self):
        layout = RoomLayout(FLOWER_4)
        batch = layout.add_batch("Blue Dream", 3)
        slots = layout.room.slot_ids()[:3]
        layout.place_across(batch.id, slots)
        layout.clear_slot(slots[0])
        self.assertEqual(layout.placed_count(batch.id), 2)

        with tempfile.TemporaryDirectory() as directory:
            saved = Path(directory) / "layout.json"
            layout.save(saved)
            loaded = RoomLayout.load(saved)
            self.assertEqual(loaded.placed_count(batch.id), 2)
            loaded.remove_batch(batch.id)
            self.assertEqual(loaded.placed_count(batch.id), 0)
            self.assertNotIn(batch.id, loaded.assignments.values())

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

    def test_table_can_have_an_exact_capacity_across_uneven_rows(self):
        room = resize_table(FLOWER_4, 1, 1, "4x8 A", rows=3, capacity=10)
        table = room.tables_for(1, 1)[0]
        self.assertEqual(table.capacity, 10)
        self.assertEqual([table.positions_in_row(row) for row in range(1, 4)], [4, 3, 3])
        table_slots = [slot for slot in room.slot_ids() if "|R1|4x8 A|" in slot and slot.startswith("L1|")]
        self.assertEqual(len(table_slots), 10)
        self.assertIn("L1|R1|4x8 A|row3|plant3", table_slots)
        self.assertNotIn("L1|R1|4x8 A|row3|plant4", table_slots)

    def test_exact_table_capacity_survives_persistence(self):
        room = resize_table(FLOWER_4, 1, 1, "4x8 A", rows=3, capacity=11)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rooms.json"
            save_custom_rooms(path, {room.name: room})
            loaded = load_custom_rooms(path)[room.name]
        table = loaded.tables_for(1, 1)[0]
        self.assertEqual(table.capacity, 11)
        self.assertEqual([table.positions_in_row(row) for row in range(1, 4)], [4, 4, 3])

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

    def test_parse_batch_csv_accepts_header_and_canonicalizes_strains(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "batches.csv"
            path.write_text("strain,count\nwedding cake,25\nApple Fritter,40\n", encoding="utf-8")
            self.assertEqual(
                parse_batch_csv(path, ("Wedding Cake", "Apple Fritter")),
                [("Wedding Cake", 25), ("Apple Fritter", 40)],
            )

    def test_parse_batch_csv_rejects_invalid_rows_before_import(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "batches.csv"
            path.write_text("Wedding Cake,25\nUnknown Strain,10\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unknown strain on CSV line 2"):
                parse_batch_csv(path, ("Wedding Cake",))


if __name__ == "__main__":
    unittest.main()
