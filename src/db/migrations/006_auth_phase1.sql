-- ============================================================
-- Auth security Phase 1: force-change-password, password reset tokens
-- ============================================================

-- 1. Add password lifecycle columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Backfill password_changed_at for existing console-login users (platform-admin / owner).
-- Setting it to "now" gives them a full max-age window before any future expiry kicks in.
UPDATE users
SET    password_changed_at = NOW()
WHERE  password_changed_at IS NULL
  AND  role IN ('platform-admin', 'owner');

-- 2. Password reset tokens (used by both forgot-password email flow
--    and platform-admin one-time view links for temp passwords).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL DEFAULT 'reset',  -- 'reset' | 'view-temp'
  payload     TEXT,                            -- encrypted temp password for view-temp purpose
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens (expires_at);
