ALTER TABLE assignments ADD COLUMN assigned_to uuid REFERENCES users(id);
CREATE INDEX idx_assignments_assigned_to ON assignments(assigned_to);


ALTER TABLE inspections ADD COLUMN rejection_reason text;