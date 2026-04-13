// 虚拟办公室核心类型定义

export type RoomType = "desk" | "meeting" | "lounge" | "focus";

export type UserStatus = "online" | "away" | "busy" | "offline";

export type SpaceRoom = {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  /** 当前在场人员 userId 列表 */
  occupants: string[];
  /** 是否允许 AI 助手 */
  aiEnabled: boolean;
  /** 房间图标（emoji） */
  icon?: string;
  /** 2D 地图坐标 */
  position?: { x: number; y: number; w: number; h: number };
};

export type UserPresence = {
  userId: string;
  displayName: string;
  /** 当前所在房间 id，null 表示不在任何房间 */
  currentRoomId: string | null;
  status: UserStatus;
  /** 活动描述，如"正在编码" */
  activity?: string;
  /** 头像 URL 或 emoji */
  avatar?: string;
  /** 2D 地图上的坐标（Phase 4 使用） */
  position?: { x: number; y: number };
  lastSeen: number;
};

export type VirtualSpace = {
  id: string;
  name: string;
  rooms: SpaceRoom[];
};

// ---- WS 消息载荷类型 ----

export type SpaceJoinParams = {
  spaceId?: string;
  userId: string;
  displayName: string;
  avatar?: string;
};

export type SpaceLeaveParams = {
  userId: string;
};

export type SpaceRoomMoveParams = {
  userId: string;
  roomId: string | null;
};

export type SpacePresenceSetParams = {
  userId: string;
  status?: UserStatus;
  activity?: string;
  /** Phase 4：2D 坐标 */
  position?: { x: number; y: number };
};

// ---- WS 事件载荷类型 ----

export type SpacePresenceEvent = {
  userId: string;
  presence: UserPresence;
};

export type SpaceRoomJoinedEvent = {
  userId: string;
  roomId: string;
  presence: UserPresence;
};

export type SpaceRoomLeftEvent = {
  userId: string;
  roomId: string | null;
  presence: UserPresence;
};

export type SpaceStateEvent = {
  space: VirtualSpace;
  presences: UserPresence[];
};
