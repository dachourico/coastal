import csv
from datetime import date
from pathlib import Path
from strains import strain_abbreviations

"""
    Plant Label
    Plant Batch Name
    Plant Batch Type
    Plant Count
    Strain Name
    Location Name
    Sublocation Name
    Patient License Number
    Actual Date
"""

# strain_abbreviations: dict = {strain: abbreviation}

batch_type = "clone"
location = "clone room"
sublocation = ""
cult_license = "B122507"
file_date = date.today().isoformat()
clone_date = date.today().strftime("%Y%m%d")

def main():
    print("\033[34mHey sexy, another buncha clones, huh?\n\033[0m")

    batch_info = input("\033[34mWhat batch even is this? \n\033[0m")
    input_csv = Path(input("\033[34mThe strains and count csv goes here please: \033[0m").strip("'\""))
    inventory_csv = Path(input("\033[34mAlso give me the current inventory csv since METRC hates us and doesn't let us use their API: \033[0m").strip("'\""))

    output_csv = input_csv.parent / f"{batch_info}_{file_date}.csv"

    source_tags = {}

    with open(inventory_csv, "r", newline="", encoding="utf-8-sig") as inventory:
        inventory_reader = csv.DictReader(inventory)

        for row in inventory_reader:
            inventory_strain = get_strain(row["Strain"])
            plant_tag = row["Tag"].strip()

            source_tags.setdefault(inventory_strain, plant_tag)
            

    with open(input_csv, "r", newline="") as infile, \
        open(output_csv, "w", newline="") as outfile:

        reader = csv.reader(infile)
        writer = csv.writer(outfile)

        for line in reader:
            plant_strain = get_strain(line[0])
            plant_count = int(line[1])
            strain_abbreviation = strain_abbreviations[plant_strain]
            if plant_count > 100:
                raise Exception("clone batches can't exceed 100 homeboy")
            batch_name = f"{batch_info}-{strain_abbreviation}-{clone_date}"

            if plant_strain not in source_tags:
                raise ValueError(f"No active source plant found for {plant_strain}")

            mother_tag = source_tags[plant_strain]
            

            writer.writerow([
                mother_tag,
                batch_name,
                batch_type,
                plant_count,
                plant_strain,
                location,
                sublocation,
                cult_license,
                file_date
            ])

        print(f"\033[1;32m\nAll done! See you in 5 weeks I guess...\n\033[0m")
        print(f"\033[1;32mOh yeah, I put it over here btw:\n\033[0m{output_csv}\n")


def get_strain(raw_strain):
    for strain in strain_abbreviations:
        if raw_strain.casefold() == strain.casefold():
            return strain
    raise ValueError(f"Sorry dude {raw_strain} ain't real")


if __name__ == "__main__":
    main()