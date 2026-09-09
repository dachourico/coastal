"""Convert Excel plant inventories into strain/count batches."""
from collections import Counter
from pathlib import Path

from room_layout import parse_batch_csv


def _header(value):
    return ''.join(c for c in str(value or '').casefold() if c.isalnum())


def parse_inventory_rows(rows, valid_strains=()):
    canonical = {s.casefold(): s for s in valid_strains}
    totals = Counter()
    tags = set()
    columns = None
    for number, row in enumerate(rows, 1):
        if not any(v is not None and str(v).strip() for v in row):
            continue
        if columns is None:
            headers = [_header(v) for v in row]
            strains = [i for i, h in enumerate(headers) if h in ('strain', 'strainname')]
            if not strains:
                if number >= 25:
                    break
                continue
            counts = [i for i, h in enumerate(headers) if h in ('count', 'plantcount', 'numberofplants')]
            identifiers = [i for i, h in enumerate(headers) if h in ('tag', 'planttag')]
            if len(strains) != 1 or len(counts) > 1 or len(identifiers) > 1:
                raise ValueError('Inventory has ambiguous strain, count, or tag columns')
            columns = (strains[0], counts[0] if counts else None, identifiers[0] if identifiers else None)
            continue
        strain_col, count_col, tag_col = columns
        def cell(index):
            return row[index] if index is not None and index < len(row) else None
        strain = str(cell(strain_col) or '').strip()
        if not strain:
            raise ValueError(f'Excel row {number}: strain is missing')
        key = strain.casefold()
        canonical.setdefault(key, strain)
        if tag_col is not None:
            tag = str(cell(tag_col) or '').strip()
            if not tag:
                raise ValueError(f'Excel row {number}: plant tag is missing')
            if tag in tags:
                raise ValueError(f'Excel row {number}: duplicate plant tag {tag}')
            tags.add(tag)
        count = 1
        if count_col is not None:
            value = cell(count_col)
            try:
                count = int(value)
                if isinstance(value, bool) or float(value) != count or count < 1:
                    raise ValueError()
            except (TypeError, ValueError, OverflowError) as exc:
                raise ValueError(f'Excel row {number}: plant count must be a positive whole number') from exc
        totals[canonical[key]] += count
    if columns is None:
        raise ValueError('Excel inventory must include a Strain or Strain Name column')
    if not totals:
        raise ValueError('Excel inventory contains no plants')
    return list(totals.items())


def parse_batch_file(path, valid_strains=()):
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == '.csv':
        return parse_batch_csv(path, valid_strains)
    if suffix not in ('.xlsx', '.xls'):
        raise ValueError('Choose an Excel (.xlsx or .xls) or CSV file')
    try:
        if suffix == '.xlsx':
            from openpyxl import load_workbook
            workbook = load_workbook(path, read_only=True, data_only=True)
            try:
                sheets = []
                for sheet in workbook:
                    # METRC exports can claim A1:A565 while actually containing ten columns.
                    sheet.reset_dimensions()
                    sheets.append(list(sheet.values))
            finally:
                workbook.close()
        else:
            import xlrd
            workbook = xlrd.open_workbook(path)
            try:
                sheets = [[sheet.row_values(i) for i in range(sheet.nrows)] for sheet in workbook.sheets()]
            finally:
                workbook.release_resources()
    except ImportError as exc:
        raise ValueError('Excel support requires the packages in requirements.txt; launch Coastal with ./coastal') from exc
    candidates = [rows for rows in sheets if any(
        _header(v) in ('strain', 'strainname') for row in rows[:25] for v in row
    )]
    if len(candidates) > 1:
        raise ValueError('Multiple inventory sheets found; use a workbook with one inventory sheet')
    return parse_inventory_rows(candidates[0] if candidates else [], valid_strains)
