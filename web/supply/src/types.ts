export type PackKind =
  | "drum"
  | "bag"
  | "box"
  | "spool"
  | "slab"
  | "block"
  | "cube"
  | "each";

export type Category = "nutrient" | "media" | "ppe" | "other";

export type Tab = "stock" | "audit" | "order" | "catalog" | "rooms";

export type EventType = "audit" | "consume" | "swap" | "receive" | "adjust";

export type OrderStatus = "draft" | "placed" | "received";

export type Confidence = "none" | "low" | "medium" | "high";

export type UsageMode = "ongoing" | "scheduled" | "dont_run_out";

export interface Item {
  id: string;
  name: string;
  vendor: string;
  category: Category;
  packKind: PackKind;
  packSize: number;
  packUnit: string;
  orderLabel: string;
  countLabel: string;
  unitsPerBuy: number;
  usageMode: UsageMode;
  roughPerWeek: number | null;
  useEveryWeeks: number | null;
  usePerEvent: number | null;
  nextUseDate: string;
  reorderPoint: number | null;
  useFromRooms: boolean;
  cycleWeeks: number;
  typicalPerCycle: number | null;
  leadTimeDays: number | null;
  notes: string;
  archived: boolean;
  createdAt: string;
}

export interface StockEvent {
  id: string;
  itemId: string;
  type: EventType;
  at: string;
  onHandPacks?: number;
  sealedPacks?: number;
  openRemaining?: number | null;
  deltaPacks?: number;
  note: string;
}

export interface TableGroup {
  lengthFt: number;
  count: number;
}

export interface Room {
  id: string;
  name: string;
  online: boolean;
  sortOrder: number;
  tables: TableGroup[];
  slabs: number;
  cubes: number;
  blocks: number | null;
  blocks4: number | null;
  blocks6: number | null;
}

export type RoomQtyKind = "ft" | "slabs" | "cubes" | "blocks" | "blocks4" | "blocks6";

export interface CutPlan {
  roomId: string;
  roomName: string;
  date: string;
  ft: number;
  slabs: number;
  cubes: number;
  blocks: number;
  blocks4: number;
  blocks6: number;
}

export interface OrderLine {
  itemId: string;
  packs: number;
  note: string;
}

export interface Order {
  id: string;
  createdAt: string;
  coverUntil: string;
  leadTimeDays: number;
  status: OrderStatus;
  placedAt?: string;
  receivedAt?: string;
  lines: OrderLine[];
}

export interface Settings {
  defaultLeadTimeDays: number;
  defaultCycleWeeks: number;
  alertWithinDays: number;
  nextOrderDate: string;
  notifyEnabled: boolean;
  netOverhangInches: number;
  trellisLayers: number;
  cutIntervalWeeks: number;
  nextCutRoomId: string;
  nextCutDate: string;
  nextCloneRoomId: string;
  nextCloneDate: string;
  nextBlockRoomId: string;
  nextBlockDate: string;
  nextTrellisRoomId: string;
  nextTrellisDate: string;
  blockRate: number;
}

export interface AppState {
  version: 1;
  settings: Settings;
  items: Item[];
  events: StockEvent[];
  orders: Order[];
  rooms: Room[];
}

export interface PackPreset {
  id: string;
  label: string;
  packKind: PackKind;
  packSize: number;
  packUnit: string;
  orderLabel: string;
  countLabel: string;
  unitsPerBuy: number;
  category: Category;
  usageMode: UsageMode;
  useEveryWeeks?: number;
  reorderPoint?: number;
  useFromRooms?: boolean;
}

export interface UsageEstimate {
  perDay: number;
  perWeek: number;
  confidence: Confidence;
  method: string;
  sampleCount: number;
  priorPerDay: number | null;
}

export interface ItemStatus {
  item: Item;
  onHandPacks: number;
  sealedPacks: number;
  openRemaining: number | null;
  onHandUnits: number;
  usage: UsageEstimate;
  daysLeft: number | null;
  orderBy: string | null;
  leadTimeDays: number;
  alert: "ok" | "soon" | "urgent" | "unknown";
  coveredByOrder: boolean;
  nextCut: CutPlan | null;
}

export const PACK_PRESETS: PackPreset[] = [
  {
    id: "drum",
    label: "55 gal drum (liquid)",
    packKind: "drum",
    packSize: 55,
    packUnit: "gal",
    orderLabel: "drum",
    countLabel: "drum",
    unitsPerBuy: 1,
    category: "nutrient",
    usageMode: "ongoing",
  },
  {
    id: "bag",
    label: "25 lb bag (powder)",
    packKind: "bag",
    packSize: 25,
    packUnit: "lb",
    orderLabel: "bag",
    countLabel: "bag",
    unitsPerBuy: 1,
    category: "nutrient",
    usageMode: "ongoing",
  },
  {
    id: "box",
    label: "Case of inner boxes (gloves, etc.)",
    packKind: "box",
    packSize: 1,
    packUnit: "box",
    orderLabel: "case",
    countLabel: "box",
    unitsPerBuy: 12,
    category: "ppe",
    usageMode: "dont_run_out",
    reorderPoint: 2,
  },
  {
    id: "spool",
    label: "Trellis spool (3280 ft)",
    packKind: "spool",
    packSize: 3280,
    packUnit: "ft",
    orderLabel: "spool",
    countLabel: "ft",
    unitsPerBuy: 3280,
    category: "other",
    usageMode: "scheduled",
    useEveryWeeks: 5,
    useFromRooms: true,
  },
  {
    id: "slab",
    label: "Rockwool slabs (bundle of 12)",
    packKind: "slab",
    packSize: 1,
    packUnit: "slab",
    orderLabel: "bundle",
    countLabel: "slab",
    unitsPerBuy: 12,
    category: "media",
    usageMode: "scheduled",
    useEveryWeeks: 10,
    useFromRooms: true,
  },
  {
    id: "block4",
    label: "4\" grow blocks (case of 144)",
    packKind: "block",
    packSize: 1,
    packUnit: "block",
    orderLabel: "case",
    countLabel: "block",
    unitsPerBuy: 144,
    category: "media",
    usageMode: "scheduled",
    useEveryWeeks: 5,
    useFromRooms: true,
  },
  {
    id: "block6",
    label: "6\" grow blocks (case of 64)",
    packKind: "block",
    packSize: 1,
    packUnit: "block",
    orderLabel: "case",
    countLabel: "block",
    unitsPerBuy: 64,
    category: "media",
    usageMode: "scheduled",
    useEveryWeeks: 5,
    useFromRooms: true,
  },
  {
    id: "cube",
    label: "Starter cubes (30 sheets × 98 = 2,940)",
    packKind: "cube",
    packSize: 98,
    packUnit: "cubes/sheet",
    orderLabel: "box",
    countLabel: "cube",
    unitsPerBuy: 2940,
    category: "media",
    usageMode: "scheduled",
    useEveryWeeks: 5,
    useFromRooms: true,
  },
  {
    id: "each",
    label: "Count (each)",
    packKind: "each",
    packSize: 1,
    packUnit: "ea",
    orderLabel: "unit",
    countLabel: "unit",
    unitsPerBuy: 1,
    category: "other",
    usageMode: "ongoing",
  },
];

export function presetMatchesItem(item: Item, preset: PackPreset): boolean {
  if (item.packKind !== preset.packKind) return false;
  const siblings = PACK_PRESETS.filter((entry) => entry.packKind === item.packKind);
  if (siblings.length <= 1) return true;
  return item.unitsPerBuy === preset.unitsPerBuy;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultLeadTimeDays: 7,
  defaultCycleWeeks: 10,
  alertWithinDays: 10,
  nextOrderDate: "",
  notifyEnabled: false,
  netOverhangInches: 6,
  trellisLayers: 3,
  cutIntervalWeeks: 5,
  nextCutRoomId: "flower-3",
  nextCutDate: "",
  nextCloneRoomId: "flower-3",
  nextCloneDate: "",
  nextBlockRoomId: "flower-3",
  nextBlockDate: "",
  nextTrellisRoomId: "flower-3",
  nextTrellisDate: "",
  blockRate: 0.95,
};

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const incoming = raw ?? {};
  const merged: Settings = { ...DEFAULT_SETTINGS, ...incoming };
  if (!("nextCloneRoomId" in incoming) && !("nextCloneDate" in incoming)) {
    merged.nextCloneRoomId = merged.nextCutRoomId;
    merged.nextCloneDate = merged.nextCutDate;
  }
  if (!("nextBlockRoomId" in incoming) && !("nextBlockDate" in incoming)) {
    merged.nextBlockRoomId = merged.nextCutRoomId;
    merged.nextBlockDate = merged.nextCutDate;
  }
  if (!("nextTrellisRoomId" in incoming) && !("nextTrellisDate" in incoming)) {
    merged.nextTrellisRoomId = merged.nextCutRoomId;
    merged.nextTrellisDate = merged.nextCutDate;
  }
  merged.nextCutRoomId = merged.nextTrellisRoomId || merged.nextCutRoomId;
  merged.nextCutDate = merged.nextTrellisDate || merged.nextCutDate;
  return merged;
}

export function defaultRooms(): Room[] {
  return [
    { id: "flower-1", name: "Flower 1", online: false, sortOrder: 1, tables: [], slabs: 0, cubes: 0, blocks: null, blocks4: null, blocks6: null },
    { id: "flower-2", name: "Flower 2", online: false, sortOrder: 2, tables: [], slabs: 0, cubes: 0, blocks: null, blocks4: null, blocks6: null },
    {
      id: "flower-3",
      name: "Flower 3",
      online: true,
      sortOrder: 3,
      tables: [
        { lengthFt: 8, count: 44 },
        { lengthFt: 6, count: 4 },
      ],
      slabs: 0,
      cubes: 600,
      blocks: null,
      blocks4: null,
      blocks6: null,
    },
    {
      id: "flower-4",
      name: "Flower 4",
      online: true,
      sortOrder: 4,
      tables: [
        { lengthFt: 8, count: 36 },
        { lengthFt: 4, count: 6 },
      ],
      slabs: 0,
      cubes: 500,
      blocks: null,
      blocks4: null,
      blocks6: null,
    },
  ];
}

export function normalizeRoom(raw: Partial<Room>): Room {
  return {
    id: raw.id || crypto.randomUUID(),
    name: raw.name || "Room",
    online: raw.online ?? false,
    sortOrder: raw.sortOrder ?? 0,
    tables: (raw.tables ?? [])
      .map((row) => ({ lengthFt: Number(row.lengthFt) || 0, count: Number(row.count) || 0 }))
      .filter((row) => row.lengthFt > 0),
    slabs: Number(raw.slabs) || 0,
    cubes:
      raw.cubes != null
        ? Number(raw.cubes) || 0
        : raw.id === "flower-3"
          ? 600
          : raw.id === "flower-4"
            ? 500
            : 0,
    blocks: raw.blocks == null ? null : Number(raw.blocks) || 0,
    blocks4: raw.blocks4 == null ? null : Number(raw.blocks4) || 0,
    blocks6: raw.blocks6 == null ? null : Number(raw.blocks6) || 0,
  };
}

export function normalizeItem(raw: Partial<Item>): Item {
  const cycleWeeks = raw.cycleWeeks || 0;
  const typical = raw.typicalPerCycle ?? null;
  const name = raw.name || "";
  let usageMode = raw.usageMode;
  if (!usageMode) {
    if (/glove/i.test(name)) usageMode = "dont_run_out";
    else if (/trellis/i.test(name)) usageMode = "scheduled";
    else usageMode = "ongoing";
  }
  const roughPerWeek =
    raw.roughPerWeek ??
    (typical != null && cycleWeeks > 0 ? typical / cycleWeeks : null);
  let orderLabel = raw.orderLabel || "unit";
  let countLabel = raw.countLabel || orderLabel;
  let unitsPerBuy = raw.unitsPerBuy && raw.unitsPerBuy > 0 ? raw.unitsPerBuy : 1;
  let reorderPoint = raw.reorderPoint ?? null;
  let useEveryWeeks = raw.useEveryWeeks ?? null;
  let packSize = raw.packSize ?? 1;
  let packUnit = raw.packUnit || "ea";
  let packKind = raw.packKind || "each";
  let useFromRooms = raw.useFromRooms ?? false;
  if (!raw.usageMode && usageMode === "dont_run_out") {
    if (!raw.unitsPerBuy) unitsPerBuy = 12;
    if (!raw.countLabel) countLabel = "box";
    if (!raw.orderLabel || raw.orderLabel === "box") orderLabel = "case";
    if (reorderPoint == null) reorderPoint = 2;
  }
  if (!raw.usageMode && usageMode === "scheduled" && useEveryWeeks == null) {
    useEveryWeeks = 5;
  }
  if (/trellis/i.test(name) && raw.useFromRooms == null) {
    useFromRooms = true;
    if (!raw.unitsPerBuy || unitsPerBuy === 1) {
      unitsPerBuy = 3280;
      packSize = 3280;
      packUnit = "ft";
      countLabel = "ft";
      orderLabel = "spool";
      packKind = "spool";
    }
  }
  if (
    raw.useFromRooms == null &&
    (packKind === "slab" ||
      packKind === "block" ||
      packKind === "cube" ||
      /slab|starter cube|grow block/i.test(name))
  ) {
    useFromRooms = true;
    if (!raw.usageMode) usageMode = "scheduled";
    if (/cube|clone/i.test(name) && packKind === "each") packKind = "cube";
  }
  return {
    id: raw.id || "",
    name,
    vendor: raw.vendor || "",
    category: raw.category || "other",
    packKind,
    packSize,
    packUnit,
    orderLabel,
    countLabel,
    unitsPerBuy,
    usageMode,
    roughPerWeek,
    useEveryWeeks,
    usePerEvent: raw.usePerEvent ?? null,
    nextUseDate: raw.nextUseDate ?? "",
    reorderPoint,
    useFromRooms,
    cycleWeeks,
    typicalPerCycle: typical,
    leadTimeDays: raw.leadTimeDays ?? null,
    notes: raw.notes || "",
    archived: raw.archived ?? false,
    createdAt: raw.createdAt || "",
  };
}

export function emptyState(): AppState {
  return {
    version: 1,
    settings: normalizeSettings(DEFAULT_SETTINGS),
    items: [],
    events: [],
    orders: [],
    rooms: defaultRooms(),
  };
}

const MEDIA_CATALOG: {
  id: string;
  name: string;
  presetId: string;
  notes: string;
  match: (item: Item) => boolean;
}[] = [
  {
    id: "media-starter-cubes",
    name: "Starter cubes",
    presetId: "cube",
    notes: "Count cubes, not boxes. A sheet is 98 cubes. A box is 30 sheets (2,940).",
    match: (item) =>
      item.id === "media-starter-cubes" ||
      item.packKind === "cube" ||
      /starter cubes?/i.test(item.name),
  },
  {
    id: "media-blocks-4",
    name: "4\" grow blocks",
    presetId: "block4",
    notes: "Count blocks, not cases. A case is 144.",
    match: (item) =>
      item.id === "media-blocks-4" ||
      (item.packKind === "block" &&
        (item.unitsPerBuy === 144 || /4\s*"/.test(item.name) || /4\s*inch/i.test(item.name))),
  },
  {
    id: "media-blocks-6",
    name: "6\" grow blocks",
    presetId: "block6",
    notes: "Count blocks, not cases. A case is 64.",
    match: (item) =>
      item.id === "media-blocks-6" ||
      (item.packKind === "block" &&
        (item.unitsPerBuy === 64 || /6\s*"/.test(item.name) || /6\s*inch/i.test(item.name))),
  },
  {
    id: "media-slabs",
    name: "Rockwool slabs",
    presetId: "slab",
    notes: "Count slabs, not bundles. A bundle is 12.",
    match: (item) =>
      item.id === "media-slabs" ||
      item.packKind === "slab" ||
      /slab/i.test(item.name),
  },
];

export function ensureMediaCatalog(items: Item[]): { items: Item[]; added: string[] } {
  const next = [...items];
  const added: string[] = [];
  const used = new Set<string>();

  for (const spec of MEDIA_CATALOG) {
    const preset = PACK_PRESETS.find((entry) => entry.id === spec.presetId);
    if (!preset) continue;
    const existing = next.find((item) => !used.has(item.id) && spec.match(item));
    if (existing) {
      used.add(existing.id);
      const updated = normalizeItem({
        ...existing,
        packKind: preset.packKind,
        packSize: preset.packSize,
        packUnit: preset.packUnit,
        orderLabel: preset.orderLabel,
        countLabel: preset.countLabel,
        unitsPerBuy: preset.unitsPerBuy,
        usageMode: "scheduled",
        useEveryWeeks: preset.useEveryWeeks ?? existing.useEveryWeeks ?? 5,
        useFromRooms: true,
        category: "media",
        notes: existing.notes || spec.notes,
      });
      Object.assign(existing, updated, { id: existing.id, name: existing.name || spec.name });
    } else {
      next.push(
        normalizeItem({
          id: spec.id,
          name: spec.name,
          vendor: "",
          category: preset.category,
          packKind: preset.packKind,
          packSize: preset.packSize,
          packUnit: preset.packUnit,
          orderLabel: preset.orderLabel,
          countLabel: preset.countLabel,
          unitsPerBuy: preset.unitsPerBuy,
          usageMode: "scheduled",
          useEveryWeeks: preset.useEveryWeeks ?? 5,
          useFromRooms: true,
          notes: spec.notes,
          createdAt: new Date().toISOString(),
        }),
      );
      added.push(spec.name);
    }
  }

  return { items: next, added };
}
