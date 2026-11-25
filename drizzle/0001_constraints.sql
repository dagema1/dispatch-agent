-- A technician can never be booked into two overlapping visits.
-- Deferred so the optimiser can reshuffle a whole day inside one transaction.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_no_overlap"
  EXCLUDE USING gist (
    "technician_id" WITH =,
    tstzrange("scheduled_start", "scheduled_end") WITH &&
  )
  WHERE ("technician_id" IS NOT NULL AND "scheduled_start" IS NOT NULL AND "status" NOT IN ('cancelled'))
  DEFERRABLE INITIALLY DEFERRED;
