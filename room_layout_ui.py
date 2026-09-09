"""GTK widgets for Coastal's room layout builder."""

from __future__ import annotations

from bisect import bisect_left
from datetime import date
from pathlib import Path

from gi.repository import Gdk, GLib, Gtk

from clone_master.strains import strain_abbreviations
from room_layout import (
    BUILTIN_ROOMS,
    FLOWER_4,
    RoomLayout,
    RoomSpec,
    TableSpec,
    add_strain_to_file,
    build_room_spec,
    load_custom_rooms,
    parse_batch_csv,
    save_custom_rooms,
    resize_table,
    slot_id,
)
from strain_colors import strain_color, strain_css_class


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
        self.layouts = {FLOWER_4.name: RoomLayout(self.rooms[FLOWER_4.name])}
        self.layout = self.layouts[FLOWER_4.name]
        self.selected_batch_id: int | None = None
        self.painting = False
        self.slot_buttons: dict[str, Gtk.Button] = {}
        self.slot_color_classes: dict[str, str] = {}
        self.strain_color_provider = Gtk.CssProvider()
        self._styled_strains: frozenset[str] = frozenset()
        self._strain_names: tuple[str, ...] = ()
        self._strain_keys: tuple[str, ...] = ()
        self._strain_positions: dict[str, int] = {}
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            self.strain_color_provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1,
        )
        self.batch_list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self._batch_controls: dict[int, tuple[Gtk.Button, Gtk.Label]] = {}
        self._rendered_batch_layout: RoomLayout | None = None
        self.capacity_label = Gtk.Label(xalign=1)
        self.capacity_label.add_css_class("heading")
        self.room_combo = Gtk.ComboBoxText()
        self.strain_entry = Gtk.Entry(placeholder_text="Type a strain name…")
        self.count = Gtk.SpinButton.new_with_range(1, 500, 1)

        self.set_margin_top(12)
        keys = Gtk.EventControllerKey()
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        keys.connect("key-pressed", self._key_pressed)
        self.add_controller(keys)
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
        GLib.idle_add(self._focus_strain_entry)

    def _toolbar(self) -> Gtk.Widget:
        bar = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        bar.add_css_class("frosted-panel")

        room_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.room_combo.set_size_request(160, -1)
        self.room_combo.connect("changed", self._room_changed)
        room_row.append(self.room_combo)
        new_room = Gtk.Button(label="Design new room…")
        new_room.set_tooltip_text("Design a new room (Ctrl+Shift+N)")
        new_room.connect("clicked", self._new_room_dialog)
        room_row.append(new_room)
        spacer = Gtk.Box(hexpand=True)
        room_row.append(spacer)
        room_row.append(self.capacity_label)
        bar.append(room_row)

        action_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, homogeneous=True)
        for label, callback, shortcut in (
            ("Open layout…", self._open_layout, "Ctrl+O"),
            ("Save layout…", self._save_layout, "Ctrl+S"),
            ("Export CSV…", self._export_csv, "Ctrl+E"),
            ("Auto-fill", self._autofill, "Ctrl+Shift+F"),
            ("Suggested split", self._suggested_split, "Ctrl+Shift+P"),
            ("Clear", self._clear_layout, None),
            ("Clear batches", self._clear_batches, None),
        ):
            button = Gtk.Button(label=label)
            if shortcut:
                button.set_tooltip_text(f"{label.rstrip('…')} ({shortcut})")
            button.connect("clicked", callback)
            button.set_valign(Gtk.Align.END)
            action_row.append(button)
        bar.append(action_row)
        return bar

    def _batch_panel(self) -> Gtk.Widget:
        panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        panel.add_css_class("frosted-panel")
        panel.set_margin_end(12)
        heading = Gtk.Label(label="Plant batches", xalign=0)
        heading.add_css_class("heading")
        panel.append(heading)
        panel.append(self.strain_entry)

        count_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        count_row.append(Gtk.Label(label="Plants", xalign=0, hexpand=True))
        self.count.set_value(1)
        count_row.append(self.count)
        panel.append(count_row)

        add = Gtk.Button(label="Add batch")
        add.set_tooltip_text("Add this strain batch (Ctrl+Enter)")
        add.add_css_class("suggested-action")
        add.connect("clicked", self._add_batch)
        panel.append(add)
        import_batches = Gtk.Button(label="Import batches from CSV…")
        import_batches.set_tooltip_text("Import strain,count rows (Ctrl+I)")
        import_batches.connect("clicked", self._import_batches)
        panel.append(import_batches)
        new_strain = Gtk.Button(label="Add new strain…")
        new_strain.set_tooltip_text("Add a strain to the strain list (Ctrl+Shift+A)")
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

    def _key_pressed(self, _controller, keyval: int, _keycode: int, state: Gdk.ModifierType) -> bool:
        modifiers = state & Gtk.accelerator_get_default_mod_mask()
        control_only = modifiers == Gdk.ModifierType.CONTROL_MASK
        control_shift = modifiers == (
            Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK
        )
        key = Gdk.keyval_to_lower(keyval)

        if control_shift and keyval in (Gdk.KEY_Return, Gdk.KEY_KP_Enter):
            self._place_selected_next()
        elif control_only and keyval in (Gdk.KEY_Return, Gdk.KEY_KP_Enter):
            self._add_batch(None)
        elif control_shift and key == Gdk.KEY_a:
            self._add_strain_dialog(None)
        elif control_shift and key == Gdk.KEY_n:
            self._new_room_dialog(None)
        elif control_shift and key == Gdk.KEY_f:
            self._autofill(None)
        elif control_shift and key == Gdk.KEY_p:
            self._suggested_split(None)
        elif control_only and key == Gdk.KEY_o:
            self._open_layout(None)
        elif control_only and key == Gdk.KEY_s:
            self._save_layout(None)
        elif control_only and key == Gdk.KEY_e:
            self._export_csv(None)
        elif control_only and key == Gdk.KEY_i:
            self._import_batches(None)
        elif keyval == Gdk.KEY_Escape and self.painting:
            self.painting = False
            self.set_status("Stopped painting plant positions", True)
        else:
            return False
        return True

    def _place_selected_next(self) -> None:
        batch_id = self.selected_batch_id
        if batch_id is None or batch_id not in self.layout.batches:
            self.set_status("Select an existing plant batch before placing it", False)
            return
        try:
            placed = self.layout.place_across(batch_id, self.layout.room.snake_slot_ids())
        except Exception as exc:
            self.set_status(str(exc), False)
            return
        self._refresh()
        remaining = self.layout.remaining_count(batch_id)
        if placed:
            self.set_status(
                f"Placed {placed} plant{'s' if placed != 1 else ''} in the next open positions; "
                f"{remaining} remaining in batch",
                True,
            )
        else:
            self.set_status("The room is full, or the selected batch is completely placed", False)

    def _room_panel(self) -> Gtk.Widget:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5, vexpand=True)
        box.add_css_class("frosted-panel")
        for level in sorted(self.layout.room.levels):
            box.append(self._level_page(level))
        return box

    def _level_page(self, level: int) -> Gtk.Widget:
        level_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, vexpand=True)
        level_title = Gtk.Label(label=f"Level {level}", xalign=0)
        level_title.add_css_class("heading")
        level_box.append(level_title)
        level_slots = self.layout.room.level_slot_ids(level)
        slot_positions = {slot: index for index, slot in enumerate(level_slots)}
        racks = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5, homogeneous=True)
        for rack in sorted(self.layout.room.levels[level]):
            rack_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, hexpand=True)
            title = Gtk.Label(label=f"Rack {rack}")
            title.add_css_class("caption")
            rack_box.append(title)
            for table in self.layout.room.tables_for(level, rack):
                rack_box.append(
                    self._table(
                        level,
                        rack,
                        table.label,
                        table.rows,
                        table.plants_per_row,
                        [table.positions_in_row(row) for row in range(1, table.rows + 1)],
                        level_slots,
                        slot_positions,
                    )
                )
            racks.append(rack_box)
        level_box.append(racks)
        return level_box

    def _table(
        self,
        level: int,
        rack: int,
        table: str,
        rows: int,
        columns: int,
        row_sizes: list[int],
        level_slots: list[str],
        slot_positions: dict[str, int],
    ) -> Gtk.Widget:
        frame = Gtk.Frame()
        body = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=2)
        body.set_margin_top(2)
        body.set_margin_bottom(2)
        body.set_margin_start(2)
        body.set_margin_end(2)

        place = Gtk.Button(
            label=table.replace("4x8 ", ""),
            tooltip_text=f"{table} — click to place a batch; right-click to change rows or capacity",
        )
        place.add_css_class("flat")
        place.add_css_class("table-label")
        first_slot = slot_id(level, rack, table, 1, 1)
        start = slot_positions[first_slot]
        placement_slots = level_slots[start:] + level_slots[:start]
        place.connect("clicked", lambda _button, slots=placement_slots: self._place_selected(slots))
        context_click = Gtk.GestureClick(button=3)
        context_click.connect(
            "pressed",
            lambda _gesture, _count, _x, _y, l=level, r=rack, name=table: self._edit_table_dialog(l, r, name),
        )
        body.append(place)

        grid = Gtk.Grid(row_spacing=1, column_spacing=1, column_homogeneous=True, hexpand=True)
        for row in range(1, rows + 1):
            for position in range(1, row_sizes[row - 1] + 1):
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
        frame.add_controller(context_click)

        target = Gtk.DropTarget.new(str, Gdk.DragAction.COPY)
        target.connect("drop", lambda _target, value, _x, _y, slots=placement_slots: self._drop(value, slots))
        frame.add_controller(target)
        return frame

    def _edit_table_dialog(self, level: int, rack: int, table_label: str) -> None:
        table = next(table for table in self.layout.room.tables_for(level, rack) if table.label == table_label)
        dialog = Gtk.Dialog(title=f"Edit {table_label}", transient_for=self.parent, modal=True)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Apply", Gtk.ResponseType.ACCEPT)
        content = dialog.get_content_area()
        content.set_spacing(10)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        content.set_margin_start(16)
        content.set_margin_end(16)
        content.append(Gtk.Label(
            label=f"Level {level} · Rack {rack}\nSet the total plant positions and how many rows to display.",
            xalign=0,
        ))
        capacity = Gtk.SpinButton.new_with_range(1, 500, 1)
        capacity.set_value(table.capacity)
        rows = Gtk.SpinButton.new_with_range(1, 50, 1)
        rows.set_value(table.rows)
        for label, control in (("Total plants", capacity), ("Rows", rows)):
            line = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
            line.append(Gtk.Label(label=label, xalign=0, hexpand=True))
            line.append(control)
            content.append(line)
        dialog.connect("response", self._edit_table_response, level, rack, table_label, rows, capacity)
        dialog.present()

    def _edit_table_response(self, dialog, response, level, rack, label, rows, capacity) -> None:
        if response == Gtk.ResponseType.ACCEPT:
            try:
                rows.update()
                capacity.update()
                room = resize_table(
                    self.layout.room, level, rack, label,
                    rows.get_value_as_int(), capacity.get_value_as_int(),
                )
                valid_slots = set(room.slot_ids())
                removed = [slot for slot in self.layout.assignments if slot not in valid_slots]
                for slot in removed:
                    self.layout.clear_slot(slot)
                self.layout.room = room
                self.rooms[room.name] = room
                # Store overrides for built-in rooms too, so table sizing survives restarts.
                self.custom_rooms[room.name] = room
                save_custom_rooms(CUSTOM_ROOMS_FILE, self.custom_rooms)
                self.slot_buttons.clear()
                self.content.set_end_child(self._room_panel())
                self._refresh()
                suffix = f"; returned {len(removed)} placed plants to their batches" if removed else ""
                self.set_status(f"Updated {label} to {capacity.get_value_as_int()} positions{suffix}", True)
            except Exception as exc:
                self.set_status(f"Could not resize table: {exc}", False)
                return
        dialog.destroy()

    def _reload_strains(self, selected: str | None = None) -> None:
        names = sorted(strain_abbreviations, key=str.casefold)
        self._strain_names = tuple(names)
        self._strain_keys = tuple(name.casefold() for name in names)
        self._strain_positions = {name.casefold(): index for index, name in enumerate(names)}
        completion = Gtk.EntryCompletion()
        model = Gtk.ListStore(str)
        for name in names:
            model.append([name])
        completion.set_model(model)
        completion.set_text_column(0)
        completion.set_inline_completion(True)
        completion.set_popup_completion(True)
        completion.set_popup_set_width(True)
        self.strain_entry.set_completion(completion)
        selected_position = self._strain_positions.get(selected.casefold()) if selected else None
        if selected_position is not None:
            self.strain_entry.set_text(self._strain_names[selected_position])
        else:
            self.strain_entry.set_text("")

    def _focus_strain_entry(self) -> bool:
        self.strain_entry.grab_focus()
        self.strain_entry.set_position(-1)
        return False

    def _reload_rooms(self, selected: str) -> None:
        self.room_combo.remove_all()
        names = sorted(self.rooms, key=str.casefold)
        positions = {name: index for index, name in enumerate(names)}
        for name in names:
            self.room_combo.append_text(name)
        if selected in positions:
            self.room_combo.set_active(positions[selected])

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
            typed = self.strain_entry.get_text().strip()
            typed_key = typed.casefold()
            position = bisect_left(self._strain_keys, typed_key)
            exact = (
                self._strain_names[position]
                if position < len(self._strain_keys) and self._strain_keys[position] == typed_key
                else None
            )
            prefix = (
                position < len(self._strain_keys)
                and self._strain_keys[position].startswith(typed_key)
            )
            another_prefix = (
                position + 1 < len(self._strain_keys)
                and self._strain_keys[position + 1].startswith(typed_key)
            )
            strain = exact or (self._strain_names[position] if prefix and not another_prefix else "")
            if not strain and prefix:
                raise ValueError("Keep typing or choose a strain from the suggestions")
            self.count.update()
            batch = self.layout.add_batch(strain, self.count.get_value_as_int())
        except Exception as exc:
            self.set_status(str(exc), False)
            return
        self.selected_batch_id = batch.id
        self.count.set_value(1)
        self.strain_entry.set_text("")
        self._focus_strain_entry()
        self._refresh()
        self.set_status(f"Added batch {batch.id}: {batch.count} {batch.strain}", True)

    def _batch_row(self, batch_id: int) -> tuple[Gtk.Widget, Gtk.Button, Gtk.Label]:
        batch = self.layout.batches[batch_id]
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        row.add_css_class("card")
        row.set_margin_top(2)
        row.set_margin_bottom(2)
        row.set_margin_start(2)
        row.set_margin_end(2)
        swatch = Gtk.Label(label="●", tooltip_text=f"Color for {batch.strain}")
        swatch.add_css_class("strain-swatch")
        swatch.add_css_class(strain_css_class(batch.strain))
        row.append(swatch)
        select = Gtk.Button(
            hexpand=True,
            tooltip_text="Select this batch; Ctrl+Shift+Enter places it in the next open positions",
        )
        select_label = Gtk.Label(
            xalign=0,
            wrap=True,
        )
        select.set_child(select_label)
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
        return row, select, select_label

    def _refresh_batch_rows(self) -> None:
        batch_ids = tuple(self.layout.batches)
        if self._rendered_batch_layout is not self.layout or tuple(self._batch_controls) != batch_ids:
            while child := self.batch_list.get_first_child():
                self.batch_list.remove(child)
            self._batch_controls.clear()
            for batch_id in batch_ids:
                row, select, label = self._batch_row(batch_id)
                self._batch_controls[batch_id] = (select, label)
                self.batch_list.append(row)
            self._rendered_batch_layout = self.layout

        for batch_id, (select, label) in self._batch_controls.items():
            batch = self.layout.batches[batch_id]
            label.set_text(
                f"#{batch.id}  {batch.strain}\n{self.layout.placed_count(batch_id)}/{batch.count}"
            )
            if batch_id == self.selected_batch_id:
                select.add_css_class("suggested-action")
            else:
                select.remove_css_class("suggested-action")

    def _refresh(self) -> None:
        self._refresh_strain_colors()
        placed = self.layout.placed_total
        remaining = self.layout.capacity - placed
        self.capacity_label.set_text(f"{placed}/{self.layout.capacity} ({remaining} remaining)")
        self._refresh_batch_rows()

        for slot, button in self.slot_buttons.items():
            if old_class := self.slot_color_classes.pop(slot, None):
                button.remove_css_class(old_class)
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
                color_class = strain_css_class(batch.strain)
                button.add_css_class(color_class)
                self.slot_color_classes[slot] = color_class

    def _refresh_strain_colors(self) -> None:
        strains = set(strain_abbreviations)
        strains.update(batch.strain for layout in self.layouts.values() for batch in layout.batches.values())
        strain_set = frozenset(strains)
        if strain_set == self._styled_strains:
            return
        rules = []
        for strain in sorted(strains, key=str.casefold):
            css_class = strain_css_class(strain)
            background, foreground = strain_color(strain)
            rules.append(
                f"button.plant-slot.{css_class} {{ "
                f"background: {background}; color: {foreground}; border-color: {background}; }}\n"
                f"label.strain-swatch.{css_class} {{ color: {background}; font-size: 18px; }}"
            )
        self.strain_color_provider.load_from_string("\n".join(rules))
        self._styled_strains = strain_set

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
        self._refresh()
        self.set_status("Room layout cleared; plant batches were kept", True)

    def _clear_batches(self, _button) -> None:
        self.painting = False
        self.layout.clear_batches()
        self.selected_batch_id = None
        self._refresh()
        self.set_status("Plant batches and room layout cleared", True)

    def _autofill(self, _button) -> None:
        placed = self.layout.autofill_batches()
        self._refresh()
        remaining = sum(self.layout.remaining_count(batch_id) for batch_id in self.layout.batches)
        if placed:
            self.set_status(
                f"Auto-filled {placed} plant{'s' if placed != 1 else ''}; "
                f"{remaining} left unplaced",
                True,
            )
        elif not self.layout.batches:
            self.set_status("Add at least one plant batch before auto-filling", False)
        else:
            self.set_status("No complete rack-level section can be filled by the remaining batches", False)

    def _suggested_split(self, _button) -> None:
        placed = self.layout.suggested_split()
        self._refresh()
        remaining = sum(self.layout.remaining_count(batch_id) for batch_id in self.layout.batches)
        if placed:
            self.set_status(
                f"Placed a proportional mix of {placed} plant{'s' if placed != 1 else ''}; "
                f"{remaining} left unplaced",
                True,
            )
        elif not self.layout.batches:
            self.set_status("Add at least one plant batch before creating a suggested split", False)
        else:
            self.set_status(
                "No proportional allocation can fill a complete rack-level section "
                "without splitting a batch between levels",
                False,
            )

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

    def _import_batches(self, _button) -> None:
        self._chooser(
            "Import plant batches",
            Gtk.FileChooserAction.OPEN,
            "csv",
            self._import_batches_chosen,
        )

    def _import_batches_chosen(self, chooser, response) -> None:
        if response == Gtk.ResponseType.ACCEPT and (selected := chooser.get_file()) and selected.get_path():
            try:
                batches = parse_batch_csv(Path(selected.get_path()), tuple(strain_abbreviations))
                added = [self.layout.add_batch(strain, count) for strain, count in batches]
                self.selected_batch_id = added[-1].id
                self._refresh()
                self.strain_entry.set_text("")
                self._focus_strain_entry()
                total = sum(batch.count for batch in added)
                self.set_status(
                    f"Imported {len(added)} batch{'es' if len(added) != 1 else ''} "
                    f"containing {total} plants",
                    True,
                )
            except Exception as exc:
                self.set_status(f"Could not import batches: {exc}", False)
        chooser.destroy()

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
        dialog.set_default_size(900, 620)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Create room", Gtk.ResponseType.ACCEPT)
        content = dialog.get_content_area()
        content.set_spacing(10)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        content.set_margin_start(16)
        content.set_margin_end(16)

        title = Gtk.Label(label="Build the room as it appears in the planner", xalign=0)
        title.add_css_class("heading")
        content.append(title)
        name = Gtk.Entry(placeholder_text="Room name (for example Flower 2)")
        content.append(name)
        help_text = Gtk.Label(
            label="Add levels, racks, and tables below. Each table shows its name, number of rows, "
                  "and total plant positions. Plant positions are distributed evenly across its rows.",
            xalign=0,
            wrap=True,
        )
        help_text.add_css_class("dim-label")
        content.append(help_text)
        levels_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        scroller = Gtk.ScrolledWindow(vexpand=True)
        scroller.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        scroller.set_child(levels_box)
        content.append(scroller)

        levels: list[dict] = []

        def add_table(rack_state, table_name="4x8", rows_value=2, capacity_value=10):
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5)
            card.add_css_class("card")
            card.set_margin_top(3)
            card.set_margin_bottom(3)
            card.set_margin_start(3)
            card.set_margin_end(3)
            heading = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5)
            label = Gtk.Entry(text=table_name, hexpand=True, placeholder_text="Table name")
            heading.append(label)
            remove = Gtk.Button(icon_name="user-trash-symbolic", tooltip_text="Remove table")
            heading.append(remove)
            card.append(heading)
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
            rows = Gtk.SpinButton.new_with_range(1, 50, 1)
            rows.set_value(rows_value)
            capacity = Gtk.SpinButton.new_with_range(1, 500, 1)
            capacity.set_value(capacity_value)
            row.append(Gtk.Label(label="Rows"))
            row.append(rows)
            row.append(Gtk.Label(label="Total plants"))
            row.append(capacity)
            card.append(row)
            state = {"card": card, "label": label, "rows": rows, "capacity": capacity}
            rack_state["tables"].append(state)
            rack_state["tables_box"].append(card)
            remove.connect("clicked", lambda _b: (
                rack_state["tables"].remove(state), rack_state["tables_box"].remove(card)
            ))

        def add_rack(level_state):
            rack_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
            rack_card.add_css_class("frosted-panel")
            rack_card.set_size_request(240, -1)
            header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5)
            rack_title = Gtk.Label(hexpand=True, xalign=0)
            header.append(rack_title)
            remove = Gtk.Button(icon_name="user-trash-symbolic", tooltip_text="Remove rack")
            header.append(remove)
            rack_card.append(header)
            tables_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
            rack_card.append(tables_box)
            add = Gtk.Button(label="+ Add table")
            rack_card.append(add)
            rack_state = {"card": rack_card, "title": rack_title, "tables_box": tables_box, "tables": []}
            level_state["racks"].append(rack_state)
            level_state["racks_box"].append(rack_card)

            def renumber():
                for index, item in enumerate(level_state["racks"], 1):
                    item["title"].set_text(f"Rack {index}")

            def remove_rack(_button):
                level_state["racks"].remove(rack_state)
                level_state["racks_box"].remove(rack_card)
                renumber()

            remove.connect("clicked", remove_rack)
            add.connect("clicked", lambda _b: add_table(rack_state, f"4x8 {chr(65 + len(rack_state['tables']))}"))
            add_table(rack_state, "4x8 A")
            renumber()

        def add_level(_button=None):
            level_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
            level_card.add_css_class("card")
            header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            level_title = Gtk.Label(hexpand=True, xalign=0)
            level_title.add_css_class("heading")
            header.append(level_title)
            add = Gtk.Button(label="+ Add rack")
            header.append(add)
            remove = Gtk.Button(icon_name="user-trash-symbolic", tooltip_text="Remove level")
            header.append(remove)
            level_card.append(header)
            racks_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            level_card.append(racks_box)
            state = {"card": level_card, "title": level_title, "racks_box": racks_box, "racks": []}
            levels.append(state)
            levels_box.append(level_card)

            def renumber_levels():
                for index, item in enumerate(levels, 1):
                    item["title"].set_text(f"Level {index}")

            def remove_level(_button):
                levels.remove(state)
                levels_box.remove(level_card)
                renumber_levels()

            add.connect("clicked", lambda _b: add_rack(state))
            remove.connect("clicked", remove_level)
            add_rack(state)
            renumber_levels()

        add_level_button = Gtk.Button(label="+ Add level")
        add_level_button.connect("clicked", add_level)
        content.append(add_level_button)
        add_level()
        dialog.connect("response", self._new_room_response, name, levels)
        dialog.present()

    def _new_room_response(self, dialog, response, name_entry, levels) -> None:
        if response == Gtk.ResponseType.ACCEPT:
            try:
                room_name = name_entry.get_text().strip()
                if not room_name:
                    raise ValueError("Room name is required")
                if not levels:
                    raise ValueError("Add at least one level")
                room_levels = {}
                for level_number, level in enumerate(levels, 1):
                    if not level["racks"]:
                        raise ValueError(f"Level {level_number} needs at least one rack")
                    room_levels[level_number] = {}
                    for rack_number, rack in enumerate(level["racks"], 1):
                        if not rack["tables"]:
                            raise ValueError(f"Level {level_number}, rack {rack_number} needs a table")
                        tables = []
                        used_labels = set()
                        for table in rack["tables"]:
                            label = table["label"].get_text().strip()
                            table["rows"].update()
                            table["capacity"].update()
                            if not label:
                                raise ValueError("Every table needs a name")
                            if label.casefold() in used_labels:
                                raise ValueError(f"Table names must be unique within rack {rack_number}")
                            used_labels.add(label.casefold())
                            rows = table["rows"].get_value_as_int()
                            capacity = table["capacity"].get_value_as_int()
                            columns = max(1, (capacity + rows - 1) // rows)
                            tables.append(TableSpec(label, rows, columns, capacity))
                        room_levels[level_number][rack_number] = tuple(tables)
                room = RoomSpec(room_name, room_levels)
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
