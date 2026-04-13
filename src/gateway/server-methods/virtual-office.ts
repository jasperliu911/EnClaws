/**
 * 虚拟办公室 - 核心 Gateway WS 方法
 *
 * 设计理念：Agent 是空间成员，虚拟办公室是 Agent 任务状态的可视化界面
 * - space.state / space.agents：与系统 agents.list 联动
 * - space.chat.send：复用 dispatchInboundMessage，真正触发 Agent 运行
 * - space.chat.history：房间聊天历史（独立于 chat.history）
 */
import { randomUUID } from "node:crypto";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import type { MsgContext } from "../../auto-reply/templating.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import { loadConfig } from "../../config/config.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { loadSessionEntry } from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  addRoomMessage,
  getAgentMember,
  getDefaultSpaceId,
  getRoomMessages,
  getSpace,
  listAgentMembers,
  listPresences,
  listSpaces,
  moveUserToRoom,
  removePresence,
  syncAgentMembers,
  updateAgentMemberStatus,
  updatePresenceStatus,
  upsertPresence,
} from "./virtual-office-store.js";

export const virtualOfficeHandlers: GatewayRequestHandlers = {
  // ---- space.list ----
  "space.list": ({ respond }) => {
    respond(true, { spaces: listSpaces(), presences: listPresences(), agents: syncAgentMembers() });
  },

  // ---- space.state：完整状态（含 Agent 成员，与系统 agents.list 联动） ----
  "space.state": ({ params, respond }) => {
    const spaceId = (params.spaceId as string | undefined) ?? getDefaultSpaceId();
    const space = getSpace(spaceId);
    if (!space) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "空间不存在"));
      return;
    }
    respond(true, { space, presences: listPresences(), agents: syncAgentMembers() });
  },

  // ---- space.agents：同步并获取 Agent 成员列表 ----
  "space.agents": ({ respond }) => {
    respond(true, { agents: syncAgentMembers() });
  },

  // ---- space.agent.status：更新 Agent 运行状态（供 hook 调用） ----
  "space.agent.status": ({ params, respond, context }) => {
    const agentId = params.agentId as string | undefined;
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少 agentId"));
      return;
    }
    const updated = updateAgentMemberStatus(agentId, {
      runStatus: params.runStatus as any,
      currentTask: params.currentTask as string | undefined,
      currentRoomId: params.currentRoomId as string | undefined,
      sessionKey: params.sessionKey as string | undefined,
    });
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Agent 不存在"));
      return;
    }
    context.broadcast("space.agent.updated", { agentId, agent: updated });
    respond(true, { agent: updated });
  },

  // ---- space.join ----
  "space.join": ({ params, respond, context }) => {
    const userId = params.userId as string | undefined;
    const displayName = params.displayName as string | undefined;
    if (!userId || !displayName) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少 userId 或 displayName"));
      return;
    }
    upsertPresence({
      userId, displayName,
      avatar: params.avatar as string | undefined,
      currentRoomId: null, status: "online", lastSeen: Date.now(),
    });
    const presences = listPresences();
    const agents = syncAgentMembers();
    context.broadcast("space.presence", { userId, presence: presences.find((p) => p.userId === userId) });
    respond(true, { space: getSpace(), presences, agents });
  },

  // ---- space.leave ----
  "space.leave": ({ params, respond, context }) => {
    const userId = params.userId as string | undefined;
    if (!userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少 userId"));
      return;
    }
    const removed = removePresence(userId);
    if (removed) context.broadcast("space.presence", { userId, presence: null });
    respond(true, { ok: true });
  },

  // ---- space.room.list ----
  "space.room.list": ({ params, respond }) => {
    const space = getSpace((params.spaceId as string | undefined) ?? getDefaultSpaceId());
    if (!space) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "空间不存在"));
      return;
    }
    respond(true, { rooms: space.rooms, presences: listPresences(), agents: listAgentMembers() });
  },

  // ---- space.room.move ----
  "space.room.move": ({ params, respond, context }) => {
    const userId = params.userId as string | undefined;
    const roomId = (params.roomId as string | null | undefined) ?? null;
    if (!userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少 userId"));
      return;
    }
    const result = moveUserToRoom(userId, roomId);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "移动失败"));
      return;
    }
    context.broadcast(roomId ? "space.room.joined" : "space.room.left", { userId, roomId, presence: result.presence });
    context.broadcast("space.presence", { userId, presence: result.presence });
    respond(true, { presence: result.presence });
  },

  // ---- space.presence.set ----
  "space.presence.set": ({ params, respond, context }) => {
    const userId = params.userId as string | undefined;
    if (!userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少 userId"));
      return;
    }
    const updated = updatePresenceStatus(userId, {
      status: params.status as any,
      activity: params.activity as string | undefined,
      position: params.position as { x: number; y: number } | undefined,
    });
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "用户未加入空间"));
      return;
    }
    context.broadcast("space.presence", { userId, presence: updated });
    respond(true, { presence: updated });
  },

  // ---- space.chat.history：获取房间聊天历史 ----
  "space.chat.history": ({ params, respond }) => {
    const roomId = params.roomId as string | undefined;
    if (!roomId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少 roomId"));
      return;
    }
    respond(true, { roomId, messages: getRoomMessages(roomId) });
  },

  // ---- space.chat.send：房间聊天 + AI 接入 ----
  // 复用 dispatchInboundMessage，与 chat.send 使用相同的 Agent 运行机制
  "space.chat.send": async ({ params, respond, context, client }) => {
    const roomId = params.roomId as string | undefined;
    const senderId = params.senderId as string | undefined;
    const senderName = params.senderName as string | undefined;
    const content = (params.content as string | undefined)?.trim();

    if (!roomId || !senderId || !senderName || !content) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "缺少必要参数"));
      return;
    }

    const space = getSpace();
    const room = space?.rooms.find((r) => r.id === roomId);
    if (!room) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "房间不存在"));
      return;
    }

    // 1. 存储并广播人类消息
    const humanMsg = addRoomMessage({ roomId, senderId, senderName, senderType: "human", content, isAiReply: false });
    context.broadcast("space.chat.message", { roomId, message: humanMsg });
    respond(true, { message: humanMsg });

    // 2. 解析 @agentId 或自动路由
    const atMatch = content.match(/^@(\S+)\s+([\s\S]+)$/);
    let targetAgentId: string | null = null;
    let messageForAgent = content;

    if (atMatch) {
      targetAgentId = atMatch[1];
      messageForAgent = atMatch[2];
    } else if (room.aiEnabled) {
      const agentsInRoom = listAgentMembers().filter((a) => a.currentRoomId === roomId);
      if (agentsInRoom.length > 0) {
        targetAgentId = agentsInRoom[0].agentId;
      }
    }

    if (!targetAgentId) return;

    const agentMember = getAgentMember(targetAgentId);
    if (!agentMember) return;

    // 3. 使用 Agent 的 sessionKey（与 chat.send 使用相同的 session）
    const sessionKey = agentMember.sessionKey ?? `agent:${targetAgentId}:main`;

    // 4. 更新 Agent 状态为 running
    updateAgentMemberStatus(targetAgentId, {
      runStatus: "running",
      currentTask: `回复 ${senderName} 在「${room.name}」的消息`,
    });
    context.broadcast("space.agent.updated", { agentId: targetAgentId, agent: getAgentMember(targetAgentId) });

    // 5. 异步触发 Agent 运行（复用 dispatchInboundMessage，与 chat.send 完全一致）
    void (async () => {
      const runId = randomUUID();
      try {
        const cfg = loadConfig();
        const { entry } = loadSessionEntry(sessionKey);
        const agentId = resolveSessionAgentId({ sessionKey, config: cfg });

        const ctx: MsgContext = {
          Body: messageForAgent,
          BodyForAgent: messageForAgent,
          BodyForCommands: messageForAgent,
          RawBody: messageForAgent,
          CommandBody: messageForAgent,
          SessionKey: sessionKey,
          Provider: INTERNAL_MESSAGE_CHANNEL,
          Surface: INTERNAL_MESSAGE_CHANNEL,
          OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
          ChatType: "direct",
          CommandAuthorized: true,
          MessageSid: runId,
          SenderId: senderId,
          SenderName: senderName,
          SenderUsername: senderName,
        };

        const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
          cfg, agentId, channel: INTERNAL_MESSAGE_CHANNEL,
        });

        const replyParts: string[] = [];
        const dispatcher = createReplyDispatcher({
          ...prefixOptions,
          onError: (err) => context.logGateway.warn(`space.chat.send dispatch error: ${formatForLog(err)}`),
          deliver: async (payload, info) => {
            if (info.kind !== "final") return;
            const text = payload.text?.trim() ?? "";
            if (text) replyParts.push(text);
          },
        });

        const abortController = new AbortController();
        context.chatAbortControllers.set(runId, {
          controller: abortController,
          sessionId: entry?.sessionId ?? runId,
          sessionKey,
          startedAtMs: Date.now(),
          expiresAtMs: Date.now() + 5 * 60 * 1000,
        });

        context.addChatRun(runId, { sessionKey, clientRunId: runId });

        const connId = typeof client?.connId === "string" ? client.connId : undefined;
        if (connId && hasGatewayClientCap(client?.connect?.caps, GATEWAY_CLIENT_CAPS.TOOL_EVENTS)) {
          context.registerToolEventRecipient(runId, connId);
        }

        await dispatchInboundMessage({
          ctx, cfg, dispatcher,
          replyOptions: {
            runId,
            abortSignal: abortController.signal,
            onAgentRunStart: (agentRunId) => {
              context.addChatRun(agentRunId, { sessionKey, clientRunId: runId });
            },
            onModelSelected,
          },
        });

        // 6. 将 AI 回复存入房间消息并广播
        const combinedReply = replyParts.filter(Boolean).join("\n\n").trim();
        if (combinedReply) {
          const agentMsg = addRoomMessage({
            roomId,
            senderId: targetAgentId!,
            senderName: agentMember.displayName,
            senderType: "agent",
            content: combinedReply,
            isAiReply: true,
            sessionKey,
          });
          context.broadcast("space.chat.message", { roomId, message: agentMsg });
        }
      } catch (err) {
        context.logGateway.warn(`space.chat.send agent error: ${formatForLog(err)}`);
      } finally {
        context.chatAbortControllers.delete(runId);
        context.removeChatRun(runId, runId, sessionKey);
        // 恢复 Agent 状态
        updateAgentMemberStatus(targetAgentId!, { runStatus: "idle", currentTask: undefined });
        context.broadcast("space.agent.updated", { agentId: targetAgentId, agent: getAgentMember(targetAgentId!) });
      }
    })();
  },
};
