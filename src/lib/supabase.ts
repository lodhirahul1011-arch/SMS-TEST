import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
export const supabasePublicKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  '';

export const supabase =
  supabaseUrl && supabasePublicKey
    ? createClient(supabaseUrl, supabasePublicKey)
    : null;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublicKey);
