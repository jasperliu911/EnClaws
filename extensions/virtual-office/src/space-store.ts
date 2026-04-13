/**
 * 虚拟办公室 - 空间状态管理（内存存储）
 * Phase 1 使用内存存储，后续可迁移到 SQLite/PostgreSQL
 */
import type { SpaceRoom, UserPresence, VirtualSpace } from "./types.js";

// ---- 默认空间配置 ----

const DEFAULT_ROOMS: SpaceRoom[] = [
  {
    id: "lobby",
    name: "大厅",
    type: "lounge",
    capacity: 50,
    occupants: [],
    aiEnabled: true,
    icon: "🏢",
    position: { x: 20, y: 20, w: 160, h: 100 },
  },
  {
    id: "workspace",
    name: "工位区",
    type: "desk",
    capacity: 20,
    occupants: [],
    aiEnabled: true,
    icon: "💻",
    position: { x: 20, y: 140, w: 160, h: 120 },
  },
  {
    id: "meeting-a",
    name: "会议室 A",
    type: "meeting",
    capacity: 8,
    occupants: [],
    aiEnabled: true,
    icon: "📋",
    position: { x: 200, y: 20, w: 120, h: 100 },
  },
  {
    id: "meeting-b",
    name: "会议室 B",
    type: "meeting",
    capacity: 4,
    occupants: [],
    aiEnabled: false,
    icon: "🔒",
    position: { x: 200, y: 140, w: 120, h: 60 },
  },
  {
    id: "focus",
    name: "专注区",
    type: "focus",
    capacity: 5,
    occupants: [],
    aiEnabled: false,
    icon: "🎧",
    position: { x: 200, y: 220, w: 120, h: 60 },
  },
  {
    id: "lounge",
    name: "茶水间",
    type: "lounge",
    capacity: 10,
    occupants: [],
    aiEnabled: true,
    icon: "☕",
    position: { x: 340, y: 20, w: 100, h: 80 },
  },
];

// ---- 状态存储 ----

const DEFAULT_SPACE_ID = "main";

/** 空间列表（内存） */
const spaces = new Map<string, VirtualSpace>([
  [
    DEFAULT_SPACE_ID,
    {
      id: DEFAULT_SPACE_ID,
      name: "虚拟办公室",
      rooms: DEFAULT_ROOMS.map((r) => ({ ...r, occupants: [] })),
    },
  ],
]);

/** 用户在线状态（内存） */
const presences = new Map<string, UserPresence>();

// ---- 空间操作 ----

export function getSpace(spaceId = DEFAULT_SPACE_ID): VirtualSpace | undefined {
  return spaces.get(spaceId);
}

export function listSpaces(): VirtualSpace[] {
  return [...spaces.values()];
}

export function getDefaultSpaceId(): string {
  return DEFAULT_SPACE_ID;
}

// ---- 在线状态操作 ----

export function getPresence(userId: string): UserPresence | undefined {
  return presences.get(userId);
}

export function listPresences(): UserPresence[] {
  return [...presences.values()];
}

export function upsertPresence(presence: UserPresence): void {
  presences.set(presence.userId, { ...presence, lastSeen: Date.now() });
}

export function removePresence(userId: string): UserPresence | undefined {
  const p = presences.get(userId);
  if (p) {
    presences.delete(userId);
    // 从所有房间移除
    for (const space of spaces.values()) {
      for (const room of space.rooms) {
        const idx = room.occupants.indexOf(userId);
        if (idx !== -1) {
          room.occupants.splice(idx, 1);
        }
      }
    }
  }
  return p;
}

export function updatePresenceStatus(
  userId: string,
  patch: Partial<Pick<UserPresence, "status" | "activity" | "position">>,
): UserPresence | undefined {
  const p = presences.get(userId);
  if (!p) return undefined;
  const updated: UserPresence = { ...p, ...patch, lastSeen: Date.now() };
  presences.set(userId, updated);
  return updated;
}

// ---- 房间操作 ----

export function moveUserToRoom(
  userId: string,
  roomId: string | null,
  spaceId = DEFAULT_SPACE_ID,
): { ok: boolean; error?: string; presence?: UserPresence } {
  const space = spaces.get(spaceId);
  if (!space) return { ok: false, error: "空间不存在" };

  const p = presences.get(userId);
  if (!p) return { ok: false, error: "用户未加入空间" };

  // 从旧房间移除
  if (p.currentRoomId) {
    const oldRoom = space.rooms.find((r) => r.id === p.currentRoomId);
    if (oldRoom) {
      const idx = oldRoom.occupants.indexOf(userId);
      if (idx !== -1) oldRoom.occupants.splice(idx, 1);
    }
  }

  // 加入新房间
  if (roomId) {
    const newRoom = space.rooms.find((r) => r.id === roomId);
    if (!newRoom) return { ok: false, error: "房间不存在" };
    if (newRoom.occupants.length >= newRoom.capacity) {
      return { ok: false, error: "房间已满" };
    }
    if (!newRoom.occupants.includes(userId)) {
      newRoom.occupants.push(userId);
    }
  }

  const updated: UserPresence = { ...p, currentRoomId: roomId, lastSeen: Date.now() };
  presences.set(userId, updated);
  return { ok: true, presence: updated };
}

export function getRoomOccupants(roomId: string, spaceId = DEFAULT_SPACE_ID): UserPresence[] {
  const space = spaces.get(spaceId);
  if (!space) return [];
  const room = space.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  return room.occupants.map((uid) => presences.get(uid)).filter(Boolean) as UserPresence[];
}
