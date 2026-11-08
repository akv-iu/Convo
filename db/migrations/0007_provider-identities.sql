CREATE TABLE "auth_identities" (
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_identities_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "github_login" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_user_provider_idx" ON "auth_identities" USING btree ("user_id","provider");
--> statement-breakpoint
-- Existing identity IDs already encode GitHub's numeric account ID. Never backfill from a mutable login.
INSERT INTO "auth_identities" ("provider", "provider_account_id", "user_id")
SELECT 'github', substring("id" from 8), "id" FROM "users"
WHERE "id" ~ '^github:[1-9][0-9]*$';
