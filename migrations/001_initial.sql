CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), national_id_normalized TEXT UNIQUE, national_id_hash TEXT,
  first_name TEXT, last_name TEXT, full_name TEXT, normalized_name TEXT, birth_date DATE, gender TEXT,
  primary_phone TEXT, primary_address TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_id UUID REFERENCES sources(id), status TEXT NOT NULL DEFAULT 'PENDING',
  batch_size INTEGER NOT NULL DEFAULT 1000, records_processed BIGINT NOT NULL DEFAULT 0, records_imported BIGINT NOT NULL DEFAULT 0,
  duplicates BIGINT NOT NULL DEFAULT 0, errors BIGINT NOT NULL DEFAULT 0, last_processed_record BIGINT NOT NULL DEFAULT 0,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS raw_records (
  id BIGSERIAL PRIMARY KEY, source_id UUID REFERENCES sources(id), external_record_id TEXT, payload JSONB NOT NULL,
  import_batch_id UUID REFERENCES import_batches(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, external_record_id)
);
CREATE TABLE IF NOT EXISTS source_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_id UUID NOT NULL REFERENCES sources(id), source_field_name TEXT NOT NULL,
  normalized_field_name TEXT NOT NULL, data_type TEXT, confidence NUMERIC(5,4), UNIQUE(source_id, source_field_name)
);
CREATE TABLE IF NOT EXISTS person_source_records (
  id BIGSERIAL PRIMARY KEY, person_id UUID NOT NULL REFERENCES people(id), raw_record_id BIGINT NOT NULL REFERENCES raw_records(id),
  source_id UUID NOT NULL REFERENCES sources(id), match_method TEXT NOT NULL, match_confidence NUMERIC(5,4), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(person_id, raw_record_id)
);
CREATE TABLE IF NOT EXISTS relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), person_a_id UUID NOT NULL REFERENCES people(id), person_b_id UUID NOT NULL REFERENCES people(id),
  relationship_type TEXT NOT NULL, confidence TEXT NOT NULL, evidence JSONB NOT NULL, source_id UUID REFERENCES sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(person_a_id, person_b_id, relationship_type)
);
CREATE TABLE IF NOT EXISTS conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), person_id UUID NOT NULL REFERENCES people(id), field_name TEXT NOT NULL,
  values_by_source JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'REQUIRES_REVIEW', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, query_type TEXT, query_value TEXT, source_ids UUID[], metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_people_national_id ON people(national_id_normalized);
CREATE INDEX IF NOT EXISTS idx_people_phone ON people(primary_phone);
CREATE INDEX IF NOT EXISTS idx_people_normalized_name ON people(normalized_name);
CREATE INDEX IF NOT EXISTS idx_people_address ON people(primary_address);
CREATE INDEX IF NOT EXISTS idx_raw_source_external ON raw_records(source_id, external_record_id);
CREATE INDEX IF NOT EXISTS idx_raw_payload_gin ON raw_records USING GIN(payload);
CREATE INDEX IF NOT EXISTS idx_relationships_a ON relationships(person_a_id);
CREATE INDEX IF NOT EXISTS idx_relationships_b ON relationships(person_b_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
