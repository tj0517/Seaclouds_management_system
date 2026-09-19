#!/usr/bin/env python3
"""Validate an .xlsx as an OPC package — independently of the library that wrote it.

    python3 scripts/validate-xlsx.py FILE.xlsx [FILE.xlsx ...]

Exit code 0 when every file is valid, 1 otherwise. Prints one block per file.

WHY THIS EXISTS AND WHY IT USES NOTHING
---------------------------------------
apps/dcs writes the MDR export with exceljs, and its tests read the result back
with exceljs. That round trip proves the two halves of one library agree with
each other; it cannot prove the file is well formed, because a library will
happily read back its own malformed output.

This script uses the Python standard library only — zipfile and
xml.etree.ElementTree, no openpyxl, no third-party anything — so a bug in
exceljs cannot hide behind a matching bug in the reader. It also means the
script runs anywhere python3 does, with no install step, which is the other
reason it is not written against a spreadsheet library.

Do NOT refactor this to share code with apps/dcs/lib/mdr-export.ts. Sharing the
column list, the sheet name, or anything else would make the check agree with
the export by construction, which is the one thing it must not do.

WHAT IT CHECKS
--------------
Exactly the conditions that make Excel show "We found a problem with some
content in <file>. Do you want us to try to recover as much as we can?" — a
prompt that appears before the user sees a single cell:

  1. the container is a valid ZIP, and every entry passes its CRC;
  2. the required OPC parts exist: [Content_Types].xml, _rels/.rels,
     xl/workbook.xml, xl/_rels/workbook.xml.rels;
  3. every .xml and .rels part parses as XML;
  4. every relationship Target resolves to a part that is actually in the
     package (a dangling rel is the classic silent corruption);
  5. every worksheet part has an Override in [Content_Types].xml;
  6. the workbook declares a sheet named MDR;
  7. the sheet's cells resolve — shared strings are dereferenced and the grid
     is rebuilt from each cell's own r= reference, so the DATA is parsed and
     not merely present.

WHAT IT DOES NOT CHECK — read this before quoting a pass
--------------------------------------------------------
  * FORMATTING of any kind. Fills, fonts, colours, number formats, column
    widths, freeze panes. A sheet whose status colours are all wrong, or whose
    dates render as 46284, passes here.
  * FORMULAS. It reads cached values; it does not evaluate, and a sheet with
    no formulas at all (which this export is) is indistinguishable.
  * HOW THE SHEET LOOKS. Nothing about layout, readability or whether a human
    would call it correct.
  * WHETHER THE ROWS ARE THE RIGHT ROWS. That is fidelity, and it is proved
    against dcs.v_mdr in apps/dcs/lib/mdr-export.fidelity.ts.

So: a pass means "Excel will open this without offering to repair it". It does
not mean the file is correct.
"""
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'

REQUIRED_PARTS = (
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
)


def column_index(ref):
    """'BC12' -> 54. Cells carry their own reference; position in the XML lies."""
    letters = ''.join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def inspect(path):
    """Returns (problems, info). A non-empty problems list means invalid."""
    if not zipfile.is_zipfile(path):
        return ['not a ZIP container at all'], {}

    z = zipfile.ZipFile(path)
    problems = []

    corrupt = z.testzip()
    if corrupt:
        problems.append(f'corrupt ZIP entry: {corrupt}')

    names = set(z.namelist())
    for required in REQUIRED_PARTS:
        if required not in names:
            problems.append(f'missing required OPC part: {required}')

    for name in sorted(names):
        if name.endswith(('.xml', '.rels')):
            try:
                ET.fromstring(z.read(name))
            except ET.ParseError as exc:
                problems.append(f'malformed XML in {name}: {exc}')

    # Everything below reads the parts, so stop if they are not all readable.
    if problems:
        return problems, {}

    for name in sorted(n for n in names if n.endswith('.rels')):
        base = posixpath.dirname(posixpath.dirname(name))
        for rel in ET.fromstring(z.read(name)).findall(f'{REL}Relationship'):
            if rel.get('TargetMode') == 'External':
                continue
            target = rel.get('Target', '')
            resolved = (
                target.lstrip('/')
                if target.startswith('/')
                else posixpath.normpath(posixpath.join(base, target))
            )
            if resolved not in names:
                problems.append(f'{name}: relationship -> missing part {resolved}')

    content_types = ET.fromstring(z.read('[Content_Types].xml'))
    declared = {
        o.get('PartName').lstrip('/')
        for o in content_types
        if o.tag.endswith('Override') and o.get('PartName')
    }
    for name in sorted(names):
        if name.startswith('xl/worksheets/') and name.endswith('.xml') and name not in declared:
            problems.append(f'worksheet not declared in [Content_Types].xml: {name}')

    workbook = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = [s.get('name') for s in workbook.iter(f'{MAIN}sheet')]
    if 'MDR' not in sheets:
        problems.append(f'no sheet named MDR (found {sheets})')

    sheet_part = 'xl/worksheets/sheet1.xml'
    if sheet_part not in names:
        problems.append(f'missing {sheet_part}')
        return problems, {}

    shared = []
    if 'xl/sharedStrings.xml' in names:
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(f'{MAIN}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{MAIN}t')))

    def value(c):
        v = c.find(f'{MAIN}v')
        if v is None or v.text is None:
            return ''
        if c.get('t') == 's':
            i = int(v.text)
            if i >= len(shared):
                problems.append(f'shared string index {i} out of range')
                return ''
            return shared[i]
        return v.text

    sheet = ET.fromstring(z.read(sheet_part))
    grid = []
    for row in sheet.findall(f'.//{MAIN}sheetData/{MAIN}row'):
        cells = row.findall(f'{MAIN}c')
        width = max([column_index(c.get('r', 'A1')) for c in cells], default=-1) + 1
        flat = [''] * width
        for c in cells:
            flat[column_index(c.get('r', 'A1'))] = value(c)
        grid.append(flat)

    if len(grid) < 2:
        problems.append(f'expected two header rows, found {len(grid)} row(s)')
        return problems, {}

    headers = grid[1]
    info = {
        'sheets': sheets,
        'merged': len(sheet.findall(f'.//{MAIN}mergeCell')),
        'columns': len(headers),
        'group_bands': [c for c in grid[0] if c],
        'rows': 0,
        'first': '-',
        'last': '-',
    }
    if 'SCL Doc. Number' in headers:
        at = headers.index('SCL Doc. Number')
        body = [r for r in grid[2:] if len(r) > at and str(r[at]).startswith('SC')]
        info['rows'] = len(body)
        if body:
            info['first'] = body[0][at]
            info['last'] = body[-1][at]

    return problems, info


def main(paths):
    if not paths:
        print(__doc__.strip().splitlines()[2].strip())
        return 1

    failed = 0
    for path in paths:
        name = path.rsplit('/', 1)[-1]
        try:
            problems, info = inspect(path)
        except Exception as exc:  # a reader that crashes is a failed file
            print(f'FAIL {name}: {type(exc).__name__}: {exc}')
            failed += 1
            continue

        if problems:
            failed += 1
            print(f'FAIL {name}')
            for p in problems:
                print(f'       {p}')
            continue

        print(f'OK   {name}')
        print(f'       sheets={info["sheets"]}  merged group bands={info["merged"]}')
        print(f'       group row   -> {info["group_bands"]}')
        print(f'       columns={info["columns"]}  data rows={info["rows"]}')
        print(f'       first SCL={info["first"]}   last SCL={info["last"]}')

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
