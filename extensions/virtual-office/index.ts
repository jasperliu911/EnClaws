/**
 * 虚拟办公室插件入口
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import {
  handleSpaceJoin,
  handleSpaceLeave,
  handleSpaceList,
  handleSpacePresenceSet,
  handleSpaceRoomList,
  handleSpaceRoomMove,
  handleSpaceState,
} from "./src/gateway-methods.js";

const plugin = {
  id: "virtual-office",
  name: "Virtual Office",
  description: "虚拟办公室 - 多人实时在线空间，支持 AI 助手接入",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // 注册所有 space.* Gateway WS 方法
    api.registerGatewayMethod("space.list", handleSpaceList);
    api.registerGatewayMethod("space.state", handleSpaceState);
    api.registerGatewayMethod("space.join", handleSpaceJoin);
    api.registerGatewayMethod("space.leave", handleSpaceLeave);
    api.registerGatewayMethod("space.room.list", handleSpaceRoomList);
    api.registerGatewayMethod("space.room.move", handleSpaceRoomMove);
    api.registerGatewayMethod("space.presence.set", handleSpacePresenceSet);

    api.logger.info("[virtual-office] 虚拟办公室插件已加载，共注册 7 个 Gateway 方法");
  },
};

export default plugin;
