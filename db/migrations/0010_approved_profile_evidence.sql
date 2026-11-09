ALTER TABLE "users" ADD COLUMN "profile_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_evidence_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "expertise" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "text_version" integer DEFAULT 0 NOT NULL;
