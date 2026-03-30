import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary, resolveNodeManagerOptions } from "./onboard-helpers.js";

function summarizeInstallFailure(message: string): string | undefined {
  const cleaned = message.replace(/^Install failed(?:\s*\([^)]*\))?\s*:?\s*/i, "").trim();
  if (!cleaned) {
    return undefined;
  }
  const maxLen = 140;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function formatSkillHint(skill: {
  description?: string;
  install: Array<{ label: string }>;
}): string {
  const desc = skill.description?.trim();
  const installLabel = skill.install[0]?.label?.trim();
  const combined = desc && installLabel ? `${desc} — ${installLabel}` : desc || installLabel;
  if (!combined) {
    return "install";
  }
  const maxLen = 90;
  return combined.length > maxLen ? `${combined.slice(0, maxLen - 1)}…` : combined;
}

function upsertSkillEntry(
  cfg: OpenClawConfig,
  skillKey: string,
  patch: { apiKey?: string },
): OpenClawConfig {
  const entries = { ...cfg.skills?.entries };
  const existing = (entries[skillKey] as { apiKey?: string } | undefined) ?? {};
  entries[skillKey] = { ...existing, ...patch };
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries,
    },
  };
}

export async function setupSkills(
  cfg: OpenClawConfig,
  workspaceDir: string,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const report = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
  const eligible = report.skills.filter((s) => s.eligible);
  const unsupportedOs = report.skills.filter(
    (s) => !s.disabled && !s.blockedByAllowlist && s.missing.os.length > 0,
  );
  const missing = report.skills.filter(
    (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist && s.missing.os.length === 0,
  );
  const blocked = report.skills.filter((s) => s.blockedByAllowlist);

  await prompter.note(
    [
      `满足条件 (Eligible): ${eligible.length}`,
      `缺失依赖 (Missing requirements): ${missing.length}`,
      `暂不支持当前系统 (Unsupported on this OS): ${unsupportedOs.length}`,
      `被白名单拦截 (Blocked by allowlist): ${blocked.length}`,
    ].join("\n"),
    "能力插件状态 (Skills status)",
  );

  const shouldConfigure = await prompter.confirm({
    message: "现在配置技能插件吗？ (Configure skills now? - 推荐)",
    initialValue: true,
  });
  if (!shouldConfigure) {
    return cfg;
  }

  const installable = missing.filter(
    (skill) => skill.install.length > 0 && skill.missing.bins.length > 0,
  );
  let next: OpenClawConfig = cfg;
  if (installable.length > 0) {
    const toInstall = await prompter.multiselect({
      message: "安装缺失的插件依赖 (Install missing skill dependencies)",
      options: [
        {
          value: "__skip__",
          label: "暂时跳过 (Skip for now)",
          hint: "不安装依赖继续 (Continue without installing dependencies)",
        },
        ...installable.map((skill) => ({
          value: skill.name,
          label: `${skill.emoji ?? "🧩"} ${skill.name}`,
          hint: formatSkillHint(skill),
        })),
      ],
    });

    const selected = toInstall.filter((name) => name !== "__skip__");

    const selectedSkills = selected
      .map((name) => installable.find((s) => s.name === name))
      .filter((item): item is (typeof installable)[number] => Boolean(item));

    const needsBrewPrompt =
      process.platform !== "win32" &&
      selectedSkills.some((skill) => skill.install.some((option) => option.kind === "brew")) &&
      !(await detectBinary("brew"));

    if (needsBrewPrompt) {
      await prompter.note(
        [
          "许多技能插件依赖通过 Homebrew 发布。",
          "如果没有 brew，您可能需要手动从源码编译或下载发布版。",
        ].join("\n"),
        "推荐安装 Homebrew (Homebrew recommended)",
      );
      const showBrewInstall = await prompter.confirm({
        message: "显示 Homebrew 安装命令？ (Show Homebrew install command?)",
        initialValue: true,
      });
      if (showBrewInstall) {
        await prompter.note(
          [
            "Run:",
            '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          ].join("\n"),
          "Homebrew install",
        );
      }
    }
    const needsScoopPrompt =
      process.platform === "win32" &&
      selectedSkills.some((skill) =>
        skill.install.some((option) => option.kind === "scoop" || option.kind === "brew"),
      ) &&
      !(await detectBinary("scoop"));

    if (needsScoopPrompt) {
      await prompter.note(
        [
          "Scoop 是一个适用于 Windows 的优秀包管理器，可安装许多技能插件依赖。",
          "如果没有 scoop，您可能需要手动下载发布版。",
        ].join("\n"),
        "推荐安装 Scoop (Scoop recommended)",
      );
      const showScoopInstall = await prompter.confirm({
        message: "显示 Scoop 安装命令？ (Show Scoop install command?)",
        initialValue: true,
      });
      if (showScoopInstall) {
        await prompter.note(
          [
            "Run in PowerShell:",
            "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser",
            "Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression",
          ].join("\n"),
          "Scoop install",
        );
      }
    }

    const needsNodeManagerPrompt = selectedSkills.some((skill) =>
      skill.install.some((option) => option.kind === "node"),
    );
    if (needsNodeManagerPrompt) {
      const nodeManager = (await prompter.select({
        message: "首选的 Node 包管理器 (Preferred node manager for skill installs)",
        options: resolveNodeManagerOptions(),
      })) as "npm" | "pnpm" | "bun";
      next = {
        ...next,
        skills: {
          ...next.skills,
          install: {
            ...next.skills?.install,
            nodeManager,
          },
        },
      };
    }

    for (const name of selected) {
      const target = installable.find((s) => s.name === name);
      if (!target || target.install.length === 0) {
        continue;
      }
      const options = target.install;
      const getBestInstallId = (opts: typeof options) => {
        if (opts.length === 0) {
          return undefined;
        }
        if (process.platform === "win32") {
          const scoop = opts.find((o) => o.kind === "scoop");
          if (scoop) {
            return scoop.id ?? "scoop";
          }
          const go = opts.find((o) => o.kind === "go");
          if (go) {
            return go.id ?? "go";
          }
        } else if (process.platform === "darwin" || process.platform === "linux") {
          const brew = opts.find((o) => o.kind === "brew");
          if (brew) {
            return brew.id ?? "brew";
          }
        }
        return opts[0]?.id;
      };

      const installId = getBestInstallId(options);
      if (!installId) {
        continue;
      }
      const spin = prompter.progress(`Installing ${name}…`);
      const result = await installSkill({
        workspaceDir,
        skillName: target.name,
        installId,
        config: next,
      });
      const warnings = result.warnings ?? [];
      if (result.ok) {
        spin.stop(warnings.length > 0 ? `Installed ${name} (with warnings)` : `Installed ${name}`);
        for (const warning of warnings) {
          runtime.log(warning);
        }
        continue;
      }
      const code = result.code == null ? "" : ` (exit ${result.code})`;
      const detail = summarizeInstallFailure(result.message);
      spin.stop(`Install failed: ${name}${code}${detail ? ` — ${detail}` : ""}`);
      for (const warning of warnings) {
        runtime.log(warning);
      }
      if (result.stderr) {
        runtime.log(result.stderr.trim());
      } else if (result.stdout) {
        runtime.log(result.stdout.trim());
      }
      runtime.log(
        `Tip: run \`${formatCliCommand("enclaws doctor")}\` to review skills + requirements.`,
      );
      runtime.log("Docs: https://docs.openclaw.ai/skills");
    }
  }

  for (const skill of missing) {
    if (!skill.primaryEnv || skill.missing.env.length === 0) {
      continue;
    }
    const wantsKey = await prompter.confirm({
      message: `要为 ${skill.name} 设置 ${skill.primaryEnv} 吗?`,
      initialValue: false,
    });
    if (!wantsKey) {
      continue;
    }
    const apiKey = String(
      await prompter.text({
        message: `输入 ${skill.primaryEnv} (Enter ${skill.primaryEnv})`,
        validate: (value) => (value?.trim() ? undefined : "必填项 (Required)"),
      }),
    );
    next = upsertSkillEntry(next, skill.skillKey, { apiKey: normalizeSecretInput(apiKey) });
  }

  return next;
}
