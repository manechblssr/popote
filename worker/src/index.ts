import { DurableObject } from "cloudflare:workers";
import {
  CATEGORIES, DEFAULT_STAPLES, MEALS, addDays as addDaysIso, dayLabel, dayName, fmtAmount, guessCategory, isCategory, isTheme, isWeekStart, nameKey, weekStartOf, weekdayOf,
  type Category, type WeekState,
} from "../../lib/types";
import { dishTitle, eatersLabel, excludedFor, headcount, ingredientPeople, neededByItem } from "../../lib/compute";

export interface Env {
  FAMILY: DurableObjectNamespace<Family>;
  ALLOWED_ORIGINS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
  TELEGRAM_API_URL?: string; // pour les tests locaux uniquement
  TEST_NOW?: string;         // date simulée, pour les tests locaux uniquement
  TELEGRAM_PLAN_CHAT_ID?: string; // conversation (ou groupe) qui reçoit le planning validé ; par défaut celle de l'administrateur
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
    if (new URL(req.url).pathname.startsWith("/internal/")) return new Response("Introuvable", { status: 404 });

    const stub = env.FAMILY.get(env.FAMILY.idFromName("family"));
    const res = await stub.fetch(req);
    if (res.webSocket) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },

  // Déclenché le vendredi à 14 h et 15 h UTC : le Durable Object n'envoie qu'à 16 h, heure de Paris (été comme hiver)
  async scheduled(_event: ScheduledController, env: Env) {
    const stub = env.FAMILY.get(env.FAMILY.idFromName("family"));
    await stub.fetch("https://popote.internal/internal/friday", { method: "POST" });
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
const catOf = (r: Row): Category => (isCategory(r.category) ? r.category : guessCategory(String(r.name)));

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
CREATE TABLE IF NOT EXISTS attendance (slot_id TEXT NOT NULL, name_key TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (slot_id, name_key));
CREATE TABLE IF NOT EXISTS exclusions (ingredient_id TEXT NOT NULL, name_key TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (ingredient_id, name_key));
CREATE TABLE IF NOT EXISTS staples (name_key TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', qty_per_person REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
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
  touchedWeeks: string[] = [];
  // Valeurs nettoyées : un espace ou un retour à la ligne collé avec la valeur ferait échouer Telegram
  admin: string;
  botToken: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.admin = (env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
    this.botToken = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
    // Migration : nombre d'invités par repas (la présence des membres est cochée par chacun)
    this.addColumn("slots", "guests", "INTEGER NOT NULL DEFAULT 0");
    // Migration : rayon des courses
    this.addColumn("items", "category", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("ingredient_memory", "category", "TEXT NOT NULL DEFAULT ''");
    // Le bot WhatsApp a été retiré : on efface les numéros enregistrés
    this.sql.exec("DROP TABLE IF EXISTS whatsapp");
    // Ingrédients permanents de départ, insérés une seule fois (ceux retirés ensuite ne reviennent pas)
    if (!this.one("SELECT key FROM meta WHERE key = 'staples_seeded'")) {
      for (const [name, theme, qty, unit] of DEFAULT_STAPLES) {
        this.sql.exec("INSERT OR IGNORE INTO staples (name_key, name, theme, unit, qty_per_person) VALUES (?, ?, ?, ?, ?)", nameKey(name), name, theme, unit, qty);
      }
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('staples_seeded', ?)", now());
    }
  }

  addColumn(table: string, col: string, def: string) {
    if (!this.q(`PRAGMA table_info(${table})`).some((c) => c.name === col)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
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
        case "POST /api/plan/validate": return await this.validatePlan(req);
        case "POST /internal/friday": return await this.fridayRecap();
        case "POST /api/data": {
          const dev = await this.member(req);
          const b = (await req.json()) as Body;
          const week = this.weekParam(b.week);
          this.ctx.storage.transactionSync(() => this.apply(this.ensureWeek(week), b, String(dev.name)));
          this.notifyFamily(week);
          for (const other of this.touchedWeeks) if (other !== week) this.notifyFamily(other);
          this.touchedWeeks = [];
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
    const sameName = existing && nameKey(String(existing.name)) === nameKey(name);

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
    // Même prénom qu'un membre déjà accepté : c'est la même personne sur un autre appareil
    const known = this.q("SELECT name FROM devices WHERE status = 'approved' AND id != ?", id).some((d) => nameKey(String(d.name)) === nameKey(name));
    const sent = await this.tg("sendMessage", {
      chat_id: this.admin,
      parse_mode: "HTML",
      text: `🍲 Nouvelle demande d'accès à Popote\n\n👤 Prénom : <b>${esc(name)}</b>\n📱 ${known ? "Déjà membre, se connecte depuis un nouvel appareil" : "Première connexion"}`,
      reply_markup: {
        inline_keyboard: [[
          { text: `✅ Accepter ${name}`.slice(0, 60), callback_data: `ok:${id}` },
          { text: `❌ Refuser ${name}`.slice(0, 60), callback_data: `no:${id}` },
        ]],
      },
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
    const res = await fetch(`${this.env.TELEGRAM_API_URL ?? "https://api.telegram.org"}/bot${this.botToken}/${method}`, {
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

    // « /recap » : récap de la semaine en cours à la demande (administrateur ou conversation du planning)
    if (msg?.text && /^\/recap\b/.test(msg.text)) {
      const plan = (this.env.TELEGRAM_PLAN_CHAT_ID ?? "").trim();
      const allowed = [this.admin, plan].filter(Boolean);
      if (allowed.includes(String(msg.chat?.id)) || allowed.includes(String(msg.from?.id))) {
        const week = weekStartOf(new Date(Date.now() + 3600_000)); // ≈ heure de Paris
        for (const text of Family.chunks(`🔔 <b>Récap de la semaine</b>\n\n${this.weekReport(week)}`)) {
          await this.tg("sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", text });
        }
      }
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
    if (typeof v !== "string" || !isWeekStart(v)) throw new Bad("Semaine invalide");
    return v;
  }

  /** Semaine enregistrée à reprendre : les anciennes semaines commençaient le lundi. */
  weekParamAny(v: unknown) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Bad("Semaine invalide");
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
    const items = this.q("SELECT * FROM items WHERE week_id = ? ORDER BY created_at", wid).map((r) => ({ ...r, per_person: bool(r.per_person), checked: bool(r.checked), category: catOf(r) }));
    const dishes = this.q("SELECT * FROM dishes WHERE week_id = ? ORDER BY created_at", wid);
    const ingredients = this.q("SELECT di.* FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id WHERE d.week_id = ? ORDER BY di.rowid", wid);
    const present = new Set(items.map((i) => nameKey(String((i as unknown as Row).name))));
    const recents = this.q("SELECT * FROM ingredient_memory ORDER BY last_week DESC, uses DESC LIMIT 120")
      .filter((r) => !present.has(String(r.name_key))).slice(0, 40).map((r) => ({ ...r, per_person: bool(r.per_person), category: catOf(r) }));
    return {
      week: { ...w, configured: bool(w.configured) },
      slots: this.q("SELECT * FROM slots WHERE week_id = ? ORDER BY day, meal DESC", wid).map((r) => ({ ...r, active: bool(r.active) })),
      attendance: this.q("SELECT a.slot_id, a.name_key, a.name FROM attendance a JOIN slots s ON s.id = a.slot_id WHERE s.week_id = ? ORDER BY a.name", wid),
      items, dishes, ingredients, recents,
      exclusions: this.q(
        `SELECT e.ingredient_id, e.name_key, e.name FROM exclusions e JOIN dish_ingredients di ON di.id = e.ingredient_id
         JOIN dishes d ON d.id = di.dish_id WHERE d.week_id = ? ORDER BY e.name`, wid),
      plan: [0, 7, 14].map((n) => this.planWeek(addDaysIso(weekStart, n))),
      staples: this.q("SELECT * FROM staples ORDER BY name"),
      library: this.library(weekStart),
      validated: this.validated(weekStart),
    };
  }

  /* ---------------- Planning validé → Telegram ---------------- */
  validated(weekStart: string) {
    const r = this.one("SELECT value FROM meta WHERE key = ?", `validated_${weekStart}`);
    if (!r) return null;
    try { return JSON.parse(String(r.value)) as { by: string; at: string }; } catch { return null; }
  }

  /** Message Telegram (HTML) d'une semaine : courses par rayon puis menu jour par jour. */
  weekReport(weekStart: string): string {
    const st = this.state(weekStart) as unknown as WeekState;
    const needed = neededByItem(st);
    const amount = (i: WeekState["items"][number]) => {
      if (i.quantity != null && i.quantity > 0) return fmtAmount(i.per_person ? i.quantity * st.week.default_people : i.quantity, i.unit);
      const n = needed.get(i.id);
      return n ? fmtAmount(n, i.unit) : "";
    };
    const out: string[] = [`📅 <b>Semaine du vendredi ${dayLabel(weekStart, 0)} au jeudi ${dayLabel(weekStart, 6)}</b>`];

    const courses = st.items.filter((i) => i.source === "courses" && !i.checked);
    out.push("", "🛒 <b>COURSES À FAIRE</b>");
    if (!courses.length) out.push("Rien à acheter.");
    for (const cat of CATEGORIES) {
      const list = courses.filter((i) => i.category === cat.id).sort((a, b) => a.name.localeCompare(b.name, "fr"));
      if (list.length) out.push("", `${cat.icon} <i>${cat.label}</i>`, ...list.map((i) => `• ${esc(i.name)}${amount(i) ? ` : ${amount(i)}` : ""}`));
    }

    out.push("", "🍽️ <b>MENU</b>");
    const active = st.slots.filter((s) => s.active);
    if (!active.length) out.push("Aucun repas prévu.");
    for (let day = 0; day < 7; day++) {
      const rows: string[] = [];
      for (const s of active.filter((x) => x.day === day)) {
        const h = headcount(st, s.id);
        const dishes = st.dishes.filter((x) => x.slot_id === s.id);
        rows.push(`${MEALS[s.meal]} · <b>${h.estimated ? "≈" : ""}${h.count} pers.</b> : ${dishes.length ? dishes.map((x) => esc(dishTitle(st, x))).join(" + ") : "<i>à définir</i>"}`);
        // Portions : quantité totale de chaque ingrédient pour ce repas (sans ceux qui n'en mangent pas)
        for (const d of dishes) {
          const parts = st.ingredients.filter((i) => i.dish_id === d.id).map((ing) => {
            const item = st.items.find((x) => x.id === ing.item_id);
            if (!item) return "";
            const n = ingredientPeople(st, d, ing.id);
            const total = ing.qty_per_person ? fmtAmount(ing.qty_per_person * n, item.unit) : "";
            const sauf = excludedFor(st, d, ing.id);
            return `${esc(item.name)}${total ? ` ${total}` : ""}${sauf.length ? ` (sauf ${esc(sauf.join(", "))})` : ""}`;
          }).filter(Boolean);
          if (parts.length) rows.push(`    ${parts.join(" · ")}`);
        }
        if (!h.estimated) rows.push(`    <i>${esc(eatersLabel(h))}</i>`);
      }
      if (rows.length) out.push("", `<b>${dayName(weekStart, day)} ${dayLabel(weekStart, day)}</b>`, ...rows);
    }
    return out.join("\n");
  }

  /** Découpe un long message en morceaux sous la limite Telegram (4 096 caractères), aux retours à la ligne. */
  static chunks(text: string, max = 3900): string[] {
    const parts: string[] = [];
    let cur = "";
    for (const line of text.split("\n")) {
      if (cur && cur.length + line.length + 1 > max) { parts.push(cur); cur = ""; }
      cur = cur ? `${cur}\n${line}` : line.slice(0, max);
    }
    if (cur) parts.push(cur);
    return parts;
  }

  /** Vendredi 16 h (Paris) : récap des courses et des repas de la semaine qui commence, une seule fois. */
  async fridayRecap() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(this.env.TEST_NOW ? new Date(this.env.TEST_NOW) : new Date()).map((p) => [p.type, p.value]));
    if (parts.weekday !== "Fri" || parts.hour !== "16") return json({ skipped: "pas vendredi 16 h à Paris" });
    const chat = (this.env.TELEGRAM_PLAN_CHAT_ID ?? "").trim() || this.admin;
    if (!chat || !this.botToken) return json({ skipped: "bot non configuré" });
    const week = `${parts.year}-${parts.month}-${parts.day}`; // ce vendredi ouvre la semaine
    const key = `friday_recap_${week}`;
    if (this.one("SELECT key FROM meta WHERE key = ?", key)) return json({ skipped: "déjà envoyé" });
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?)", key, now());
    let sent = 0;
    for (const text of Family.chunks(`🔔 <b>Récap du vendredi : c'est le jour des courses !</b>

${this.weekReport(week)}`)) {
      if ((await this.tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text })).ok) sent++;
    }
    return json({ week, sent });
  }

  /** Bouton « Valider » : envoie au bot Telegram les courses et le menu des 3 semaines, un message par semaine. */
  async validatePlan(req: Request) {
    const dev = await this.member(req);
    const b = (await req.json().catch(() => ({}))) as Body;
    const first = this.weekParam(b.week);
    const chat = (this.env.TELEGRAM_PLAN_CHAT_ID ?? "").trim() || this.admin;
    if (!chat || !this.botToken) throw new Bad("Le bot Telegram n'est pas configuré.", 503);
    const weeks = [0, 7, 14].map((n) => addDaysIso(first, n));
    const head = await this.tg("sendMessage", {
      chat_id: chat, parse_mode: "HTML",
      text: `✅ <b>Planning validé par ${esc(String(dev.name))}</b>\nCourses et menus des 3 semaines, du vendredi ${dayLabel(first, 0)} au jeudi ${dayLabel(weeks[2], 6)}`,
    });
    if (!head.ok) throw new Bad("Telegram n'a pas accepté le message, réessayez.", 502);
    const at = now();
    for (const week of weeks) {
      for (const text of Family.chunks(this.weekReport(week))) {
        const r = await this.tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text });
        if (!r.ok) throw new Bad("Envoi interrompu, réessayez.", 502);
      }
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", `validated_${week}`, JSON.stringify({ by: String(dev.name), at }));
      this.notifyFamily(week);
    }
    return json({ ok: true, weeks });
  }

  /** Repas d'une semaine (et plats déjà placés) pour le choix multi-repas sur 3 semaines. */
  planWeek(weekStart: string) {
    const w = this.ensureWeek(weekStart);
    const slots = this.q("SELECT id, day, meal, active FROM slots WHERE week_id = ? ORDER BY day, meal DESC", w.id);
    const dishes = this.q("SELECT id, slot_id FROM dishes WHERE week_id = ? AND slot_id IS NOT NULL", w.id);
    return {
      week_start: weekStart,
      slots: slots.map((s) => ({
        id: s.id, day: s.day, meal: s.meal, active: bool(s.active),
        taken: dishes.filter((d) => d.slot_id === s.id).map((d) => this.dishLabel(String(d.id))),
      })),
    };
  }

  /** Un plat n'a pas de nom : on l'affiche par ses ingrédients. */
  dishLabel(dishId: string) {
    const names = this.q("SELECT i.name FROM dish_ingredients di JOIN items i ON i.id = di.item_id WHERE di.dish_id = ? ORDER BY di.rowid", dishId).map((r) => String(r.name));
    return names.length ? names.join(", ") : "Plat sans ingrédient";
  }

  /** Semaines enregistrées (sauf celle affichée), les plus récentes d'abord, avec leurs plats et ingrédients par personne. */
  library(current: string) {
    const out: { week_start: string; dishes: { day: number | null; meal: string | null; name: string; ingredients: Row[] }[] }[] = [];
    const weeks = this.q(
      `SELECT w.id, w.week_start FROM weeks w WHERE w.week_start != ? AND EXISTS (SELECT 1 FROM dishes d WHERE d.week_id = w.id)
       ORDER BY w.week_start DESC LIMIT 30`, current);
    for (const w of weeks) {
      const dishes = this.q(
        `SELECT d.id, s.day, s.meal FROM dishes d LEFT JOIN slots s ON s.id = d.slot_id WHERE d.week_id = ?
         ORDER BY s.day IS NULL, s.day, s.meal DESC, d.created_at`, w.id,
      ).map((d) => {
        const ingredients = this.libraryIngredients(String(d.id));
        return { day: d.day == null ? null : Number(d.day), meal: d.meal == null ? null : String(d.meal), name: ingredients.map((g) => String(g.name)).join(", "), ingredients };
      }).filter((d) => d.ingredients.length);
      if (dishes.length) out.push({ week_start: String(w.week_start), dishes });
    }
    return out;
  }

  libraryIngredients(dishId: string) {
    return this.q(
      `SELECT i.name, i.unit, i.source, i.category, di.qty_per_person FROM dish_ingredients di JOIN items i ON i.id = di.item_id
       WHERE di.dish_id = ? ORDER BY di.rowid`, dishId,
    ).map((r) => ({ ...r, name: String(r.name), category: catOf(r) }));
  }

  /** Crée un plat (ses ingrédients entrent dans les courses de sa semaine). */
  createDish(wk: Row, slot: string | null, list: Body[]) {
    const label = list.map((g) => str(g.name)).join(", ").slice(0, 80);
    const dishId = uuid();
    this.sql.exec("INSERT INTO dishes (id, week_id, name, slot_id, created_at) VALUES (?, ?, ?, ?, ?)", dishId, wk.id, label, slot, now());
    for (const g of list) {
      const itemId = this.dishItem(wk, g);
      this.sql.exec(
        `INSERT INTO dish_ingredients (id, dish_id, item_id, qty_per_person) VALUES (?, ?, ?, ?)
         ON CONFLICT(dish_id, item_id) DO UPDATE SET qty_per_person = excluded.qty_per_person`,
        uuid(), dishId, itemId, num(g.qty_per_person) ?? 0,
      );
    }
    if (!this.touchedWeeks.includes(String(wk.week_start))) this.touchedWeeks.push(String(wk.week_start));
  }

  /**
   * Ingrédient d'un plat : il va dans la liste de courses de la semaine (décoché s'il était déjà acheté),
   * la quantité à acheter étant calculée d'après les portions et les convives. Seules les épices restent au placard.
   */
  dishItem(wk: Row, g: Body): string {
    const name = str(g.name);
    const staple = this.one("SELECT theme FROM staples WHERE name_key = ?", nameKey(name));
    const source = staple?.theme === "epice" ? "placard" : "courses";
    const id = this.addItem(wk, { name, unit: g.unit, source, category: g.category });
    if (source === "courses") this.sql.exec("UPDATE items SET source = 'courses', checked = 0 WHERE id = ?", id);
    return id;
  }

  remember(weekStart: string, it: { name: string; source: string; unit: string; quantity: number | null; per_person: boolean; category: string }) {
    this.sql.exec(
      `INSERT INTO ingredient_memory (name_key, name, source, unit, quantity, per_person, last_week, uses, category) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, source = excluded.source, unit = excluded.unit, quantity = excluded.quantity,
       per_person = excluded.per_person, last_week = excluded.last_week, uses = uses + 1, category = excluded.category`,
      nameKey(it.name), it.name, it.source, it.unit, it.quantity, it.per_person ? 1 : 0, weekStart, it.category,
    );
  }

  addItem(week: Row, b: Body): string {
    const name = str(b.name);
    const dup = this.q("SELECT id, name, unit FROM items WHERE week_id = ?", week.id).find((i) => nameKey(String(i.name)) === nameKey(name));
    if (dup) {
      // Ingrédient déjà dans la liste : on complète seulement son unité si elle manquait
      if (!dup.unit && unitOf(b.unit)) this.sql.exec("UPDATE items SET unit = ? WHERE id = ?", unitOf(b.unit), dup.id);
      return String(dup.id);
    }
    const it = {
      name, source: sourceOf(b.source), quantity: num(b.quantity), unit: unitOf(b.unit), per_person: b.per_person === true || b.per_person === 1,
      category: isCategory(b.category) ? b.category : guessCategory(name),
    };
    const id = uuid();
    this.sql.exec("INSERT INTO items (id, week_id, name, source, quantity, unit, per_person, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, week.id, it.name, it.source, it.quantity, it.unit, it.per_person ? 1 : 0, now(), it.category);
    this.remember(String(week.week_start), it);
    return id;
  }

  /** UPDATE dynamique sur une liste blanche de colonnes. */
  patch(table: string, fields: Record<string, SqlStorageValue>, where: string, ...args: SqlStorageValue[]) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.sql.exec(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE ${where}`, ...keys.map((k) => fields[k]), ...args);
  }

  /** Créneau de la semaine, ou erreur. */
  slotOf(v: unknown, w: string) {
    const s = this.one("SELECT id FROM slots WHERE id = ? AND week_id = ?", idOf(v), w);
    if (!s) throw new Bad("Créneau introuvable");
    return String(s.id);
  }

  setPresence(slotId: string, me: string, present: boolean) {
    if (present) this.sql.exec("INSERT OR IGNORE INTO attendance (slot_id, name_key, name) VALUES (?, ?, ?)", slotId, nameKey(me), me);
    else this.sql.exec("DELETE FROM attendance WHERE slot_id = ? AND name_key = ?", slotId, nameKey(me));
  }

  apply(week: Row, b: Body, me: string) {
    const w = String(week.id);
    switch (b.op) {
      // Chacun ne coche ou décoche que sa propre présence (identité = prénom de l'appareil validé)
      case "attend.set":
        return this.setPresence(this.slotOf(b.slot_id, w), me, b.present === true);
      case "attend.all":
        for (const s of this.q("SELECT id FROM slots WHERE week_id = ? AND active = 1", w)) this.setPresence(String(s.id), me, b.present === true);
        return;
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
        if ("guests" in b) f.guests = Math.round(num(b.guests, 0, 30) ?? 0);
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
        if (isCategory(b.category)) f.category = b.category;
        this.patch("items", f, "id = ? AND week_id = ?", id, w);
        if ("name" in f || "unit" in f || "quantity" in f) {
          const it = this.one("SELECT * FROM items WHERE id = ?", id);
          if (it) this.remember(String(week.week_start), { name: String(it.name), source: String(it.source), unit: String(it.unit), quantity: it.quantity as number | null, per_person: bool(it.per_person), category: catOf(it) });
        }
        return;
      }
      case "item.delete": {
        const id = idOf(b.id);
        if (!this.one("SELECT id FROM items WHERE id = ? AND week_id = ?", id, w)) return;
        this.sql.exec("DELETE FROM exclusions WHERE ingredient_id IN (SELECT id FROM dish_ingredients WHERE item_id = ?)", id);
        this.sql.exec("DELETE FROM dish_ingredients WHERE item_id = ?", id);
        return this.sql.exec("DELETE FROM items WHERE id = ?", id);
      }
      case "items.uncheckAll":
        return this.sql.exec("UPDATE items SET checked = 0 WHERE week_id = ?", w);
      case "recent.add": {
        const r = this.one("SELECT * FROM ingredient_memory WHERE name_key = ?", str(b.name_key));
        if (!r) throw new Bad("Ingrédient oublié entre-temps");
        return this.addItem(week, { ...r, per_person: bool(r.per_person), category: catOf(r) });
      }
      case "recent.forget":
        return this.sql.exec("DELETE FROM ingredient_memory WHERE name_key = ?", str(b.name_key));
      // Création d'un plat avec tous ses ingrédients (quantités par personne) en une fois
      case "dish.create": {
        const list = Array.isArray(b.ingredients) ? (b.ingredients as Body[]).slice(0, 40) : [];
        if (!list.length) throw new Bad("Ajoutez au moins un ingrédient");
        // Repas choisis, sur cette semaine ou les 2 suivantes ; aucun = plat pas encore placé
        const targets = Array.isArray(b.targets) ? (b.targets as Body[]).slice(0, 42) : [];
        const allowed = [0, 7, 14].map((n) => addDaysIso(String(week.week_start), n));
        const places: { wk: Row; slot: string | null }[] = targets.length ? targets.map((t) => {
          const ws = this.weekParam(t.week);
          if (!allowed.includes(ws)) throw new Bad("Semaine hors des 3 semaines");
          const wk = this.ensureWeek(ws);
          const s = this.one("SELECT id FROM slots WHERE week_id = ? AND day = ? AND meal = ?", wk.id, Number(t.day), t.meal === "lunch" ? "lunch" : "dinner");
          if (!s) throw new Bad("Repas introuvable");
          return { wk, slot: String(s.id) };
        }) : [{ wk: week, slot: null }];
        for (const { wk, slot } of places) this.createDish(wk, slot, list);
        return;
      }
      // Reprendre toute une semaine enregistrée : chaque plat retrouve le même jour (vendredi → vendredi) et le même repas
      case "week.copy": {
        const from = this.one("SELECT * FROM weeks WHERE week_start = ?", this.weekParamAny(b.from));
        if (!from) throw new Bad("Semaine introuvable");
        const ws = this.weekParam(b.to);
        if (![0, 7, 14].map((n) => addDaysIso(String(week.week_start), n)).includes(ws)) throw new Bad("Semaine hors des 3 semaines");
        const to = this.ensureWeek(ws);
        const dishes = this.q("SELECT d.id, s.day, s.meal FROM dishes d LEFT JOIN slots s ON s.id = d.slot_id WHERE d.week_id = ? ORDER BY d.created_at", from.id);
        for (const d of dishes) {
          const list = this.libraryIngredients(String(d.id)) as unknown as Body[];
          if (!list.length) continue;
          let slot: string | null = null;
          if (d.day != null) {
            const wd = weekdayOf(String(from.week_start), Number(d.day));
            const day = [0, 1, 2, 3, 4, 5, 6].find((i) => weekdayOf(ws, i) === wd)!;
            const s = this.one("SELECT id, active FROM slots WHERE week_id = ? AND day = ? AND meal = ?", to.id, day, String(d.meal));
            if (s && bool(s.active)) slot = String(s.id);
          }
          this.createDish(to, slot, list);
        }
        return;
      }
      // « Je mange à ce repas mais pas cet ingrédient » : chacun pour soi
      case "staple.add": {
        const name = str(b.name, 60);
        this.sql.exec(
          `INSERT INTO staples (name_key, name, theme, unit, qty_per_person) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, theme = excluded.theme, unit = excluded.unit, qty_per_person = excluded.qty_per_person`,
          nameKey(name), name, isTheme(b.theme) ? b.theme : "proteine", unitOf(b.unit), num(b.qty_per_person) ?? 0,
        );
        return;
      }
      case "staple.delete":
        return this.sql.exec("DELETE FROM staples WHERE name_key = ?", str(b.name_key));
      case "ing.exclude": {
        const ing = this.one("SELECT di.id FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id WHERE di.id = ? AND d.week_id = ?", idOf(b.id), w);
        if (!ing) throw new Bad("Ingrédient introuvable");
        if (b.excluded === true) this.sql.exec("INSERT OR IGNORE INTO exclusions (ingredient_id, name_key, name) VALUES (?, ?, ?)", ing.id, nameKey(me), me);
        else this.sql.exec("DELETE FROM exclusions WHERE ingredient_id = ? AND name_key = ?", ing.id, nameKey(me));
        return;
      }
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
        this.sql.exec("DELETE FROM exclusions WHERE ingredient_id IN (SELECT id FROM dish_ingredients WHERE dish_id = ?)", id);
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
          itemId = this.dishItem(week, b); // nouvel ingrédient créé à la volée
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
        this.sql.exec("DELETE FROM exclusions WHERE ingredient_id = ?", ing.id);
        return this.sql.exec("DELETE FROM dish_ingredients WHERE id = ?", ing.id);
      }
      default:
        throw new Bad("Action inconnue");
    }
  }
}
