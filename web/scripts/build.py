"""Build only explicitly selected application assets; never publish inventories."""
from pathlib import Path
import shutil

web = Path(__file__).resolve().parents[1]
root = web.parent
dist = web / 'dist'
if dist.exists():
    shutil.rmtree(dist)
shutil.copytree(web / 'public', dist)
if not (web / 'vendor/pyodide.mjs').exists():
    raise SystemExit('Run python3 scripts/vendor.py once before building')
shutil.copytree(web / 'vendor', dist / 'runtime')
for name in ('coastal_core.py', 'room_layout.py', 'inventory_import.py',
             'strain_catalog.py', 'app_paths.py', 'clone_master/strains.py'):
    target = dist / 'python' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / name, target)
shutil.copy2(web / 'bridge.py', dist / 'python/bridge.py')
shutil.copy2(root / 'assets/coastal-healing-logo.svg', dist / 'logo.svg')
print('Built Coastal browser app in web/dist')
