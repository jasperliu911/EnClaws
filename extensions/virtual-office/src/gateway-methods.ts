/**
 * 虚拟办公室 - Gateway WS 方法注册
 * 注册 space.* 系列方法供前端调用
 */
import type { GatewayRequestHandler } from "openclaw/plugin-sdk";
import {
  getDefaultSpaceId,
  getSpace,
  listPresences,
  listSpaces,
  moveUserToRoom,
  removePresence,
  updatePresenceStatus,
  upsertPresence,
} from "./space-store.js";
import type {
  SpaceJoinParams,
  SpaceLeaveParams,
  SpacePresenceSetParams,
  SpaceRoomMoveParams,
  SpaceStateEvent,
} from "./types.js";

// ---- 广播辅助 ----

function broadcastSpaceEvent(
  context: Parameters<GatewayRequestHandler>[0]["context"],
  event: string,
  payload: unknown,
): void {
  context.broadcast(event, payload);
}

// ---- space.list ----
// 获取所有空间列表（含房间和在场人员）

export const handleSpaceList: GatewayRequestHandler = ({ respond }) => {
  const spaces = listSpaces();
  const presences = listPresences();
  respond(true, { spaces, presences });
};

// ---- space.state ----
// 获取指定空间的完整状态

export const handleSpaceState: GatewayRequestHandler = ({ params, respond }) => {
  const spaceId = (params.spaceId as string | undefined) ?? getDefaultSpaceId();
  const space = getSpace(spaceId);
  if (!space) {
    respond(false, undefined, { code: "NOT_FOUND", message: "空间不存在" });
    return;
  }
  const presences = listPresences();
  const payload: SpaceStateEvent = { space, presences };
  respond(true, payload);
};

// ---- space.join ----
// 用户加入空间（建立在线状态）

export const handleSpaceJoin: GatewayRequestHandler = ({ params, respond, context }) => {
  const { userId, displayName, avatar } = params as SpaceJoinParams;
  if (!userId || !displayName) {
    respond(false, undefined, { code: "BAD_PARAMS", message: "缺少 userId 或 displayName" });
    return;
  }

  upsertPresence({
    userId,
    displayName,
    avatar,
    currentRoomId: null,
    status: "online",
    lastSeen: Date.now(),
  });

  const presences = listPresences();
  const space = getSpace();

  // 广播给所有连接的客户端
  broadcastSpaceEvent(context, "space.presence", {
    userId,
    presence: presences.find((p) => p.userId === userId),
  });

  respond(true, { space, presences });
};

// ---- space.leave ----
// 用户离开空间（清除在线状态）

export const handleSpaceLeave: GatewayRequestHandler = ({ params, respond, context }) => {
  const { userId } = params as SpaceLeaveParams;
  if (!userId) {
    respond(false, undefined, { code: "BAD_PARAMS", message: "缺少 userId" });
    return;
  }

  const removed = removePresence(userId);
  if (removed) {
    broadcastSpaceEvent(context, "space.presence", { userId, presence: null });
  }

  respond(true, { ok: true });
};

// ---- space.room.move ----
// 用户移动到指定房间（或离开所有房间传 null）

export const handleSpaceRoomMove: GatewayRequestHandler = ({ params, respond, context }) => {
  const { userId, roomId } = params as SpaceRoomMoveParams;
  if (!userId) {
    respond(false, undefined, { code: "BAD_PARAMS", message: "缺少 userId" });
    return;
  }

  const result = moveUserToRoom(userId, roomId ?? null);
  if (!result.ok) {
    respond(false, undefined, { code: "MOVE_FAILED", message: result.error ?? "移动失败" });
    return;
  }

  // 广播房间变化事件
  if (roomId) {
    broadcastSpaceEvent(context, "space.room.joined", {
      userId,
      roomId,
      presence: result.presence,
    });
  } else {
    broadcastSpaceEvent(context, "space.room.left", {
      userId,
      roomId: null,
      presence: result.presence,
    });
  }

  respond(true, { presence: result.presence });
};

// ---- space.presence.set ----
// 更新自己的状态/活动描述/2D 坐标

export const handleSpacePresenceSet: GatewayRequestHandler = ({ params, respond, context }) => {
  const { userId, status, activity, position } = params as SpacePresenceSetParams;
  if (!userId) {
    respond(false, undefined, { code: "BAD_PARAMS", message: "缺少 userId" });
    return;
  }

  const updated = updatePresenceStatus(userId, { status, activity, position });
  if (!updated) {
    respond(false, undefined, { code: "NOT_FOUND", message: "用户未加入空间" });
    return;
  }

  broadcastSpaceEvent(context, "space.presence", { userId, presence: updated });
  respond(true, { presence: updated });
};

// ---- space.room.list ----
// 获取房间列表及在场人员

export const handleSpaceRoomList: GatewayRequestHandler = ({ params, respond }) => {
  const spaceId = (params.spaceId as string | undefined) ?? getDefaultSpaceId();
  const space = getSpace(spaceId);
  if (!space) {
    respond(false, undefined, { code: "NOT_FOUND", message: "空间不存在" });
    return;
  }
  const presences = listPresences();
  respond(true, { rooms: space.rooms, presences });
};
