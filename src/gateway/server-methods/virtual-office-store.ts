/**
 * 虚拟办公室 - 空间状态管理（内存存储）
 * 核心设计：Agent 是空间的"成员"，虚拟办公室是 Agent 任务状态的可视化界面
 */
import { loadConfig } from "../../config/config.js";
import { listAgentsForGateway } from "../session-utils.js";

// ---- 类型定义 ----

export type RoomType = "desk" | "meeting" | "lounge" | "focus";
export type UserStatus = "online" | "away" | "busy" | "offline";

/** Agent 运行状态 */
export type AgentRunStatus = "idle" | "running" | "waiting" | "error";

/** Agent 成员（虚拟办公室中的 Agent 代表） */
export type AgentMember = {
  /** Agent ID（与系统 agent id 一致） */
  agentId: string;
  /** 显示名称 */
  displayName: string;
  /** emoji 图标 */
  emoji?: string;
  /** 头像 URL */
  avatarUrl?: string;
  /** 当前所在房间 */
  currentRoomId: string | null;
  /** 运行状态 */
  runStatus: AgentRunStatus;
  /** 当前任务描述 */
  currentTask?: string;
  /** 关联的 session key（用于聊天接入） */
  sessionKey?: string;
  /** 最后活跃时间 */
  lastActiveAt: number;
};

export type SpaceRoom = {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  /** 在场的 agent id 列表 */
  occupants: string[];
  aiEnabled: boolean;
  icon?: string;
  position?: { x: number; y: number; w: number; h: number };
};

export type UserPresence = {
  userId: string;
  displayName: string;
  currentRoomId: string | null;
  status: UserStatus;
  activity?: string;
  avatar?: string;
  position?: { x: number; y: number };
  lastSeen: number;
};

export type VirtualSpace = {
  id: string;
  name: string;
  rooms: SpaceRoom[];
};

/** 房间聊天消息 */
export type RoomChatMessage = {
  id: string;
  roomId: string;
  /** 发送者：userId（人类）或 agentId（Agent） */
  senderId: string;
  senderName: string;
  senderType: "human" | "agent";
  content: string;
  /** 是否是 AI 回复 */
  isAiReply: boolean;
  /** 关联的 agent session key（AI 消息时有值） */
  sessionKey?: string;
  timestamp: number;
};

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

const DEFAULT_SPACE_ID = "main";

// ---- 内存状态 ----

const spaces = new Map<string, VirtualSpace>([
  [
    DEFAULT_SPACE_ID,
    {
      id: DEFAULT_SPACE_ID,
      name: "办公室视图",
      rooms: DEFAULT_ROOMS.map((r) => ({ ...r, occupants: [] })),
    },
  ],
]);

/** 人类用户在线状态 */
const presences = new Map<string, UserPresence>();

/** Agent 成员状态（key = agentId） */
const agentMembers = new Map<string, AgentMember>();

/** 房间聊天消息（key = roomId，最多保留 200 条） */
const roomMessages = new Map<string, RoomChatMessage[]>();

const MAX_ROOM_MESSAGES = 200;

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

// ---- 人类用户在线状态操作 ----

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
    for (const space of spaces.values()) {
      for (const room of space.rooms) {
        const idx = room.occupants.indexOf(userId);
        if (idx !== -1) room.occupants.splice(idx, 1);
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

// ---- Agent 成员操作 ----

/** 从系统 agents.list 同步 Agent 成员到虚拟办公室 */
export function syncAgentMembers(): AgentMember[] {
  try {
    const cfg = loadConfig();
    const { agents, defaultId } = listAgentsForGateway(cfg);
    for (const agent of agents) {
      const existing = agentMembers.get(agent.id);
      if (!existing) {
        // 新 Agent：默认放在工位区
        const member: AgentMember = {
          agentId: agent.id,
          displayName: agent.identity?.name ?? agent.name ?? agent.id,
          emoji: agent.identity?.emoji,
          avatarUrl: agent.identity?.avatarUrl,
          currentRoomId: "workspace",
          runStatus: "idle",
          sessionKey: agent.id === defaultId ? "main" : `agent:${agent.id}:main`,
          lastActiveAt: Date.now(),
        };
        agentMembers.set(agent.id, member);
        // 加入工位区
        const space = spaces.get(DEFAULT_SPACE_ID);
        const room = space?.rooms.find((r) => r.id === "workspace");
        if (room && !room.occupants.includes(agent.id)) {
          room.occupants.push(agent.id);
        }
      } else {
        // 更新显示信息（不覆盖运行状态和位置）
        agentMembers.set(agent.id, {
          ...existing,
          displayName: agent.identity?.name ?? agent.name ?? agent.id,
          emoji: agent.identity?.emoji ?? existing.emoji,
          avatarUrl: agent.identity?.avatarUrl ?? existing.avatarUrl,
        });
      }
    }
    // 移除已删除的 Agent
    for (const [agentId] of agentMembers) {
      if (!agents.find((a) => a.id === agentId)) {
        removeAgentMember(agentId);
      }
    }
  } catch {
    // 配置加载失败时静默处理
  }
  return listAgentMembers();
}

export function listAgentMembers(): AgentMember[] {
  return [...agentMembers.values()];
}

export function getAgentMember(agentId: string): AgentMember | undefined {
  return agentMembers.get(agentId);
}

export function updateAgentMemberStatus(
  agentId: string,
  patch: Partial<Pick<AgentMember, "runStatus" | "currentTask" | "currentRoomId" | "sessionKey">>,
): AgentMember | undefined {
  const m = agentMembers.get(agentId);
  if (!m) return undefined;

  // 如果房间变化，更新 space.rooms.occupants
  if (patch.currentRoomId !== undefined && patch.currentRoomId !== m.currentRoomId) {
    const space = spaces.get(DEFAULT_SPACE_ID);
    if (space) {
      // 从旧房间移除
      if (m.currentRoomId) {
        const oldRoom = space.rooms.find((r) => r.id === m.currentRoomId);
        if (oldRoom) {
          const idx = oldRoom.occupants.indexOf(agentId);
          if (idx !== -1) oldRoom.occupants.splice(idx, 1);
        }
      }
      // 加入新房间
      if (patch.currentRoomId) {
        const newRoom = space.rooms.find((r) => r.id === patch.currentRoomId);
        if (newRoom && !newRoom.occupants.includes(agentId)) {
          newRoom.occupants.push(agentId);
        }
      }
    }
  }

  const updated: AgentMember = { ...m, ...patch, lastActiveAt: Date.now() };
  agentMembers.set(agentId, updated);
  return updated;
}

export function removeAgentMember(agentId: string): void {
  const m = agentMembers.get(agentId);
  if (m) {
    agentMembers.delete(agentId);
    for (const space of spaces.values()) {
      for (const room of space.rooms) {
        const idx = room.occupants.indexOf(agentId);
        if (idx !== -1) room.occupants.splice(idx, 1);
      }
    }
  }
}

// ---- 房间操作（人类用户） ----

export function moveUserToRoom(
  userId: string,
  roomId: string | null,
  spaceId = DEFAULT_SPACE_ID,
): { ok: boolean; error?: string; presence?: UserPresence } {
  const space = spaces.get(spaceId);
  if (!space) return { ok: false, error: "空间不存在" };

  const p = presences.get(userId);
  if (!p) return { ok: false, error: "用户未加入空间" };

  if (p.currentRoomId) {
    const oldRoom = space.rooms.find((r) => r.id === p.currentRoomId);
    if (oldRoom) {
      const idx = oldRoom.occupants.indexOf(userId);
      if (idx !== -1) oldRoom.occupants.splice(idx, 1);
    }
  }

  if (roomId) {
    const newRoom = space.rooms.find((r) => r.id === roomId);
    if (!newRoom) return { ok: false, error: "房间不存在" };
    if (newRoom.occupants.length >= newRoom.capacity) return { ok: false, error: "房间已满" };
    if (!newRoom.occupants.includes(userId)) newRoom.occupants.push(userId);
  }

  const updated: UserPresence = { ...p, currentRoomId: roomId, lastSeen: Date.now() };
  presences.set(userId, updated);
  return { ok: true, presence: updated };
}

// ---- 房间聊天消息操作 ----

export function getRoomMessages(roomId: string): RoomChatMessage[] {
  return roomMessages.get(roomId) ?? [];
}

export function addRoomMessage(msg: Omit<RoomChatMessage, "id" | "timestamp">): RoomChatMessage {
  const full: RoomChatMessage = {
    ...msg,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };
  const list = roomMessages.get(msg.roomId) ?? [];
  list.push(full);
  // 超出上限时裁剪旧消息
  if (list.length > MAX_ROOM_MESSAGES) {
    list.splice(0, list.length - MAX_ROOM_MESSAGES);
  }
  roomMessages.set(msg.roomId, list);
  return full;
}
