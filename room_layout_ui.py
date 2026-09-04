"""GTK widgets for Coastal's room layout builder."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from gi.repository import Gdk, Gtk

from clone_master.strains import strain_abbreviations
from room_layout import (
    BUILTIN_ROOMS,
    FLOWER_4,
    RoomLayout,
    RoomSpec,
    add_strain_to_file,
    build_room_spec,
    load_custom_rooms,
    save_custom_rooms,
    slot_id,
)


STRAINS_FILE = Path(__file__).parent / "clone_master" / "strains.py"
CUSTOM_ROOMS_FILE = Path(__file__).parent / "custom_rooms.json"


class RoomLayoutPage(Gtk.Box):
    def __init__(self, parent: Gtk.Window, set_status):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.parent = parent
        self.set_status = set_status
        try:
            self.custom_rooms = load_custom_rooms(CUSTOM_ROOMS_FILE)
        except Exception as exc:
            self.custom_rooms = {}
            set_status(f"Could not load custom rooms: {exc}", False)
        self.rooms = {**BUILTIN_ROOMS, **self.custom_rooms}
        self.layouts = {FLOWER_4.name: RoomLayout(FLOWER_4)}
        self.layout = self.layouts[FLOWER_4.name]
        self.selected_batch_id: int | None = None
        self.painting = False
        self.slot_buttons: dict[str, Gtk.Button] = {}
        self.batch_list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.capacity_label = Gtk.Label(xalign=1)
        self.capacity_label.add_css_class("heading")
        self.room_combo = Gtk.ComboBoxText()
        self.strain_combo = Gtk.ComboBoxText.new_with_entry()
        self.count = Gtk.SpinButton.new_with_range(1, 500, 1)

        self.set_margin_top(12)
        self.append(self._toolbar())

        self.content = Gtk.Paned(orientation=Gtk.Orientation.HORIZONTAL, wide_handle=True)
        self.content.set_position(310)
        self.content.set_vexpand(True)
        self.content.set_resize_start_child(False)
        self.content.set_shrink_start_child(False)
        self.content.set_start_child(self._batch_panel())
        self.content.set_end_child(self._room_panel())
        self.append(self.content)
        self._reload_rooms(FLOWER_4.name)
        self._reload_strains()
        self._refresh()

    def _toolbar(self) -> Gtk.Widget:
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.room_combo.set_size_request(160, -1)
        self.room_combo.connect("changed", self._room_changed)
        bar.append(self.room_combo)
        new_room = Gtk.Button(label="Design new room…")
        new_room.connect("clicked", self._new_room_dialog)
        bar.append(new_room)
        spacer = Gtk.Box(hexpand=True)
        bar.append(spacer)
        bar.append(self.capacity_label)
        for label, callback in (
            ("Open layout…", self._open_layout),
            ("Save layout…", self._save_layout),
            ("Export CSV…", self._export_csv),
            ("Clear", self._clear_layout),
        ):
            button = Gtk.Button(label=label)
            button.connect("clicked", callback)
            bar.append(button)
        return bar

    def _batch_panel(self) -> Gtk.Widget:
        panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        panel.set_margin_end(12)
        heading = Gtk.Label(label="Plant batches", xalign=0)
        heading.add_css_class("heading")
        panel.append(heading)
        panel.append(self.strain_combo)

        count_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        count_row.append(Gtk.Label(label="Plants", xalign=0, hexpand=True))
        self.count.set_value(1)
        count_row.append(self.count)
        panel.append(count_row)

        add = Gtk.Button(label="Add batch")
        add.add_css_class("suggested-action")
        add.connect("clicked", self._add_batch)
        panel.append(add)
        new_strain = Gtk.Button(label="Add new strain…")
        new_strain.connect("clicked", self._add_strain_dialog)
        panel.append(new_strain)

        instruction = Gtk.Label(
            label="Drag a batch onto its starting table. Plants fill down that rack, then across "
                  "the level. Or select a batch, hold the mouse on a plant position, and paint "
                  "across the exact positions you want.",
            xalign=0,
            wrap=True,
        )
        instruction.add_css_class("dim-label")
        panel.append(instruction)

        scroller = Gtk.ScrolledWindow(vexpand=True)
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroller.set_child(self.batch_list)
        panel.append(scroller)
        return panel

    def _room_panel(self) -> Gtk.Widget:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5, vexpand=True)
        for level in sorted(self.layout.room.levels):
            box.append(self._level_page(level))
        return box

    def _level_page(self, level: int) -> Gtk.Widget:
        level_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, vexpand=True)
        level_title = Gtk.Label(label=f"Level {level}", xalign=0)
        level_title.add_css_class("heading")
        level_box.append(level_title)
        racks = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5, homogeneous=True)
        for rack in sorted(self.layout.room.levels[level]):
            rack_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, hexpand=True)
            title = Gtk.Label(label=f"Rack {rack}")
            title.add_css_class("caption")
            rack_box.append(title)
            for table in self.layout.room.tables_for(level, rack):
                rack_box.append(self._table(level, rack, table.label, table.rows, table.plants_per_row))
            racks.append(rack_box)
        level_box.append(racks)
        return level_box

    def _table(self, level: int, rack: int, table: str, rows: int, columns: int) -> Gtk.Widget:
        frame = Gtk.Frame()
        body = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=2)
        body.set_margin_top(2)
        body.set_margin_bottom(2)
        body.set_margin_start(2)
        body.set_margin_end(2)

        place = Gtk.Button(
            label=table.replace("4x8 ", ""),
            tooltip_text=f"{table} — start selected batch here and fill across this level",
        )
        place.add_css_class("flat")
        place.add_css_class("table-label")
        table_slot_ids = [
            slot_id(level, rack, table, row, position)
            for row in range(1, rows + 1)
            for position in range(1, columns + 1)
        ]
        placement_slots = self.layout.room.level_slots_from(level, table_slot_ids[0])
        place.connect("clicked", lambda _button, slots=placement_slots: self._place_selected(slots))
        body.append(place)

        grid = Gtk.Grid(row_spacing=1, column_spacing=1, column_homogeneous=True, hexpand=True)
        for row in range(1, rows + 1):
            for position in range(1, columns + 1):
                key = slot_id(level, rack, table, row, position)
                button = Gtk.Button(label="·", width_request=20, height_request=20)
                button.set_tooltip_text(f"Row {row}, position {position} — empty")
                button.add_css_class("plant-slot")
                click = Gtk.GestureClick(button=1)
                click.connect("pressed", lambda _gesture, _count, _x, _y, slot=key: self._paint_start(slot))
                click.connect("released", lambda *_args: self._paint_end())
                button.add_controller(click)
                motion = Gtk.EventControllerMotion()
                motion.connect("enter", lambda controller, _x, _y, slot=key: self._paint_enter(controller, slot))
                button.add_controller(motion)
                self.slot_buttons[key] = button
                grid.attach(button, position - 1, row - 1, 1, 1)
        body.append(grid)
        frame.set_child(body)

        target = Gtk.DropTarget.new(str, Gdk.DragAction.COPY)
        target.connect("drop", lambda _target, value, _x, _y, slots=placement_slots: self._drop(value, slots))
        frame.add_controller(target)
        return frame

    def _reload_strains(self, selected: str | None = None) -> None:
        self.strain_combo.remove_all()
        names = sorted(strain_abbreviations, key=str.casefold)
        for name in names:
            self.strain_combo.append_text(name)
        entry = self.strain_combo.get_child()
        completion = Gtk.EntryCompletion()
        model = Gtk.ListStore(str)
        for name in names:
            model.append([name])
        completion.set_model(model)
        completion.set_text_column(0)
        completion.set_inline_completion(True)
        completion.set_popup_completion(True)
        completion.set_popup_set_width(True)
        entry.set_completion(completion)
        entry.set_placeholder_text("Type a strain name…")
        if selected in names:
            self.strain_combo.set_active(names.index(selected))
        elif names:
            self.strain_combo.set_active(0)

    def _reload_rooms(self, selected: str) -> None:
        self.room_combo.remove_all()
        names = sorted(self.rooms, key=str.casefold)
        for name in names:
            self.room_combo.append_text(name)
        if selected in names:
            self.room_combo.set_active(names.index(selected))

    def _room_changed(self, combo) -> None:
        name = combo.get_active_text()
        if not name or name not in self.rooms or not hasattr(self, "content"):
            return
        self.painting = False
        self.selected_batch_id = None
        self.layout = self.layouts.setdefault(name, RoomLayout(self.rooms[name]))
        self.slot_buttons.clear()
        self.content.set_end_child(self._room_panel())
        self._refresh()
        self.set_status(f"Showing {name}: {self.layout.capacity} plant positions", True)

    def _add_batch(self, _button) -> None:
        try:
            typed = self.strain_combo.get_child().get_text().strip()
            exact = next((name for name in strain_abbreviations if name.casefold() == typed.casefold()), None)
            matches = [name for name in strain_abbreviations if name.casefold().startswith(typed.casefold())]
            strain = exact or (matches[0] if len(matches) == 1 else "")
            if not strain and matches:
                raise ValueError("Keep typing or choose a strain from the suggestions")
            batch = self.layout.add_batch(strain, self.count.get_value_as_int())
        except Exception as exc:
            self.set_status(str(exc), False)
            return
        self.selected_batch_id = batch.id
        self.count.set_value(1)
        self._refresh()
        self.set_status(f"Added batch {batch.id}: {batch.count} {batch.strain}", True)

    def _batch_row(self, batch_id: int) -> Gtk.Widget:
        batch = self.layout.batches[batch_id]
        placed = self.layout.placed_count(batch_id)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        row.add_css_class("card")
        row.set_margin_top(2)
        row.set_margin_bottom(2)
        row.set_margin_start(2)
        row.set_margin_end(2)
        select = Gtk.Button(
            label=f"#{batch.id}  {batch.strain}\n{placed}/{batch.count}",
            hexpand=True,
        )
        if batch_id == self.selected_batch_id:
            select.add_css_class("suggested-action")
        select.connect("clicked", lambda _button, value=batch_id: self._select_batch(value))
        drag = Gtk.DragSource(actions=Gdk.DragAction.COPY)
        drag.connect(
            "prepare",
            lambda _source, _x, _y, value=batch_id: Gdk.ContentProvider.new_for_value(str(value)),
        )
        select.add_controller(drag)
        row.append(select)
        remove = Gtk.Button(icon_name="user-trash-symbolic", tooltip_text="Remove batch and its placements")
        remove.connect("clicked", lambda _button, value=batch_id: self._remove_batch(value))
        row.append(remove)
        return row

    def _refresh(self) -> None:
        placed = self.layout.placed_total
        remaining = self.layout.capacity - placed
        self.capacity_label.set_text(f"{placed}/{self.layout.capacity} ({remaining} remaining)")
        while child := self.batch_list.get_first_child():
            self.batch_list.remove(child)
        for batch_id in self.layout.batches:
            self.batch_list.append(self._batch_row(batch_id))

        for slot, button in self.slot_buttons.items():
            batch_id = self.layout.assignments.get(slot)
            if batch_id is None:
                button.set_label("·")
                button.set_tooltip_text(f"{slot} — empty")
                button.remove_css_class("occupied")
            else:
                batch = self.layout.batches[batch_id]
                abbreviation = strain_abbreviations.get(batch.strain, batch.strain[:4]).upper()
                button.set_label(abbreviation[:3])
                button.set_tooltip_text(f"{slot} — {batch.strain} (batch {batch_id}); click to remove")
                button.add_css_class("occupied")

    def _select_batch(self, batch_id: int) -> None:
        self.selected_batch_id = batch_id
        self._refresh()
        self.set_status(
            "Batch selected. Drag it onto a table, click a table label, or paint individual positions.",
            True,
        )

    def _paint_start(self, slot: str) -> None:
        if slot in self.layout.assignments:
            self.layout.clear_slot(slot)
            self.painting = False
            self._refresh()
            self.set_status("Plant returned to its batch", True)
            return
        if self.selected_batch_id is None or self.selected_batch_id not in self.layout.batches:
            self.painting = False
            self.set_status("Select a plant batch before painting positions", False)
            return
        self.painting = True
        self._paint_slot(slot)

    def _paint_enter(self, controller: Gtk.EventControllerMotion, slot: str) -> None:
        button_down = controller.get_current_event_state() & Gdk.ModifierType.BUTTON1_MASK
        if self.painting and button_down:
            self._paint_slot(slot)
        elif self.painting:
            self.painting = False

    def _paint_end(self) -> None:
        self.painting = False

    def _paint_slot(self, slot: str) -> None:
        batch_id = self.selected_batch_id
        if batch_id is None or batch_id not in self.layout.batches:
            self.painting = False
            return
        if slot in self.layout.assignments:
            return
        placed = self.layout.place_across(batch_id, [slot])
        if not placed:
            self.painting = False
            self.set_status("The selected batch is completely placed", True)
            return
        remaining = self.layout.remaining_count(batch_id)
        self._refresh()
        self.set_status(f"Painted 1 plant; {remaining} remaining in batch", True)
        if remaining == 0:
            self.painting = False

    def _place_selected(self, slots: list[str]) -> None:
        if self.selected_batch_id is None or self.selected_batch_id not in self.layout.batches:
            self.set_status("Select or drag a plant batch first", False)
            return
        self._place(self.selected_batch_id, slots)

    def _drop(self, value: str, slots: list[str]) -> bool:
        try:
            batch_id = int(value)
        except (TypeError, ValueError):
            return False
        self.selected_batch_id = batch_id
        self._place(batch_id, slots)
        return True

    def _place(self, batch_id: int, slots: list[str]) -> None:
        try:
            placed = self.layout.place_across(batch_id, slots)
        except Exception as exc:
            self.set_status(str(exc), False)
            return
        self._refresh()
        if placed:
            remaining = self.layout.remaining_count(batch_id)
            self.set_status(
                f"Placed {placed} plant{'s' if placed != 1 else ''} across this level; "
                f"{remaining} remaining in batch",
                True,
            )
        else:
            self.set_status("This level is full, or the selected batch is completely placed", False)

    def _clear_slot(self, slot: str) -> None:
        if slot in self.layout.assignments:
            self.layout.clear_slot(slot)
            self._refresh()
            self.set_status("Plant returned to its batch", True)

    def _remove_batch(self, batch_id: int) -> None:
        self.painting = False
        self.layout.remove_batch(batch_id)
        if self.selected_batch_id == batch_id:
            self.selected_batch_id = None
        self._refresh()
        self.set_status("Batch and its placements removed", True)

    def _clear_layout(self, _button) -> None:
        self.painting = False
        self.layout.clear()
        self.selected_batch_id = None
        self._refresh()
        self.set_status("Layout cleared", True)

    def _chooser(self, title: str, action: Gtk.FileChooserAction, suffix: str, callback) -> None:
        chooser = Gtk.FileChooserNative(
            title=title,
            transient_for=self.parent,
            action=action,
            accept_label="Open" if action == Gtk.FileChooserAction.OPEN else "Save",
            cancel_label="Cancel",
        )
        file_filter = Gtk.FileFilter()
        file_filter.set_name(f"{suffix.upper()} files")
        file_filter.add_pattern(f"*.{suffix}")
        chooser.add_filter(file_filter)
        if action == Gtk.FileChooserAction.SAVE:
            room_name = self.layout.room.name.replace(" ", "_")
            chooser.set_current_name(f"{room_name}_layout_{date.today().isoformat()}.{suffix}")
        chooser.connect("response", callback)
        chooser.show()

    def _save_layout(self, _button) -> None:
        self._chooser(f"Save {self.layout.room.name} layout", Gtk.FileChooserAction.SAVE, "json", self._save_chosen)

    def _save_chosen(self, chooser, response) -> None:
        if response == Gtk.ResponseType.ACCEPT and (selected := chooser.get_file()) and selected.get_path():
            try:
                path = self.layout.save(Path(selected.get_path()))
                self.set_status(f"Saved {path}", True)
            except Exception as exc:
                self.set_status(f"Could not save layout: {exc}", False)
        chooser.destroy()

    def _open_layout(self, _button) -> None:
        self._chooser("Open room layout", Gtk.FileChooserAction.OPEN, "json", self._open_chosen)

    def _open_chosen(self, chooser, response) -> None:
        if response == Gtk.ResponseType.ACCEPT and (selected := chooser.get_file()) and selected.get_path():
            try:
                loaded = RoomLayout.load(Path(selected.get_path()))
                self.rooms[loaded.room.name] = loaded.room
                self.layouts[loaded.room.name] = loaded
                self.layout = loaded
                self.selected_batch_id = None
                self._reload_rooms(loaded.room.name)
                self.slot_buttons.clear()
                self.content.set_end_child(self._room_panel())
                self._refresh()
                self.set_status(f"Opened {selected.get_path()}", True)
            except Exception as exc:
                self.set_status(f"Could not open layout: {exc}", False)
        chooser.destroy()

    def _new_room_dialog(self, _button) -> None:
        dialog = Gtk.Dialog(title="Design a new room", transient_for=self.parent, modal=True)
        dialog.set_default_size(680, 480)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Create room", Gtk.ResponseType.ACCEPT)
        content = dialog.get_content_area()
        content.set_spacing(10)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        content.set_margin_start(16)
        content.set_margin_end(16)

        name = Gtk.Entry(placeholder_text="Room name (for example Flower 2)")
        content.append(name)
        help_text = Gtk.Label(
            label="Add one line per table configuration:\n"
                  "Level | Racks | Table size | Number of tables | Rows per table | Plants per row\n\n"
                  "Rack groups can be written as 1-3,6. Different rack layouts use separate lines.",
            xalign=0,
            wrap=True,
        )
        help_text.add_css_class("dim-label")
        content.append(help_text)
        editor = Gtk.TextView(monospace=True, vexpand=True)
        editor.get_buffer().set_text(
            "1 | 1-6 | 4x8 | 2 | 2 | 5\n"
            "2 | 1-6 | 4x8 | 2 | 2 | 4"
        )
        scroller = Gtk.ScrolledWindow(vexpand=True)
        scroller.set_child(editor)
        content.append(scroller)
        dialog.connect("response", self._new_room_response, name, editor)
        dialog.present()

    def _new_room_response(self, dialog, response, name_entry, editor) -> None:
        if response == Gtk.ResponseType.ACCEPT:
            buffer = editor.get_buffer()
            start, end = buffer.get_bounds()
            try:
                room = build_room_spec(name_entry.get_text(), buffer.get_text(start, end, True))
                if any(room.name.casefold() == name.casefold() for name in self.rooms):
                    raise ValueError(f"A room named {room.name} already exists")
                self.custom_rooms[room.name] = room
                save_custom_rooms(CUSTOM_ROOMS_FILE, self.custom_rooms)
                self.rooms[room.name] = room
                self.layouts[room.name] = RoomLayout(room)
                self._reload_rooms(room.name)
                self.set_status(
                    f"Created {room.name}: {len(room.levels)} levels, "
                    f"{room.capacity} plant positions",
                    True,
                )
            except Exception as exc:
                self.set_status(f"Could not create room: {exc}", False)
                return
        dialog.destroy()

    def _export_csv(self, _button) -> None:
        self._chooser("Export staff layout", Gtk.FileChooserAction.SAVE, "csv", self._export_chosen)

    def _export_chosen(self, chooser, response) -> None:
        if response == Gtk.ResponseType.ACCEPT and (selected := chooser.get_file()) and selected.get_path():
            try:
                path = self.layout.export_csv(Path(selected.get_path()))
                self.set_status(f"Exported {path}", True)
            except Exception as exc:
                self.set_status(f"Could not export layout: {exc}", False)
        chooser.destroy()

    def _add_strain_dialog(self, _button) -> None:
        dialog = Gtk.Dialog(title="Add a strain", transient_for=self.parent, modal=True)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Add strain", Gtk.ResponseType.ACCEPT)
        content = dialog.get_content_area()
        content.set_spacing(8)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        content.set_margin_start(16)
        content.set_margin_end(16)
        name = Gtk.Entry(placeholder_text="Strain name")
        abbreviation = Gtk.Entry(placeholder_text="Abbreviation (for example WC)")
        content.append(name)
        content.append(abbreviation)
        dialog.connect("response", self._strain_response, name, abbreviation)
        dialog.present()

    def _strain_response(self, dialog, response, name, abbreviation) -> None:
        if response == Gtk.ResponseType.ACCEPT:
            try:
                strain = name.get_text().strip()
                short = abbreviation.get_text().strip().upper()
                add_strain_to_file(STRAINS_FILE, strain, short)
                strain_abbreviations[strain] = short
                self._reload_strains(strain)
                self.set_status(f"Added {strain} ({short}) to clone_master/strains.py", True)
            except Exception as exc:
                self.set_status(f"Could not add strain: {exc}", False)
                return
        dialog.destroy()
