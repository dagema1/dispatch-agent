ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_no_overlap";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_no_overlap" EXCLUDE USING gist ("technician_id" WITH =, tstzrange("scheduled_start","scheduled_end") WITH &&) WHERE ("technician_id" IS NOT NULL AND "scheduled_start" IS NOT NULL AND "status" NOT IN ('cancelled', 'done')) DEFERRABLE INITIALLY DEFERRED;
