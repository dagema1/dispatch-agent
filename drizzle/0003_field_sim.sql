ALTER TABLE "calls" ADD COLUMN "caller_phone" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "via" text;