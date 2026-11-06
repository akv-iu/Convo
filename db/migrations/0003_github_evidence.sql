ALTER TABLE "users" ADD COLUMN "github_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_evidence_pending" boolean DEFAULT false NOT NULL;