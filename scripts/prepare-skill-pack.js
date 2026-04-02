#!/usr/bin/env node

/**
 * prepare-skill-pack.js
 *
 * Clones the feishu-skills git repo into <project-root>/skills-pack/
 * so that all distribution methods (npm publish, EXE installer, install.sh)
 * can bundle it directly. If skills-pack/ already exists and is up-to-date,
 * does a git pull instead of a fresh clone.
 *
 * Usage:  node scripts/prepare-skill-pack.js
 * Called by: npm prepublishOnly, build-installer.ps1, install.sh
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const GIT_URL = "https://github.com/hashSTACS-Global/feishu-skills.git";
const projectRoot = join(import.meta.dirname, "..");
const targetDir = join(projectRoot, "skills-pack");

function run(cmd, opts = {}) {
  console.log(`[skill-pack] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

if (existsSync(join(targetDir, ".git"))) {
  // Already cloned — pull latest
  console.log("[skill-pack] skills-pack/ exists, pulling latest...");
  run("git pull --ff-only", { cwd: targetDir });
} else {
  // Fresh clone
  console.log("[skill-pack] Cloning feishu-skills into skills-pack/...");
  run(`git clone --depth 1 ${GIT_URL} "${targetDir}"`);
}

console.log("[skill-pack] Done.");
