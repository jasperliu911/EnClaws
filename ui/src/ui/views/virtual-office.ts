/**
 * 虚拟办公室 - Web UI 视图
 * - 房间列表视图（含 Agent 状态卡片）
 * - 房间聊天面板（消息列表 + 输入框 + @Agent 提示）
 * - 2D SVG 俯视图
 */
import { html, nothing } from "lit";
import type {
  AgentMember,
  RoomChatMessage,
  SpaceRoom,
  UserPresence,
  VirtualOfficeState,
} from "../controllers/virtual-office.ts";

// ---- 常量 ----

const ROOM_TYPE_COLORS: Record<string, string> = {
  desk: "#3b82f6",
  meeting: "#8b5cf6",
  lounge: "#10b981",
  focus: "#f59e0b",
};

const STATUS_COLORS: Record<string, string> = {
  online: "#22c55e",
  away: "#f59e0b",
  busy: "#ef4444",
  offline: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  away: "离开",
  busy: "忙碌",
  offline: "离线",
};

const AGENT_RUN_COLORS: Record<string, string> = {
  idle: "#22c55e",
  running: "#3b82f6",
  waiting: "#f59e0b",
  error: "#ef4444",
};

const AGENT_RUN_LABELS: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  waiting: "等待中",
  error: "错误",
};

// ---- 辅助：格式化时间 ----

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---- 头像 ----

function renderUserAvatar(presence: UserPresence, size = 32): ReturnType<typeof html> {
  const initial = presence.displayName?.[0]?.toUpperCase() ?? "?";
  const color = STATUS_COLORS[presence.status] ?? "#6b7280";
  return html`
    <div class="vo-avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.45)}px">
      ${presence.avatar
        ? html`<img src="${presence.avatar}" alt="${presence.displayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`
        : html`<span>${initial}</span>`}
      <span class="vo-avatar-dot" style="background:${color}"></span>
    </div>`;
}

function renderAgentAvatar(agent: AgentMember, size = 32): ReturnType<typeof html> {
  const color = AGENT_RUN_COLORS[agent.runStatus] ?? "#6b7280";
  return html`
    <div class="vo-avatar vo-avatar--agent" style="width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.5)}px">
      <span>${agent.emoji ?? "🤖"}</span>
      <span class="vo-avatar-dot" style="background:${color}"></span>
    </div>`;
}

// ---- Agent 状态卡片 ----

function renderAgentCard(agent: AgentMember): ReturnType<typeof html> {
  const runColor = AGENT_RUN_COLORS[agent.runStatus] ?? "#6b7280";
  const runLabel = AGENT_RUN_LABELS[agent.runStatus] ?? agent.runStatus;
  const isRunning = agent.runStatus === "running";
  return html`
    <div class="vo-agent-card ${isRunning ? "vo-agent-card--running" : ""}">
      ${renderAgentAvatar(agent, 36)}
      <div class="vo-agent-card__info">
        <div class="vo-agent-card__name">${agent.displayName}</div>
        <div class="vo-agent-card__status">
          <span class="vo-agent-run-dot ${isRunning ? "vo-agent-run-dot--pulse" : ""}"
            style="background:${runColor}"></span>
          <span style="color:${runColor};font-size:11px">${runLabel}</span>
          ${agent.currentTask
            ? html`<span class="vo-agent-card__task" title="${agent.currentTask}">· ${agent.currentTask}</span>`
            : nothing}
        </div>
      </div>
    </div>`;
}

// ---- 房间卡片 ----

function renderRoomCard(
  room: SpaceRoom,
  presences: UserPresence[],
  agents: AgentMember[],
  myUserId: string | null,
  selectedRoomId: string | null,
  onEnter: (roomId: string) => void,
  onLeave: () => void,
  onOpenChat: (roomId: string) => void,
): ReturnType<typeof html> {
  const humanOccupants = presences.filter((p) => p.currentRoomId === room.id);
  const agentOccupants = agents.filter((a) => a.currentRoomId === room.id);
  const totalCount = humanOccupants.length + agentOccupants.length;
  const isSelected = selectedRoomId === room.id;
  const isMeHere = humanOccupants.some((p) => p.userId === myUserId);
  const isFull = totalCount >= room.capacity;
  const color = ROOM_TYPE_COLORS[room.type] ?? "#6b7280";
  const hasRunningAgent = agentOccupants.some((a) => a.runStatus === "running");

  return html`
    <div class="vo-room-card ${isSelected ? "vo-room-card--selected" : ""} ${hasRunningAgent ? "vo-room-card--active" : ""}"
      style="--room-color:${color}">
      <div class="vo-room-card__header">
        <span class="vo-room-icon">${room.icon ?? "🏠"}</span>
        <div class="vo-room-info">
          <span class="vo-room-name">${room.name}</span>
          <span class="vo-room-count">${totalCount}/${room.capacity}</span>
        </div>
        <div class="vo-room-badges">
          ${room.aiEnabled ? html`<span class="vo-ai-badge" title="AI 助手可用">🤖</span>` : nothing}
          ${hasRunningAgent ? html`<span class="vo-running-badge" title="Agent 运行中">⚡</span>` : nothing}
        </div>
      </div>

      <!-- 人类成员 -->
      ${humanOccupants.length > 0 ? html`
        <div class="vo-room-occupants">
          ${humanOccupants.map((p) => html`
            <div class="vo-occupant" title="${p.displayName}${p.activity ? ` · ${p.activity}` : ""}">
              ${renderUserAvatar(p, 26)}
              <span class="vo-occupant-name">${p.displayName}</span>
            </div>`)}
        </div>` : nothing}

      <!-- Agent 成员 -->
      ${agentOccupants.length > 0 ? html`
        <div class="vo-room-agents">
          ${agentOccupants.map((a) => renderAgentCard(a))}
        </div>` : nothing}

      ${humanOccupants.length === 0 && agentOccupants.length === 0
        ? html`<div class="vo-room-empty">暂无人员</div>` : nothing}

      <div class="vo-room-actions">
        ${isMeHere ? html`
          <button class="vo-btn vo-btn--chat" @click=${() => onOpenChat(room.id)}>💬 聊天</button>
          <button class="vo-btn vo-btn--leave" @click=${onLeave}>离开</button>
        ` : html`
          <button class="vo-btn vo-btn--enter" ?disabled=${isFull} @click=${() => onEnter(room.id)}>
            ${isFull ? "已满" : "进入"}
          </button>
          ${room.aiEnabled ? html`
            <button class="vo-btn vo-btn--ghost vo-btn--sm" @click=${() => onOpenChat(room.id)} title="查看聊天">💬</button>
          ` : nothing}
        `}
      </div>
    </div>`;
}

// ---- 房间聊天面板 ----

function renderChatPanel(
  room: SpaceRoom,
  messages: RoomChatMessage[],
  agents: AgentMember[],
  myUserId: string | null,
  isSending: boolean,
  onSend: (content: string) => void,
  onClose: () => void,
): ReturnType<typeof html> {
  const color = ROOM_TYPE_COLORS[room.type] ?? "#6b7280";
  const agentsInRoom = agents.filter((a) => a.currentRoomId === room.id);
  const allAgents = agents;
  let inputVal = "";
  let showMentions = false;
  let mentionFilter = "";

  const handleInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    inputVal = val;
    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0) {
      showMentions = true;
      mentionFilter = val.slice(atIdx + 1).toLowerCase();
    } else {
      showMentions = false;
      mentionFilter = "";
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const val = (e.target as HTMLInputElement).value.trim();
      if (val) {
        onSend(val);
        (e.target as HTMLInputElement).value = "";
        inputVal = "";
        showMentions = false;
      }
    }
  };

  const handleSendClick = (inputEl: HTMLInputElement | null) => {
    const val = inputEl?.value.trim() ?? inputVal.trim();
    if (val) {
      onSend(val);
      if (inputEl) inputEl.value = "";
      inputVal = "";
    }
  };

  const mentionList = allAgents.filter((a) =>
    !mentionFilter || a.agentId.toLowerCase().includes(mentionFilter) || a.displayName.toLowerCase().includes(mentionFilter)
  );

  return html`
    <div class="vo-chat-panel">
      <!-- 聊天面板头部 -->
      <div class="vo-chat-panel__header" style="border-bottom-color:${color}40">
        <span class="vo-chat-panel__room">${room.icon ?? "🏠"} ${room.name}</span>
        ${room.aiEnabled ? html`
          <span class="vo-chat-hint" title="输入 @agentId 可指定 Agent 回复">
            🤖 ${agentsInRoom.length > 0 ? `${agentsInRoom[0].displayName} 在此` : "AI 可用"}
          </span>` : nothing}
        <button class="vo-chat-panel__close" @click=${onClose} title="关闭">✕</button>
      </div>

      <!-- 消息列表 -->
      <div class="vo-chat-messages" id="vo-chat-messages-${room.id}">
        ${messages.length === 0
          ? html`<div class="vo-chat-empty">
              ${room.aiEnabled
                ? html`<p>暂无消息</p><p class="vo-chat-empty__hint">直接发消息，或输入 <code>@agentId 内容</code> 指定 Agent 回复</p>`
                : html`<p>暂无消息</p>`}
            </div>`
          : messages.map((msg) => {
              const isMe = msg.senderId === myUserId;
              const isAgent = msg.senderType === "agent";
              return html`
                <div class="vo-chat-msg ${isMe ? "vo-chat-msg--me" : ""} ${isAgent ? "vo-chat-msg--agent" : ""}">
                  <div class="vo-chat-msg__meta">
                    ${isAgent ? html`<span class="vo-chat-msg__agent-icon">🤖</span>` : nothing}
                    <span class="vo-chat-msg__sender">${isMe ? "我" : msg.senderName}</span>
                    <span class="vo-chat-msg__time">${formatTime(msg.timestamp)}</span>
                  </div>
                  <div class="vo-chat-msg__bubble">${msg.content}</div>
                </div>`;
            })}
        ${isSending ? html`
          <div class="vo-chat-msg vo-chat-msg--agent vo-chat-msg--typing">
            <div class="vo-chat-msg__meta"><span class="vo-chat-msg__agent-icon">🤖</span><span class="vo-chat-msg__sender">Agent</span></div>
            <div class="vo-chat-msg__bubble"><span class="vo-typing-dot"></span><span class="vo-typing-dot"></span><span class="vo-typing-dot"></span></div>
          </div>` : nothing}
      </div>

      <!-- @mention 提示列表 -->
      ${showMentions && mentionList.length > 0 ? html`
        <div class="vo-mention-list">
          ${mentionList.slice(0, 6).map((a) => html`
            <div class="vo-mention-item" @mousedown=${(e: Event) => {
              e.preventDefault();
              // 将 @xxx 替换为选中的 agentId
              const inputEl = document.querySelector(`#vo-chat-input-${room.id}`) as HTMLInputElement | null;
              if (inputEl) {
                const atIdx = inputEl.value.lastIndexOf("@");
                inputEl.value = inputEl.value.slice(0, atIdx) + `@${a.agentId} `;
                inputVal = inputEl.value;
                inputEl.focus();
              }
              showMentions = false;
            }}>
              <span class="vo-mention-emoji">${a.emoji ?? "🤖"}</span>
              <span class="vo-mention-name">${a.displayName}</span>
              <span class="vo-mention-id">@${a.agentId}</span>
              <span class="vo-mention-status" style="color:${AGENT_RUN_COLORS[a.runStatus]}">${AGENT_RUN_LABELS[a.runStatus]}</span>
            </div>`)}
        </div>` : nothing}

      <!-- 输入框 -->
      <div class="vo-chat-input-row">
        <input
          id="vo-chat-input-${room.id}"
          class="vo-input vo-chat-input"
          type="text"
          placeholder="${room.aiEnabled ? "发消息，或 @agentId 触发 AI..." : "发消息..."}"
          ?disabled=${isSending}
          @input=${handleInput}
          @keydown=${handleKeydown}
        />
        <button
          class="vo-btn vo-btn--primary vo-btn--sm"
          ?disabled=${isSending}
          @click=${(e: Event) => {
            const row = (e.target as HTMLElement).closest(".vo-chat-input-row");
            const inputEl = row?.querySelector("input") as HTMLInputElement | null;
            handleSendClick(inputEl);
          }}
        >${isSending ? "⏳" : "发送"}</button>
      </div>
    </div>`;
}

// ---- 在线人员 + Agent 侧边栏 ----

function renderSidebar(presences: UserPresence[], agents: AgentMember[]): ReturnType<typeof html> {
  const onlineHumans = presences.filter((p) => p.status !== "offline");
  const runningAgents = agents.filter((a) => a.runStatus === "running");
  const idleAgents = agents.filter((a) => a.runStatus !== "running");

  return html`
    <div class="vo-sidebar">
      <!-- Agent 状态区 -->
      ${agents.length > 0 ? html`
        <div class="vo-sidebar__section">
          <div class="vo-sidebar__title">
            Agent 状态
            <span class="vo-count">${agents.length}</span>
            ${runningAgents.length > 0 ? html`<span class="vo-running-count">⚡${runningAgents.length} 运行中</span>` : nothing}
          </div>
          <div class="vo-sidebar__list">
            ${[...runningAgents, ...idleAgents].map((a) => html`
              <div class="vo-sidebar__item">
                ${renderAgentAvatar(a, 34)}
                <div class="vo-sidebar__item-info">
                  <span class="vo-sidebar__name">${a.displayName}</span>
                  <div class="vo-sidebar__meta">
                    <span class="vo-agent-run-dot ${a.runStatus === "running" ? "vo-agent-run-dot--pulse" : ""}"
                      style="background:${AGENT_RUN_COLORS[a.runStatus]}"></span>
                    <span style="color:${AGENT_RUN_COLORS[a.runStatus]};font-size:10px">${AGENT_RUN_LABELS[a.runStatus]}</span>
                    ${a.currentTask ? html`<span class="vo-sidebar__activity" title="${a.currentTask}">${a.currentTask}</span>` : nothing}
                  </div>
                </div>
              </div>`)}
          </div>
        </div>` : nothing}

      <!-- 在线成员区 -->
      <div class="vo-sidebar__section">
        <div class="vo-sidebar__title">在线成员 <span class="vo-count">${onlineHumans.length}</span></div>
        <div class="vo-sidebar__list">
          ${presences.length === 0
            ? html`<div class="vo-sidebar__empty">暂无在线成员</div>`
            : presences.map((p) => html`
                <div class="vo-sidebar__item">
                  ${renderUserAvatar(p, 34)}
                  <div class="vo-sidebar__item-info">
                    <span class="vo-sidebar__name">${p.displayName}</span>
                    <div class="vo-sidebar__meta">
                      <span class="vo-status-badge" style="background:${STATUS_COLORS[p.status]}20;color:${STATUS_COLORS[p.status]}">${STATUS_LABELS[p.status] ?? p.status}</span>
                      ${p.activity ? html`<span class="vo-sidebar__activity">${p.activity}</span>` : nothing}
                    </div>
                  </div>
                </div>`)}
        </div>
      </div>
    </div>`;
}

// ---- 加入面板 ----

function renderJoinPanel(onJoin: (name: string) => void): ReturnType<typeof html> {
  let inputValue = "";
  return html`
    <div class="vo-join-panel">
      <div class="vo-join-panel__icon">🏢</div>
      <h2 class="vo-join-panel__title">进入办公室视图</h2>
      <p class="vo-join-panel__desc">输入你的显示名称，查看 Agent 状态并与 AI 协作</p>
      <div class="vo-join-panel__form">
        <input class="vo-input" type="text" placeholder="你的名字" maxlength="20"
          @input=${(e: Event) => { inputValue = (e.target as HTMLInputElement).value; }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && inputValue.trim()) onJoin(inputValue.trim()); }}
        />
        <button class="vo-btn vo-btn--primary" @click=${() => { if (inputValue.trim()) onJoin(inputValue.trim()); }}>进入</button>
      </div>
    </div>`;
}

// ---- 2D SVG 俯视图 ----

function renderCanvas2D(
  space: import("../controllers/virtual-office.ts").VirtualSpace,
  presences: UserPresence[],
  agents: AgentMember[],
  myUserId: string | null,
  onRoomClick: (roomId: string) => void,
): ReturnType<typeof html> {
  const MAP_W = 460;
  const MAP_H = 300;

  return html`
    <div class="vo-map-container">
      <div class="vo-map-title">办公室平面图</div>
      <svg class="vo-map" viewBox="0 0 ${MAP_W} ${MAP_H}" xmlns="http://www.w3.org/2000/svg"
        style="width:100%;max-width:${MAP_W}px;height:auto">
        <rect width="${MAP_W}" height="${MAP_H}" fill="#1e293b" rx="8" />
        ${space.rooms.map((room) => {
          if (!room.position) return nothing;
          const { x, y, w, h } = room.position;
          const color = ROOM_TYPE_COLORS[room.type] ?? "#6b7280";
          const humanOcc = presences.filter((p) => p.currentRoomId === room.id);
          const agentOcc = agents.filter((a) => a.currentRoomId === room.id);
          const isMeHere = humanOcc.some((p) => p.userId === myUserId);
          const hasRunning = agentOcc.some((a) => a.runStatus === "running");

          return html`
            <g class="vo-map-room" @click=${() => onRoomClick(room.id)} style="cursor:pointer">
              <rect x="${x}" y="${y}" width="${w}" height="${h}"
                fill="${color}22"
                stroke="${isMeHere || hasRunning ? color : color + "55"}"
                stroke-width="${isMeHere || hasRunning ? 2 : 1}" rx="6" />
              <text x="${x + 8}" y="${y + 16}" fill="${color}" font-size="10" font-weight="600">
                ${room.icon ?? ""} ${room.name}
              </text>
              <text x="${x + 8}" y="${y + 28}" fill="#94a3b8" font-size="9">
                ${humanOcc.length + agentOcc.length}/${room.capacity}
              </text>
              <!-- 人类头像 -->
              ${humanOcc.map((p, i) => {
                const ax = x + 8 + (i % 5) * 20;
                const ay = y + h - 20;
                const isMe = p.userId === myUserId;
                return html`
                  <g title="${p.displayName}">
                    <circle cx="${ax + 8}" cy="${ay + 8}" r="8"
                      fill="${isMe ? color : "#334155"}"
                      stroke="${STATUS_COLORS[p.status] ?? "#6b7280"}" stroke-width="2" />
                    <text x="${ax + 8}" y="${ay + 12}" text-anchor="middle" fill="white" font-size="7" font-weight="bold">
                      ${p.displayName[0]?.toUpperCase() ?? "?"}
                    </text>
                  </g>`;
              })}
              <!-- Agent 头像 -->
              ${agentOcc.map((a, i) => {
                const ax = x + 8 + (humanOcc.length + i) % 5 * 20;
                const ay = y + h - 20;
                const rc = AGENT_RUN_COLORS[a.runStatus] ?? "#6b7280";
                return html`
                  <g title="${a.displayName} (${AGENT_RUN_LABELS[a.runStatus]})">
                    <circle cx="${ax + 8}" cy="${ay + 8}" r="8"
                      fill="#1e3a5f" stroke="${rc}" stroke-width="2" />
                    <text x="${ax + 8}" y="${ay + 12}" text-anchor="middle" fill="white" font-size="9">🤖</text>
                  </g>`;
              })}
            </g>`;
        })}
      </svg>
    </div>`;
}

// ---- 主视图 ----

export type VirtualOfficeViewMode = "list" | "map";

export type VirtualOfficeProps = {
  state: VirtualOfficeState;
  viewMode: VirtualOfficeViewMode;
  onJoin: (displayName: string) => void;
  onLeave: () => void;
  onEnterRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
  onSelectRoom: (roomId: string | null) => void;
  onSetViewMode: (mode: VirtualOfficeViewMode) => void;
  onSetActivity: (activity: string) => void;
  onSendMessage: (roomId: string, content: string) => void;
};

export function renderVirtualOffice(props: VirtualOfficeProps): ReturnType<typeof html> {
  const {
    state, viewMode,
    onJoin, onLeave, onEnterRoom, onLeaveRoom,
    onSelectRoom, onSetViewMode, onSendMessage,
  } = props;

  if (state.loading) {
    return html`<div class="vo-loading"><span class="vo-spinner"></span> 加载中...</div>`;
  }
  if (state.error) {
    return html`<div class="vo-error">⚠️ ${state.error}</div>`;
  }
  if (!state.myUserId) {
    return renderJoinPanel(onJoin);
  }

  const { space, presences, agents, myUserId, selectedRoomId, roomMessages, sendingRoomId } = state;
  if (!space) {
    return html`<div class="vo-error">空间数据不可用</div>`;
  }

  const myPresence = presences.find((p) => p.userId === myUserId);
  const myRoom = myPresence?.currentRoomId
    ? space.rooms.find((r) => r.id === myPresence.currentRoomId)
    : null;

  // 当前打开聊天面板的房间
  const chatRoom = selectedRoomId ? space.rooms.find((r) => r.id === selectedRoomId) : null;

  return html`
    <div class="vo-root">
      <!-- 顶部工具栏 -->
      <div class="vo-toolbar">
        <div class="vo-toolbar__left">
          <span class="vo-toolbar__title">🏢 ${space.name}</span>
          ${myRoom
            ? html`<span class="vo-toolbar__location">📍 ${myRoom.icon ?? ""} ${myRoom.name}</span>`
            : html`<span class="vo-toolbar__location vo-toolbar__location--none">未进入任何房间</span>`}
        </div>
        <div class="vo-toolbar__right">
          <div class="vo-view-toggle">
            <button class="vo-view-btn ${viewMode === "list" ? "vo-view-btn--active" : ""}"
              @click=${() => onSetViewMode("list")} title="列表视图">☰</button>
            <button class="vo-view-btn ${viewMode === "map" ? "vo-view-btn--active" : ""}"
              @click=${() => onSetViewMode("map")} title="地图视图">🗺</button>
          </div>
          <button class="vo-btn vo-btn--ghost" @click=${onLeave}>离开</button>
        </div>
      </div>

      <!-- 主体 -->
      <div class="vo-body">
        <!-- 左侧：房间列表 / 地图 + 聊天面板 -->
        <div class="vo-main ${chatRoom ? "vo-main--with-chat" : ""}">
          <!-- 房间区域 -->
          <div class="vo-rooms-area">
            ${viewMode === "map"
              ? renderCanvas2D(space, presences, agents, myUserId, (roomId) => {
                  onSelectRoom(roomId);
                  onEnterRoom(roomId);
                })
              : html`
                  <div class="vo-rooms-grid">
                    ${space.rooms.map((room) =>
                      renderRoomCard(
                        room, presences, agents, myUserId, selectedRoomId,
                        onEnterRoom, onLeaveRoom,
                        (roomId) => onSelectRoom(roomId),
                      ))}
                  </div>`}
          </div>

          <!-- 聊天面板（选中房间时显示） -->
          ${chatRoom ? renderChatPanel(
            chatRoom,
            roomMessages[chatRoom.id] ?? [],
            agents,
            myUserId,
            sendingRoomId === chatRoom.id,
            (content) => onSendMessage(chatRoom.id, content),
            () => onSelectRoom(null),
          ) : nothing}
        </div>

        <!-- 右侧：Agent 状态 + 在线人员 -->
        ${renderSidebar(presences, agents)}
      </div>
    </div>`;
}
