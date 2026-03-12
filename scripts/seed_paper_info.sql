-- Add paper_title and paper_doi columns to datasets table
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS paper_title TEXT;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS paper_doi TEXT;

-- Recreate the datasets_with_tags view to include new columns
CREATE OR REPLACE VIEW datasets_with_tags AS
SELECT
  d.*,
  COALESCE(array_agg(dt.tag_id) FILTER (WHERE dt.tag_id IS NOT NULL), '{}') AS tag_ids,
  COALESCE(
    array_agg(t.name ORDER BY t.sort_order) FILTER (WHERE t.name IS NOT NULL),
    '{}'
  ) AS tag_names
FROM datasets d
LEFT JOIN dataset_tags dt ON dt.dataset_id = d.id
LEFT JOIN tags t ON t.id = dt.tag_id
GROUP BY d.id;
