ALTER TABLE inspection_values ADD COLUMN measurement_surface_m2 numeric(10,2);
ALTER TABLE inspection_values ADD COLUMN measurement_length_m numeric(10,2);
ALTER TABLE inspection_values ADD COLUMN measurement_height_or_depth_m numeric(10,2);

CREATE TABLE form_item_segment_exclusions (
  item_id    uuid NOT NULL REFERENCES form_items(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES form_segments(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, segment_id)
);