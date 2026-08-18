-- Table d'infrastructure (auth), hors périmètre du schéma-bdd v1.1
CREATE TABLE sessions (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Idempotence [Epic 3] : une seule inspection par assignation.
-- (assignment_id reste nullable pour d'éventuelles inspections ad hoc hors planification)
CREATE UNIQUE INDEX idx_inspections_assignment_unique
  ON inspections(assignment_id) WHERE assignment_id IS NOT NULL;

-- Idempotence [Epic 3] : la contrainte UNIQUE(inspection_id, item_id, segment_id) du
-- schéma v1.1 ne déduplique pas les fiches bâtiment (segment_id NULL), NULL <> NULL
-- en SQL. Cet index partiel couvre ce cas.
CREATE UNIQUE INDEX idx_inspection_values_no_segment
  ON inspection_values(inspection_id, item_id) WHERE segment_id IS NULL;