DROP INDEX IF EXISTS idx_vault_pick;
CREATE INDEX IF NOT EXISTS idx_vault_pick ON vault(status, country, id);
