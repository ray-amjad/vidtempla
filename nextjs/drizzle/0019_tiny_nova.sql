ALTER TABLE "youtube_videos" ADD COLUMN "push_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD COLUMN "push_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD COLUMN "last_push_error" text;