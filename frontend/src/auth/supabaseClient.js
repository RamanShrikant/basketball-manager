import { createClient } from "@supabase/supabase-js";

const endpoint = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();

export const isAuthConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(endpoint) &&
  (publishableKey.startsWith("sb_publishable_") || publishableKey.startsWith("eyJ"));

export const supabase = isAuthConfigured
  ? createClient(endpoint, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
