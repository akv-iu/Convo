CREATE TABLE "profile_enrichment_states" (
	"user_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"next_sweep_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profile_enrichment_states" ADD CONSTRAINT "profile_enrichment_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_enrichment_states_sweep_idx" ON "profile_enrichment_states" USING btree ("next_sweep_at");