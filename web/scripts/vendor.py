"""Fetch a pinned browser Python runtime and pure-Python Excel dependencies."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import urllib.request

base = 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/'
target = Path(__file__).resolve().parents[1] / 'vendor'
target.mkdir(exist_ok=True)
def fetch(name, url, digest=None):
    path = target / name
    if not path.exists():
        data = urllib.request.urlopen(url, timeout=60).read()
        if digest and hashlib.sha256(data).hexdigest() != digest:
            raise ValueError(f'Checksum mismatch: {name}')
        path.write_bytes(data)
    print(name)
with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(lambda name: fetch(name,base+name), ['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']))
lock=json.loads((target/'pyodide-lock.json').read_text())
xlrd=lock['packages']['xlrd']
fetch(xlrd['file_name'],base+xlrd['file_name'],xlrd['sha256'])
wheels=[xlrd['file_name']]
for name,version in [('openpyxl','3.1.5'),('et-xmlfile','2.0.0')]:
    package=json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json',timeout=30))
    wheel=next(item for item in package['urls'] if item['filename'].endswith('.whl'))
    fetch(wheel['filename'],wheel['url'],wheel['digests']['sha256'])
    wheels.append(wheel['filename'])
(target/'excel-wheels.json').write_text(json.dumps(wheels))
