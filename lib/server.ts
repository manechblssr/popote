import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

let admin: SupabaseClient | null = null;
export function db(): SupabaseClient {
  admin ??= createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/* ---------- Session (cookie signé HMAC, vérifié en base à chaque requête) ---------- */
const COOKIE = "popote_session";
const sign = (v: string) => createHmac("sha256", env("SESSION_SECRET")).update(v).digest("base64url");

export async function setSession(deviceId: string) {
  (await cookies()).set(COOKIE, `${deviceId}.${sign(deviceId)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<{ id: string; name: string } | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(id));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const { data } = await db().from("devices").select("id,name,status").eq("id", id).maybeSingle();
  if (!data || data.status !== "approved") return null;
  return { id: data.id, name: data.name };
}

/* ---------- Temps réel : diffusion Supabase Broadcast (aucune donnée transmise) ---------- */
export async function broadcast(topic: string, event: string, payload: Record<string, unknown> = {}) {
  try {
    await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: false }] }),
    });
  } catch (e) {
    console.error("broadcast", e);
  }
}

/* ---------- Telegram ---------- */
export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.error("telegram", method, json);
  return json;
}
export const adminChatId = () => env("TELEGRAM_ADMIN_CHAT_ID");
export const webhookSecret = () => env("TELEGRAM_WEBHOOK_SECRET");

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
