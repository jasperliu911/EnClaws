/**
 * 虚拟办公室 - 前端 Controller
 * 负责与 Gateway WS 通信，管理本地状态
 * 核心：Agent 是空间成员，虚拟办公室是 Agent 任务状态的可视化界面
 */
import type { GatewayBrowserClient, GatewayEventFrame } from "../gateway.ts";

// ---- 类型定义（与后端保持一致） ----

export type RoomType = "desk" | "meeting" | "lounge" | "focus";
export type UserStatus = "online" | "away" | "busy" | "offline";
export type AgentRunStatus = "idle" | "running" | "waiting" | "error";

export type SpaceRoom = {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
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

/** Agent 成员（与系统 agents.list 联动） */
export type AgentMember = {
  agentId: string;
  displayName: string;
  emoji?: string;
  avatarUrl?: string;
  currentRoomId: string | null;
  runStatus: AgentRunStatus;
  currentTask?: string;
  sessionKey?: string;
  lastActiveAt: number;
};

/** 房间聊天消息 */
export type RoomChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderType: "human" | "agent";
  content: string;
  isAiReply: boolean;
  sessionKey?: string;
  timestamp: number;
};

export type VirtualSpace = {
  id: string;
  name: string;
  rooms: SpaceRoom[];
};

export type VirtualOfficeState = {
  loading: boolean;
  error: string | null;
  space: VirtualSpace | null;
  presences: UserPresence[];
  /** Agent 成员列表（与系统 agents.list 联动） */
  agents: AgentMember[];
  myUserId: string | null;
  myDisplayName: string | null;
  /** 当前选中/进入的房间 id */
  selectedRoomId: string | null;
  /** 各房间的聊天消息（key = roomId） */
  roomMessages: Record<string, RoomChatMessage[]>;
  /** 正在发送消息的房间 id */
  sendingRoomId: string | null;
};

// ---- Controller ----

export class VirtualOfficeController {
  private gateway: GatewayBrowserClient;
  private state: VirtualOfficeState = {
    loading: false,
    error: null,
    space: null,
    presences: [],
    agents: [],
    myUserId: null,
    myDisplayName: null,
    selectedRoomId: null,
    roomMessages: {},
    sendingRoomId: null,
  };
  private listeners: Array<(state: VirtualOfficeState) => void> = [];

  constructor(gateway: GatewayBrowserClient) {
    this.gateway = gateway;
  }

  getState(): VirtualOfficeState {
    return { ...this.state, roomMessages: { ...this.state.roomMessages } };
  }

  subscribe(fn: (state: VirtualOfficeState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(): void {
    const s = this.getState();
    for (const fn of this.listeners) {
      try { fn(s); } catch { /* ignore */ }
    }
  }

  private patch(patch: Partial<VirtualOfficeState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  // ---- 处理 Gateway 事件 ----

  handleEvent(evt: GatewayEventFrame): void {
    switch (evt.event) {
      // 人类用户在线状态变化
      case "space.presence": {
        const { userId, presence } = evt.payload as { userId: string; presence: UserPresence | null };
        if (!presence) {
          this.patch({ presences: this.state.presences.filter((p) => p.userId !== userId) });
        } else {
          const list = [...this.state.presences];
          const idx = list.findIndex((p) => p.userId === userId);
          if (idx >= 0) list[idx] = presence; else list.push(presence);
          const space = this.state.space ? this._syncRoomOccupants(this.state.space, list, this.state.agents) : null;
          this.patch({ presences: list, space });
        }
        break;
      }
      // Agent 状态变化（运行中/空闲/任务描述）
      case "space.agent.updated": {
        const { agentId, agent } = evt.payload as { agentId: string; agent: AgentMember };
        const list = [...this.state.agents];
        const idx = list.findIndex((a) => a.agentId === agentId);
        if (idx >= 0) list[idx] = agent; else list.push(agent);
        const space = this.state.space ? this._syncRoomOccupants(this.state.space, this.state.presences, list) : null;
        this.patch({ agents: list, space });
        break;
      }
      // 房间聊天消息（人类消息 + AI 回复都通过此事件推送）
      case "space.chat.message": {
        const { roomId, message } = evt.payload as { roomId: string; message: RoomChatMessage };
        const prev = this.state.roomMessages[roomId] ?? [];
        // 去重（防止自己发送时重复）
        if (prev.some((m) => m.id === message.id)) break;
        this.patch({
          roomMessages: { ...this.state.roomMessages, [roomId]: [...prev, message] },
        });
        break;
      }
      case "space.room.joined":
      case "space.room.left":
        // presence 事件已包含完整状态，此处可扩展 toast 提示
        break;
    }
  }

  /** 同步 space.rooms.occupants（人类 + Agent 都算） */
  private _syncRoomOccupants(
    space: VirtualSpace,
    presences: UserPresence[],
    agents: AgentMember[],
  ): VirtualSpace {
    const rooms = space.rooms.map((room) => ({
      ...room,
      occupants: [
        ...presences.filter((p) => p.currentRoomId === room.id).map((p) => p.userId),
        ...agents.filter((a) => a.currentRoomId === room.id).map((a) => a.agentId),
      ],
    }));
    return { ...space, rooms };
  }

  // ---- 加载空间状态（含 Agent 列表） ----

  async loadSpace(): Promise<void> {
    this.patch({ loading: true, error: null });
    try {
      const result = (await this.gateway.request("space.state")) as {
        space: VirtualSpace;
        presences: UserPresence[];
        agents: AgentMember[];
      };
      this.patch({
        loading: false,
        space: result.space,
        presences: result.presences,
        agents: result.agents ?? [],
      });
    } catch (err) {
      this.patch({ loading: false, error: err instanceof Error ? err.message : "加载失败" });
    }
  }

  // ---- 加入空间 ----

  async joinSpace(userId: string, displayName: string, avatar?: string): Promise<void> {
    try {
      const result = (await this.gateway.request("space.join", { userId, displayName, avatar })) as {
        space: VirtualSpace;
        presences: UserPresence[];
        agents: AgentMember[];
      };
      this.patch({
        myUserId: userId,
        myDisplayName: displayName,
        space: result.space,
        presences: result.presences,
        agents: result.agents ?? [],
      });
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : "加入失败" });
    }
  }

  // ---- 离开空间 ----

  async leaveSpace(): Promise<void> {
    if (!this.state.myUserId) return;
    try {
      await this.gateway.request("space.leave", { userId: this.state.myUserId });
      this.patch({ myUserId: null, myDisplayName: null, selectedRoomId: null });
    } catch { /* ignore */ }
  }

  // ---- 移动到房间（同时加载该房间的聊天历史） ----

  async moveToRoom(roomId: string | null): Promise<void> {
    if (!this.state.myUserId) return;
    try {
      await this.gateway.request("space.room.move", { userId: this.state.myUserId, roomId });
      this.patch({ selectedRoomId: roomId });
      // 进入房间时加载聊天历史
      if (roomId && !this.state.roomMessages[roomId]) {
        await this.loadRoomHistory(roomId);
      }
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : "移动失败" });
    }
  }

  // ---- 加载房间聊天历史 ----

  async loadRoomHistory(roomId: string): Promise<void> {
    try {
      const result = (await this.gateway.request("space.chat.history", { roomId })) as {
        roomId: string;
        messages: RoomChatMessage[];
      };
      this.patch({
        roomMessages: { ...this.state.roomMessages, [roomId]: result.messages },
      });
    } catch { /* ignore */ }
  }

  // ---- 发送房间消息（支持 @agentId 触发 AI） ----

  async sendMessage(roomId: string, content: string): Promise<void> {
    if (!this.state.myUserId || !this.state.myDisplayName || !content.trim()) return;
    this.patch({ sendingRoomId: roomId });
    try {
      await this.gateway.request("space.chat.send", {
        roomId,
        senderId: this.state.myUserId,
        senderName: this.state.myDisplayName,
        content: content.trim(),
      });
      // 消息通过 space.chat.message 事件广播回来，handleEvent 会处理
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : "发送失败" });
    } finally {
      this.patch({ sendingRoomId: null });
    }
  }

  // ---- 更新在线状态 ----

  async setPresence(opts: { status?: UserStatus; activity?: string; position?: { x: number; y: number } }): Promise<void> {
    if (!this.state.myUserId) return;
    try {
      await this.gateway.request("space.presence.set", { userId: this.state.myUserId, ...opts });
    } catch { /* ignore */ }
  }

  // ---- 选中房间（不移动，仅打开聊天面板） ----

  selectRoom(roomId: string | null): void {
    this.patch({ selectedRoomId: roomId });
    if (roomId && !this.state.roomMessages[roomId]) {
      void this.loadRoomHistory(roomId);
    }
  }

  // ---- 辅助方法 ----

  getMyPresence(): UserPresence | undefined {
    return this.state.presences.find((p) => p.userId === this.state.myUserId);
  }

  getRoomPresences(roomId: string): UserPresence[] {
    return this.state.presences.filter((p) => p.currentRoomId === roomId);
  }

  getRoomAgents(roomId: string): AgentMember[] {
    return this.state.agents.filter((a) => a.currentRoomId === roomId);
  }

  getRoomMessages(roomId: string): RoomChatMessage[] {
    return this.state.roomMessages[roomId] ?? [];
  }

  /** 获取房间内可 @ 的 Agent 列表（用于输入框提示） */
  getMentionableAgents(roomId: string): AgentMember[] {
    // 房间内的 Agent + 所有 Agent（全局可 @）
    const inRoom = this.state.agents.filter((a) => a.currentRoomId === roomId);
    const others = this.state.agents.filter((a) => a.currentRoomId !== roomId);
    return [...inRoom, ...others];
  }
}
