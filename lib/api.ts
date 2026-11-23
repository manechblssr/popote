"use client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TOKEN = "popote_device";

/** Jeton secret de l'appareil : c'est lui qui est validé via Telegram. */
export function deviceToken(): string {
  let t = localStorage.getItem(TOKEN);
  if (!t) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    t = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem(TOKEN, t);
  }
  return t;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const r = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken()}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({ error: "Réponse illisible du serveur." }));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Pas de connexion au serveur." } as T & { error?: string } };
  }
}

export type Live = { type: "status"; status: string } | { type: "change"; week: string };

/** Connexion temps réel au serveur, avec reconnexion automatique. Renvoie la fonction de fermeture. */
export function live(onMessage: (m: Live) => void, onOpen?: () => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let ping: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws`);
    ws.onopen = () => {
      retry = 0;
      ws?.send(JSON.stringify({ type: "auth", token: deviceToken() }));
      ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })), 30_000);
      onOpen?.();
    };
    ws.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.type === "status" || m.type === "change") onMessage(m); } catch { /* ignoré */ }
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (!stopped) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
    };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); clearInterval(ping); ws?.close(); };
}
