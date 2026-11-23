import { DurableObject } from "cloudflare:workers";
import { isMonday, nameKey } from "../../lib/types";

export interface Env {
  FAMILY: DurableObjectNamespace<Family>;
  ALLOWED_ORIGINS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
}

/* ------------------------------------------------------------------ */
/* Point d'entrée : CORS puis tout est confié à l'unique Durable Object */
/* ------------------------------------------------------------------ */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    const cors: Record<string, string> = allowed.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin" }
      : {};
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const stub = env.FAMILY.get(env.FAMILY.idFromName("family"));
    const res = await stub.fetch(req);
    if (res.webSocket) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;

/* ------------------------------------------------------------------ */
class Bad extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}
type Row = Record<string, SqlStorageValue>;
type Body = Record<string, unknown>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const str = (v: unknown, max = 80) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s || s.length > max) throw new Bad("Texte invalide");
  return s;
};
const unitOf = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 20) : "");
const num = (v: unknown, min = 0, max = 100000): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Bad("Nombre invalide");
  return n;
};
const peopleOf = (v: unknown) => { const n = num(v, 1, 50); return n === null ? null : Math.round(n); };
const idOf = (v: unknown) => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/.test(v)) throw new Bad("Identifiant invalide");
  return v;
};
const sourceOf = (v: unknown) => (v === "placard" ? "placard" : "courses");
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const bool = (v: SqlStorageValue) => v === 1;

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS weeks (id TEXT PRIMARY KEY, week_start TEXT NOT NULL UNIQUE, default_people INTEGER NOT NULL DEFAULT 4, configured INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, week_id TEXT NOT NULL, day INTEGER NOT NULL, meal TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, people INTEGER, UNIQUE (week_id, day, meal));
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, week_id TEXT NOT NULL, name TEXT NOT NULL, source TEXT NOT NULL, quantity REAL, unit TEXT NOT NULL DEFAULT '', per_person INTEGER NOT NULL DEFAULT 0, checked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS items_week ON items(week_id);
CREATE TABLE IF NOT EXISTS dishes (id TEXT PRIMARY KEY, week_id TEXT NOT NULL, name TEXT NOT NULL, slot_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS dishes_week ON dishes(week_id);
CREATE TABLE IF NOT EXISTS dish_ingredients (id TEXT PRIMARY KEY, dish_id TEXT NOT NULL, item_id TEXT NOT NULL, qty_per_person REAL NOT NULL DEFAULT 0, UNIQUE (dish_id, item_id));
CREATE TABLE IF NOT EXISTS ingredient_memory (name_key TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', quantity REAL, per_person INTEGER NOT NULL DEFAULT 0, last_week TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 1);
`;

/* ------------------------------------------------------------------ */
/* Durable Object : base SQLite + WebSockets temps réel de la famille   */
/* ------------------------------------------------------------------ */
export class Family extends DurableObject<Env> {
  sql: SqlStorage;
  // Valeurs nettoyées : un espace ou un retour à la ligne collé avec la valeur ferait échouer Telegram
  admin: string;
  botToken: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.admin = (env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
    this.botToken = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  q(query: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(query, ...args).toArray() as Row[];
  }
  one(query: string, ...args: SqlStorageValue[]): Row | undefined {
    return this.q(query, ...args)[0];
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      switch (`${req.method} ${url.pathname}`) {
        case "GET /ws": return this.openSocket(req);
        case "POST /api/auth/request": return await this.authRequest(req);
        case "POST /api/auth/status": return await this.authStatus(req);
        case "GET /api/data": {
          await this.member(req);
          return json(this.state(this.weekParam(url.searchParams.get("week"))));
        }
        case "POST /api/data": {
          await this.member(req);
          const b = (await req.json()) as Body;
          const week = this.weekParam(b.week);
          this.ctx.storage.transactionSync(() => this.apply(this.ensureWeek(week), b));
          this.notifyFamily(week);
          return json(this.state(week));
        }
        case "POST /telegram/webhook": return await this.telegram(req);
        case "GET /telegram/setup": return await this.setupWebhook(url);
        case "GET /": return json({ ok: true, service: "popote-api" });
        default: return json({ error: "Introuvable" }, 404);
      }
    } catch (e) {
      if (e instanceof Bad) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Erreur serveur, réessayez." }, 500);
    }
  }

  /* ---------------- Appareils & accès ---------------- */
  async deviceByToken(token: unknown): Promise<Row | undefined> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return undefined;
    return this.one("SELECT * FROM devices WHERE token_hash = ?", await sha256(token));
  }

  async member(req: Request) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const dev = await this.deviceByToken(token);
    if (!dev || dev.status !== "approved") throw new Bad("Session expirée", 401);
    return dev;
  }

  async authRequest(req: Request) {
    const b = (await req.json().catch(() => ({}))) as Body;
    const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 1 || name.length > 40) throw new Bad("Saisissez un prénom (40 caractères max).");
    if (typeof b.token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(b.token)) throw new Bad("Appareil non reconnu, rechargez la page.");
    const hash = await sha256(b.token);
    const existing = this.one("SELECT * FROM devices WHERE token_hash = ?", hash);
    const sameName = existing && String(existing.name).toLowerCase() === name.toLowerCase();

    if (existing && sameName && existing.status === "approved") {
      this.sql.exec("UPDATE devices SET last_seen = ? WHERE id = ?", now(), existing.id);
      return json({ id: existing.id, status: "approved", name: existing.name });
    }
    if (existing && sameName && existing.status === "rejected") return json({ id: existing.id, status: "rejected" });
    if (existing && sameName && existing.status === "pending" && Date.now() - Date.parse(String(existing.created_at)) < 10 * 60_000) {
      return json({ id: existing.id, status: "pending" });
    }
    // Garde-fou contre l'envoi massif de demandes
    const recent = this.one("SELECT COUNT(*) AS n FROM devices WHERE status = 'pending' AND created_at > ?", new Date(Date.now() - 3600_000).toISOString());
    if (Number(recent?.n ?? 0) >= 20) throw new Bad("Trop de demandes en attente, réessayez plus tard.", 429);

    const id = existing ? String(existing.id) : uuid();
    if (existing) this.sql.exec("UPDATE devices SET name = ?, status = 'pending', created_at = ?, decided_at = NULL WHERE id = ?", name, now(), id);
    else this.sql.exec("INSERT INTO devices (id, name, token_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)", id, name, hash, now());

    if (!this.admin) throw new Bad("Veuillez patienter.", 503);
    const sent = await this.tg("sendMessage", {
      chat_id: this.admin,
      parse_mode: "HTML",
      text: `🍲 <b>${esc(name)}</b> demande l'accès à Popote depuis un nouvel appareil.`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Accepter", callback_data: `ok:${id}` }, { text: "❌ Refuser", callback_data: `no:${id}` }]] },
    });
    // Échec d'envoi : on autorise un nouvel essai immédiat
    if (!sent.ok) this.sql.exec("UPDATE devices SET created_at = ? WHERE id = ?", new Date(0).toISOString(), id);
    if (!sent.ok) throw new Bad("Veuillez patienter.", 502);
    return json({ id, status: "pending" });
  }

  async authStatus(req: Request) {
    const b = (await req.json().catch(() => ({}))) as Body;
    const dev = await this.deviceByToken(b.token);
    if (!dev) return json({ status: "unknown" });
    if (dev.status === "approved") this.sql.exec("UPDATE devices SET last_seen = ? WHERE id = ?", now(), dev.id);
    return json({ id: dev.id, status: dev.status, name: dev.name });
  }

  /* ---------------- Telegram ---------------- */
  async tg(method: string, body: Body): Promise<{ ok?: boolean; [k: string]: unknown }> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean };
    if (!out.ok) console.error("telegram", method, JSON.stringify(out));
    return out;
  }

  /** Secret du webhook dérivé du token du bot : rien de plus à configurer. */
  webhookSecret() {
    return hmac(this.botToken,"popote-webhook").then((h) => h.slice(0, 48));
  }

  async setupWebhook(url: URL) {
    const hook = `${url.origin}/telegram/webhook`;
    const res = await this.tg("setWebhook", { url: hook, secret_token: await this.webhookSecret(), allowed_updates: ["message", "callback_query"] });
    return json({ webhook: hook, ok: res.ok === true, description: res.description ?? null });
  }

  async telegram(req: Request) {
    if (!safeEqual(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", await this.webhookSecret())) return json({ error: "forbidden" }, 403);
    const update = (await req.json().catch(() => null)) as any;

    const msg = update?.message;
    if (msg?.text && /^\/(start|id)\b/.test(msg.text)) {
      const admin = this.admin;
      await this.tg("sendMessage", {
        chat_id: msg.chat.id,
        text: admin ? `Bonjour ! Identifiant de cette conversation : ${msg.chat.id}` : `Identifiant de cette conversation : ${msg.chat.id}\nEnregistrez-le comme TELEGRAM_ADMIN_CHAT_ID pour recevoir les demandes d'accès.`,
      });
      return json({ ok: true });
    }

    const cb = update?.callback_query;
    if (!cb?.data) return json({ ok: true });
    const admin = this.admin;
    if (String(cb.message?.chat?.id) !== admin && String(cb.from?.id) !== admin) {
      await this.tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Action réservée à l'administrateur." });
      return json({ ok: true });
    }
    const m = /^(ok|no):([0-9a-f-]{36})$/.exec(cb.data);
    if (!m) return json({ ok: true });
    const status = m[1] === "ok" ? "approved" : "rejected";
    const dev = this.one("SELECT id, name FROM devices WHERE id = ?", m[2]);
    if (!dev) {
      await this.tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Demande introuvable." });
      return json({ ok: true });
    }
    this.sql.exec("UPDATE devices SET status = ?, decided_at = ? WHERE id = ?", status, now(), dev.id);
    this.notifyDevice(String(dev.id), status);
    await this.tg("answerCallbackQuery", { callback_query_id: cb.id, text: status === "approved" ? "Accès accordé" : "Accès refusé" });
    if (cb.message) {
      await this.tg("editMessageText", {
        chat_id: cb.message.chat.id, message_id: cb.message.message_id, parse_mode: "HTML",
        text: `${status === "approved" ? "✅" : "❌"} <b>${esc(String(dev.name))}</b> : accès ${status === "approved" ? "accordé" : "refusé"}.`,
      });
    }
    return json({ ok: true });
  }

  /* ---------------- Temps réel (WebSocket Hibernation) ---------------- */
  openSocket(req: Request) {
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket attendu" }, 426);
    const origin = req.headers.get("Origin");
    if (origin && !this.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin)) return json({ error: "forbidden" }, 403);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({});
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: Body;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
    if (msg.type === "auth") {
      const dev = await this.deviceByToken(msg.token);
      if (!dev) { ws.send(JSON.stringify({ type: "status", status: "unknown" })); return ws.close(4001, "unknown"); }
      ws.serializeAttachment({ id: dev.id, status: dev.status });
      ws.send(JSON.stringify({ type: "status", status: dev.status }));
    }
  }

  webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* déjà fermé */ }
  }

  notifyFamily(week: string) {
    const data = JSON.stringify({ type: "change", week });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { status?: string } | null;
      if (a?.status === "approved") try { ws.send(data); } catch { /* socket fermée */ }
    }
  }

  notifyDevice(id: string, status: string) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { id?: string } | null;
      if (a?.id !== id) continue;
      ws.serializeAttachment({ id, status });
      try { ws.send(JSON.stringify({ type: "status", status })); } catch { /* socket fermée */ }
    }
  }

  /* ---------------- Données de la semaine ---------------- */
  weekParam(v: unknown) {
    if (typeof v !== "string" || !isMonday(v)) throw new Bad("Semaine invalide");
    return v;
  }

  ensureWeek(weekStart: string): Row {
    let week = this.one("SELECT * FROM weeks WHERE week_start = ?", weekStart);
    if (week) return week;
    const prev = this.one("SELECT default_people FROM weeks WHERE week_start < ? ORDER BY week_start DESC LIMIT 1", weekStart);
    const id = uuid();
    this.sql.exec("INSERT INTO weeks (id, week_start, default_people) VALUES (?, ?, ?)", id, weekStart, prev?.default_people ?? 4);
    for (let i = 0; i < 14; i++) {
      this.sql.exec("INSERT INTO slots (id, week_id, day, meal) VALUES (?, ?, ?, ?)", uuid(), id, i >> 1, i % 2 ? "dinner" : "lunch");
    }
    week = this.one("SELECT * FROM weeks WHERE id = ?", id)!;
    return week;
  }

  state(weekStart: string) {
    const w = this.ensureWeek(weekStart);
    const wid = String(w.id);
    const items = this.q("SELECT * FROM items WHERE week_id = ? ORDER BY created_at", wid).map((r) => ({ ...r, per_person: bool(r.per_person), checked: bool(r.checked) }));
    const dishes = this.q("SELECT * FROM dishes WHERE week_id = ? ORDER BY created_at", wid);
    const ingredients = this.q("SELECT di.* FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id WHERE d.week_id = ?", wid);
    const present = new Set(items.map((i) => nameKey(String((i as unknown as Row).name))));
    const recents = this.q("SELECT * FROM ingredient_memory ORDER BY last_week DESC, uses DESC LIMIT 120")
      .filter((r) => !present.has(String(r.name_key))).slice(0, 40).map((r) => ({ ...r, per_person: bool(r.per_person) }));
    return {
      week: { ...w, configured: bool(w.configured) },
      slots: this.q("SELECT * FROM slots WHERE week_id = ? ORDER BY day, meal DESC", wid).map((r) => ({ ...r, active: bool(r.active) })),
      items, dishes, ingredients, recents,
    };
  }

  remember(weekStart: string, it: { name: string; source: string; unit: string; quantity: number | null; per_person: boolean }) {
    this.sql.exec(
      `INSERT INTO ingredient_memory (name_key, name, source, unit, quantity, per_person, last_week, uses) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, source = excluded.source, unit = excluded.unit, quantity = excluded.quantity,
       per_person = excluded.per_person, last_week = excluded.last_week, uses = uses + 1`,
      nameKey(it.name), it.name, it.source, it.unit, it.quantity, it.per_person ? 1 : 0, weekStart,
    );
  }

  addItem(week: Row, b: Body): string {
    const name = str(b.name);
    const dup = this.q("SELECT id, name FROM items WHERE week_id = ?", week.id).find((i) => nameKey(String(i.name)) === nameKey(name));
    if (dup) return String(dup.id);
    const it = { name, source: sourceOf(b.source), quantity: num(b.quantity), unit: unitOf(b.unit), per_person: b.per_person === true || b.per_person === 1 };
    const id = uuid();
    this.sql.exec("INSERT INTO items (id, week_id, name, source, quantity, unit, per_person, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, week.id, it.name, it.source, it.quantity, it.unit, it.per_person ? 1 : 0, now());
    this.remember(String(week.week_start), it);
    return id;
  }

  /** UPDATE dynamique sur une liste blanche de colonnes. */
  patch(table: string, fields: Record<string, SqlStorageValue>, where: string, ...args: SqlStorageValue[]) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.sql.exec(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE ${where}`, ...keys.map((k) => fields[k]), ...args);
  }

  apply(week: Row, b: Body) {
    const w = String(week.id);
    switch (b.op) {
      case "week.update": {
        const f: Record<string, SqlStorageValue> = {};
        if (b.default_people !== undefined) f.default_people = peopleOf(b.default_people) ?? week.default_people;
        if (typeof b.configured === "boolean") f.configured = b.configured ? 1 : 0;
        return this.patch("weeks", f, "id = ?", w);
      }
      case "slots.preset":
        if (b.preset === "dinner") return this.sql.exec("UPDATE slots SET active = CASE meal WHEN 'dinner' THEN 1 ELSE 0 END WHERE week_id = ?", w);
        return this.sql.exec("UPDATE slots SET active = 1 WHERE week_id = ?", w);
      case "slot.update": {
        const f: Record<string, SqlStorageValue> = {};
        if (typeof b.active === "boolean") f.active = b.active ? 1 : 0;
        if ("people" in b) f.people = peopleOf(b.people);
        return this.patch("slots", f, "id = ? AND week_id = ?", idOf(b.id), w);
      }
      case "item.add":
        return this.addItem(week, b);
      case "item.update": {
        const id = idOf(b.id);
        const f: Record<string, SqlStorageValue> = {};
        if (b.name !== undefined) f.name = str(b.name);
        if (b.source !== undefined) f.source = sourceOf(b.source);
        if ("quantity" in b) f.quantity = num(b.quantity);
        if (b.unit !== undefined) f.unit = unitOf(b.unit);
        if (typeof b.per_person === "boolean") f.per_person = b.per_person ? 1 : 0;
        if (typeof b.checked === "boolean") f.checked = b.checked ? 1 : 0;
        this.patch("items", f, "id = ? AND week_id = ?", id, w);
        if ("name" in f || "unit" in f || "quantity" in f) {
          const it = this.one("SELECT * FROM items WHERE id = ?", id);
          if (it) this.remember(String(week.week_start), { name: String(it.name), source: String(it.source), unit: String(it.unit), quantity: it.quantity as number | null, per_person: bool(it.per_person) });
        }
        return;
      }
      case "item.delete": {
        const id = idOf(b.id);
        if (!this.one("SELECT id FROM items WHERE id = ? AND week_id = ?", id, w)) return;
        this.sql.exec("DELETE FROM dish_ingredients WHERE item_id = ?", id);
        return this.sql.exec("DELETE FROM items WHERE id = ?", id);
      }
      case "items.uncheckAll":
        return this.sql.exec("UPDATE items SET checked = 0 WHERE week_id = ?", w);
      case "recent.add": {
        const r = this.one("SELECT * FROM ingredient_memory WHERE name_key = ?", str(b.name_key));
        if (!r) throw new Bad("Ingrédient oublié entre-temps");
        return this.addItem(week, { ...r, per_person: bool(r.per_person) });
      }
      case "recent.forget":
        return this.sql.exec("DELETE FROM ingredient_memory WHERE name_key = ?", str(b.name_key));
      case "dish.add": {
        const slot = b.slot_id ? idOf(b.slot_id) : null;
        if (slot && !this.one("SELECT id FROM slots WHERE id = ? AND week_id = ?", slot, w)) throw new Bad("Créneau introuvable");
        return this.sql.exec("INSERT INTO dishes (id, week_id, name, slot_id, created_at) VALUES (?, ?, ?, ?, ?)", uuid(), w, str(b.name), slot, now());
      }
      case "dish.update": {
        const f: Record<string, SqlStorageValue> = {};
        if (b.name !== undefined) f.name = str(b.name);
        if ("slot_id" in b) {
          const slot = b.slot_id ? idOf(b.slot_id) : null;
          if (slot && !this.one("SELECT id FROM slots WHERE id = ? AND week_id = ?", slot, w)) throw new Bad("Créneau introuvable");
          f.slot_id = slot;
        }
        return this.patch("dishes", f, "id = ? AND week_id = ?", idOf(b.id), w);
      }
      case "dish.delete": {
        const id = idOf(b.id);
        if (!this.one("SELECT id FROM dishes WHERE id = ? AND week_id = ?", id, w)) return;
        this.sql.exec("DELETE FROM dish_ingredients WHERE dish_id = ?", id);
        return this.sql.exec("DELETE FROM dishes WHERE id = ?", id);
      }
      case "ing.set": {
        const dish = this.one("SELECT id FROM dishes WHERE id = ? AND week_id = ?", idOf(b.dish_id), w);
        if (!dish) throw new Bad("Plat introuvable");
        let itemId: string;
        if (b.item_id) {
          const it = this.one("SELECT id FROM items WHERE id = ? AND week_id = ?", idOf(b.item_id), w);
          if (!it) throw new Bad("Ingrédient introuvable");
          itemId = String(it.id);
        } else {
          itemId = this.addItem(week, b); // nouvel ingrédient créé à la volée
        }
        return this.sql.exec(
          `INSERT INTO dish_ingredients (id, dish_id, item_id, qty_per_person) VALUES (?, ?, ?, ?)
           ON CONFLICT(dish_id, item_id) DO UPDATE SET qty_per_person = excluded.qty_per_person`,
          uuid(), dish.id, itemId, num(b.qty_per_person) ?? 0,
        );
      }
      case "ing.delete": {
        const ing = this.one("SELECT di.id FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id WHERE di.id = ? AND d.week_id = ?", idOf(b.id), w);
        if (!ing) throw new Bad("Ingrédient introuvable");
        return this.sql.exec("DELETE FROM dish_ingredients WHERE id = ?", ing.id);
      }
      default:
        throw new Bad("Action inconnue");
    }
  }
}
