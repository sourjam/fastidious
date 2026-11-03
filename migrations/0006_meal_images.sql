ALTER TABLE meals ADD COLUMN image_asset_id TEXT REFERENCES image_assets(id) ON DELETE SET NULL;

CREATE INDEX meals_log_image_idx ON meals(log_id, image_asset_id);
