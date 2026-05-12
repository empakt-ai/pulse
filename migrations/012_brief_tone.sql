-- 012_brief_tone.sql
-- Agency-only brief tone preference (analytical / strategic / executive).
-- Replaces the Claude/Gemini model switcher during the Gemini-only phase.
-- Removed when public model selection ships or when testing wraps.
--
-- 'strategic' is the default — same balance the brief has had since launch.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS brief_tone text NOT NULL DEFAULT 'strategic';
