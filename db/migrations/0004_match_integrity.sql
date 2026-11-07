DELETE FROM "rejections" r USING "rejections" k WHERE r.ask_id = k.ask_id AND r.person_id = k.person_id AND (r.created_at, r.id) > (k.created_at, k.id);--> statement-breakpoint
DELETE FROM "requests" r USING "requests" k WHERE r.ask_id = k.ask_id AND r.to_person_id = k.to_person_id AND (r.created_at, r.id) > (k.created_at, k.id);--> statement-breakpoint
DROP INDEX "rejections_ask_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "rejections_ask_person_idx" ON "rejections" USING btree ("ask_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_ask_person_idx" ON "requests" USING btree ("ask_id","to_person_id");
