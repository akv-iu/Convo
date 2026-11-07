DROP INDEX "rejections_ask_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "rejections_ask_person_idx" ON "rejections" USING btree ("ask_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_ask_person_idx" ON "requests" USING btree ("ask_id","to_person_id");