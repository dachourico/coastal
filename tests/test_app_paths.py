import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app_paths


class PackagedSettingsTests(unittest.TestCase):
    def test_settings_are_seeded_once_and_survive_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / 'resources'
            resources.mkdir()
            (resources / 'custom_rooms.json').write_text('original')
            with patch.object(app_paths, 'RESOURCE_DIR', resources), \
                 patch.object(app_paths.sys, 'frozen', True, create=True), \
                 patch.dict(app_paths.os.environ, {'LOCALAPPDATA': str(root / 'user')}):
                target = app_paths.settings_file('custom_rooms.json')
                self.assertEqual(target.read_text(), 'original')
                target.write_text('user edits')
                (resources / 'custom_rooms.json').write_text('updated defaults')
                self.assertEqual(app_paths.settings_file('custom_rooms.json').read_text(), 'user edits')
                self.assertEqual(target.parent, root / 'user' / 'Coastal')

    def test_source_checkout_keeps_existing_settings_location(self):
        with patch.object(app_paths.sys, 'frozen', False, create=True):
            self.assertEqual(app_paths.settings_file('custom_rooms.json'),
                             app_paths.RESOURCE_DIR / 'custom_rooms.json')
