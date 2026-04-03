import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { normalizeUpdateTrack, type UpdateTrack } from "./update-channels.js";

const UPDATE_SETTINGS_FILENAME = "update-settings.json";

export type UpdateSettings = {
  track?: UpdateTrack;
  checkOnStart?: boolean;
  auto?: {
    enabled?: boolean;
    stableDelayHours?: number;
    stableJitterHours?: number;
    betaCheckIntervalHours?: number;
  };
};

export async function readUpdateSettings(): Promise<UpdateSettings> {
  const settingsPath = path.join(resolveStateDir(), UPDATE_SETTINGS_FILENAME);
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as UpdateSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeUpdateSettings(settings: UpdateSettings): Promise<void> {
  const settingsPath = path.join(resolveStateDir(), UPDATE_SETTINGS_FILENAME);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

export async function patchUpdateSettings(patch: Partial<UpdateSettings>): Promise<void> {
  const current = await readUpdateSettings();
  await writeUpdateSettings({ ...current, ...patch });
}

/** Returns the effective stored track: env var > settings file > null */
export async function getStoredUpdateTrack(): Promise<UpdateTrack | null> {
  const envTrack = normalizeUpdateTrack(process.env.ENCLAWS_UPDATE_TRACK);
  if (envTrack) {
    return envTrack;
  }
  const settings = await readUpdateSettings();
  return normalizeUpdateTrack(settings.track) ?? null;
}
