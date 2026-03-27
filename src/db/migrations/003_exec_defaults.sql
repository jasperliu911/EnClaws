-- Set exec tool defaults for bot/skill contexts:
--   security: "full"    — allow skill scripts to run without allowlist restrictions
--   ask: "off"          — no user approval prompts in automated bot context
--   backgroundMs: 600000 — 10 min timeout for long-running scripts (e.g. auth polling)
UPDATE sys_tools_config
SET exec = jsonb_build_object(
  'security', 'full',
  'ask', 'off',
  'backgroundMs', 600000
)
WHERE id = 1
  AND (exec IS NULL OR exec = '{}'::jsonb);
