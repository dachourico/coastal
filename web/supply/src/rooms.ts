import type { AppState, CutPlan, Item, Room, RoomQtyKind, Settings } from "./types";

export type RoomJob = "clones" | "blocks" | "trellis";

function todayDate(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function formatFt(n: number): string {
  return String(Math.round(n));
}

export function netFtPerTable(
  lengthFt: number,
  overhangInches: number,
  layers: number,
): number {
  const extra = (overhangInches / 12) * 2;
  return (lengthFt + extra) * layers;
}

export function netFtForRoom(room: Room, settings: Settings): number {
  const overhang = settings.netOverhangInches || 6;
  const layers = settings.trellisLayers || 3;
  return room.tables.reduce(
    (sum, row) => sum + netFtPerTable(row.lengthFt, overhang, layers) * row.count,
    0,
  );
}

export function blockRateOf(settings: Settings): number {
  const rate = settings.blockRate;
  return rate > 0 && rate <= 1.5 ? rate : 0.95;
}

export function suggestedBlocks(room: Room, settings: Settings): number {
  if (room.blocks != null && room.blocks > 0) return room.blocks;
  return Math.round((room.cubes || 0) * blockRateOf(settings));
}

export function jobForKind(kind: RoomQtyKind): RoomJob {
  if (kind === "cubes") return "clones";
  if (kind === "blocks" || kind === "blocks4" || kind === "blocks6") return "blocks";
  return "trellis";
}

export function jobLabel(job: RoomJob): string {
  if (job === "clones") return "Clones";
  if (job === "blocks") return "Blocks";
  return "Trellis";
}

export function scheduleOf(settings: Settings, job: RoomJob): { roomId: string; date: string } {
  if (job === "clones") return { roomId: settings.nextCloneRoomId, date: settings.nextCloneDate };
  if (job === "blocks") return { roomId: settings.nextBlockRoomId, date: settings.nextBlockDate };
  return {
    roomId: settings.nextTrellisRoomId || settings.nextCutRoomId,
    date: settings.nextTrellisDate || settings.nextCutDate,
  };
}

export function setSchedule(settings: Settings, job: RoomJob, roomId: string, date: string): void {
  if (job === "clones") {
    settings.nextCloneRoomId = roomId;
    settings.nextCloneDate = date;
    return;
  }
  if (job === "blocks") {
    settings.nextBlockRoomId = roomId;
    settings.nextBlockDate = date;
    return;
  }
  settings.nextTrellisRoomId = roomId;
  settings.nextTrellisDate = date;
  settings.nextCutRoomId = roomId;
  settings.nextCutDate = date;
}

export function qtyKindForItem(item: Item): RoomQtyKind {
  if (item.packKind === "slab" || /slab/i.test(item.name)) return "slabs";
  if (item.packKind === "cube" || /cube|clone/i.test(item.name)) return "cubes";
  if (item.packKind === "block" || /block/i.test(item.name)) {
    if (item.unitsPerBuy === 64 || /6\s*"/.test(item.name) || /6\s*inch/i.test(item.name)) return "blocks6";
    if (item.unitsPerBuy === 144 || /4\s*"/.test(item.name) || /4\s*inch/i.test(item.name)) return "blocks4";
    return "blocks";
  }
  return "ft";
}

export function roomQty(room: Room, settings: Settings, kind: RoomQtyKind): number {
  if (kind === "slabs") return room.slabs || 0;
  if (kind === "cubes") return room.cubes || 0;
  if (kind === "blocks4") return room.blocks4 || 0;
  if (kind === "blocks6") return room.blocks6 || 0;
  if (kind === "blocks") return suggestedBlocks(room, settings);
  return netFtForRoom(room, settings);
}

export function qtyFromPlan(plan: CutPlan, kind: RoomQtyKind): number {
  if (kind === "slabs") return plan.slabs;
  if (kind === "cubes") return plan.cubes;
  if (kind === "blocks4") return plan.blocks4;
  if (kind === "blocks6") return plan.blocks6;
  if (kind === "blocks") return plan.blocks;
  return plan.ft;
}

export function qtyUnit(kind: RoomQtyKind): string {
  if (kind === "slabs") return "slab";
  if (kind === "cubes") return "cube";
  if (kind === "blocks" || kind === "blocks4" || kind === "blocks6") return "block";
  return "ft";
}

export function tableCounts(room: Room): { eight: number; six: number; four: number } {
  return {
    eight: room.tables.find((row) => row.lengthFt === 8)?.count ?? 0,
    six: room.tables.find((row) => row.lengthFt === 6)?.count ?? 0,
    four: room.tables.find((row) => row.lengthFt === 4)?.count ?? 0,
  };
}

export function describeTables(room: Room): string {
  const parts = [...room.tables]
    .sort((a, b) => b.lengthFt - a.lengthFt)
    .filter((row) => row.count > 0)
    .map((row) => `${row.count} × ${row.lengthFt} ft`);
  return parts.join(" · ") || "No tables yet";
}

export function roomIsActive(room: Room, settings: Settings): boolean {
  if (!room.online) return false;
  return (
    netFtForRoom(room, settings) > 0 ||
    (room.slabs || 0) > 0 ||
    (room.cubes || 0) > 0 ||
    suggestedBlocks(room, settings) > 0 ||
    (room.blocks4 || 0) > 0 ||
    (room.blocks6 || 0) > 0
  );
}

export function onlineRooms(state: AppState): Room[] {
  return [...state.rooms]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .filter((room) => roomIsActive(room, state.settings));
}

export function nextOnlineRoom(state: AppState, afterId: string): Room | null {
  const rooms = onlineRooms(state);
  if (!rooms.length) return null;
  const index = rooms.findIndex((room) => room.id === afterId);
  if (index < 0) return rooms[0];
  return rooms[(index + 1) % rooms.length];
}

export function planForRoom(room: Room, settings: Settings, date: string): CutPlan {
  return {
    roomId: room.id,
    roomName: room.name,
    date,
    ft: netFtForRoom(room, settings),
    slabs: room.slabs || 0,
    cubes: room.cubes || 0,
    blocks: suggestedBlocks(room, settings),
    blocks4: room.blocks4 || 0,
    blocks6: room.blocks6 || 0,
  };
}

export function resolveNextJob(state: AppState, job: RoomJob): CutPlan | null {
  const rooms = onlineRooms(state);
  if (!rooms.length) return null;
  const wanted = scheduleOf(state.settings, job);
  const room = rooms.find((entry) => entry.id === wanted.roomId) ?? rooms[0];
  const date = wanted.date && wanted.date >= todayDate() ? wanted.date : todayDate();
  return planForRoom(room, state.settings, date);
}

export function resolveNextCut(state: AppState): CutPlan | null {
  return resolveNextJob(state, "trellis");
}

export function upcomingCuts(state: AppState, coverUntil: string, extra = 12, job: RoomJob = "trellis"): CutPlan[] {
  const first = resolveNextJob(state, job);
  if (!first) return [];
  const weeks = state.settings.cutIntervalWeeks || 5;
  const plans: CutPlan[] = [];
  let roomId = first.roomId;
  let date = first.date;
  for (let i = 0; i < extra; i += 1) {
    const room = onlineRooms(state).find((entry) => entry.id === roomId);
    if (!room) break;
    if (date > coverUntil && i > 0) break;
    plans.push(planForRoom(room, state.settings, date));
    const next = nextOnlineRoom(state, room.id);
    if (!next) break;
    roomId = next.id;
    date = addDays(date, weeks * 7);
    if (i > 0 && date > coverUntil) break;
  }
  return plans.filter((plan, index) => index === 0 || plan.date <= coverUntil);
}

export function firstUncoveredCut(
  state: AppState,
  onHand: number,
  kind: RoomQtyKind = "ft",
): CutPlan | null {
  let remaining = onHand;
  const far = addDays(todayDate(), 365 * 3);
  for (const cut of upcomingCuts(state, far, 24, jobForKind(kind))) {
    const need = qtyFromPlan(cut, kind);
    if (need <= 0) continue;
    if (remaining + 1e-9 < need) return cut;
    remaining -= need;
  }
  return null;
}

export function roomNeedInWindow(
  state: AppState,
  coverUntil: string,
  kind: RoomQtyKind = "ft",
): number {
  return upcomingCuts(state, coverUntil, 12, jobForKind(kind)).reduce(
    (sum, cut) => sum + qtyFromPlan(cut, kind),
    0,
  );
}

export function advanceJobRotation(state: AppState, job: RoomJob, fromRoomId: string, cutDate: string): void {
  const current = scheduleOf(state.settings, job);
  if (current.roomId && current.roomId !== fromRoomId) return;
  const next = nextOnlineRoom(state, fromRoomId);
  const weeks = state.settings.cutIntervalWeeks || 5;
  setSchedule(state.settings, job, next?.id ?? "", addDays(cutDate, weeks * 7));
}

export function advanceCutRotation(state: AppState, fromRoomId: string, cutDate: string): void {
  advanceJobRotation(state, "trellis", fromRoomId, cutDate);
}

export function tablesFromCounts(eight: number, six: number, four: number): Room["tables"] {
  return [
    { lengthFt: 8, count: eight },
    { lengthFt: 6, count: six },
    { lengthFt: 4, count: four },
  ].filter((row) => row.count > 0);
}

export function cutPreview(state: AppState): string {
  const rooms = onlineRooms(state);
  if (!rooms.length) return "Turn a flower room online and add tables or media counts.";
  return rooms
    .map((room) => {
      const bits = [`${formatFt(netFtForRoom(room, state.settings))} ft`];
      if (room.cubes) bits.push(`${room.cubes} cubes`);
      if (room.blocks4) bits.push(`${room.blocks4} 4" blocks`);
      if (room.blocks6) bits.push(`${room.blocks6} 6" blocks`);
      if (!room.blocks4 && !room.blocks6) {
        const blocks = suggestedBlocks(room, state.settings);
        if (blocks) bits.push(`~${blocks} blocks`);
      }
      if (room.slabs) bits.push(`${room.slabs} slabs`);
      return `${room.name} ${bits.join(" · ")}`;
    })
    .join(" · ");
}

export function logActionLabel(item: Item): string {
  const kind = qtyKindForItem(item);
  if (kind === "cubes") return "Log clones";
  if (kind === "blocks4") return "Log 4\" blocks";
  if (kind === "blocks6") return "Log 6\" blocks";
  if (kind === "blocks") return "Log blocks";
  if (kind === "slabs") return "Log slabs";
  if (kind === "ft") return "Log cut";
  return "Log use";
}
