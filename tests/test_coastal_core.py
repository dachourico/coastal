import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from coastal_core import generate_clone_batches, generate_harvest


class CoastalCoreTests(unittest.TestCase):
    def test_clone_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clone_input = root / "clones.csv"
            clone_input.write_text("Wedding Cake,25\n", encoding="utf-8")
            inventory = root / "inventory.csv"
            inventory.write_text("Strain,Tag\nWedding Cake,1A400\n", encoding="utf-8")

            output = generate_clone_batches("BatchA", clone_input, inventory, date(2026, 9, 4))

            with output.open(newline="") as generated:
                self.assertEqual(next(csv.reader(generated)), [
                    "1A400", "BatchA-WC-20260904", "clone", "25", "Wedding Cake",
                    "clone room", "", "B122507", "2026-09-04",
                ])

    def test_harvest_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            harvest_input = root / "harvest.csv"
            harvest_input.write_text("1A400,123.4,WC\n", encoding="utf-8")

            output = generate_harvest("Room1", harvest_input, date(2026, 9, 4))

            with output.open(newline="") as generated:
                self.assertEqual(next(csv.reader(generated)), [
                    "1A400", "123.4", "Grams", "Dry room", "",
                    "Room1-WC-20260904", "B122507", "2026-09-04",
                ])


if __name__ == "__main__":
    unittest.main()
