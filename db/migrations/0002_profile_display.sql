ALTER TABLE "users" ADD COLUMN "workplace_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "badge_colour" text DEFAULT 'sunflower' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "visibility" jsonb DEFAULT '{"country":true,"workplace":true,"hiring":true}'::jsonb NOT NULL;