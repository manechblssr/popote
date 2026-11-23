"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
function rt(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Écoute un canal Broadcast public. Les messages ne contiennent aucune donnée : ce sont des signaux de rafraîchissement. */
export function listen(topic: string, event: string, cb: (payload: Record<string, unknown>) => void): () => void {
  const c = rt();
  if (!c) return () => {};
  const ch = c.channel(topic).on("broadcast", { event }, (m) => cb((m.payload ?? {}) as Record<string, unknown>)).subscribe();
  return () => { c.removeChannel(ch); };
}
