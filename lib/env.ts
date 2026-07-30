/**
 * Environment access with lazy validation.
 *
 * We intentionally DON'T throw at module load — that would break `next build`
 * and tests in environments where secrets aren't present. Instead each getter
 * validates on first use and gives a clear error naming the missing var.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  supabase: {
    url: () => required("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  luma: {
    apiKey: () => required("LUMA_API_KEY"),
    webhookSecret: () => optional("LUMA_WEBHOOK_SECRET"),
  },
  notionDev: {
    token: () => required("NOTION_DEV_TOKEN"),
    bookingsDbId: () => optional("NOTION_DEV_BOOKINGS_DB_ID"),
    // Row reads/writes target the data source (Notion API v2025-09-03+).
    bookingsDataSourceId: () => required("NOTION_DEV_BOOKINGS_DATA_SOURCE_ID"),
    webhookSecret: () => optional("NOTION_DEV_WEBHOOK_SECRET"),
  },
  notionAmbassador: {
    token: () => required("NOTION_AMBASSADOR_TOKEN"),
    bookingsDbId: () => optional("NOTION_AMBASSADOR_BOOKINGS_DB_ID"),
    bookingsDataSourceId: () => required("NOTION_AMBASSADOR_BOOKINGS_DATA_SOURCE_ID"),
    webhookSecret: () => optional("NOTION_AMBASSADOR_WEBHOOK_SECRET"),
  },
  app: {
    baseUrl: () => optional("APP_BASE_URL") ?? "http://localhost:3000",
  },
} as const;
