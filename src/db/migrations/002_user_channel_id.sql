-- Add channel_id to users table for tracking channel source
-- Safe for new deployments where 001_init.sql already includes channel_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'channel_id'
  ) THEN
    ALTER TABLE users ADD COLUMN channel_id UUID REFERENCES tenant_channels(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_channel ON users (channel_id) WHERE channel_id IS NOT NULL;
