ALTER TABLE feeds ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
CREATE INDEX IF NOT EXISTS feeds_language_idx ON feeds(language);
UPDATE feeds SET language = 'en' WHERE language IS NULL;
