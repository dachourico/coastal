This repo aims to make CSV generation for METRC tasks easy.

Clone master creates clone batches based on input of strain, plant count.

Harvest master creates harvest CSVS based on tag, weight, strain abbreviation.

## Desktop app

Run `./coastal` to open the GTK 4 desktop interface. It provides separate Clone
Batches and Harvest tabs, native CSV file pickers, input validation, and opens
the output folder after generating a file.

The app requires Python 3, PyGObject, and GTK 4.

Run the automated tests with:

```sh
python -m unittest discover -s tests
```
