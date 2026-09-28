-- Group product lines in older lists that have never had custom sections.
CREATE TEMP TABLE shopping_category_groups ON COMMIT DROP AS
SELECT l.list_id, p.category, gen_random_uuid() AS section_id
FROM shopping_list_lines l
JOIN shopping_lists s ON s.id = l.list_id
JOIN products p ON p.id = l.product_id
WHERE s.sections = '[]'::jsonb AND l.section_id IS NULL
GROUP BY l.list_id, p.category;

UPDATE shopping_lists s
SET sections = grouped.sections
FROM (
  SELECT list_id,
    jsonb_agg(
      jsonb_build_object('id', section_id, 'name', category, 'category', category)
      ORDER BY category
    ) AS sections
  FROM shopping_category_groups
  GROUP BY list_id
) grouped
WHERE s.id = grouped.list_id;

UPDATE shopping_list_lines l
SET section_id = grouped.section_id
FROM products p, shopping_category_groups grouped
WHERE l.product_id = p.id
  AND l.list_id = grouped.list_id
  AND p.category = grouped.category
  AND l.section_id IS NULL;
