CREATE TABLE "comment_automation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"cursor" timestamp with time zone,
	"paused_reject_ban" boolean DEFAULT false NOT NULL,
	"paused_delete" boolean DEFAULT false NOT NULL,
	"last_run_status" text,
	"last_run_at" timestamp with time zone,
	"last_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comment_automation_youtube_channel_id_unique" UNIQUE("youtube_channel_id")
);
--> statement-breakpoint
CREATE TABLE "comment_moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"requested_action" text NOT NULL,
	"applied_action" text NOT NULL,
	"degraded_reason" text,
	"source" text NOT NULL,
	"user_id" uuid,
	"rule_id" uuid,
	"rubric_version" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_moderation_counters" (
	"youtube_channel_id" uuid NOT NULL,
	"pacific_day" text NOT NULL,
	"reject_ban_count" integer DEFAULT 0 NOT NULL,
	"delete_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comment_moderation_counters_youtube_channel_id_pacific_day_pk" PRIMARY KEY("youtube_channel_id","pacific_day")
);
--> statement-breakpoint
CREATE TABLE "comment_moderation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"label" text NOT NULL,
	"threshold" real NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_rubric_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"comment_id" uuid,
	"text" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"suggested_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"included_in_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"labels" jsonb NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comment_rubrics_channel_version_unique" UNIQUE("youtube_channel_id","version")
);
--> statement-breakpoint
CREATE TABLE "comment_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"rubric_version" integer NOT NULL,
	"model" text NOT NULL,
	"choice" text NOT NULL,
	"probabilities" jsonb NOT NULL,
	"confidence" real,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_scores_comment_version_unique" UNIQUE("comment_id","rubric_version")
);
--> statement-breakpoint
CREATE TABLE "youtube_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" uuid NOT NULL,
	"comment_id" text NOT NULL,
	"parent_id" text,
	"video_id" text NOT NULL,
	"author_channel_id" text,
	"author_display_name" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"text_source" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"score_status" text DEFAULT 'pending' NOT NULL,
	"moderation_state" text DEFAULT 'none' NOT NULL,
	"actioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "youtube_comments_channel_comment_unique" UNIQUE("youtube_channel_id","comment_id")
);
--> statement-breakpoint
ALTER TABLE "comment_automation" ADD CONSTRAINT "comment_automation_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_actions" ADD CONSTRAINT "comment_moderation_actions_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_actions" ADD CONSTRAINT "comment_moderation_actions_comment_id_youtube_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."youtube_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_actions" ADD CONSTRAINT "comment_moderation_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_counters" ADD CONSTRAINT "comment_moderation_counters_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_rules" ADD CONSTRAINT "comment_moderation_rules_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_rubric_examples" ADD CONSTRAINT "comment_rubric_examples_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_rubric_examples" ADD CONSTRAINT "comment_rubric_examples_comment_id_youtube_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."youtube_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_rubric_examples" ADD CONSTRAINT "comment_rubric_examples_suggested_by_user_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_rubric_examples" ADD CONSTRAINT "comment_rubric_examples_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_rubrics" ADD CONSTRAINT "comment_rubrics_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_rubrics" ADD CONSTRAINT "comment_rubrics_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_scores" ADD CONSTRAINT "comment_scores_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_scores" ADD CONSTRAINT "comment_scores_comment_id_youtube_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."youtube_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_comments" ADD CONSTRAINT "youtube_comments_youtube_channel_id_youtube_channels_id_fk" FOREIGN KEY ("youtube_channel_id") REFERENCES "public"."youtube_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_moderation_actions_channel_created_at_idx" ON "comment_moderation_actions" USING btree ("youtube_channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comment_moderation_rules_channel_idx" ON "comment_moderation_rules" USING btree ("youtube_channel_id");--> statement-breakpoint
CREATE INDEX "comment_rubric_examples_channel_status_idx" ON "comment_rubric_examples" USING btree ("youtube_channel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_rubrics_one_published" ON "comment_rubrics" USING btree ("youtube_channel_id") WHERE "comment_rubrics"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "comment_rubrics_one_draft" ON "comment_rubrics" USING btree ("youtube_channel_id") WHERE "comment_rubrics"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "comment_scores_channel_version_idx" ON "comment_scores" USING btree ("youtube_channel_id","rubric_version");--> statement-breakpoint
CREATE INDEX "youtube_comments_channel_score_status_idx" ON "youtube_comments" USING btree ("youtube_channel_id","score_status");--> statement-breakpoint
CREATE INDEX "youtube_comments_channel_published_at_idx" ON "youtube_comments" USING btree ("youtube_channel_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "youtube_comments_channel_moderation_state_idx" ON "youtube_comments" USING btree ("youtube_channel_id","moderation_state");