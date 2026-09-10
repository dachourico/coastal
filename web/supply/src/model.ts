import type {
  AppState,
  Confidence,
  CutPlan,
  Item,
  ItemStatus,
  Order,
  StockEvent,
  UsageEstimate,
} from "./types";
import {
  firstUncoveredCut,
  jobForKind,
  qtyFromPlan,
  qtyKindForItem,
  qtyUnit,
  resolveNextJob,
  roomNeedInWindow,
} from "./rooms";

export function uid(): string {
  return crypto.randomUUID();
}

export function todayDate(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dateToIsoStart(date: string): string {
  if (date === todayDate()) return nowIso();
  return new Date(`${date}T12:00:00`).toISOString();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return (b - a) / 86_400_000;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function formatDate(date: string): string {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatNumber(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

export function plural(n: number, label: string): string {
  const abs = Math.abs(n);
  const shown = formatNumber(n, abs < 10 ? 1 : 0);
  if (abs === 1) return `${shown} ${label}`;
  if (label.endsWith("s")) return `${shown} ${label}`;
  if (/x$|ch$|sh$/.test(label)) return `${shown} ${label}es`;
  return `${shown} ${label}s`;
}

export function countLabelOf(item: Item): string {
  return item.countLabel || item.orderLabel;
}

export function buyLabelOf(item: Item): string {
  return item.orderLabel;
}

export function unitsPerBuyOf(item: Item): number {
  return item.unitsPerBuy > 0 ? item.unitsPerBuy : 1;
}

export function eventSize(item: Item): number {
  return item.usePerEvent && item.usePerEvent > 0 ? item.usePerEvent : 1;
}

export function cutSize(state: AppState, item: Item): number {
  if (item.useFromRooms) {
    const next = resolveNextJob(state, jobForKind(qtyKindForItem(item)));
    return next ? qtyFromPlan(next, qtyKindForItem(item)) : 0;
  }
  return eventSize(item);
}

export function nextScheduledDate(state: AppState, item: Item): string {
  if (item.useFromRooms) return resolveNextJob(state, jobForKind(qtyKindForItem(item)))?.date ?? todayDate();
  const weeks = item.useEveryWeeks && item.useEveryWeeks > 0 ? item.useEveryWeeks : 5;
  if (item.nextUseDate && item.nextUseDate >= todayDate()) return item.nextUseDate;
  const consumes = itemEvents(state, item.id).filter((event) => event.type === "consume");
  const last = consumes[consumes.length - 1];
  if (!last) return todayDate();
  let date = addDays(last.at.slice(0, 10), weeks * 7);
  while (date < todayDate()) date = addDays(date, weeks * 7);
  return date;
}

export function scheduledCutsInWindow(
  state: AppState,
  item: Item,
  coverUntil: string,
): number {
  const weeks = item.useEveryWeeks && item.useEveryWeeks > 0 ? item.useEveryWeeks : 5;
  let date = nextScheduledDate(state, item);
  let count = 0;
  while (date <= coverUntil) {
    count += 1;
    date = addDays(date, weeks * 7);
  }
  return count;
}

export function itemEvents(state: AppState, itemId: string): StockEvent[] {
  return state.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.itemId === itemId)
    .sort((a, b) => a.event.at.localeCompare(b.event.at) || a.index - b.index)
    .map(({ event }) => event);
}

export function currentStock(
  state: AppState,
  item: Item,
): { onHandPacks: number; sealedPacks: number; openRemaining: number | null } {
  const events = itemEvents(state, item.id);
  let onHandPacks = 0;
  let sealedPacks = 0;
  let openRemaining: number | null = null;
  let split = false;

  for (const event of events) {
    if (event.type === "audit" || event.type === "adjust") {
      if (event.sealedPacks != null || event.openRemaining !== undefined) {
        sealedPacks = event.sealedPacks ?? 0;
        openRemaining = event.openRemaining ?? null;
        split = openRemaining != null;
        onHandPacks =
          event.onHandPacks ??
          packsFromDrumFields(sealedPacks, openRemaining, item.packSize);
      } else if (event.onHandPacks != null) {
        onHandPacks = event.onHandPacks;
        split = false;
        openRemaining = null;
        sealedPacks = Math.floor(onHandPacks);
      }
    } else if (event.type === "consume") {
      onHandPacks = Math.max(0, onHandPacks - (event.deltaPacks ?? 1));
      if (split) {
        const units = onHandPacks * item.packSize;
        sealedPacks = Math.floor(units / item.packSize);
        openRemaining = units - sealedPacks * item.packSize;
      }
    } else if (event.type === "swap") {
      const newOpen = event.openRemaining ?? item.packSize;
      if (split) {
        sealedPacks = Math.max(0, sealedPacks - 1);
        openRemaining = newOpen;
        onHandPacks = sealedPacks + newOpen / item.packSize;
      } else {
        onHandPacks = Math.max(0, onHandPacks - 1);
        openRemaining = newOpen;
        sealedPacks = Math.max(0, onHandPacks - newOpen / item.packSize);
        onHandPacks = sealedPacks + newOpen / item.packSize;
        split = true;
      }
    } else if (event.type === "receive") {
      const delta = event.deltaPacks ?? 0;
      onHandPacks += delta;
      if (split) sealedPacks += delta;
    }
  }

  return { onHandPacks, sealedPacks, openRemaining: split ? openRemaining : null };
}

export function estimateUsage(state: AppState, item: Item): UsageEstimate {
  const priorPerDay =
    item.usageMode === "scheduled" && item.useEveryWeeks && item.useEveryWeeks > 0
      ? eventSize(item) / (item.useEveryWeeks * 7)
      : item.roughPerWeek && item.roughPerWeek > 0
        ? item.roughPerWeek / 7
        : item.typicalPerCycle && item.cycleWeeks > 0
          ? item.typicalPerCycle / (item.cycleWeeks * 7)
          : null;

  const events = itemEvents(state, item.id);
  const samples: { days: number; used: number; at: string }[] = [];

  let lastSnapshot: { at: string; packs: number } | null = null;
  let receivedSince = 0;
  let lastSwap: { at: string } | null = null;

  for (const event of events) {
    if (event.type === "receive") {
      receivedSince += event.deltaPacks ?? 0;
    }

    if (event.type === "swap") {
      if (lastSwap) {
        const days = daysBetween(lastSwap.at, event.at);
        if (days >= 3) samples.push({ days, used: 1, at: event.at });
      }
      lastSwap = { at: event.at };
    }

    if (event.type === "audit" || event.type === "adjust") {
      const packs = event.onHandPacks;
      if (packs == null) continue;
      if (lastSnapshot) {
        const days = daysBetween(lastSnapshot.at, event.at);
        if (days >= 1) {
          const used = lastSnapshot.packs + receivedSince - packs;
          if (used >= 0) samples.push({ days, used, at: event.at });
        }
      }
      lastSnapshot = { at: event.at, packs };
      receivedSince = 0;
    }
  }

  const consumeEvents = events.filter((e) => e.type === "consume");
  if (consumeEvents.length >= 2) {
    const first = consumeEvents[0];
    const last = consumeEvents[consumeEvents.length - 1];
    const days = daysBetween(first.at, last.at);
    const used = consumeEvents.reduce((sum, e) => sum + (e.deltaPacks ?? 1), 0);
    if (days >= 3 && used > 0) samples.push({ days, used, at: last.at });
  }

  let blended = 0;
  let weight = 0;
  const now = nowIso();
  for (const sample of samples) {
    if (sample.days <= 0 || sample.used < 0) continue;
    const rate = sample.used / sample.days;
    const recency = Math.max(0.25, 1 / (1 + daysBetween(sample.at, now) / 60));
    const span = Math.min(8, Math.sqrt(sample.days / 7));
    const w = recency * span;
    blended += rate * w;
    weight += w;
  }

  let perDay = 0;
  let method = "No usage yet";
  let confidence: Confidence = "none";

  if (weight > 0) {
    perDay = blended / weight;
    method =
      samples.length === 1
        ? "From your last count / swap"
        : `From ${samples.length} counts, swaps, and used packs`;
    const spanDays = samples.length
      ? daysBetween(samples[0].at, samples[samples.length - 1].at)
      : 0;
    if (samples.length >= 3 && spanDays >= 21) confidence = "high";
    else if (samples.length >= 2 || spanDays >= 14) confidence = "medium";
    else confidence = "low";
  } else if (priorPerDay && priorPerDay > 0) {
    perDay = priorPerDay;
    method = `About ${formatNumber(item.roughPerWeek ?? (priorPerDay ?? 0) * 7, 2)} ${countLabelOf(item)} / week`;
    confidence = "low";
  }

  if (priorPerDay && priorPerDay > 0 && weight > 0) {
    const priorWeight = confidence === "high" ? 0.15 : confidence === "medium" ? 0.35 : 0.55;
    perDay = perDay * (1 - priorWeight) + priorPerDay * priorWeight;
    method += ", blended with your weekly guess";
  }

  return {
    perDay,
    perWeek: perDay * 7,
    confidence,
    method,
    sampleCount: samples.length,
    priorPerDay,
  };
}

export function leadTimeFor(state: AppState, item: Item): number {
  return item.leadTimeDays ?? state.settings.defaultLeadTimeDays;
}

export function activeOrders(state: AppState): Order[] {
  return state.orders.filter((o) => o.status === "draft" || o.status === "placed");
}

export function itemCovered(state: AppState, itemId: string): boolean {
  return activeOrders(state).some((order) =>
    order.lines.some((line) => line.itemId === itemId && line.packs > 0),
  );
}

export function itemStatus(state: AppState, item: Item): ItemStatus {
  const stock = currentStock(state, item);
  const usage = estimateUsage(state, item);
  const leadTimeDays = leadTimeFor(state, item);
  const coveredByOrder = itemCovered(state, item.id);
  const count = stock.onHandPacks;

  let daysLeft: number | null =
    usage.perDay > 0 ? count / usage.perDay : count > 0 ? Infinity : 0;
  let orderBy: string | null = null;
  let alert: ItemStatus["alert"] = "unknown";

  if (item.usageMode === "dont_run_out") {
    const reorder = item.reorderPoint ?? 0;
    daysLeft = null;
    if (count <= 0 || (reorder > 0 && count <= reorder)) {
      alert = "urgent";
      orderBy = todayDate();
    } else if (reorder > 0 && count <= reorder * 2) {
      alert = "soon";
    } else if (reorder <= 0 && count <= 1) {
      alert = "soon";
    } else {
      alert = "ok";
    }
    usage.confidence = usage.confidence === "none" ? "low" : usage.confidence;
    if (usage.method === "No usage yet") {
      usage.method =
        reorder > 0
          ? `Don’t run out — order before you’re down to ${plural(reorder, countLabelOf(item))}`
          : "Don’t run out — order another case before the last boxes are gone";
    }
  } else if (item.usageMode === "scheduled") {
    const kind = qtyKindForItem(item);
    const next = item.useFromRooms ? resolveNextJob(state, jobForKind(qtyKindForItem(item))) : null;
    const need = cutSize(state, item);
    const weeks = item.useFromRooms
      ? state.settings.cutIntervalWeeks || 5
      : item.useEveryWeeks && item.useEveryWeeks > 0
        ? item.useEveryWeeks
        : 5;
    const nextDate = nextScheduledDate(state, item);
    if (item.useFromRooms && need <= 0) {
      daysLeft = null;
      orderBy = null;
      alert = "unknown";
      usage.method = "Add a typical for this room on the Rooms tab";
      usage.perDay = 0;
      usage.perWeek = 0;
    } else {
    let uncovered: CutPlan | null = null;
    if (item.useFromRooms) {
      uncovered = firstUncoveredCut(state, count, kind);
    } else {
      const cutsWeCanMake = need > 0 ? Math.floor((count + 1e-9) / need) : 0;
      uncovered = {
        roomId: "",
        roomName: "cut",
        date: addDays(nextDate, cutsWeCanMake * weeks * 7),
        ft: need,
        slabs: 0,
        cubes: 0,
        blocks: 0,
        blocks4: 0,
        blocks6: 0,
      };
    }
    const firstMissed = uncovered?.date ?? nextDate;
    daysLeft = Math.max(0, daysBetween(dateToIsoStart(todayDate()), dateToIsoStart(firstMissed)));
    orderBy = addDays(firstMissed, -leadTimeDays);
    const unit = qtyUnit(kind);
    usage.method = next
      ? `Next ${next.roomName} needs ${formatNumber(need, 0)} ${unit}${need === 1 || unit === "ft" ? "" : "s"}`
      : `Every ${weeks} weeks, need ${plural(need, countLabelOf(item))} on that day`;
    usage.confidence = "low";
    usage.perDay = need > 0 ? need / (weeks * 7) : 0;
    usage.perWeek = usage.perDay * 7;
    if (need > 0 && count < need) alert = "urgent";
    else if (daysLeft <= leadTimeDays) alert = "urgent";
    else if (daysLeft <= leadTimeDays + state.settings.alertWithinDays) alert = "soon";
    else alert = "ok";
    }
  } else if (usage.perDay > 0 && daysLeft !== null) {
    if (!Number.isFinite(daysLeft)) alert = "ok";
    else if (daysLeft <= leadTimeDays) alert = "urgent";
    else if (daysLeft <= leadTimeDays + state.settings.alertWithinDays) alert = "soon";
    else alert = "ok";
    if (Number.isFinite(daysLeft) && daysLeft !== Infinity) {
      orderBy = addDays(todayDate(), Math.floor(daysLeft - leadTimeDays));
    }
  } else if (count <= 0) {
    alert = "urgent";
  }

  if (coveredByOrder && alert === "urgent") alert = "soon";

  return {
    item,
    ...stock,
    onHandUnits: stock.onHandPacks * item.packSize,
    usage,
    daysLeft: daysLeft === Infinity ? null : daysLeft,
    orderBy,
    leadTimeDays,
    alert,
    coveredByOrder,
    nextCut: item.useFromRooms ? resolveNextJob(state, jobForKind(qtyKindForItem(item))) : null,
  };
}

export function allStatuses(state: AppState): ItemStatus[] {
  return state.items
    .filter((item) => !item.archived)
    .map((item) => itemStatus(state, item))
    .sort((a, b) => {
      const rank = { urgent: 0, soon: 1, unknown: 2, ok: 3 };
      const diff = rank[a.alert] - rank[b.alert];
      if (diff !== 0) return diff;
      return a.item.name.localeCompare(b.item.name);
    });
}

export function alertsToPing(state: AppState): ItemStatus[] {
  return allStatuses(state).filter((row) => {
    if (row.coveredByOrder) return false;
    return row.alert === "urgent" || row.alert === "soon";
  });
}

export function suggestedOrderPacks(
  state: AppState,
  status: ItemStatus,
  coverUntil: string,
  extraBufferDays: number,
): number {
  const item = status.item;
  const perBuy = unitsPerBuyOf(item);
  const coverDate = addDays(coverUntil, extraBufferDays);

  if (item.usageMode === "dont_run_out") {
    const reorder = item.reorderPoint ?? 0;
    if (status.onHandPacks > reorder && status.onHandPacks > 0) return 0;
    const target = Math.max(perBuy, reorder + perBuy);
    const shortfall = target - status.onHandPacks;
    if (shortfall <= 0) return 0;
    return Math.max(1, Math.ceil(shortfall / perBuy - 1e-9));
  }

  if (item.usageMode === "scheduled") {
    const kind = qtyKindForItem(item);
    const need = item.useFromRooms
      ? roomNeedInWindow(state, coverDate, kind)
      : eventSize(item) * scheduledCutsInWindow(state, item, coverDate);
    const shortfall = need - status.onHandPacks;
    if (shortfall <= 0) return 0;
    return Math.ceil(shortfall / perBuy - 1e-9);
  }

  if (status.usage.perDay <= 0) return 0;
  const days = Math.max(0, daysBetween(dateToIsoStart(todayDate()), dateToIsoStart(coverUntil)));
  const need = status.usage.perDay * (days + extraBufferDays);
  const shortfall = need - status.onHandPacks;
  if (shortfall <= 0) return 0;
  return Math.ceil(shortfall / perBuy - 1e-9);
}

export function formatOnHand(status: ItemStatus): string {
  const { item, onHandPacks, sealedPacks, openRemaining } = status;
  if (item.packKind === "drum" && openRemaining != null) {
    return `${formatNumber(sealedPacks, 0)} unopened · ${formatNumber(openRemaining, 0)} ${item.packUnit} open`;
  }
  const perBuy = unitsPerBuyOf(item);
  const count = countLabelOf(item);
  if (perBuy > 1) {
    const cases = Math.floor(onHandPacks / perBuy);
    const inner = onHandPacks - cases * perBuy;
    if (cases > 0 && inner > 0) {
      return `${plural(cases, buyLabelOf(item))} + ${plural(inner, count)}`;
    }
    if (cases > 0 && inner === 0) return plural(cases, buyLabelOf(item));
    return plural(onHandPacks, count);
  }
  if (
    (item.packKind === "bag" || item.packKind === "box" || item.packKind === "spool") &&
    openRemaining != null &&
    openRemaining > 0 &&
    openRemaining < item.packSize
  ) {
    return `${formatNumber(sealedPacks, 0)} sealed · ${formatNumber(openRemaining, 1)} ${item.packUnit} open`;
  }
  return plural(onHandPacks, count);
}

export function formatDaysLeft(status: ItemStatus): string {
  const item = status.item;
  if (item.usageMode === "dont_run_out") {
    const reorder = item.reorderPoint;
    if (status.onHandPacks <= 0) return "Out — order now";
    if (reorder != null && reorder > 0) {
      return `Reorder at ${plural(reorder, countLabelOf(item))}`;
    }
    return "Order another case before the last ones are gone";
  }
  if (item.usageMode === "scheduled") {
    const kind = qtyKindForItem(item);
    const need = item.useFromRooms && status.nextCut
      ? qtyFromPlan(status.nextCut, kind)
      : eventSize(item);
    const unit = item.useFromRooms && kind === "ft" ? "ft" : countLabelOf(item);
    if (status.onHandPacks < need) {
      return status.nextCut
        ? `Not enough for ${status.nextCut.roomName} (${formatNumber(need, 0)} ${unit}${need === 1 || unit === "ft" ? "" : "s"})`
        : "Not enough for the next run";
    }
    if (status.nextCut) {
      return `Next ${status.nextCut.roomName} · ${formatNumber(need, 0)} ${unit}${need === 1 || unit === "ft" ? "" : "s"} on ${formatDate(status.nextCut.date)}`;
    }
    if (status.orderBy) return `Next run covered · order by ${formatDate(status.orderBy)}`;
    return `Need ${plural(need, countLabelOf(item))} on that day`;
  }
  if (status.usage.confidence === "none") return "Optional weekly guess, or wait for audits";
  if (status.daysLeft == null) return "Plenty on hand";
  if (status.daysLeft <= 0) return "Out / overdue";
  if (status.daysLeft < 14) return `~${formatNumber(status.daysLeft, 0)} days left`;
  return `~${formatNumber(status.daysLeft / 7, 1)} weeks left`;
}

export function packsFromDrumFields(
  sealed: number,
  openRemaining: number | null,
  packSize: number,
): number {
  if (openRemaining == null) return sealed;
  return sealed + openRemaining / packSize;
}
