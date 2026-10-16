import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const publicEnv = window.__TRELLO_ENV__ ?? {};
const url = publicEnv.supabaseUrl ?? "";
const publishableKey = publicEnv.supabasePublishableKey ?? "";

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, publishableKey)
  : null;
