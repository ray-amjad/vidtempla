CREATE TABLE "comment_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"user_id" uuid,
	"channel_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"video_id" text,
	"verb" text NOT NULL,
	"text_source" text NOT NULL,
	"before_text" text NOT NULL,
	"after_text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_edits" ADD CONSTRAINT "comment_edits_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_edits" ADD CONSTRAINT "comment_edits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_edits_org_created_at_idx" ON "comment_edits" USING btree ("organization_id","created_at" DESC NULLS LAST);