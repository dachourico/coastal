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

The app requires Python 3, PyGObject, and GTK 4.

Run the automated tests with:

```sh
python -m unittest discover -s tests
```
