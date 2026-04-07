import { extractDeliveryInfo } from "../../config/sessions.js";
import { resolveOpenClawPackageRoot } from "../../infra/openclaw-root.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { runGatewayUpdate } from "../../infra/update-runner.js";
import { getStoredUpdateTrack } from "../../infra/update-settings.js";
import { markPendingUpdateRetry } from "../../infra/update-startup.js";
import { formatControlPlaneActor, resolveControlPlaneActor } from "../control-plane-audit.js";
import { validateUpdateRunParams } from "../protocol/index.js";
import { parseRestartRequestParams } from "./restart-request.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

export const updateHandlers: GatewayRequestHandlers = {
  "update.run": async ({ params, respond, client, context }) => {
    if (!assertValidParams(params, validateUpdateRunParams, "update.run", respond)) {
      return;
    }
    const actor = resolveControlPlaneActor(client);
    const { sessionKey, note, restartDelayMs } = parseRestartRequestParams(params);
    const { deliveryContext, threadId } = extractDeliveryInfo(sessionKey);
    const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs =
      typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
        ? Math.max(1000, Math.floor(timeoutMsRaw))
        : undefined;

    let result: Awaited<ReturnType<typeof runGatewayUpdate>>;
    try {
      const [storedTrack, root] = await Promise.all([
        getStoredUpdateTrack(),
        resolveOpenClawPackageRoot({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        }).then((r) => r ?? process.cwd()),
      ]);
      result = await runGatewayUpdate({
        timeoutMs,
        cwd: root,
        argv1: process.argv[1],
        track: storedTrack ?? undefined,
      });
    } catch (err) {
      result = {
        status: "error",
        mode: "unknown",
        reason: String(err),
        steps: [],
        durationMs: 0,
      };
    }

    const payload: RestartSentinelPayload = {
      kind: "update",
      status: result.status,
      ts: Date.now(),
      sessionKey,
      deliveryContext,
      threadId,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: result.mode,
        root: result.root ?? undefined,
        before: result.before ?? null,
        after: result.after ?? null,
        steps: result.steps.map((step) => ({
          name: step.name,
          command: step.command,
          cwd: step.cwd,
          durationMs: step.durationMs,
          log: {
            stdoutTail: step.stdoutTail ?? null,
            stderrTail: step.stderrTail ?? null,
            exitCode: step.exitCode ?? null,
          },
        })),
        reason: result.reason ?? null,
        durationMs: result.durationMs,
      },
    };

    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }

    // Restart the gateway after update:
    // - On success: restart to load updated code
    // - On Windows EBUSY failure (package mode): restart to release file locks,
    //   so the next auto-update retry can succeed
    // For git mode, add extra delay to ensure build output is fully flushed.
    const isWindowsEbusy =
      process.platform === "win32" &&
      result.status === "error" &&
      result.mode !== "git" &&
      result.steps?.some((s) => s.stderrTail?.includes("EBUSY"));
    if (isWindowsEbusy) {
      // Mark for retry on next startup — after restart, file locks are released
      const version = result.after?.version ?? result.before?.version;
      if (version) {
        await markPendingUpdateRetry(version, storedTrack ?? "stable");
      }
    }
    const shouldRestart = result.status === "ok" || isWindowsEbusy;
    const effectiveDelayMs = result.mode === "git" ? Math.max(restartDelayMs, 3000) : restartDelayMs;
    const restart = shouldRestart
        ? scheduleGatewaySigusr1Restart({
            delayMs: effectiveDelayMs,
            reason: isWindowsEbusy ? "update.run (ebusy-retry)" : "update.run",
            audit: {
              actor: actor.actor,
              deviceId: actor.deviceId,
              clientIp: actor.clientIp,
              changedPaths: [],
            },
          })
        : null;
    context?.logGateway?.info(
      `update.run completed ${formatControlPlaneActor(actor)} changedPaths=<n/a> restartReason=update.run status=${result.status}`,
    );
    if (restart?.coalesced) {
      context?.logGateway?.warn(
        `update.run restart coalesced ${formatControlPlaneActor(actor)} delayMs=${restart.delayMs}`,
      );
    }

    respond(
      true,
      {
        ok: result.status !== "error",
        result,
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
};
