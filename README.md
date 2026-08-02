# VidTempla

A powerful dashboard and API platform for managing YouTube video descriptions at scale using dynamic templates and variables.

## Features

### Core Functionality

- **Multi-Channel Support**: Connect and manage multiple YouTube channels via OAuth
- **Template System**: Create reusable description templates with `{{variable}}` placeholders
- **Container Management**: Group templates together to create description structures
- **Dynamic Variables**: Set unique variable values per video for personalized descriptions
- **Version History**: Track all description changes with rollback capability
- **Batch Updates**: Update multiple video descriptions simultaneously

### Key Features

- 🔐 Secure authentication with magic link and Google OAuth
- 📝 Powerful template editor with variable auto-detection
- 🎯 Immutable video-to-container assignment for data integrity
- 📊 Clean, intuitive dashboard
- 🔄 Background job processing with Trigger.dev (scheduled channel syncs every 6 hours)
- 💳 Stripe-powered subscription billing (Pro + Business plans)
- 🤖 MCP server with OAuth for AI agent access
- 🌐 REST API for programmatic channel management
- 📱 Fully responsive UI

## Tech Stack

- **Frontend**: Next.js 15, React 18, TypeScript, Tailwind CSS
- **UI Components**: Radix UI
- **Backend**: tRPC for type-safe APIs
- **Database**: PlanetScale Postgres with Drizzle ORM
- **Authentication**: Better Auth (magic link via Resend + Google OAuth)
- **Background Jobs**: Trigger.dev
- **Email**: Resend
- **Payments**: Stripe
- **API Integration**: YouTube Data API v3
- **Analytics**: PostHog (optional)

## REST API (`/api/v1/`)

VidTempla exposes a REST API for programmatic access, usable by AI agents or external tools. Authenticate with an API key generated in the dashboard.

| Group             | Endpoints                                                                        |
| ----------------- | -------------------------------------------------------------------------------- |
| **Channels**      | List, get, overview, analytics, sync, search                                     |
| **Videos**        | List, get, analytics, retention, assign, variables, description history & revert |
| **Templates**     | CRUD, impact analysis                                                            |
| **Containers**    | CRUD                                                                             |
| **YouTube Proxy** | Playlists, comments, thumbnails, and search                                      |
| **Analytics**     | Flexible YouTube Analytics API queries                                           |
| **Usage**         | API request tracking and quota monitoring                                        |

Interactive API reference available at `/reference`.

## MCP Server

VidTempla includes a built-in MCP (Model Context Protocol) server accessible at `/api/[transport]`. It uses Better Auth's OIDC plugin for dynamic client registration, allowing AI assistants to connect and manage your YouTube channels on your behalf.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- [PlanetScale](https://planetscale.com/) account (or compatible Postgres)
- [Google Cloud](https://console.cloud.google.com/) account (YouTube Data API v3 + OAuth)
- [Trigger.dev](https://trigger.dev/) account (background jobs)
- [Resend](https://resend.com/) account (magic link emails)
- [Stripe](https://stripe.com/) account (payments)

### 1. Clone the Repository

```bash
git clone https://github.com/theramjad/vidtempla.git
cd vidtempla
```

### 2. Set Up Google Cloud & YouTube API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **YouTube Data API v3**
4. Create **two** OAuth 2.0 credentials:
   - **Google Sign-In** (for dashboard auth): redirect URI `http://localhost:3000/api/auth/callback`
   - **YouTube OAuth** (for channel access): redirect URI `http://localhost:3000/api/auth/youtube/callback`

### 3. Configure Environment Variables

```bash
cd nextjs
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```env
# Database (PlanetScale Postgres)
DATABASE_URL=

# Better Auth
BETTER_AUTH_SECRET=                   # Random secret string
BETTER_AUTH_URL=http://localhost:3000

# Resend (for magic link emails)
RESEND_API_KEY=

# Google Sign-In OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# YouTube OAuth (channel access)
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback

# Encryption key (generate a random 32+ character string)
ENCRYPTION_KEY_V2=

# Trigger.dev (background jobs)
TRIGGER_SECRET_KEY=tr_dev_YOUR_KEY_HERE

# Stripe (payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_BUSINESS_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# PostHog (optional analytics)
NEXT_PUBLIC_POSTHOG_KEY=
```

### 4. Install Dependencies and Run

```bash
cd nextjs
npm install

# Run database migrations
npx drizzle-kit migrate

# Start the development server
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000)

### 5. Start Trigger.dev (Background Jobs)

In a separate terminal:

```bash
cd nextjs
npm run dev:trigger
```

### Database Migrations

Schema changes use Drizzle ORM. To apply changes:

```bash
# After editing nextjs/src/db/schema.ts, generate a migration:
npx drizzle-kit generate

# Then commit the generated SQL file — Vercel runs migrations on deploy automatically
```

**Never run `drizzle-kit push`** — it prompts interactively and silently fails in CI.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See the [LICENSE.md](./LICENSE.md) file for the full license text.

For more information, visit: https://www.gnu.org/licenses/agpl-3.0.en.html
