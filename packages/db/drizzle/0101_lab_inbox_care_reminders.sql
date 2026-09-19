DO $$ BEGIN
  CREATE TYPE care_reminder_status AS ENUM ('open', 'completed', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS care_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  title varchar(255) NOT NULL,
  notes text,
  due_date date NOT NULL,
  status care_reminder_status NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES users(id),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES users(id),
  dismissal_reason text,
  external_source varchar(64),
  external_id varchar(128)
);

CREATE INDEX IF NOT EXISTS care_reminders_practice_status_due_idx
  ON care_reminders (practice_id, status, due_date, deleted_at);
CREATE INDEX IF NOT EXISTS care_reminders_patient_idx
  ON care_reminders (patient_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS care_reminders_external_unique_idx
  ON care_reminders (practice_id, external_source, external_id);
