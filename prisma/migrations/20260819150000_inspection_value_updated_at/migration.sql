
ALTER TABLE inspection_values ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();