import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export async function identityToken(): Promise<string | undefined> {
  if (Boolean(url) !== Boolean(key))
    throw new Error('SUPABASE_CONFIG_INCOMPLETE');
  if (!supabase) return undefined;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session.access_token;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) throw new Error('AUTH_UNAVAILABLE');
  return data.session.access_token;
}
