-- Optional cover images follow the same bounded JPEG format as catalog photos.
ALTER TABLE promotion_campaigns ADD COLUMN image text NOT NULL DEFAULT ''
 CHECK (length(image)<=60000 AND (image='' OR image LIKE 'data:image/jpeg;base64,/9j/%'));
