// @ts-check
import { z } from "zod";

/**
 * Specify your server-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
export const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  CLOUDFLARE_TUNNEL_URL: z.string().optional().default("http://localhost:3000"),

  // YouTube OAuth
  YOUTUBE_CLIENT_ID: z.string(),
  YOUTUBE_CLIENT_SECRET: z.string(),
  YOUTUBE_REDIRECT_URI: z.string().url(),

  // Encryption
  // V2 is the currently-active key (required). V3 is reserved for the next
  // rotation; set it ahead of bumping ACTIVE_VERSION in `utils/encryption.ts`.
  // See `utils/encryption.ts` for the version-byte → key mapping.
  ENCRYPTION_KEY_V2: z.string().min(32),
  ENCRYPTION_KEY_V3: z.string().min(32).optional(),

  // RapidAPI (optional)
  RAPID_API_KEY: z.string().optional(),

  // Database
  DATABASE_URL: z.string(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string(),
  // Required: when unset, Better Auth derives its base URL from the request Host
  // header, which would put a spoofed host into magic-link emails and leave
  // `trustedOrigins` empty.
  BETTER_AUTH_URL: z.string().url(),

  // SendGrid
  SENDGRID_API_KEY: z.string(),

  // Google OAuth (for Better Auth)
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),

  // Trigger.dev
  TRIGGER_SECRET_KEY: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  STRIPE_PRO_PRICE_ID: z.string(),
  STRIPE_BUSINESS_PRICE_ID: z.string(),

});

/**
 * You can't destruct `process.env` as a regular object in the Next.js
 * middleware, so you have to do it manually here.
 * @type {{ [k in keyof z.input<typeof serverSchema>]: string | undefined }}
 */
export const serverEnv = {
  NODE_ENV: process.env.NODE_ENV,
  CLOUDFLARE_TUNNEL_URL: process.env.CLOUDFLARE_TUNNEL_URL,

  // YouTube OAuth
  YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REDIRECT_URI: process.env.YOUTUBE_REDIRECT_URI,

  // Encryption
  ENCRYPTION_KEY_V2: process.env.ENCRYPTION_KEY_V2,
  ENCRYPTION_KEY_V3: process.env.ENCRYPTION_KEY_V3,

  // RapidAPI
  RAPID_API_KEY: process.env.RAPID_API_KEY,

  // Database
  DATABASE_URL: process.env.DATABASE_URL,

  // Better Auth
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,

  // SendGrid
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,

  // Google OAuth (for Better Auth)
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,

  // Trigger.dev
  TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
  STRIPE_BUSINESS_PRICE_ID: process.env.STRIPE_BUSINESS_PRICE_ID,

};

/**
 * Specify your client-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 * To expose them to the client, prefix them with `NEXT_PUBLIC_`.
 */
export const clientSchema = z.object({
  // App URL
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Stripe
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),

  // PostHog
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
});

/**
 * You can't destruct `process.env` as a regular object, so you have to do
 * it manually here. This is because Next.js evaluates this at build time,
 * and only used environment variables are included in the build.
 * @type {{ [k in keyof z.input<typeof clientSchema>]: string | undefined }}
 */
export const clientEnv = {
  // App URL
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

  // Stripe
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,

  // PostHog
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
};
