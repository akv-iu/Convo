CREATE TABLE "ai_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"refined" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"soft_blocker" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"ask_id" text NOT NULL,
	"person_id" text NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"ask_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_person_id" text NOT NULL,
	"question" text NOT NULL,
	"minutes" integer NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"reply" text,
	"slot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organisations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb,
	"free_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejections" ADD CONSTRAINT "rejections_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cache_key_idx" ON "ai_cache" USING btree ("key");--> statement-breakpoint
CREATE INDEX "asks_user_idx" ON "asks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rejections_ask_idx" ON "rejections" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "requests_to_idx" ON "requests" USING btree ("to_person_id");--> statement-breakpoint
CREATE INDEX "requests_from_idx" ON "requests" USING btree ("from_user_id");