This repo aims to make CSV generation for METRC tasks easy.

Clone master creates clone batches based on input of strain, plant count.

Harvest master creates harvest CSVS based on tag, weight, strain abbreviation.

## Desktop app

Run `./coastal` to open the GTK 4 desktop interface. It provides separate Clone
Batches and Harvest tabs, native CSV file pickers, input validation, and opens
the output folder after generating a file.

The Room Layouts tab includes visual Flower 3 and Flower 4 planners. Add strain/count
batches, drag them onto individual tables, save reusable layouts as JSON, and
export the finished plant-by-plant assignment to CSV for staff. New strains can
also be added to `clone_master/strains.py` from the planner. Use **Design new
room** to visually add levels, racks, and tables, choose each table's rows and
total plant positions, and preview the same structure used by the planner. These
rooms are saved in `custom_rooms.json` and become available in the room selector.
Right-click any table in the planner to change its row count or exact plant
capacity; if a table is made smaller, plants in removed positions return to their
batches.

In **Room Layouts**, use **Import Excel or CSV…** (Ctrl+I), or drop a file onto
that tab. METRC Excel inventories (`.xlsx` or `.xls`) are counted by strain,
creating one plant batch per strain in the selected room. Each row counts as one
plant; if a `Count`, `Plant Count`, or `Number of Plants` column exists, its values
are summed instead. The workbook must have one inventory sheet with a `Strain`
or `Strain Name` header within its first 25 rows. Duplicate plant tags and invalid
rows are rejected before any batches are added. New strain names are accepted
from Excel without changing the saved strain catalog. Existing batches and
placements are kept; importing the same file again adds another set of batches.
CSV import still accepts the original `strain,count` format and known strains.

The app requires Python 3, PyGObject, and GTK 4. Install Excel support once:

```sh
python -m venv --system-site-packages .venv
.venv/bin/python -m pip install -r requirements.txt
```

The `./coastal` launcher automatically uses this environment.

Run the automated tests with:

```sh
.venv/bin/python -m unittest discover -s tests
```

## Windows app

Share `Coastal-Windows.zip` from the **Build Windows app** GitHub Actions
artifact. Extract the ZIP, open the Coastal folder, and double-click
`Coastal.exe`. Python and GTK are bundled. Keep `_internal` beside the EXE.
The package targets 64-bit Windows 10/11 and is unsigned.

Packaged settings live in `%LOCALAPPDATA%\Coastal` and survive replacement
of the app folder. Save room layouts explicitly before exiting.

The Windows workflow installs GTK and Python using MSYS2 UCRT64, runs the
tests, builds with PyInstaller, and verifies the packaged window starts
without MSYS2 on PATH. It can also be run manually from GitHub Actions.
