-- Add subtype column to entities table for fine-grained entity classification
ALTER TABLE entities ADD COLUMN subtype VARCHAR(50);
CREATE INDEX entities_type_subtype_idx ON entities (type, subtype) WHERE subtype IS NOT NULL;
