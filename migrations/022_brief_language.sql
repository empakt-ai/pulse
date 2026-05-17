-- 022_brief_language.sql
-- Adds brief_language to workspaces.
-- Controls what language the AI writes the brief output in.
-- Default 'en' (English) — existing workspaces unaffected.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS brief_language TEXT NOT NULL DEFAULT 'en';

-- Valid values: 'en' | 'ar' | 'fr' | 'tr' | 'ur' | 'pt-BR' | 'id' | 'hi' | 'es'
-- The shell/UI stays in English. Only the AI-generated brief content changes language.
