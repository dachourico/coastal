"""JSON API for the browser worker, reusing desktop business logic."""
import json
import re
import tempfile
from datetime import date
from pathlib import Path
from coastal_core import generate_clone_batches, generate_harvest
from inventory_import import parse_batch_file
from room_layout import BUILTIN_ROOMS, RoomLayout, RoomSpec, resize_table
from strain_catalog import strain_abbreviations

layout = RoomLayout()
rooms = dict(BUILTIN_ROOMS)

def state():
    return dict(room=layout.room.to_dict(), rooms=[r.to_dict() for r in rooms.values()],
                batches=[dict(id=b.id, strain=b.strain, count=b.count,
                              remaining=layout.remaining_count(b.id)) for b in layout.batches.values()],
                assignments=layout.assignments, capacity=layout.capacity,
                placed=layout.placed_total, strains=strain_abbreviations)

def dispatch(raw):
    global layout
    request = json.loads(raw)
    action = request['action']
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        if action == 'generate':
            name = request['name'].strip()
            if not name or len(name) > 100 or not re.fullmatch(r'[\w .-]+', name) or name in ('.', '..'):
                raise ValueError('Use a name with letters, numbers, spaces, dots, or hyphens (up to 100 characters)')
            source = directory / 'input.csv'
            source.write_text(request['input'], encoding='utf-8')
            day = date.fromisoformat(request['date'])
            if request['kind'] == 'clone':
                inventory = directory / 'inventory.csv'
                inventory.write_text(request['inventory'], encoding='utf-8')
                output = generate_clone_batches(name, source, inventory, day)
            else:
                output = generate_harvest(name, source, day)
            return json.dumps(dict(filename=output.name, content=output.read_text()))
        if action == 'restore':
            path = directory / 'layout.json'
            path.write_text(request['content'])
            restored = RoomLayout.load(path)
            layout = restored
            rooms[layout.room.name] = layout.room
        elif action == 'room':
            layout = RoomLayout(rooms[request['name']])
        elif action == 'add':
            layout.add_batch(request['strain'], int(request['count']))
        elif action == 'import':
            suffix = Path(request['filename']).suffix.lower()
            path = directory / ('inventory' + suffix)
            path.write_bytes(bytes(request['bytes']))
            batches = parse_batch_file(path, tuple(strain_abbreviations))
            for strain, count in batches:
                layout.add_batch(strain, count)
        elif action == 'place':
            prefix = request['prefix']
            slots = [s for s in layout.room.snake_slot_ids() if s.startswith(prefix)]
            layout.place_across(int(request['batch']), slots)
        elif action == 'clear_slot':
            layout.clear_slot(request['slot'])
        elif action == 'remove':
            layout.remove_batch(int(request['batch']))
        elif action == 'autofill':
            layout.autofill_batches()
        elif action == 'split':
            layout.suggested_split()
        elif action == 'clear_all':
            layout = RoomLayout(layout.room)
        elif action == 'clear':
            layout.clear()
        elif action == 'design':
            room = RoomSpec.from_dict(request['spec'])
            if room.capacity > 10000:
                raise ValueError('Rooms must have at most 10,000 positions')
            rooms[room.name] = room
            layout = RoomLayout(room)
        elif action == 'resize':
            room = resize_table(layout.room, int(request['level']), int(request['rack']),
                                request['label'], int(request['rows']), int(request['capacity']))
            if room.capacity > 10000:
                raise ValueError('Rooms must have at most 10,000 positions')
            valid = set(room.slot_ids())
            for slot in list(layout.assignments):
                if slot not in valid:
                    layout.clear_slot(slot)
            layout.room = room
            rooms[room.name] = room
        elif action == 'strain':
            name, abbreviation = request['name'].strip(), request['abbreviation'].strip().upper()
            if not name or not re.fullmatch(r'[A-Z0-9-]{1,12}', abbreviation):
                raise ValueError('Enter a strain and a 1–12 character abbreviation (letters, numbers, hyphens)')
            if any(s.casefold() == name.casefold() for s in strain_abbreviations):
                raise ValueError('This strain already exists')
            strain_abbreviations[name] = abbreviation
        elif action in ('save', 'export'):
            path = directory / ('layout.json' if action == 'save' else 'layout.csv')
            (layout.save if action == 'save' else layout.export_csv)(path)
            return json.dumps(dict(filename=path.name, content=path.read_text()))
    return json.dumps(state())
