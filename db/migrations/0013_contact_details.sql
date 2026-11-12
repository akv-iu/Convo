ALTER TABLE "users" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_share" text DEFAULT 'email' NOT NULL;