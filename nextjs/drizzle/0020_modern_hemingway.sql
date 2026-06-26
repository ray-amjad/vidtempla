CREATE TABLE "description_push_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "description_push_job_items_job_id_video_id_unique" UNIQUE("job_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "description_push_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"user_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"label" text NOT NULL,
	"total_videos" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD COLUMN "current_push_job_id" uuid;--> statement-breakpoint
ALTER TABLE "description_push_job_items" ADD CONSTRAINT "description_push_job_items_job_id_description_push_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."description_push_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "description_push_job_items" ADD CONSTRAINT "description_push_job_items_video_id_youtube_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."youtube_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "description_push_jobs" ADD CONSTRAINT "description_push_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "description_push_jobs" ADD CONSTRAINT "description_push_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "description_push_job_items_job_id_idx" ON "description_push_job_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "description_push_jobs_org_created_at_idx" ON "description_push_jobs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "description_push_jobs_user_created_at_idx" ON "description_push_jobs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_current_push_job_id_description_push_jobs_id_fk" FOREIGN KEY ("current_push_job_id") REFERENCES "public"."description_push_jobs"("id") ON DELETE set null ON UPDATE no action;