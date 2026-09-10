import "./style.css";
import type { AppState, Item, PackKind, Tab, UsageMode } from "./types";
import { PACK_PRESETS, ensureMediaCatalog, normalizeItem, normalizeRoom } from "./types";
import { exportBackup, importBackup, loadState, saveState } from "./store";
import {
  addDays,
  alertsToPing,
  countLabelOf,
  dateToIsoStart,
  nowIso,
  packsFromDrumFields,
  plural,
  todayDate,
  uid,
  unitsPerBuyOf,
} from "./model";
import { advanceJobRotation, jobForKind, qtyKindForItem, roomQty, suggestedBlocks, tablesFromCounts } from "./rooms";
import { pingIfNeeded, requestNotifyPermission } from "./notify";
import {
  defaultGenerated,
  orderCsv,
  orderText,
  renderApp,
  type View,
} from "./ui";

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) throw new Error("Missing #app");
const app = appEl;

const view: View = {
  tab: "stock",
  flash: "Counts save automatically in this browser.",
  flashError: false,
  coverUntil: "",
  bufferDays: 7,
  dialog: null,
  activeItemId: null,
  generated: null,
  duplicating: false,
};

let state: AppState = loadState();
{
  const seeded = ensureMediaCatalog(state.items);
  state.items = seeded.items;
  saveState(state);
  if (seeded.added.length) {
    view.flash = `Added to Catalog: ${seeded.added.join(", ")}. Count pieces on the shelf; orders are boxes, cases, and bundles.`;
  }
}
view.coverUntil = state.settings.nextOrderDate || addDays(todayDate(), 70);
view.bufferDays = state.settings.defaultLeadTimeDays;

function persist(message?: string, error = false): void {
  const saved = saveState(state);
  if (!saved) {
    view.flash = "Updated for this session, but browser storage is full or unavailable. Download a backup to keep the change.";
    view.flashError = true;
  }
  if (message) {
    if (saved) view.flash = message;
    view.flashError = error || !saved;
  }
  render();
}

function render(): void {
  app.innerHTML = renderApp(state, view);
  const dialog = document.querySelector<HTMLDialogElement>("#app-dialog");
  if (dialog && view.dialog) {
    if (!dialog.open) dialog.showModal();
    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]');
    for (const input of dateInputs) {
      if (!input.value) input.value = todayDate();
    }
  } else if (dialog?.open) {
    dialog.close();
  }

  const auditDate = document.querySelector<HTMLInputElement>('input[name="audit-date"]');
  if (auditDate && !auditDate.value) auditDate.value = todayDate();
}

function closeDialog(): void {
  view.dialog = null;
  view.activeItemId = null;
  view.duplicating = false;
  render();
}

function itemById(id: string | null): Item | undefined {
  return state.items.find((item) => item.id === id);
}

function pushEvent(
  itemId: string,
  type: "audit" | "consume" | "swap" | "receive" | "adjust",
  fields: {
    at?: string;
    onHandPacks?: number;
    sealedPacks?: number;
    openRemaining?: number | null;
    deltaPacks?: number;
    note?: string;
  },
): void {
  state.events.push({
    id: uid(),
    itemId,
    type,
    at: fields.at ?? nowIso(),
    onHandPacks: fields.onHandPacks,
    sealedPacks: fields.sealedPacks,
    openRemaining: fields.openRemaining,
    deltaPacks: fields.deltaPacks,
    note: fields.note ?? "",
  });
}

function applyPreset(form: HTMLFormElement, presetId: string): void {
  const preset = PACK_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) return;
  setInput(form, "packSize", String(preset.packSize));
  setInput(form, "packUnit", preset.packUnit);
  setInput(form, "orderLabel", preset.orderLabel);
  setInput(form, "countLabel", preset.countLabel);
  setInput(form, "unitsPerBuy", String(preset.unitsPerBuy));
  setInput(form, "category", preset.category);
  setInput(form, "usageMode", preset.usageMode);
  if (preset.useEveryWeeks) setInput(form, "useEveryWeeks", String(preset.useEveryWeeks));
  if (preset.reorderPoint != null) setInput(form, "reorderPoint", String(preset.reorderPoint));
  const roomsBox = form.elements.namedItem("useFromRooms");
  if (roomsBox instanceof HTMLInputElement) roomsBox.checked = Boolean(preset.useFromRooms);
  form.dataset.usage = preset.usageMode;
  form.dataset.fromRooms = preset.useFromRooms ? "yes" : "no";
}

function setInput(form: HTMLFormElement, name: string, value: string): void {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    el.value = value;
  }
}

function num(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLElement>("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (!action) return;
  event.preventDefault();
  handleAction(action, button.dataset.id ?? null, button);
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const action = form.dataset.submit;
  if (!action) return;
  event.preventDefault();
  handleSubmit(action, form);
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
  if (target instanceof HTMLInputElement && target.dataset.action === "import-backup" && target.files?.[0]) {
    const file = target.files[0];
    file.text().then((text: string) => {
      try {
        state = importBackup(text);
        view.coverUntil = state.settings.nextOrderDate || view.coverUntil;
        view.bufferDays = state.settings.defaultLeadTimeDays;
        persist("Backup restored.");
      } catch (error) {
        view.flash = error instanceof Error ? error.message : "Could not read that backup.";
        view.flashError = true;
        render();
      }
    });
    return;
  }
  if (target.dataset.action === "preset-change" && target.form) {
    applyPreset(target.form, target.value);
  }
  if (target.dataset.action === "usage-change" && target.form) {
    target.form.dataset.usage = target.value;
  }
  if (target.dataset.action === "rooms-change" && target.form && target instanceof HTMLInputElement) {
    target.form.dataset.fromRooms = target.checked ? "yes" : "no";
  }
  if (target.name === "roomId" && target.form) {
    const room = state.rooms.find((entry) => entry.id === target.value);
    if (room) {
      const kind = (target.form.dataset.qty as ReturnType<typeof qtyKindForItem>) || "ft";
      setInput(target.form, "packs", String(Math.round(roomQty(room, state.settings, kind))));
      if (kind === "cubes") {
        setInput(target.form, "blocks", String(suggestedBlocks(room, state.settings) || ""));
      }
    }
  }
});

app.addEventListener("click", (event) => {
  const dialog = document.querySelector("#app-dialog");
  if (event.target === dialog) closeDialog();
});

function handleAction(action: string, id: string | null, el: HTMLElement): void {
  switch (action) {
    case "tab":
      view.tab = (el.dataset.tab as Tab) || "stock";
      view.flash = "";
      view.flashError = false;
      render();
      break;
    case "open-settings":
      view.dialog = "settings";
      render();
      break;
    case "close-dialog":
      closeDialog();
      break;
    case "add-item":
      view.activeItemId = null;
      view.duplicating = false;
      view.dialog = "item";
      view.tab = "catalog";
      render();
      break;
    case "edit-item":
      view.activeItemId = id;
      view.duplicating = false;
      view.dialog = "item";
      render();
      break;
    case "duplicate-item":
      view.activeItemId = id;
      view.duplicating = true;
      view.dialog = "item";
      view.tab = "catalog";
      render();
      break;
    case "archive-item": {
      const item = itemById(id);
      if (!item) return;
      item.archived = !item.archived;
      persist(item.archived ? `${item.name} archived.` : `${item.name} restored.`);
      break;
    }
    case "consume":
      view.activeItemId = id;
      view.dialog = "consume";
      render();
      break;
    case "swap":
      view.activeItemId = id;
      view.dialog = "swap";
      render();
      break;
    case "remaining":
      view.activeItemId = id;
      view.dialog = "remaining";
      render();
      break;
    case "detail":
      view.activeItemId = id;
      view.dialog = "detail";
      render();
      break;
    case "export-backup": {
      download(`coastal-supply-${todayDate()}.json`, exportBackup(state), "application/json");
      view.flash = "Backup downloaded.";
      view.flashError = false;
      render();
      break;
    }
    case "copy-order": {
      const lines = readGeneratedFromDom() ?? view.generated;
      if (!lines) return;
      view.generated = lines;
      void navigator.clipboard.writeText(orderText(state, view.coverUntil, view.bufferDays, lines));
      view.flash = "Order copied.";
      view.flashError = false;
      render();
      break;
    }
    case "export-order-csv": {
      const lines = readGeneratedFromDom() ?? view.generated;
      if (!lines) return;
      view.generated = lines;
      download(`coastal-order-${view.coverUntil}.csv`, orderCsv(state, lines), "text/csv");
      view.flash = "CSV downloaded.";
      view.flashError = false;
      render();
      break;
    }
    case "save-draft": {
      const lines = readGeneratedFromDom() ?? view.generated;
      if (!lines) return;
      view.generated = lines;
      state.settings.nextOrderDate = view.coverUntil;
      state.orders.push({
        id: uid(),
        createdAt: nowIso(),
        coverUntil: view.coverUntil,
        leadTimeDays: view.bufferDays,
        status: "draft",
        lines: lines.filter((line) => line.packs > 0),
      });
      persist("Draft order saved.");
      break;
    }
    case "place-order": {
      const order = state.orders.find((entry) => entry.id === id);
      if (!order) return;
      order.status = "placed";
      order.placedAt = nowIso();
      persist("Marked as placed. We’ll stop nagging those lines until it arrives.");
      break;
    }
    case "receive-order": {
      const order = state.orders.find((entry) => entry.id === id);
      if (!order) return;
      order.status = "received";
      order.receivedAt = nowIso();
      for (const line of order.lines) {
        if (line.packs > 0) {
          const item = itemById(line.itemId);
          pushEvent(line.itemId, "receive", {
            deltaPacks: line.packs * (item ? unitsPerBuyOf(item) : 1),
            note: `Received order covering ${order.coverUntil}`,
          });
        }
      }
      persist("Received and added to on-hand.");
      break;
    }
    case "add-room": {
      const form = document.querySelector<HTMLFormElement>('form[data-submit="save-rooms"]');
      if (form) applyRoomsForm(new FormData(form));
      const nextNum = state.rooms.length + 1;
      state.rooms.push(
        normalizeRoom({
          name: `Flower ${nextNum}`,
          online: false,
          sortOrder: nextNum,
          tables: [],
        }),
      );
      view.tab = "rooms";
      persist("Room added. Add tables if it’s online, then save.");
      break;
    }
    default:
      break;
  }
}

function applyRoomsForm(data: FormData): void {
  state.settings.netOverhangInches = num(data, "overhang") ?? 6;
  state.settings.trellisLayers = num(data, "layers") ?? 3;
  state.settings.cutIntervalWeeks = num(data, "interval") ?? 5;
  state.settings.nextCloneRoomId = String(data.get("next-clone-room") || "");
  state.settings.nextCloneDate = String(data.get("next-clone-date") || "");
  state.settings.nextBlockRoomId = String(data.get("next-block-room") || "");
  state.settings.nextBlockDate = String(data.get("next-block-date") || "");
  state.settings.nextTrellisRoomId = String(data.get("next-trellis-room") || "");
  state.settings.nextTrellisDate = String(data.get("next-trellis-date") || "");
  state.settings.nextCutRoomId = state.settings.nextTrellisRoomId;
  state.settings.nextCutDate = state.settings.nextTrellisDate;
  for (const room of state.rooms) {
    room.name = String(data.get(`room-name-${room.id}`) || room.name).trim() || room.name;
    room.online = data.get(`room-online-${room.id}`) === "on";
    room.tables = tablesFromCounts(
      num(data, `room-8-${room.id}`) ?? 0,
      num(data, `room-6-${room.id}`) ?? 0,
      num(data, `room-4-${room.id}`) ?? 0,
    );
    room.slabs = num(data, `room-slabs-${room.id}`) ?? 0;
    room.cubes = num(data, `room-cubes-${room.id}`) ?? 0;
    room.blocks4 = num(data, `room-blocks4-${room.id}`);
    room.blocks6 = num(data, `room-blocks6-${room.id}`);
  }
  const ratePct = num(data, "block-rate");
  if (ratePct != null) state.settings.blockRate = ratePct > 1.5 ? ratePct / 100 : ratePct;
}

function handleSubmit(action: string, form: HTMLFormElement): void {
  const data = new FormData(form);
  switch (action) {
    case "save-settings": {
      state.settings.defaultLeadTimeDays = num(data, "lead") ?? 7;
      state.settings.alertWithinDays = num(data, "alert") ?? 10;
      state.settings.nextOrderDate = String(data.get("next") ?? "");
      const wantNotify = String(data.get("notify")) === "yes";
      if (wantNotify) {
        void requestNotifyPermission().then((ok) => {
          state.settings.notifyEnabled = ok;
          saveState(state);
          if (ok) pingIfNeeded(alertsToPing(state), true);
        });
      }
      state.settings.notifyEnabled = wantNotify;
      view.bufferDays = state.settings.defaultLeadTimeDays;
      if (state.settings.nextOrderDate) view.coverUntil = state.settings.nextOrderDate;
      view.dialog = null;
      persist("Settings saved.");
      break;
    }
    case "save-item": {
      const preset = PACK_PRESETS.find((entry) => entry.id === String(data.get("preset")));
      const existing = view.duplicating
        ? undefined
        : itemById(String(data.get("id") || (!view.duplicating && view.activeItemId) || ""));
      const packKind: PackKind = preset?.packKind ?? existing?.packKind ?? "each";
      const usageMode = (String(data.get("usageMode") || "ongoing") as UsageMode) || "ongoing";
      const payload = normalizeItem({
        id: existing?.id ?? uid(),
        name: String(data.get("name") || "").trim(),
        vendor: String(data.get("vendor") || "").trim(),
        category: (String(data.get("category")) as Item["category"]) || "other",
        packKind,
        packSize: num(data, "packSize") ?? preset?.packSize ?? 1,
        packUnit: String(data.get("packUnit") || preset?.packUnit || "ea"),
        orderLabel: String(data.get("orderLabel") || preset?.orderLabel || "unit"),
        countLabel: String(data.get("countLabel") || data.get("orderLabel") || "unit"),
        unitsPerBuy: num(data, "unitsPerBuy") ?? preset?.unitsPerBuy ?? 1,
        usageMode,
        roughPerWeek: num(data, "roughPerWeek"),
        useEveryWeeks: num(data, "useEveryWeeks"),
        usePerEvent: num(data, "usePerEvent"),
        nextUseDate: String(data.get("nextUseDate") || ""),
        reorderPoint: num(data, "reorderPoint"),
        useFromRooms: usageMode === "scheduled" && data.get("useFromRooms") === "on",
        cycleWeeks: num(data, "useEveryWeeks") ?? 0,
        typicalPerCycle: null,
        leadTimeDays: num(data, "lead"),
        notes: String(data.get("notes") || "").trim(),
        archived: existing?.archived ?? false,
        createdAt: existing?.createdAt ?? nowIso(),
      });
      if (!payload.name) {
        view.flash = "Name is required.";
        view.flashError = true;
        render();
        return;
      }
      if (existing) {
        Object.assign(existing, payload, { id: existing.id });
      } else {
        state.items.push(payload);
        const startPacks = num(data, "startPacks") ?? 0;
        const startOpen = num(data, "startOpen");
        if (startPacks > 0 || (startOpen != null && startOpen > 0)) {
          const sealed =
            packKind === "drum" && startOpen != null ? startPacks : startPacks;
          const open = packKind === "drum" ? startOpen : null;
          pushEvent(payload.id, "audit", {
            onHandPacks: packsFromDrumFields(sealed, open, payload.packSize),
            sealedPacks: packKind === "drum" ? sealed : undefined,
            openRemaining: packKind === "drum" ? open : undefined,
            note: "Starting quantity",
          });
        }
      }
      view.dialog = null;
      view.activeItemId = null;
      view.duplicating = false;
      persist(`${payload.name} saved.`);
      break;
    }
    case "save-consume": {
      const item = itemById(view.activeItemId);
      if (!item) return;
      const packs = num(data, "packs") ?? 1;
      const date = String(data.get("date") || todayDate());
      const roomId = String(data.get("roomId") || "");
      const room = state.rooms.find((entry) => entry.id === roomId);
      const kind = qtyKindForItem(item);
      const note =
        String(data.get("note") || "") ||
          (room ? `${room.name}${kind === "cubes" ? " clones" : kind === "slabs" ? " slabs" : kind === "blocks4" || kind === "blocks6" || kind === "blocks" ? " blocks" : " cut"}` : "");
      pushEvent(item.id, "consume", {
        at: dateToIsoStart(date),
        deltaPacks: packs,
        note,
      });
      const blocksUsed = num(data, "blocks");
      if (kind === "cubes" && blocksUsed != null && blocksUsed > 0) {
        const blockId = String(data.get("blockItemId") || "");
        const blockItem =
          itemById(blockId) ??
          state.items.find((entry) => !entry.archived && entry.packKind === "block");
        if (blockItem) {
          pushEvent(blockItem.id, "consume", {
            at: dateToIsoStart(date),
            deltaPacks: blocksUsed,
            note: note || (room ? `${room.name} into blocks` : "Planted into blocks"),
          });
        }
      }
      if (item.useFromRooms && data.get("advance") === "on" && roomId) {
        advanceJobRotation(state, jobForKind(kind), roomId, date);
      }
      view.dialog = null;
      persist(
        kind === "cubes" && blocksUsed
          ? `Logged ${plural(packs, "cube")} and ${plural(blocksUsed, "block")}.`
          : `Logged ${plural(packs, countLabelOf(item))} used.`,
      );
      break;
    }
    case "save-swap": {
      const item = itemById(view.activeItemId);
      if (!item) return;
      pushEvent(item.id, "swap", {
        at: dateToIsoStart(String(data.get("date") || todayDate())),
        openRemaining: num(data, "open") ?? item.packSize,
        deltaPacks: 1,
        note: String(data.get("note") || "Drum swap"),
      });
      view.dialog = null;
      persist("Drum swap logged. The next few swaps will tighten the estimate.");
      break;
    }
    case "save-remaining": {
      const item = itemById(view.activeItemId);
      if (!item) return;
      const sealed = num(data, "sealed") ?? 0;
      const open = num(data, "open");
      pushEvent(item.id, "adjust", {
        at: dateToIsoStart(String(data.get("date") || todayDate())),
        sealedPacks: sealed,
        openRemaining: open,
        onHandPacks: packsFromDrumFields(sealed, open, item.packSize),
        note: String(data.get("note") || "Remaining estimate"),
      });
      view.dialog = null;
      persist("Remaining estimate saved.");
      break;
    }
    case "save-audit": {
      const date = String(data.get("audit-date") || todayDate());
      let counted = 0;
      for (const item of state.items.filter((entry) => !entry.archived)) {
        const note = String(data.get(`note-${item.id}`) || "");
        if (item.packKind === "drum") {
          const sealedRaw = data.get(`sealed-${item.id}`);
          const openRaw = data.get(`open-${item.id}`);
          if (sealedRaw === null && openRaw === null) continue;
          const sealed = num(data, `sealed-${item.id}`) ?? 0;
          const open = num(data, `open-${item.id}`);
          pushEvent(item.id, "audit", {
            at: dateToIsoStart(date),
            sealedPacks: sealed,
            openRemaining: open,
            onHandPacks: packsFromDrumFields(sealed, open, item.packSize),
            note,
          });
          counted += 1;
        } else {
          const packs = num(data, `packs-${item.id}`);
          if (packs == null) continue;
          pushEvent(item.id, "audit", {
            at: dateToIsoStart(date),
            onHandPacks: packs,
            note,
          });
          counted += 1;
        }
      }
      persist(`Saved audit for ${counted} item${counted === 1 ? "" : "s"}.`);
      break;
    }
    case "generate-order": {
      view.coverUntil = String(data.get("cover-until") || view.coverUntil);
      view.bufferDays = num(data, "buffer-days") ?? state.settings.defaultLeadTimeDays;
      state.settings.nextOrderDate = view.coverUntil;
      view.generated = defaultGenerated(state, view.coverUntil, view.bufferDays);
      persist("Order generated. Edit quantities if you want extra, then save a draft.");
      break;
    }
    case "save-rooms": {
      applyRoomsForm(data);
      persist("Rooms saved.");
      break;
    }
    default:
      break;
  }
}

function readGeneratedFromDom(): { itemId: string; packs: number; note: string }[] | null {
  if (!view.generated) return null;
  return view.generated.map((line) => {
    const input = document.querySelector<HTMLInputElement>(`input[name="order-${line.itemId}"]`);
    const packs = input ? Number(input.value) : line.packs;
    return { ...line, packs: Number.isFinite(packs) ? packs : line.packs };
  });
}

function download(name: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

render();
pingIfNeeded(alertsToPing(state), state.settings.notifyEnabled);
