import csv
from datetime import date
from pathlib import Path

"""
plant_tag
weight
units
drying_location
sublocation
harvest_batch
license
date
"""

units = "Grams"
location = "Dry room"
sublocation = ""
cult_license = "B122507"
current_date = date.today().isoformat()
harvest_date = date.today().strftime("%Y%m%d")

def main():
    print("\033[34mHey sexy, another harvest in the books, huh?\n\033[0m")

    harvest_info = input("\033[34mWhat harvest even is this? \n\033[0m")
    input_csv = Path(input("\033[34mWow, already? Gimme dat juicy CSV: \033[0m").strip("'\""))

    output_csv = input_csv.parent / f"{harvest_info}_{current_date}.csv"

    with open(input_csv, "r", newline="") as infile, \
         open(output_csv, "w", newline="") as outfile:

        reader = csv.reader(infile)
        writer = csv.writer(outfile)


        for line in reader:
            plant_tag = line[0]
            plant_weight = line[1]
            strain = line[2]
            harvest_batch = f"{harvest_info}-{strain}-{harvest_date}"

            writer.writerow([
                plant_tag,
                plant_weight,
                units,
                location,
                sublocation,
                harvest_batch,
                cult_license,
                current_date
            ])

    print(f"\033[1;32m\nAll done! See you in 5 weeks I guess...\n\033[0m")
    print(f"\033[1;32mOh yeah, I put it over here btw:\n\033[0m{output_csv}\n")


main()