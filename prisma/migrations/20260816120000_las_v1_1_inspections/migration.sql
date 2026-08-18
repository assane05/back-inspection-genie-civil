-- ========= ENUMS =========
CREATE TYPE user_role       AS ENUM ('superviseur', 'administrateur', 'approbateur');
CREATE TYPE form_module      AS ENUM ('horizontal', 'vertical');
CREATE TYPE inspection_status AS ENUM ('non_soumis', 'soumis', 'verifie', 'rejete');
CREATE TYPE finding_state    AS ENUM ('non_inspecte', 'ras', 'minor', 'major', 'yes', 'na');
CREATE TYPE severity_level   AS ENUM ('leger', 'moyen', 'eleve');
CREATE TYPE sector_type      AS ENUM ('landside', 'airside');
CREATE TYPE acceptance_type  AS ENUM ('conforme', 'non_conforme');

-- ========= UTILISATEURS & GROUPES =========
CREATE TABLE groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  email         text,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'superviseur',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_groups (
  user_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

-- ========= DICTIONNAIRE (modèles de formulaires) =========
CREATE TABLE form_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  name       text NOT NULL,
  module     form_module NOT NULL,
  version    int NOT NULL DEFAULT 1,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE form_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_type_id uuid NOT NULL REFERENCES form_types(id) ON DELETE CASCADE,
  code         text,
  label        text NOT NULL,
  sort_order   int NOT NULL DEFAULT 0
);

CREATE TABLE form_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
  label      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE form_segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_type_id uuid NOT NULL REFERENCES form_types(id) ON DELETE CASCADE,
  label        text NOT NULL,
  sort_order   int NOT NULL DEFAULT 0
);

-- ========= PLANIFICATION =========
CREATE TABLE assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_type_id     uuid NOT NULL REFERENCES form_types(id),
  group_id         uuid NOT NULL REFERENCES groups(id),
  zone_notes       text,
  year             int  NOT NULL,
  bimonthly_period smallint NOT NULL CHECK (bimonthly_period BETWEEN 1 AND 6),
  week_number      smallint,
  due_date         date,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ========= FICHES REMPLIES =========
CREATE TABLE inspections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid REFERENCES assignments(id),
  form_type_id   uuid NOT NULL REFERENCES form_types(id),
  group_id       uuid NOT NULL REFERENCES groups(id),
  ouvrage        text,
  sector         sector_type,
  acceptance     acceptance_type,
  header_comment text,
  status         inspection_status NOT NULL DEFAULT 'non_soumis',
  submitted_by   uuid REFERENCES users(id),
  submitted_at   timestamptz,
  verified_by    uuid REFERENCES users(id),
  verified_at    timestamptz,
  week_number    smallint,
  due_date       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES form_items(id),
  segment_id    uuid REFERENCES form_segments(id),
  state         finding_state NOT NULL DEFAULT 'non_inspecte',
  severity      severity_level,
  reveal_qualitative text,
  location_action    text,
  comment       text,
  UNIQUE (inspection_id, item_id, segment_id)
);

CREATE TABLE inspection_photos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_value_id uuid NOT NULL REFERENCES inspection_values(id) ON DELETE CASCADE,
  url        text NOT NULL,
  thumb_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE corrective_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_value_id uuid REFERENCES inspection_values(id) ON DELETE CASCADE,
  reference   text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ========= INDEX =========
CREATE INDEX idx_assignments_group   ON assignments(group_id);
CREATE INDEX idx_assignments_period  ON assignments(year, bimonthly_period, week_number);
CREATE INDEX idx_inspections_status  ON inspections(status);
CREATE INDEX idx_inspections_group   ON inspections(group_id);
CREATE INDEX idx_values_inspection   ON inspection_values(inspection_id);
CREATE INDEX idx_photos_value        ON inspection_photos(inspection_value_id);