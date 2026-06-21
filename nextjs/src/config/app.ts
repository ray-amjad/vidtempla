/**
 * Application Configuration
 * 
 * Centralized configuration for the Social Media Monitoring application.
 * Modify these values to customize the application for your needs.
 */

export const appConfig = {
  // Basic app information
  name: "VidTempla",
  description: "Manage YouTube video descriptions with dynamic templates",
  supportEmail: "support@vidtempla.com",

  // Branding
  brand: {
    name: "VidTempla",
    shortName: "VidTempla",
    tagline: "Let AI agents manage your YouTube channel",
  },

  // Authentication settings
  auth: {
    enableSignUp: true,
  },

  // Dashboard configuration
  dashboard: {
    defaultRoute: "/dashboard/youtube",
    showSettings: true,
    navigation: [
      {
        title: "Dashboard",
        url: "/dashboard/youtube",
      },
      {
        title: "API Keys",
        url: "/dashboard/api-keys",
      },
      {
        title: "MCP Server",
        url: "/dashboard/mcp-server",
      },
      {
        title: "Usage",
        url: "/dashboard/usage",
      },
    ],
  },
} as const;

export type AppConfig = typeof appConfig;