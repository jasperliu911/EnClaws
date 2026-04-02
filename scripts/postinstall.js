#!/usr/bin/env node

/**
 * postinstall script for enclaws.
 *
 * Runs after `npm install -g enclaws` to generate a working
 * ~/.enclaws/.env with sensible defaults so the gateway starts
 * out of the box. Skips if .env already exists (never overwrites).
 *
 * Zero dependencies — uses only Node built-ins.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Extract node_modules.tar (created by build-installer.ps1 to speed up install)
// ---------------------------------------------------------------------------
const appDir = join(import.meta.dirname, "..");
const tarPath = join(appDir, "node_modules.tar");

if (existsSync(tarPath) && !existsSync(join(appDir, "node_modules"))) {
  console.log("[enclaws] Extracting node_modules...");
  execSync(`tar -xf "${tarPath}"`, { cwd: appDir, stdio: "inherit" });
  unlinkSync(tarPath);
  console.log("[enclaws] node_modules extracted.");
}

const stateDir = join(homedir(), ".enclaws");
const envPath = join(stateDir, ".env");

if (existsSync(envPath)) {
  // Never overwrite user config
  process.exit(0);
}

const dbPath = join(stateDir, "data.db").replace(/\\/g, "/");

const content = `# EnClaws — auto-generated at install time
# Edit freely. This file is never overwritten by reinstall / upgrade.

OPENCLAW_DB_URL=sqlite:///${dbPath}
OPENCLAW_GATEWAY_PORT=18888
OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=true
OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS=http://localhost:18888,http://127.0.0.1:18888
`;

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(envPath, content, "utf-8");
  console.log(`[enclaws] Config created: ${envPath}`);
} catch (err) {
  console.warn(`[enclaws] Could not create ${envPath}:`, err.message);
}
