"""Load the editable strain catalog, including packaged app settings."""
import runpy
import sys
from app_paths import settings_file
from clone_master.strains import strain_abbreviations

STRAINS_FILE = settings_file("clone_master/strains.py")
if getattr(sys, "frozen", False):
    strain_abbreviations.update(runpy.run_path(str(STRAINS_FILE))["strain_abbreviations"])
