ALTER TABLE "comment_automation" ADD COLUMN "listing_page_token" text;--> statement-breakpoint
ALTER TABLE "comment_automation" ADD COLUMN "listing_newest" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_scores" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
-- Scores stored before this column existed already went through the decision step.
UPDATE "comment_scores" SET "decided_at" = "created_at" WHERE "decided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "comment_scores_undecided_idx" ON "comment_scores" USING btree ("youtube_channel_id","rubric_version") WHERE "comment_scores"."decided_at" IS NULL;