PRAGMA foreign_keys = ON;

ALTER TABLE logs ADD COLUMN target_calories REAL CHECK (target_calories IS NULL OR target_calories > 0);
ALTER TABLE logs ADD COLUMN target_protein_grams REAL CHECK (target_protein_grams IS NULL OR target_protein_grams > 0);
ALTER TABLE logs ADD COLUMN target_fiber_grams REAL CHECK (target_fiber_grams IS NULL OR target_fiber_grams > 0);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('food', 'activity')),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX categories_log_kind_order_idx ON categories(log_id, kind, sort_order);
CREATE INDEX categories_log_revision_idx ON categories(log_id, revision);
CREATE UNIQUE INDEX categories_log_kind_name_idx ON categories(log_id, kind, name) WHERE deleted_at IS NULL;

CREATE TABLE foods (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  serving TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  calories REAL NOT NULL CHECK (calories >= 0),
  protein_grams REAL CHECK (protein_grams IS NULL OR protein_grams >= 0),
  fiber_grams REAL CHECK (fiber_grams IS NULL OR fiber_grams >= 0),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  external_url TEXT,
  image_asset_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX foods_log_category_name_idx ON foods(log_id, category_id, name);
CREATE INDEX foods_log_revision_idx ON foods(log_id, revision);

CREATE TABLE meals (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  eaten_at INTEGER NOT NULL CHECK (eaten_at >= 0),
  items_json TEXT NOT NULL CHECK (json_valid(items_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX meals_log_eaten_idx ON meals(log_id, eaten_at);
CREATE INDEX meals_log_revision_idx ON meals(log_id, revision);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  detail TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  external_url TEXT,
  image_asset_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX activities_log_category_name_idx ON activities(log_id, category_id, name);
CREATE INDEX activities_log_revision_idx ON activities(log_id, revision);

CREATE TABLE exercise_entries (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  performed_at INTEGER NOT NULL CHECK (performed_at >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX exercise_log_performed_idx ON exercise_entries(log_id, performed_at);
CREATE INDEX exercise_log_activity_idx ON exercise_entries(log_id, activity_id);
CREATE INDEX exercise_log_revision_idx ON exercise_entries(log_id, revision);

CREATE TABLE checklist_items (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  external_url TEXT,
  image_asset_id TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX checklist_items_log_order_idx ON checklist_items(log_id, sort_order);
CREATE INDEX checklist_items_log_revision_idx ON checklist_items(log_id, revision);

CREATE TABLE checklist_completions (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  checklist_item_id TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  completed_at INTEGER NOT NULL CHECK (completed_at >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX checklist_completions_log_completed_idx ON checklist_completions(log_id, completed_at);
CREATE INDEX checklist_completions_log_revision_idx ON checklist_completions(log_id, revision);
CREATE UNIQUE INDEX checklist_one_completion_per_period_idx
  ON checklist_completions(log_id, checklist_item_id, period_key) WHERE deleted_at IS NULL;

CREATE TABLE grocery_items (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  food_id TEXT REFERENCES foods(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  in_cart INTEGER NOT NULL CHECK (in_cart IN (0, 1)),
  external_url TEXT,
  image_asset_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX grocery_items_log_cart_name_idx ON grocery_items(log_id, in_cart, name);
CREATE INDEX grocery_items_log_revision_idx ON grocery_items(log_id, revision);

ALTER TABLE changes RENAME TO changes_v1;
CREATE TABLE changes (
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'fast', 'weight', 'preferences', 'nutritionTargets', 'category', 'food', 'meal', 'activity',
    'exercise', 'checklistItem', 'checklistCompletion', 'groceryItem', 'generation'
  )),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'reset')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (log_id, revision)
) WITHOUT ROWID;
INSERT INTO changes SELECT * FROM changes_v1;
DROP TABLE changes_v1;
CREATE INDEX changes_log_revision_idx ON changes(log_id, revision);
