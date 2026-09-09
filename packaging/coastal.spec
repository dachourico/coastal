# Build from the repository root: python -m PyInstaller packaging/coastal.spec
from pathlib import Path
root = Path(SPECPATH).parent
analysis = Analysis(
    [str(root / 'coastal_app.py')],
    pathex=[str(root)],
    datas=[(str(root / 'assets'), 'assets'),
           (str(root / 'custom_rooms.json'), '.'),
           (str(root / 'clone_master/strains.py'), 'clone_master')],
    hiddenimports=['gi.repository.GdkPixbuf', 'gi.repository.PangoCairo', 'cairo', 'gi._gi_cairo'],
    hooksconfig={'gi': {'module-versions': {'Gtk': '4.0', 'Gdk': '4.0'},
                        'icons': ['Adwaita'], 'themes': ['Adwaita']}},
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name='Coastal', console=False,
          icon=str(root / 'assets/coastal-healing.ico'))
collection = COLLECT(exe, analysis.binaries, analysis.datas, name='Coastal')
