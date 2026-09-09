import type { AppState, Item, ItemStatus, Order, Tab } from "./types";
import { PACK_PRESETS, presetMatchesItem } from "./types";
import {
  allStatuses,
  alertsToPing,
  buyLabelOf,
  countLabelOf,
  formatDate,
  formatDaysLeft,
  formatNumber,
  formatOnHand,
  itemEvents,
  plural,
  suggestedOrderPacks,
} from "./model";
import {
  cutPreview,
  describeTables,
  logActionLabel,
  netFtForRoom,
  onlineRooms,
  qtyKindForItem,
  qtyFromPlan,
  resolveNextCut,
  roomQty,
  suggestedBlocks,
  tableCounts,
  upcomingCuts,
} from "./rooms";

export interface View {
  tab: Tab;
  flash: string;
  flashError: boolean;
  coverUntil: string;
  bufferDays: number;
  dialog:
    | "item"
    | "consume"
    | "swap"
    | "remaining"
    | "settings"
    | "detail"
    | null;
  activeItemId: string | null;
  generated: { itemId: string; packs: number; note: string }[] | null;
  duplicating: boolean;
}

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function meterPct(status: ItemStatus): number {
  if (status.alert === "unknown") return 12;
  if (status.daysLeft == null) return 100;
  const target = status.leadTimeDays + 28;
  return Math.max(5, Math.min(100, (status.daysLeft / target) * 100));
}

function kindLabel(item: Item): string {
  const match = PACK_PRESETS.find((preset) => presetMatchesItem(item, preset));
  return match?.label.split(" (")[0] ?? item.packKind;
}

function confidenceLabel(status: ItemStatus): string {
  if (status.item.usageMode === "dont_run_out") return "Just don’t run out";
  if (status.item.useFromRooms) return "From flower rooms";
  if (status.item.usageMode === "scheduled") return "Used on a schedule";
  switch (status.usage.confidence) {
    case "high":
      return "Learned from your counts";
    case "medium":
      return "Getting a read";
    case "low":
      return "Early estimate";
    default:
      return "Audits will teach the rate";
  }
}

function itemById(state: AppState, id: string | null): Item | undefined {
  return state.items.find((item) => item.id === id);
}

export function renderApp(state: AppState, view: View): string {
  const statuses = allStatuses(state);
  const alerts = alertsToPing(state);
  const active = itemById(state, view.activeItemId);
  const activeStatus = statuses.find((row) => row.item.id === view.activeItemId);

  return `
    <header>
      <img src="./logo.svg" alt="Coastal Healing" />
      <div>
        <strong>Coastal Healing</strong>
        <span>Cultivation tools</span>
      </div>
      <div class="device">Your files stay on this device</div>
    </header>
    <main>
      <section class="intro">
        <div class="eyebrow">A LITTLE LESS PAPERWORK</div>
        <h1>Order before you run out.</h1>
        <p>Track nutrients and supplies. Log audits and used packs. We’ll estimate usage and build an order that lasts until the date you pick.</p>
        <nav class="tools" aria-label="Tools">
          <a href="../">Room layouts</a>
          <a href="../?tab=clone">Clone batches</a>
          <a href="../?tab=harvest">Harvest</a>
          <a href="./" class="active">Supply</a>
        </nav>
        <nav class="tabs">
          <button type="button" data-action="tab" data-tab="stock" class="${view.tab === "stock" ? "active" : ""}">On hand</button>
          <button type="button" data-action="tab" data-tab="audit" class="${view.tab === "audit" ? "active" : ""}">Audit</button>
          <button type="button" data-action="tab" data-tab="order" class="${view.tab === "order" ? "active" : ""}">Order</button>
          <button type="button" data-action="tab" data-tab="catalog" class="${view.tab === "catalog" ? "active" : ""}">Catalog</button>
          <button type="button" data-action="tab" data-tab="rooms" class="${view.tab === "rooms" ? "active" : ""}">Rooms</button>
        </nav>
        <p id="status" class="${view.flashError ? "error" : ""}">${escapeHtml(view.flash)}</p>
      </section>
      ${renderTab(state, view, statuses, alerts)}
      <footer>
        <div>
          <button type="button" data-action="open-settings">Settings</button>
          <button type="button" data-action="export-backup">Download backup</button>
          <label class="file-button">Open backup<input type="file" accept="application/json,.json" data-action="import-backup" /></label>
        </div>
        <span>Counts save in this browser. Download a backup to share it or open it on another device.</span>
      </footer>
    </main>
    ${renderDialogs(state, view, active, activeStatus)}
  `;
}

function renderTab(
  state: AppState,
  view: View,
  statuses: ItemStatus[],
  alerts: ItemStatus[],
): string {
  if (view.tab === "stock") return renderStock(state, statuses, alerts);
  if (view.tab === "audit") return renderAudit(statuses);
  if (view.tab === "order") return renderOrder(state, view, statuses);
  if (view.tab === "rooms") return renderRooms(state);
  return renderCatalog(state);
}

function renderStock(
  state: AppState,
  statuses: ItemStatus[],
  alerts: ItemStatus[],
): string {
  if (!state.items.filter((item) => !item.archived).length) {
    return `
      <section class="panel page">
        <div class="empty">
          <h2>Nothing on the shelf yet</h2>
          <p>Add nutrients, media, gloves, and anything else you order. Then log what you have — weekly, or whenever you walk the room.</p>
          <button type="button" class="primary" data-action="add-item">Add an item</button>
        </div>
      </section>
    `;
  }

  const banners = alerts
    .slice(0, 4)
    .map((row) => {
      const cls = row.alert === "urgent" ? "urgent" : "soon";
      const when = row.orderBy ? `Order by ${formatDate(row.orderBy)}` : "Order soon";
      return `<div class="banner ${cls}"><strong>${escapeHtml(row.item.name)}</strong><span>${escapeHtml(formatDaysLeft(row))} · ${escapeHtml(when)}. Shipping buffer is ${row.leadTimeDays} days.</span></div>`;
    })
    .join("");

  return `
    <section class="page">
      <div class="alert-row">${banners || `<div class="banner">No overdue items. Set a next order date when you’re heading out or see a bulk sale.</div>`}</div>
      <div class="stock-grid">
        ${statuses.map(renderCard).join("")}
      </div>
    </section>
  `;
}

function renderCard(status: ItemStatus): string {
  const { item } = status;
  const quick =
    item.packKind === "drum"
      ? `<button type="button" data-action="swap" data-id="${item.id}">Swap drum</button>
         <button type="button" data-action="remaining" data-id="${item.id}">Estimate left</button>`
      : `<button type="button" data-action="consume" data-id="${item.id}">${item.useFromRooms ? logActionLabel(item) : `Used ${escapeHtml(countLabelOf(item))}`}</button>`;

  return `
    <article class="item-card ${status.alert}">
      <header class="card-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <small>${escapeHtml(kindLabel(item))}${item.vendor ? ` · ${escapeHtml(item.vendor)}` : ""}</small>
        </div>
        <span class="badge ${status.alert}">${escapeHtml(status.alert === "ok" ? "On track" : status.alert === "soon" ? "Order soon" : status.alert === "urgent" ? "Order now" : "Learning")}</span>
      </header>
      <div class="qty">${escapeHtml(formatOnHand(status))}</div>
      <small>${escapeHtml(formatDaysLeft(status))}</small>
      <div class="meter"><span style="width:${meterPct(status)}%"></span></div>
      <small>${escapeHtml(confidenceLabel(status))}${
        status.usage.perWeek > 0 && !item.useFromRooms
          ? ` · ~${formatNumber(status.usage.perWeek, status.usage.perWeek < 1 ? 2 : 1)} ${escapeHtml(countLabelOf(item))} / week`
          : ""
      }</small>
      <div class="actions">
        ${quick}
        <button type="button" data-action="detail" data-id="${item.id}">History</button>
      </div>
    </article>
  `;
}

function renderAudit(statuses: ItemStatus[]): string {
  if (!statuses.length) {
    return `<section class="panel page"><div class="empty"><p>Add items in Catalog first, then come back to count the shelf.</p></div></section>`;
  }

  const rows = statuses
    .map((status) => {
      const item = status.item;
      const drum = item.packKind === "drum";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong><br />
            <small>Est. ${escapeHtml(formatOnHand(status))}</small>
          </td>
          <td>
            ${
              drum
                ? `<label>Unopened drums<input type="number" min="0" step="1" name="sealed-${item.id}" value="${escapeHtml(status.sealedPacks)}" /></label>
                   <label>Open drum (${escapeHtml(item.packUnit)})<input type="number" min="0" step="0.5" name="open-${item.id}" value="${escapeHtml(status.openRemaining ?? "")}" placeholder="optional" /></label>`
                : `<label>On hand (${escapeHtml(countLabelOf(item))})<input type="number" min="0" step="0.1" name="packs-${item.id}" value="${escapeHtml(formatNumber(status.onHandPacks, 2))}" /></label>`
            }
          </td>
          <td>
            <label>Note<small class="muted">optional</small><input name="note-${item.id}" placeholder="Room 2, sale, etc." /></label>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="panel page">
      <div class="toolbar">
        <h2>Shelf audit</h2>
        <button type="submit" class="primary" form="audit-form">Save counts</button>
      </div>
      <p class="hint">Count what you can see. Drums can be a guess — unopened plus what’s left in the open one. If you skipped logging used bags, this is how the estimate catches up.</p>
      <form id="audit-form" data-submit="save-audit">
        <label style="max-width:220px">Audit date<input type="date" name="audit-date" required /></label>
        <div style="overflow:auto">
          <table class="audit-table">
            <thead><tr><th>Item</th><th>Count</th><th>Note</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </form>
    </section>
  `;
}

function renderOrder(state: AppState, view: View, statuses: ItemStatus[]): string {
  const lines = view.generated;
  const known = statuses.filter((row) => row.item.usageMode !== "ongoing" || row.usage.perDay > 0);
  const unknown = statuses.filter((row) => row.item.usageMode === "ongoing" && row.usage.perDay <= 0);
  const past = [...state.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let table = "";
  if (lines) {
    table = `
      <table class="order-table">
        <thead><tr><th>Item</th><th>On hand</th><th>Order</th><th>Why</th></tr></thead>
        <tbody>
          ${lines
            .map((line) => {
              const status = statuses.find((row) => row.item.id === line.itemId);
              if (!status) return "";
              return `<tr>
                <td><strong>${escapeHtml(status.item.name)}</strong><br /><small>${escapeHtml(status.item.vendor || status.item.orderLabel)}</small></td>
                <td>${escapeHtml(formatOnHand(status))}</td>
                <td><input type="number" min="0" step="1" name="order-${line.itemId}" value="${line.packs}" /></td>
                <td><small>${escapeHtml(line.note)}</small></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      <div class="actions" style="margin-top:16px">
        <button type="button" class="primary" data-action="save-draft">Save draft</button>
        <button type="button" data-action="copy-order">Copy list</button>
        <button type="button" data-action="export-order-csv">Export CSV</button>
      </div>
    `;
  }

  return `
    <section class="panel page">
      <div class="toolbar">
        <h2>Build an order</h2>
      </div>
      <p class="hint">Pick the date this order should last until — before vacation, a holiday shutdown, or the next time you want to sit down and order. We’ll add your shipping buffer so it arrives in time.</p>
      <form id="order-form" class="form-grid" data-submit="generate-order">
        <label>Cover until<input type="date" name="cover-until" value="${escapeHtml(view.coverUntil)}" required /></label>
        <label>Shipping buffer (days)<input type="number" min="0" step="1" name="buffer-days" value="${escapeHtml(view.bufferDays)}" /></label>
        <div style="display:flex;align-items:end;margin-bottom:14px">
          <button type="submit" class="primary">Generate order</button>
        </div>
      </form>
      <div class="order-summary">
        <div class="stat"><b>${known.length}</b><small>items with a usage rate</small></div>
        <div class="stat"><b>${unknown.length}</b><small>regular-use items still need a weekly guess or an audit</small></div>
        <div class="stat"><b>${state.settings.nextOrderDate ? formatDate(state.settings.nextOrderDate) : "—"}</b><small>saved next order date</small></div>
      </div>
      ${table}
      ${
        unknown.length
          ? `<p class="hint">No weekly guess yet for: ${unknown.map((row) => escapeHtml(row.item.name)).join(", ")}. That’s fine — set “just don’t run out”, a cut schedule, or log a couple of audits.</p>`
          : ""
      }
      ${past.length ? `<h2 style="margin-top:28px">Past orders</h2>${past.map((order) => renderPastOrder(state, order)).join("")}` : ""}
    </section>
  `;
}

function renderPastOrder(state: AppState, order: Order): string {
  const count = order.lines.reduce((sum, line) => sum + line.packs, 0);
  const actions =
    order.status === "draft"
      ? `<button type="button" data-action="place-order" data-id="${order.id}">Mark placed</button>`
      : order.status === "placed"
        ? `<button type="button" class="primary" data-action="receive-order" data-id="${order.id}">Mark received</button>`
        : "";
  return `
    <div class="catalog-row" style="margin-top:10px">
      <div>
        <strong>${escapeHtml(formatDate(order.coverUntil))} cover · ${escapeHtml(order.status)}</strong>
        <small>${count} packs · buffer ${order.leadTimeDays} days · ${order.lines
          .map((line) => {
            const item = state.items.find((entry) => entry.id === line.itemId);
            return item ? `${line.packs} ${item.orderLabel}${line.packs === 1 ? "" : "s"} ${item.name}` : "";
          })
          .filter(Boolean)
          .join(" · ")}</small>
      </div>
      <div class="actions">${actions}</div>
    </div>
  `;
}

function renderCatalog(state: AppState): string {
  const items = [...state.items].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  return `
    <section class="panel page">
      <div class="toolbar">
        <h2>Catalog</h2>
        <button type="button" class="primary" data-action="add-item">Add item</button>
      </div>
      <p class="hint">Drums, bags, glove cases, trellis, and rockwool. For cubes / blocks / slabs, pick the matching pack size — count pieces, order the box, case, or bundle.</p>
      <div class="catalog-list">
        ${
          items.length
            ? items
                .map(
                  (item) => `
          <div class="catalog-row">
            <div>
              <strong>${escapeHtml(item.name)}${item.archived ? " <span class='muted'>(archived)</span>" : ""}</strong>
              <small>${escapeHtml(kindLabel(item))} · count ${escapeHtml(countLabelOf(item))} · order ${escapeHtml(buyLabelOf(item))}${
                    item.unitsPerBuy > 1 ? ` of ${item.unitsPerBuy}` : ""
                  }${
                    item.usageMode === "dont_run_out"
                      ? " · don’t run out"
                      : item.useFromRooms
                        ? " · from rooms"
                      : item.usageMode === "scheduled"
                        ? ` · every ${item.useEveryWeeks ?? 5} weeks`
                        : item.roughPerWeek
                          ? ` · ~${formatNumber(item.roughPerWeek)} / week`
                          : ""
                  }${item.vendor ? ` · ${escapeHtml(item.vendor)}` : ""}</small>
            </div>
            <div class="actions">
              <button type="button" data-action="edit-item" data-id="${item.id}">Edit</button>
              <button type="button" data-action="duplicate-item" data-id="${item.id}">Duplicate</button>
              <button type="button" data-action="archive-item" data-id="${item.id}">${item.archived ? "Restore" : "Archive"}</button>
            </div>
          </div>`,
                )
                .join("")
            : `<div class="empty">Add the things you actually order. You can start with what’s on the pallet today.</div>`
        }
      </div>
    </section>
  `;
}

function renderRooms(state: AppState): string {
  const s = state.settings;
  const next = resolveNextCut(state);
  const rooms = [...state.rooms].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const far = upcomingCuts(state, "9999-12-31", 6);
  const roomOptions = onlineRooms(state)
    .map(
      (room) =>
        `<option value="${escapeHtml(room.id)}" ${s.nextCutRoomId === room.id || (!s.nextCutRoomId && next?.roomId === room.id) ? "selected" : ""}>${escapeHtml(room.name)}</option>`,
    )
    .join("");
  const blockPct = Math.round(blockRateDisplay(s.blockRate));

  const cards = rooms
    .map((room) => {
      const counts = tableCounts(room);
      const ft = netFtForRoom(room, s);
      const blocks = suggestedBlocks(room, s);
      return `
        <article class="room-card ${room.online ? "" : "offline"}">
          <header class="card-head">
            <label>Room name<input name="room-name-${escapeHtml(room.id)}" value="${escapeHtml(room.name)}" /></label>
            <label class="check-row online-toggle">
              <input type="checkbox" name="room-online-${escapeHtml(room.id)}" ${room.online ? "checked" : ""} />
              Online
            </label>
          </header>
          <p class="hint">${escapeHtml(describeTables(room))}${!room.online ? " Offline until you turn it on." : ""}</p>
          <div class="form-grid three">
            <label>8 ft tables<input type="number" min="0" step="1" name="room-8-${escapeHtml(room.id)}" value="${counts.eight}" /></label>
            <label>6 ft tables<input type="number" min="0" step="1" name="room-6-${escapeHtml(room.id)}" value="${counts.six}" /></label>
            <label>4 ft tables<input type="number" min="0" step="1" name="room-4-${escapeHtml(room.id)}" value="${counts.four}" /></label>
          </div>
          <div class="qty">${ft ? `${formatNumber(ft, 0)} ft trellis / cut` : "No net yet"}</div>
          <small>Count cubes, slabs, and blocks on the shelf — not boxes. ~95% of cubes is a starting guess for the block size you plant.</small>
          <div class="form-grid">
            <label>Slabs / 10 weeks<input type="number" min="0" step="1" name="room-slabs-${escapeHtml(room.id)}" value="${room.slabs || ""}" placeholder="0" /></label>
            <label>Starter cubes<input type="number" min="0" step="1" name="room-cubes-${escapeHtml(room.id)}" value="${room.cubes || ""}" placeholder="0" /></label>
            <label>4" blocks<input type="number" min="0" step="1" name="room-blocks4-${escapeHtml(room.id)}" value="${room.blocks4 ?? ""}" placeholder="0" /></label>
            <label>6" blocks<input type="number" min="0" step="1" name="room-blocks6-${escapeHtml(room.id)}" value="${room.blocks6 ?? ""}" placeholder="0" /></label>
          </div>
          <small>${
            room.cubes
              ? `~${blockPct}% of ${room.cubes} cubes is ${blocks} blocks. Put that on 4" or 6" — whichever you plant.`
              : "Add cube counts when you know them. Extra cubes are fine — log what you actually used."
          }</small>
        </article>`;
    })
    .join("");

  const cuts = far
    .map((cut) => {
      const bits = [`${formatNumber(cut.ft, 0)} ft`];
      if (cut.cubes) bits.push(`${cut.cubes} cubes`);
      if (cut.blocks4) bits.push(`${cut.blocks4} 4"`);
      if (cut.blocks6) bits.push(`${cut.blocks6} 6"`);
      if (cut.slabs) bits.push(`${cut.slabs} slabs`);
      return `<div class="stat"><b>${escapeHtml(cut.roomName)}</b><small>${escapeHtml(formatDate(cut.date))} · ${escapeHtml(bits.join(" · "))}</small></div>`;
    })
    .join("");

  return `
    <section class="panel page">
      <form data-submit="save-rooms">
        <div class="toolbar">
          <h2>Flower rooms</h2>
          <button type="button" data-action="add-room">Add room</button>
          <button type="submit" class="primary">Save rooms</button>
        </div>
        <div class="form-grid">
          <label>Extra net each end (inches)<input type="number" min="0" step="0.5" name="overhang" value="${escapeHtml(s.netOverhangInches)}" /></label>
          <label>Layers per table<input type="number" min="1" step="1" name="layers" value="${escapeHtml(s.trellisLayers)}" /></label>
          <label>Weeks between rooms<input type="number" min="1" step="1" name="interval" value="${escapeHtml(s.cutIntervalWeeks)}" /></label>
          <label>Next room<select name="next-room">${roomOptions || `<option value="">No online rooms yet</option>`}</select></label>
          <label>Next date<input type="date" name="next-cut" value="${escapeHtml(s.nextCutDate)}" /></label>
          <label>Blocks from cubes (%)<input type="number" min="1" max="150" step="1" name="block-rate" value="${blockPct}" /></label>
        </div>
        <p class="hint">${escapeHtml(cutPreview(state))}</p>
        <div class="order-summary">${cuts || `<div class="stat"><b>—</b><small>Turn a room online and add tables or media</small></div>`}</div>
        <div class="room-grid">${cards}</div>
      </form>
    </section>
  `;
}

function blockRateDisplay(rate: number | undefined): number {
  const value = rate && rate > 0 ? rate : 0.95;
  return value <= 1.5 ? value * 100 : value;
}

function renderDialogs(
  state: AppState,
  view: View,
  item?: Item,
  status?: ItemStatus,
): string {
  return `
    <dialog id="app-dialog" class="${view.dialog === "detail" || view.dialog === "item" ? "wide-dialog" : ""}">
      ${dialogBody(state, view, item, status)}
    </dialog>
  `;
}

function dialogBody(
  state: AppState,
  view: View,
  item?: Item,
  status?: ItemStatus,
): string {
  if (!view.dialog) return "";
  if (view.dialog === "settings") return settingsForm(state);
  if (view.dialog === "item") return itemForm(item, view.duplicating);
  if (!item) return `<h2>Missing item</h2><menu><button type="button" data-action="close-dialog">Close</button></menu>`;
  if (view.dialog === "consume") return consumeForm(state, item);
  if (view.dialog === "swap") return swapForm(item, status);
  if (view.dialog === "remaining") return remainingForm(item, status);
  if (view.dialog === "detail") return detailView(state, item, status);
  return "";
}

function settingsForm(state: AppState): string {
  const s = state.settings;
  return `
    <form data-submit="save-settings">
      <h2>Settings</h2>
      <div class="form-grid">
        <label>Default shipping buffer (days)<input type="number" min="0" name="lead" value="${s.defaultLeadTimeDays}" /></label>
        <label>Ping me this many days before empty, on top of shipping<input type="number" min="0" name="alert" value="${s.alertWithinDays}" /></label>
        <label>Saved next order date<input type="date" name="next" value="${escapeHtml(s.nextOrderDate)}" /></label>
      </div>
      <label><span>Browser pings when you open this page and something is running low</span>
        <select name="notify">
          <option value="no" ${s.notifyEnabled ? "" : "selected"}>Off</option>
          <option value="yes" ${s.notifyEnabled ? "selected" : ""}>On — ask this browser</option>
        </select>
      </label>
      <p class="hint">Pings work while this page can run in the browser. They won’t email you from the cloud unless we add that later.</p>
      <menu>
        <button type="button" data-action="close-dialog">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </menu>
    </form>
  `;
}

function itemForm(item?: Item, duplicating = false): string {
  const presetOptions = PACK_PRESETS.map(
    (preset) =>
      `<option value="${preset.id}" ${item && presetMatchesItem(item, preset) ? "selected" : ""}>${escapeHtml(preset.label)}</option>`,
  ).join("");
  const mode = item?.usageMode ?? "ongoing";
  const isNew = !item || duplicating;
  const title = duplicating ? `Duplicate ${item?.name ?? "item"}` : item ? "Edit item" : "Add item";
  const name = duplicating && item ? `${item.name} copy` : (item?.name ?? "");
  const fromRooms = item?.useFromRooms ?? false;
  return `
    <form data-submit="save-item" data-usage="${mode}" data-from-rooms="${fromRooms ? "yes" : "no"}">
      <h2>${escapeHtml(title)}</h2>
      <input type="hidden" name="id" value="${escapeHtml(isNew ? "" : (item?.id ?? ""))}" />
      <label>Name<input name="name" required value="${escapeHtml(name)}" placeholder="Athena Bloom A, nitrile gloves…" /></label>
      <div class="form-grid">
        <label>Vendor<input name="vendor" value="${escapeHtml(item?.vendor ?? "")}" placeholder="Athena, etc." /></label>
        <label>Category
          <select name="category">
            ${["nutrient", "media", "ppe", "other"]
              .map(
                (cat) =>
                  `<option value="${cat}" ${item?.category === cat ? "selected" : ""}>${cat}</option>`,
              )
              .join("")}
          </select>
        </label>
      </div>
      <label>How it comes
        <select name="preset" data-action="preset-change">${presetOptions}</select>
      </label>
      <p class="hint">Count the piece you use. Order the case, box, or bundle. Starter cubes: count cubes (a sheet is 98, a box is 2,940). Slabs: count slabs, order bundles of 12. Blocks: count blocks, order cases of 144 (4") or 64 (6").</p>
      <div class="form-grid three">
        <label>You count<input name="countLabel" value="${escapeHtml(item?.countLabel ?? item?.orderLabel ?? "drum")}" /></label>
        <label>One order contains<input type="number" min="1" step="1" name="unitsPerBuy" value="${escapeHtml(item?.unitsPerBuy ?? 1)}" /></label>
        <label>Order as<input name="orderLabel" value="${escapeHtml(item?.orderLabel ?? "drum")}" /></label>
      </div>
      <div class="form-grid">
        <label>Contents of one (drums / bags / long spools)<input type="number" min="0.01" step="0.01" name="packSize" value="${escapeHtml(item?.packSize ?? 55)}" /></label>
        <label>Unit of that content<input name="packUnit" value="${escapeHtml(item?.packUnit ?? "gal")}" /></label>
      </div>
      <label>How you use it
        <select name="usageMode" data-action="usage-change">
          <option value="ongoing" ${mode === "ongoing" ? "selected" : ""}>Used regularly — nutrients, etc.</option>
          <option value="scheduled" ${mode === "scheduled" ? "selected" : ""}>On a schedule — trellis cut, rockwool set</option>
          <option value="dont_run_out" ${mode === "dont_run_out" ? "selected" : ""}>Just don’t run out — gloves, extra boxes</option>
        </select>
      </label>
      <div class="usage-block only-ongoing">
        <label>About how many per week, across all rooms<input type="number" min="0" step="0.01" name="roughPerWeek" value="${escapeHtml(item?.roughPerWeek ?? "")}" placeholder="leave blank if you’re not sure yet" /></label>
        <p class="hint">Not a room cycle — just a facility-wide guess. Audits and “used a bag” make it smarter.</p>
      </div>
      <div class="usage-block only-scheduled">
        <label class="check-row">
          <input type="checkbox" name="useFromRooms" data-action="rooms-change" ${fromRooms ? "checked" : ""} />
          Calculate from flower rooms
        </label>
        <p class="hint only-rooms-cut">Uses the typicals on the Rooms tab. Log the real number when you take clones, plant blocks, or set a room — extras are normal.</p>
        <div class="form-grid three only-manual-cut">
          <label>Every how many weeks<input type="number" min="1" name="useEveryWeeks" value="${escapeHtml(item?.useEveryWeeks ?? 5)}" /></label>
          <label>Need this much that day<input type="number" min="0.01" step="0.01" name="usePerEvent" value="${escapeHtml(item?.usePerEvent ?? "")}" placeholder="ft, spools, slabs…" /></label>
          <label>Next cut / use date<input type="date" name="nextUseDate" value="${escapeHtml(item?.nextUseDate ?? "")}" /></label>
        </div>
        <p class="hint only-manual-cut">We’ll make sure you have enough on that day, and that a replacement can arrive before the following one.</p>
      </div>
      <div class="usage-block only-par">
        <label>Remind me when this many are left<input type="number" min="0" step="0.1" name="reorderPoint" value="${escapeHtml(item?.reorderPoint ?? 2)}" /></label>
        <p class="hint">No weekly rate needed. When you hit that count, the order will be 1 case. Bump the quantity if you’re heading out.</p>
      </div>
      <label>Shipping buffer for this item (days)<input type="number" min="0" name="lead" value="${escapeHtml(item?.leadTimeDays ?? "")}" placeholder="use the default" /></label>
      ${
        isNew
          ? `<div class="form-grid">
              <label>Starting count on the shelf<input type="number" min="0" step="0.1" name="startPacks" value="0" /></label>
              <label>If a drum is open, gallons left<input type="number" min="0" step="0.5" name="startOpen" placeholder="optional" /></label>
            </div>`
          : ""
      }
      <label>Notes<textarea name="notes">${escapeHtml(item?.notes ?? "")}</textarea></label>
      <menu>
        <button type="button" data-action="close-dialog">Cancel</button>
        <button type="submit" class="primary">Save item</button>
      </menu>
    </form>
  `;
}

function consumeForm(state: AppState, item: Item): string {
  const count = countLabelOf(item);
  const kind = qtyKindForItem(item);
  const next = item.useFromRooms ? resolveNextCut(state) : null;
  const amount = item.useFromRooms
    ? next
      ? qtyFromPlan(next, kind)
      : 0
    : item.usageMode === "scheduled"
      ? (item.usePerEvent ?? 1)
      : 1;
  const roomOptions = (item.useFromRooms ? onlineRooms(state) : [])
    .map((room) => {
      const qty = roomQty(room, state.settings, kind);
      const extra = `${formatNumber(qty, 0)} ${kind === "ft" ? "ft" : count}`;
      return `<option value="${escapeHtml(room.id)}" ${next?.roomId === room.id ? "selected" : ""}>${escapeHtml(room.name)} · ${escapeHtml(extra)}</option>`;
    })
    .join("");
  const title = item.useFromRooms
    ? logActionLabel(item)
    : item.usageMode === "scheduled"
      ? "Log a cut / use day"
      : `Used ${escapeHtml(count)}`;
  const hint = item.useFromRooms
    ? kind === "cubes"
      ? "Type how many clones you took. Then how many went into 4\" or 6\" blocks — often around 95%, sometimes extra."
      : kind === "slabs"
        ? "Count slabs you set. A bundle is 12. Type slabs, not bundles."
        : kind === "blocks4" || kind === "blocks6" || kind === "blocks"
          ? "Type how many blocks you planted, not cases."
          : "We’ll subtract that room’s trellis footage."
    : "If you forget, a later audit will still correct the shelf.";
  const blocksDefault =
    kind === "cubes" && next ? next.blocks4 || next.blocks6 || next.blocks : 0;
  const blockItems = state.items.filter((entry) => !entry.archived && entry.packKind === "block");
  const defaultBlockId =
    blockItems.find((entry) => {
      const k = qtyKindForItem(entry);
      if (next?.blocks4 && k === "blocks4") return true;
      if (next?.blocks6 && k === "blocks6") return true;
      return false;
    })?.id ?? blockItems[0]?.id ?? "";
  return `
    <form data-submit="save-consume" data-qty="${kind}">
      <h2>${title}</h2>
      <p class="hint">${escapeHtml(item.name)}. ${escapeHtml(hint)}</p>
      ${
        item.useFromRooms
          ? `<label>Room<select name="roomId">${roomOptions || `<option value="">No online rooms</option>`}</select></label>
             <label class="check-row"><input type="checkbox" name="advance" ${kind === "ft" ? "checked" : ""} /> This was the scheduled next room — rotate after</label>`
          : ""
      }
      <div class="form-grid">
        <label>${kind === "cubes" ? "Clones / starter cubes" : `How many ${escapeHtml(count)}`}<input type="number" min="0.01" step="0.01" name="packs" value="${escapeHtml(amount)}" required /></label>
        <label>Date<input type="date" name="date" value="${escapeHtml(next?.date ?? "")}" required /></label>
      </div>
      ${
        kind === "cubes"
          ? `${
              blockItems.length
                ? `<label>Blocks planted into<select name="blockItemId">${blockItems
                    .map(
                      (entry) =>
                        `<option value="${escapeHtml(entry.id)}" ${entry.id === defaultBlockId ? "selected" : ""}>${escapeHtml(entry.name)}</option>`,
                    )
                    .join("")}</select></label>`
                : ""
            }
             <label>How many blocks planted<input type="number" min="0" step="1" name="blocks" value="${blocksDefault || ""}" placeholder="optional" />
             <p class="hint">Leave blank if you’re only logging cubes today.</p>`
          : ""
      }
      <label>Note<input name="note" placeholder="optional" /></label>
      <menu>
        <button type="button" data-action="close-dialog">Cancel</button>
        <button type="submit" class="primary">Log it</button>
      </menu>
    </form>
  `;
}

function swapForm(item: Item, status?: ItemStatus): string {
  const sealed = Math.max(0, (status?.sealedPacks ?? Math.floor(status?.onHandPacks ?? 0)) - 1);
  return `
    <form data-submit="save-swap">
      <h2>Swap drum</h2>
      <p class="hint">Count the old drum as used. Unopened drums go down by one, and the new drum starts full unless you change it. After a few swaps we’ll know how long a drum lasts.</p>
      <div class="form-grid">
        <label>New drum remaining (${escapeHtml(item.packUnit)})<input type="number" min="0" step="0.5" name="open" value="${escapeHtml(item.packSize)}" /></label>
        <label>Date<input type="date" name="date" required /></label>
      </div>
      <p class="hint">Estimated unopened after this swap: ${escapeHtml(sealed)}.</p>
      <label>Note<input name="note" placeholder="optional" /></label>
      <menu>
        <button type="button" data-action="close-dialog">Cancel</button>
        <button type="submit" class="primary">Log swap</button>
      </menu>
    </form>
  `;
}

function remainingForm(item: Item, status?: ItemStatus): string {
  return `
    <form data-submit="save-remaining">
      <h2>Estimate remaining</h2>
      <p class="hint">${escapeHtml(item.name)}. Unopened drums plus a guess on the open one is enough — it doesn’t have to be a dipstick reading.</p>
      <div class="form-grid">
        <label>Unopened drums<input type="number" min="0" step="1" name="sealed" value="${escapeHtml(status?.sealedPacks ?? 0)}" /></label>
        <label>Open drum (${escapeHtml(item.packUnit)})<input type="number" min="0" step="0.5" name="open" value="${escapeHtml(status?.openRemaining ?? "")}" /></label>
        <label>Date<input type="date" name="date" required /></label>
      </div>
      <label>Note<input name="note" placeholder="optional" /></label>
      <menu>
        <button type="button" data-action="close-dialog">Cancel</button>
        <button type="submit" class="primary">Save estimate</button>
      </menu>
    </form>
  `;
}

function detailView(state: AppState, item: Item, status?: ItemStatus): string {
  const events = [...itemEvents(state, item.id)].reverse().slice(0, 25);
  const rows = events
    .map((event) => {
      const extra =
        event.onHandPacks != null
          ? `${formatNumber(event.onHandPacks)} ${countLabelOf(item)}`
          : event.deltaPacks != null
            ? `${event.type === "receive" ? "+" : "−"}${event.deltaPacks}`
            : event.openRemaining != null
              ? `${formatNumber(event.openRemaining)} ${item.packUnit} open`
              : "";
      return `<tr><td>${escapeHtml(formatDate(event.at.slice(0, 10)))}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(extra)}</td><td>${escapeHtml(event.note)}</td></tr>`;
    })
    .join("");

  return `
    <div>
      <h2>${escapeHtml(item.name)}</h2>
      <p class="hint">${status ? `${formatOnHand(status)} · ${formatDaysLeft(status)} · ${status.usage.method}` : ""}</p>
      ${
        status?.usage.perWeek
          ? `<p>~${formatNumber(status.usage.perWeek, 2)} ${escapeHtml(countLabelOf(item))} / week (${escapeHtml(confidenceLabel(status))})</p>`
          : ""
      }
      <div class="actions">
        <button type="button" data-action="edit-item" data-id="${item.id}">Edit</button>
        ${
          item.packKind === "drum"
            ? `<button type="button" data-action="swap" data-id="${item.id}">Swap drum</button>`
            : `<button type="button" data-action="consume" data-id="${item.id}">${item.useFromRooms ? logActionLabel(item) : `Used ${escapeHtml(countLabelOf(item))}`}</button>`
        }
      </div>
      <div class="history">
        <table class="history-table">
          <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4">No history yet.</td></tr>`}</tbody>
        </table>
      </div>
      <menu>
        <button type="button" data-action="close-dialog">Close</button>
      </menu>
    </div>
  `;
}

export function orderText(
  state: AppState,
  coverUntil: string,
  bufferDays: number,
  lines: { itemId: string; packs: number; note: string }[],
): string {
  const rows = lines
    .filter((line) => line.packs > 0)
    .map((line) => {
      const item = state.items.find((entry) => entry.id === line.itemId);
      if (!item) return "";
      return `${item.name}  —  ${plural(line.packs, item.orderLabel)}${item.vendor ? `  (${item.vendor})` : ""}`;
    })
    .filter(Boolean);
  return [
    `Coastal Supply order`,
    `Cover until ${formatDate(coverUntil)} · ${bufferDays} day shipping buffer`,
    "",
    ...rows,
  ].join("\n");
}

export function orderCsv(
  state: AppState,
  lines: { itemId: string; packs: number; note: string }[],
): string {
  const header = "Item,Vendor,Packs,Unit,Note";
  const rows = lines
    .filter((line) => line.packs > 0)
    .map((line) => {
      const item = state.items.find((entry) => entry.id === line.itemId);
      if (!item) return "";
      const cells = [item.name, item.vendor, String(line.packs), item.orderLabel, line.note].map(
        (cell) => `"${String(cell).replaceAll('"', '""')}"`,
      );
      return cells.join(",");
    });
  return [header, ...rows.filter(Boolean)].join("\n");
}

export function defaultGenerated(
  state: AppState,
  coverUntil: string,
  bufferDays: number,
): { itemId: string; packs: number; note: string }[] {
  return allStatuses(state).map((status) => {
    const packs = suggestedOrderPacks(state, status, coverUntil, bufferDays);
    const days = Math.max(
      0,
      Math.round(
        (new Date(`${coverUntil}T12:00:00`).getTime() - Date.now()) / 86_400_000 + bufferDays,
      ),
    );
    const buy = buyLabelOf(status.item);
    let note = "Enough on hand through that date";
    if (packs > 0) {
      if (status.item.usageMode === "dont_run_out") {
        note = `${plural(packs, buy)} to stay above the reorder point`;
      } else if (status.item.usageMode === "scheduled") {
        note = status.item.useFromRooms
          ? `${plural(packs, buy)} so upcoming room runs are covered`
          : `${plural(packs, buy)} so the next cut(s) are covered`;
      } else {
        note = `${plural(packs, buy)} to last ~${days} days at current use`;
      }
    }
    return { itemId: status.item.id, packs, note };
  });
}
