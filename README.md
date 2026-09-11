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

## Browser app (Cloudflare)

Live app: https://coastalcultivation.coastal-web.workers.dev

The `web/` app runs the existing Python CSV and room-planning logic in a browser
worker using Pyodide. Cloudflare serves only static files. Inventories and layouts
are processed on the device; no database, paid services, or server processing are
used. The public link opens the tools without an account. Each visit starts with no batches or placements. Custom rooms
and added strains are saved in that browser. Coworkers share layouts using **Save
layout** and **Open layout**; edits are not synchronized between devices.

The **Supply** tab (also at `/supply/`) tracks nutrients, trellis, rockwool, and
orders. Those counts stay in this browser and are separate from room layouts.
Download a supply backup to move them to another device.

The **Calendar** tab (also at `/calendar/`) displays a Google Calendar in agenda,
week, or month view, with Flower 3, Flower 4, Veg, and Service shown together by default, color coded
by calendar. Use the calendar filter to focus on a room or Service. In Google Calendar on a computer, open **Settings → your
calendar → Integrate calendar**, copy the **Calendar ID**, and save it in the
tab's Calendar settings. An embed URL with one `src` calendar is also accepted.
The selection is saved in this browser; coworkers enter the same ID on their
devices. Do not paste a secret iCal address. Private calendars require each
viewer to sign in to a Google account with permission to see the calendar.
If browser privacy settings prevent the embedded calendar from displaying,
use **Open Google Calendar**. Google hosts the calendar and handles access;
Coastal does not store event data or Google credentials. Edit events in Google
Calendar. Separate Google Tasks lists are not part of this embedded view.

Includes clone and harvest CSV generation, Excel/CSV batch import, table placement
(including drag and drop), auto-fill, suggested split, table resizing, room creation,
JSON layout interchange with the desktop app, and plant assignment CSV export.
The browser room designer starts with matching racks and allows individual table
sizes to be edited. Existing custom desktop rooms can be transferred in saved
layout JSON files. Local inventory data and desktop settings are never bundled.

Setup and deployment:

```sh
cd web
npm ci
python3 scripts/vendor.py  # Download pinned Python runtime and Excel wheels once
npm run build
npm test                  # Uses /usr/bin/chromium; adjust config on other systems
npx wrangler login
npm run deploy
```

`npm run dev` starts a local preview. `wrangler.jsonc` deploys a static-assets-only
Worker to the free `workers.dev` address. These commands do not change the account
subscription or provision paid resources. Dependencies in `node_modules` are only
build/deployment/test tools; the deployment contains only `web/dist`.

The initial visit downloads the browser Python runtime. Use a current Chrome,
Edge, Firefox, or Safari browser. Excel inputs are limited to 20 MB. Clearing site
data removes saved room designs and strains. Download layouts to keep your work.

**Clear placements** returns plants to their batches. **Clear all** removes all
batches and placements while keeping the current room design.

### Tag scanning (browser)

Place plants in Room layouts, then open **Tag scanning**, choose a placed batch,
and press **Start scanning**. Targets use the number actually placed in the room.
Each nonempty barcode followed by Enter counts once, including repeated barcodes.
This checks quantities, not barcode uniqueness or whether a tag belongs to a strain.
At the target the batch is marked satisfied and stops accepting scans. Select the
next batch explicitly. **Undo latest entries** removes one or more recent entries;
**Add one manually** corrects a missed scan. Undoing below the target allows a new
completion alert after scanning resumes.

Live counters remain only for this page. Reloads and replacement layouts clear
counters; changing placements resets the affected batch. Move records are stored
under one stable browser key and survive refreshes, offline use, and layout changes. Layout downloads do not
include move records or scanning progress.

**Download move records CSV** exports all saved scan entries across rooms and
layouts, including incomplete batches. Each row includes a unique record ID,
move batch ID, UTC timestamp, destination room, batch ID, strain, abbreviation,
placed target at scan time, entry type, and tag. Manual additions have a blank
tag and an explicit label. Repeated barcodes remain separate entries. Undo removes
entries from the current page’s saved records; it cannot modify a CSV already
downloaded. Previous-page records remain exportable, but their counters are not
resumed and they cannot be undone from a fresh page.

For Google Sheets use File → Import → Upload, select the CSV, and turn off
“Convert text to numbers, dates, and formulas”. Import as text to preserve exact
tags, leading zeros, and long numeric IDs. CSV fields are quoted and escaped, but
quoting alone does not stop spreadsheet formula evaluation if conversion is on.
Repeated exports contain previously exported records; use Record ID to deduplicate.
Records are local to this browser and origin; clearing browser data or storage
failure can remove them. The app requests persistent storage where available and
reports failures in the tab. Download a CSV at the end of each move for an
independent permanent copy; current-page records remain downloadable from memory.
This is a record of scanned room moves, not a METRC transfer submission.

USB keyboard scanners (including the Zebra DS2208-SR in keyboard mode) need an
Enter suffix and focus in the tag field. Completion plays three tones on the
computer and shows “Batch satisfied”. It plays the 7–11 second crop of
“Best Cup of Coffee.mp3” from the local app asset. Use **Test completion song**
before scanning
and keep the computer volume on. The app does not control the scanner or require
browser USB permissions. Its ordinary scan beep remains controlled by the scanner.
If the scanner was previously switched to another USB mode, restore keyboard mode.

Use **Save named move history** to keep a historical snapshot in the app. The
snapshot includes the room layout, batches, placements, and tags recorded for
that room. Saved histories can be restored or deleted from **Saved move
histories**. Download the CSV as the independent backup copy.
