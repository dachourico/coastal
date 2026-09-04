#!/usr/bin/env python
"""GTK 4 desktop interface for Coastal's METRC CSV helpers."""

import subprocess
import sys
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gio, Gtk  # noqa: E402

from coastal_core import generate_clone_batches, generate_harvest


class FileRow(Gtk.Box):
    def __init__(self, label: str, parent: Gtk.Window):
        super().__init__(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        self.parent = parent
        self.entry = Gtk.Entry(hexpand=True, placeholder_text=label)
        button = Gtk.Button(label="Browse…")
        button.connect("clicked", self._choose)
        self.append(self.entry)
        self.append(button)

    @property
    def path(self) -> Path:
        value = self.entry.get_text().strip()
        if not value:
            raise ValueError(f"Choose a file for {self.entry.get_placeholder_text()}")
        path = Path(value).expanduser()
        if not path.is_file():
            raise ValueError(f"File not found: {path}")
        return path

    def _choose(self, _button):
        chooser = Gtk.FileChooserNative(
            title=self.entry.get_placeholder_text(),
            transient_for=self.parent,
            action=Gtk.FileChooserAction.OPEN,
            accept_label="Choose",
            cancel_label="Cancel",
        )
        csv_filter = Gtk.FileFilter()
        csv_filter.set_name("CSV files")
        csv_filter.add_pattern("*.csv")
        chooser.add_filter(csv_filter)
        chooser.connect("response", self._chosen)
        chooser.show()

    def _chosen(self, chooser, response):
        if response == Gtk.ResponseType.ACCEPT:
            selected = chooser.get_file()
            if selected and selected.get_path():
                self.entry.set_text(selected.get_path())
        chooser.destroy()


class CoastalWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Coastal Helper Functions")
        self.set_default_size(620, 390)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        outer.set_margin_top(24)
        outer.set_margin_bottom(24)
        outer.set_margin_start(24)
        outer.set_margin_end(24)
        self.set_child(outer)

        title = Gtk.Label(label="Helper Functions", xalign=0)
        title.add_css_class("title-1")
        outer.append(title)

        stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        switcher = Gtk.StackSwitcher(stack=stack, halign=Gtk.Align.CENTER)
        outer.append(switcher)
        outer.append(stack)

        stack.add_titled(self._clone_page(), "clones", "Clone batches")
        stack.add_titled(self._harvest_page(), "harvest", "Harvest")

        self.status = Gtk.Label(xalign=0, wrap=True)
        self.status.add_css_class("dim-label")
        outer.append(self.status)

    def _clone_page(self):
        page = self._page()
        self.clone_name = Gtk.Entry(placeholder_text="Batch name")
        self.clone_input = FileRow("Strain and plant count CSV", self)
        self.clone_inventory = FileRow("Current inventory CSV", self)
        page.append(self.clone_name)
        page.append(self.clone_input)
        page.append(self.clone_inventory)
        button = Gtk.Button(label="Generate clone batch CSV", halign=Gtk.Align.END)
        button.add_css_class("suggested-action")
        button.connect("clicked", self._generate_clones)
        page.append(button)
        return page

    def _harvest_page(self):
        page = self._page()
        self.harvest_name = Gtk.Entry(placeholder_text="Harvest name")
        self.harvest_input = FileRow("Tag, weight, and strain CSV", self)
        page.append(self.harvest_name)
        page.append(self.harvest_input)
        button = Gtk.Button(label="Generate harvest CSV", halign=Gtk.Align.END)
        button.add_css_class("suggested-action")
        button.connect("clicked", self._generate_harvest)
        page.append(button)
        return page

    @staticmethod
    def _page():
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_margin_top(18)
        return page

    def _generate_clones(self, _button):
        self._run(lambda: generate_clone_batches(
            self.clone_name.get_text(), self.clone_input.path, self.clone_inventory.path
        ))

    def _generate_harvest(self, _button):
        self._run(lambda: generate_harvest(self.harvest_name.get_text(), self.harvest_input.path))

    def _run(self, operation):
        try:
            output = operation()
        except Exception as exc:
            self.status.set_text(f"Could not generate CSV: {exc}")
            self.status.remove_css_class("success")
            self.status.add_css_class("error")
            return
        self.status.set_text(f"Created {output}")
        self.status.remove_css_class("error")
        self.status.add_css_class("success")
        subprocess.Popen(["xdg-open", str(output.parent)])


class CoastalApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="com.dachourico.Coastal", flags=Gio.ApplicationFlags.DEFAULT_FLAGS)

    def do_activate(self):
        window = self.props.active_window or CoastalWindow(self)
        window.present()


if __name__ == "__main__":
    raise SystemExit(CoastalApp().run(sys.argv))
