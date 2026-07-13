-- up
-- Phase 135 Step 7: Team benchmark data plane (§5.8.2 — the 6th registry table).
-- Owned by ModelRegistryService (@exaix-team/model-registry-live). Scores are
-- MODEL-properties, not route-properties (§5.8.2 note): keyed on (provider, model,
-- benchmark), so a model scored once applies to every route offering it. Empty ⇒ the
-- top-N admission path and the `best` scorer (Step 8) find no scores and no-op.

CREATE TABLE IF NOT EXISTS model_benchmark (
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  benchmark       TEXT    NOT NULL,   -- e.g. 'swe_bench_verified'
  score           REAL    NOT NULL,   -- normalised 0..1 (validated at write)
  harness_version TEXT,               -- benchmark harness/version, when published
  provenance      TEXT    NOT NULL,   -- 'static' (curated) | 'remote_static' (models.dev ingest)
  measured_at     REAL    NOT NULL,   -- epoch-ms; REAL avoids 32-bit INTEGER read truncation
  source_url      TEXT,               -- citable publication / dataset URL
  PRIMARY KEY (provider, model, benchmark)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_rank ON model_benchmark (benchmark, score DESC);

-- down
DROP INDEX IF EXISTS idx_benchmark_rank;
DROP TABLE IF EXISTS model_benchmark;
