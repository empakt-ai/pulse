-- 008_default_ai_model_gemini.sql
-- Flip the workspace default AI provider to Gemini.
--
-- Why: after side-by-side comparison the owner prefers Gemini's brief
-- style. Claude remains fully supported (and the router still falls back
-- to it on Gemini failure) — this only changes the default for newly
-- created workspaces and any rows where ai_model was never set.
--
-- Safe / idempotent: workspaces that have already chosen a provider
-- (ai_model IS NOT NULL) are not touched.

ALTER TABLE workspaces ALTER COLUMN ai_model SET DEFAULT 'gemini';

UPDATE workspaces SET ai_model = 'gemini' WHERE ai_model IS NULL;
