-- 001_initial_schema/migration.sql
-- Equilec cotizador v4: schema inicial sobre Neon Postgres.
-- Estructura: tabla cotizaciones con items como JSONB (decision del usuario).

CREATE TABLE IF NOT EXISTS users (
    email           TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    password_hash   TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cotizaciones (
    number          INTEGER PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'borrador',
    client          JSONB NOT NULL,
    items           JSONB NOT NULL,
    terms           JSONB NOT NULL DEFAULT '{}'::jsonb,
    vendor          JSONB NOT NULL DEFAULT '{}'::jsonb,
    totals          JSONB,
    created_by      JSONB,
    last_edited_by  JSONB,
    notes           TEXT NOT NULL DEFAULT '',
    saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_saved_at ON cotizaciones (saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_status   ON cotizaciones (status);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_createdby_email
    ON cotizaciones ((created_by ->> 'email'));

CREATE TABLE IF NOT EXISTS counters (
    name        TEXT PRIMARY KEY,
    next_val    INTEGER NOT NULL
);

-- Bootstrap folio counter
INSERT INTO counters (name, next_val) VALUES ('folio', 1501)
ON CONFLICT (name) DO NOTHING;
