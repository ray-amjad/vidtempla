import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  real,
  primaryKey,
  timestamp,
  jsonb,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Better Auth tables (4 + 3 organization plugin)

export const user = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  activeOrganizationId: text("active_organization_id"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    mode: "date",
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    mode: "date",
    withTimezone: true,
  }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).$defaultFn(
    () => new Date()
  ),
});

// Organization plugin tables (Better Auth)

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  inviterId: uuid("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

// App tables

export const youtubeChannels = pgTable("youtube_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .references(() => organization.id, { onDelete: "cascade" }),
  channelId: text("channel_id").unique().notNull(),
  title: text("title"),
  thumbnailUrl: text("thumbnail_url"),
  subscriberCount: integer("subscriber_count").default(0),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", {
    mode: "date",
    withTimezone: true,
  }),
  tokenStatus: text("token_status").notNull().default("valid"),
  syncStatus: text("sync_status").notNull().default("idle"),
  lastSyncedAt: timestamp("last_synced_at", {
    mode: "date",
    withTimezone: true,
  }),
  driftBaselinedAt: timestamp("drift_baselined_at", {
    mode: "date",
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const containers = pgTable("containers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  separator: text("separator").notNull().default("\n\n"),
  templateOrder: jsonb("template_order").$type<string[]>(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const templates = pgTable("templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const youtubeVideos = pgTable("youtube_videos", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => youtubeChannels.id, { onDelete: "cascade" }),
  videoId: text("video_id").unique().notNull(),
  title: text("title"),
  currentDescription: text("current_description"),
  containerId: uuid("container_id").references(() => containers.id, {
    onDelete: "set null",
  }),
  driftDetectedAt: timestamp("drift_detected_at", {
    mode: "date",
    withTimezone: true,
  }),
  renderVersion: integer("render_version").notNull().default(0),
  descriptionPushReservedUntil: timestamp("description_push_reserved_until", {
    mode: "date",
    withTimezone: true,
  }),
  // User-visible per-video push state: idle | queued | updating | retry_scheduled
  // | failed. `idle` means nothing in flight / already synced (renders no badge).
  // Broader than descriptionPushReservedUntil (a 2-min CAS lock), which it does
  // not replace — that still backs the reservation; this drives the UI + retries.
  pushStatus: text("push_status").notNull().default("idle"),
  // Counts non-quota lasting failures only. Quota-blocked retries reschedule to
  // the known quota reset without consuming an attempt, so the 3/6/12h backoff
  // budget is reserved for genuine post-reset failures.
  pushAttempts: integer("push_attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", {
    mode: "date",
    withTimezone: true,
  }),
  lastPushError: text("last_push_error"),
  // Points at the in-flight push job grouping this video's current push. The
  // hourly retry cron reads it to re-enqueue a failed push under its original
  // job rather than spawning a new one. Cleared (set null) if the job is deleted.
  currentPushJobId: uuid("current_push_job_id").references(
    () => descriptionPushJobs.id,
    { onDelete: "set null" }
  ),
  publishedAt: timestamp("published_at", {
    mode: "date",
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => ({
  // Created in migration 0017 (custom SQL) but never declared here; backs the
  // description-push reservation CAS lookups. Declared so drizzle stops trying
  // to drop it on every generate.
  channelPushReservationIdx: index(
    "youtube_videos_channel_push_reservation_idx"
  ).on(table.channelId, table.descriptionPushReservedUntil),
}));

export const videoVariables = pgTable(
  "video_variables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => youtubeVideos.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    variableName: text("variable_name").notNull(),
    variableValue: text("variable_value"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueVideoTemplateVariable: unique().on(
      table.videoId,
      table.templateId,
      table.variableName
    ),
  })
);

export type HistorySource =
  | "initial_sync"
  | "template_push"
  | "manual_youtube_edit"
  | "revert";

export const descriptionHistory = pgTable(
  "description_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => youtubeVideos.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    versionNumber: integer("version_number").notNull(),
    renderSnapshot: jsonb("render_snapshot").$type<Record<string, Record<string, string>>>(),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source").$type<HistorySource | null>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueVideoVersion: unique().on(table.videoId, table.versionNumber),
  })
);

export type VariableChangeType =
  | "create"
  | "update"
  | "delete"
  | "assignment_init"
  | "revert_clear"
  | "drift_clear";

export const videoVariableEvents = pgTable(
  "video_variable_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => youtubeVideos.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    variableName: text("variable_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changeType: text("change_type").$type<VariableChangeType>().notNull(),
    changedBy: uuid("changed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    historyVersionNumber: integer("history_version_number"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    videoCreatedAtIdx: index("video_variable_events_video_created_at_idx").on(
      table.videoId,
      table.createdAt
    ),
    videoTemplateVarIdx: index(
      "video_variable_events_video_template_name_idx"
    ).on(table.videoId, table.templateId, table.variableName, table.createdAt),
  })
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    planTier: text("plan_tier").notNull().default("free"),
    status: text("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", {
      mode: "date",
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", {
      mode: "date",
      withTimezone: true,
    }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // Partial unique index: enforces one subscription per organization while
    // allowing legacy rows where organization_id IS NULL (handled by the org
    // backfill in PRs #34, #35).
    orgIdUnique: uniqueIndex("subscriptions_org_id_unique")
      .on(table.organizationId)
      .where(sql`${table.organizationId} IS NOT NULL`),
  })
);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: text("event_id").unique().notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processed: boolean("processed").default(false),
  processedAt: timestamp("processed_at", {
    mode: "date",
    withTimezone: true,
  }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

// OAuth / MCP plugin tables

export const oauthApplication = pgTable("oauth_application", {
  id: text("id").primaryKey(),
  name: text("name"),
  icon: text("icon"),
  metadata: text("metadata"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  redirectUrls: text("redirect_urls").notNull(),
  type: text("type").notNull(),
  disabled: boolean("disabled").default(false),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const oauthAccessToken = pgTable("oauth_access_token", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").unique(),
  refreshToken: text("refresh_token").unique(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    mode: "date",
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    mode: "date",
    withTimezone: true,
  }),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const oauthConsent = pgTable("oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  consentGiven: boolean("consent_given").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

// API tables

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    permission: text("permission").notNull().default("read"),
    lastUsedAt: timestamp("last_used_at", {
      mode: "date",
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    keyHashUnique: uniqueIndex("api_keys_key_hash_unique").on(table.keyHash),
  })
);

export const apiRequestLog = pgTable(
  "api_request_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id")
      .references(() => apiKeys.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    quotaUnits: integer("quota_units").notNull().default(0),
    source: text("source").notNull().default("rest"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCreatedAtIdx: index("api_request_log_user_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
    orgCreatedAtIdx: index("api_request_log_org_created_at_idx").on(
      table.organizationId,
      table.createdAt
    ),
  })
);

export const userCredits = pgTable("user_credits", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  monthlyAllocation: integer("monthly_allocation").notNull(),
  periodStart: timestamp("period_start", { mode: "date", withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Global (non-user-scoped) key/value state. Backs the YouTube quota circuit
// breaker (`youtube_quota_exhausted_until`) and its alert-email dedup
// (`youtube_quota_notified_for`) so a quota wipeout is recorded once and
// stops doomed background syncs platform-wide until the quota resets.
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A Job groups every per-video description push fired by one user action (a
// template/container edit, a manual "Update to YouTube", a variable edit, a
// drift resolve). Created only when a push actually enqueues >= 1 video. Job
// status is DERIVED from its items at read time (running if any item is still
// active, else completed) — there are no counter columns to drift.
export const descriptionPushJobs = pgTable(
  "description_push_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").references(
      () => organization.id,
      { onDelete: "cascade" }
    ),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // template_update | container_update | manual_push | variable_edit |
    // drift_resolve | retry
    trigger: text("trigger").notNull(),
    // Display name: template/container name, video title, or "Manual update".
    label: text("label").notNull(),
    totalVideos: integer("total_videos").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    orgCreatedAtIdx: index("description_push_jobs_org_created_at_idx").on(
      table.organizationId,
      table.createdAt.desc()
    ),
    userCreatedAtIdx: index("description_push_jobs_user_created_at_idx").on(
      table.userId,
      table.createdAt.desc()
    ),
  })
);

// One row per (job, video). Persists each push's outcome independently of
// youtubeVideos.pushStatus, because a later job re-pushing the same video
// overwrites that column — only a per-(job,video) row preserves a completed
// job's history.
export const descriptionPushJobItems = pgTable(
  "description_push_job_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => descriptionPushJobs.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => youtubeVideos.id, { onDelete: "cascade" }),
    // queued | updating | succeeded | retry_scheduled | failed | superseded
    status: text("status").notNull().default("queued"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueJobVideo: unique().on(table.jobId, table.videoId),
    jobIdIdx: index("description_push_job_items_job_id_idx").on(table.jobId),
  })
);

// One row per destructive YouTube comment write (update, delete, reject or
// ban), recorded BEFORE the write reaches YouTube. `comments.update` overwrites textOriginal
// in place and YouTube keeps no version history, so this table is the only
// surviving copy of the prior text.
//
// Append-only: verb, textSource, beforeText and afterText are written once and
// never modified; only `status` transitions (pending -> applied | failed |
// unknown). Nothing references these rows, so nothing cascades from them.
//
// `textSource` records which YouTube field the snapshot captured. YouTube
// returns snippet.textOriginal only to the comment's author, so a comment the
// acting channel wrote snapshots as 'original' (byte-exact, restorable) while a
// third-party comment snapshots as 'display' (HTML-marked-up, audit record
// only — never a restore source).
export const commentEdits = pgTable(
  "comment_edits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    // The acting user. Kept as an audit record after the user is deleted.
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    // UC... channel whose token signed the write.
    channelId: text("channel_id").notNull(),
    commentId: text("comment_id").notNull(),
    // Nullable: callers pass it through from search results when they have it.
    videoId: text("video_id"),
    // update | delete | reject | ban. reject and ban come from comment
    // moderation (#156); a hold is reversible and writes no snapshot.
    verb: text("verb").notNull(),
    // original | display
    textSource: text("text_source").notNull(),
    beforeText: text("before_text").notNull(),
    // Null for verb = 'delete'.
    afterText: text("after_text"),
    // pending | applied | failed | unknown
    status: text("status").notNull().default("pending"),
    // mcp | rest | dashboard | auto. `auto` is automatic comment moderation
    // (#156), which writes a null userId.
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCreatedAtIdx: index("comment_edits_org_created_at_idx").on(
      table.organizationId,
      table.createdAt.desc()
    ),
  })
);

// ─── Automatic comment moderation (#156) ─────────────────────────────────────
//
// Every table below is channel-scoped: `youtube_channel_id` references
// youtube_channels.id ON DELETE CASCADE, so disconnecting a channel removes
// all of its stored comments, scores, rules, rubrics, examples, counters and
// action log (I8). Org scoping goes through youtube_channels.organization_id.
// `comment_edits` snapshots are NOT here: they survive disconnect and go only
// with the org. Enumerated text columns mirror the types in
// src/lib/moderation/types.ts.

// One row per channel: whether the sweep runs, where it has read up to, and
// the I2 cap pauses.
export const commentAutomation = pgTable("comment_automation", {
  id: uuid("id").defaultRandom().primaryKey(),
  youtubeChannelId: uuid("youtube_channel_id")
    .notNull()
    .unique()
    .references(() => youtubeChannels.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  // Scoring starts here; comments posted before enable are never imported.
  enabledAt: timestamp("enabled_at", { mode: "date", withTimezone: true }),
  // Comments published before this instant are not ingested (one in the same
  // second is, and deduped by id). Advances to now after a credit or quota
  // skip, so missed windows are dropped.
  cursor: timestamp("cursor", { mode: "date", withTimezone: true }),
  // Set when the listing stopped at its page limit before reaching the
  // cursor: the YouTube page token the next run resumes from, so the older
  // comments are still read. The cursor stays put until they are.
  listingPageToken: text("listing_page_token"),
  // The newest comment seen by the listing being resumed; the cursor moves
  // here once the resumed listing reaches the old cursor.
  listingNewest: timestamp("listing_newest", { mode: "date", withTimezone: true }),
  // Set when today's automatic reject+ban (or delete) cap is hit; matches
  // then degrade to hold until an owner or admin resumes.
  pausedRejectBan: boolean("paused_reject_ban").notNull().default(false),
  pausedDelete: boolean("paused_delete").notNull().default(false),
  // done | skipped: disabled | skipped: no published rubric |
  // skipped: out of credits | skipped: quota breaker | skipped: youtube error
  lastRunStatus: text("last_run_status"),
  lastRunAt: timestamp("last_run_at", { mode: "date", withTimezone: true }),
  // The resolved Jev model string from the most recent score (jev-latest
  // resolves to a concrete version), shown on the dashboard.
  lastModel: text("last_model"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Viewer comments and replies on the channel's own videos, stored from enable
// until disconnect. The sweep is the only writer of `text` (I7: the text only
// ever reaches Jev as state; moderation calls take comment ids only).
export const youtubeComments = pgTable(
  "youtube_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    // YouTube comment id.
    commentId: text("comment_id").notNull(),
    // YouTube id of the top-level comment for a reply; null for top-level.
    parentId: text("parent_id"),
    videoId: text("video_id").notNull(),
    authorChannelId: text("author_channel_id"),
    authorDisplayName: text("author_display_name").notNull().default(""),
    // Whole text; truncation happens only when building the Jev request.
    text: text("text").notNull(),
    // original | display (as comment_edits.text_source)
    textSource: text("text_source").notNull(),
    publishedAt: timestamp("published_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    // pending | scoring | scored | unscored. `unscored` is terminal: a Jev
    // failure is never retried and never acted on.
    scoreStatus: text("score_status").notNull().default("pending"),
    // none | flagged | held | rejected | banned | deleted | released
    moderationState: text("moderation_state").notNull().default("none"),
    // Set on the first hold/reject/ban/delete (flag does not count, I4).
    actionedAt: timestamp("actioned_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueChannelComment: unique("youtube_comments_channel_comment_unique").on(
      table.youtubeChannelId,
      table.commentId
    ),
    channelScoreStatusIdx: index("youtube_comments_channel_score_status_idx").on(
      table.youtubeChannelId,
      table.scoreStatus
    ),
    channelPublishedAtIdx: index("youtube_comments_channel_published_at_idx").on(
      table.youtubeChannelId,
      table.publishedAt.desc()
    ),
    channelModerationStateIdx: index(
      "youtube_comments_channel_moderation_state_idx"
    ).on(table.youtubeChannelId, table.moderationState),
  })
);

// One Jev score per comment per rubric version. Reclassify adds a row for the
// new version; it never rewrites an old one.
export const commentScores = pgTable(
  "comment_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => youtubeComments.id, { onDelete: "cascade" }),
    rubricVersion: integer("rubric_version").notNull(),
    // Resolved model string returned by Jev (never the `jev-latest` alias).
    model: text("model").notNull(),
    // The winning label.
    choice: text("choice").notNull(),
    // { [label]: probability }
    probabilities: jsonb("probabilities").notNull(),
    confidence: real("confidence"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // When this score's rule decision was taken up (evaluated, and any match
    // attempted by the chokepoint). Null = still owed a decision: the next
    // sweep re-evaluates it if this is the published version.
    decidedAt: timestamp("decided_at", { mode: "date", withTimezone: true }),
    // Set atomically by the run that takes this score's decision to the
    // chokepoint, so two overlapping runs never act on it twice. Cleared when
    // the decision stays owed (nothing reached YouTube). A claim left by a
    // killed step, or by an outcome that could not be recorded, is never
    // re-taken: the comment waits for a person rather than risk acting twice.
    decisionClaimedAt: timestamp("decision_claimed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    undecidedIdx: index("comment_scores_undecided_idx")
      .on(table.youtubeChannelId, table.rubricVersion)
      .where(sql`${table.decidedAt} IS NULL`),
    uniqueCommentVersion: unique("comment_scores_comment_version_unique").on(
      table.commentId,
      table.rubricVersion
    ),
    channelVersionIdx: index("comment_scores_channel_version_idx").on(
      table.youtubeChannelId,
      table.rubricVersion
    ),
  })
);

// Owner rules `{label, threshold, action}`. `setModerationRules` replaces the
// channel's whole set in one transaction.
export const commentModerationRules = pgTable(
  "comment_moderation_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    // Inclusive: probability >= threshold matches. 0..1.
    threshold: real("threshold").notNull(),
    // flag | hold | reject | ban | delete (ban = reject + ban author)
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    channelIdx: index("comment_moderation_rules_channel_idx").on(
      table.youtubeChannelId
    ),
  })
);

// Versioned rubric: labels + owner wording + the accepted examples frozen at
// publish. At most one draft and one published version per channel.
export const commentRubrics = pgTable(
  "comment_rubrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // draft | published | superseded
    status: text("status").notNull().default("draft"),
    // [{ name, description }]
    labels: jsonb("labels").notNull(),
    instructions: text("instructions").notNull().default(""),
    // [{ text, label }] — sent to Jev only inside `state` (I7).
    examples: jsonb("examples").notNull().default(sql`'[]'::jsonb`),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    publishedBy: uuid("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueChannelVersion: unique("comment_rubrics_channel_version_unique").on(
      table.youtubeChannelId,
      table.version
    ),
    onePublished: uniqueIndex("comment_rubrics_one_published")
      .on(table.youtubeChannelId)
      .where(sql`${table.status} = 'published'`),
    oneDraft: uniqueIndex("comment_rubrics_one_draft")
      .on(table.youtubeChannelId)
      .where(sql`${table.status} = 'draft'`),
  })
);

// Corrections: a member suggests a label for a stored comment, an owner or
// admin accepts or rejects it. Accepted examples enter the next draft only.
// The text is copied so an example outlives edits to the stored comment.
export const commentRubricExamples = pgTable(
  "comment_rubric_examples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => youtubeComments.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    label: text("label").notNull(),
    // suggested | accepted | rejected
    status: text("status").notNull().default("suggested"),
    suggestedBy: uuid("suggested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedBy: uuid("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true }),
    // Rubric version this example was first published in; null until then.
    includedInVersion: integer("included_in_version"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    channelStatusIdx: index("comment_rubric_examples_channel_status_idx").on(
      table.youtubeChannelId,
      table.status
    ),
  })
);

// I2 cap counters, one row per channel per Pacific day (YYYY-MM-DD, the
// YouTube quota day). Only applyModerationDecision writes them: reserve is a
// row-locked (SELECT … FOR UPDATE) read-modify-write in one transaction, and
// slots whose action provably never reached YouTube are released.
export const commentModerationCounters = pgTable(
  "comment_moderation_counters",
  {
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    pacificDay: text("pacific_day").notNull(),
    rejectBanCount: integer("reject_ban_count").notNull().default(0),
    deleteCount: integer("delete_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.youtubeChannelId, table.pacificDay] }),
  })
);

// Moderation action log, automatic and manual. One row per comment per
// decision; `appliedAction` differs from `requestedAction` when a cap or
// pause degraded it to hold.
export const commentModerationActions = pgTable(
  "comment_moderation_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    youtubeChannelId: uuid("youtube_channel_id")
      .notNull()
      .references(() => youtubeChannels.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => youtubeComments.id, { onDelete: "cascade" }),
    // flag | hold | reject | ban | delete | release
    requestedAction: text("requested_action").notNull(),
    appliedAction: text("applied_action").notNull(),
    // cap_reached | paused | batch_failed | no_author; null when not degraded.
    degradedReason: text("degraded_reason"),
    // auto | dashboard
    source: text("source").notNull(),
    // Null for automatic actions.
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    // No FK: rules are replaced wholesale, and the log must outlive that.
    ruleId: uuid("rule_id"),
    rubricVersion: integer("rubric_version"),
    // pending | applied | failed | unknown | skipped_non_production.
    // unknown = the YouTube call failed ambiguously and may have landed.
    status: text("status").notNull().default("pending"),
    // Short machine reason for failed/unknown (quota, credits, timeBudget,
    // snapshot_failed, youtube_rejected, youtube_ambiguous, …). Never text.
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    channelCreatedAtIdx: index("comment_moderation_actions_channel_created_at_idx").on(
      table.youtubeChannelId,
      table.createdAt.desc()
    ),
  })
);
