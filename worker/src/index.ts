import { DurableObject } from "cloudflare:workers";
import {
  CATEGORIES, DAYS, DEFAULT_STAPLES, MEALS, addDays as addDaysIso, dayLabel, fmtAmount, guessCategory, isCategory, isMonday, isTheme, mondayOf, nameKey,
  type Category, type WeekState,
} from "../../lib/types";
import { dishTitle, headcount, neededByItem } from "../../lib/compute";

export interface Env {
  FAMILY: DurableObjectNamespace<Family>;
  ALLOWED_ORIGINS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
  // Bot WhatsApp officiel (Meta Cloud API)
  WA_TOKEN?: string;        // jeton d'accès permanent (utilisateur système)
  WA_PHONE_ID?: string;     // « Phone number ID » du numéro du bot
  WA_APP_SECRET?: string;   // « App secret » : vérifie que les webhooks viennent bien de Meta
  WA_VERIFY_TOKEN?: string; // jeton de vérification saisi dans la configuration du webhook
  WA_NUMBER?: string;       // numéro du bot affiché dans l'appli, ex. +15551234567
  WA_TEMPLATE?: string;     // modèle approuvé pour l'envoi du jeudi hors fenêtre de 24 h (facultatif)
  WA_API_URL?: string;      // pour les tests locaux uniquement
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

  // Déclenché le jeudi à 17 h et 18 h UTC : le Durable Object n'envoie qu'à 19 h, heure de Paris (été comme hiver)
  async scheduled(_event: ScheduledController, env: Env) {
    const stub = env.FAMILY.get(env.FAMILY.idFromName("family"));
    await stub.fetch("https://popote.internal/internal/weekly", { method: "POST" });
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
CREATE TABLE IF NOT EXISTS whatsapp (name_key TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, apikey TEXT NOT NULL, weekly INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
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
          const dev = await this.member(req);
          return json(this.state(this.weekParam(url.searchParams.get("week")), String(dev.name)));
        }
        case "POST /api/whatsapp/send": return await this.whatsappSend(req);
        case "GET /whatsapp/webhook": return this.waVerify(url);
        case "POST /whatsapp/webhook": return await this.waWebhook(req);
        case "POST /internal/weekly": return await this.weeklyWhatsapp();
        case "POST /api/data": {
          const dev = await this.member(req);
          const b = (await req.json()) as Body;
          const week = this.weekParam(b.week);
          this.ctx.storage.transactionSync(() => this.apply(this.ensureWeek(week), b, String(dev.name)));
          this.notifyFamily(week);
          for (const other of this.touchedWeeks) if (other !== week) this.notifyFamily(other);
          this.touchedWeeks = [];
          return json(this.state(week, String(dev.name)));
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

  state(weekStart: string, me = "") {
    const w = this.ensureWeek(weekStart);
    const wid = String(w.id);
    const items = this.q("SELECT * FROM items WHERE week_id = ? ORDER BY created_at", wid).map((r) => ({ ...r, per_person: bool(r.per_person), checked: bool(r.checked), category: catOf(r) }));
    const dishes = this.q("SELECT * FROM dishes WHERE week_id = ? ORDER BY created_at", wid);
    const ingredients = this.q("SELECT di.* FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id WHERE d.week_id = ?", wid);
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
      whatsapp: this.whatsappInfo(me),
      library: this.library(),
    };
  }

  /* ---------------- WhatsApp (bot officiel Meta) ---------------- */
  /** Ce que l'appli affiche : son propre numéro masqué, le numéro du bot et qui est inscrit. */
  whatsappInfo(me: string) {
    const mine = me ? this.one("SELECT phone, weekly FROM whatsapp WHERE name_key = ?", nameKey(me)) : undefined;
    const phone = mine ? String(mine.phone) : "";
    return {
      me: mine ? { phone: phone.slice(0, 4) + " •• •• " + phone.slice(-2), weekly: bool(mine.weekly) } : null,
      members: this.q("SELECT name FROM whatsapp ORDER BY name").map((r) => String(r.name)),
      bot: this.env.WA_TOKEN && this.env.WA_PHONE_ID ? (this.env.WA_NUMBER ?? "") : null,
    };
  }

  /** Texte WhatsApp : courses par rayon et/ou repas de la semaine. */
  weekMessage(weekStart: string, part: "all" | "courses" | "repas" = "all"): string {
    const st = this.state(weekStart) as unknown as WeekState;
    const needed = neededByItem(st);
    const amount = (i: WeekState["items"][number]) => {
      if (i.quantity != null && i.quantity > 0) return fmtAmount(i.per_person ? i.quantity * st.week.default_people : i.quantity, i.unit);
      const n = needed.get(i.id);
      return n ? fmtAmount(n, i.unit) : "";
    };
    const line = (i: WeekState["items"][number]) => `• ${i.name}${amount(i) ? ` : ${amount(i)}` : ""}`;
    const out: string[] = [`🛒 *Popote · semaine du ${dayLabel(weekStart, 0)} au ${dayLabel(weekStart, 6)}*`];

    if (part !== "repas") {
      const courses = st.items.filter((i) => i.source === "courses" && !i.checked);
      out.push("", "*COURSES À FAIRE*");
      if (!courses.length) out.push("Rien à acheter pour l'instant.");
      for (const cat of CATEGORIES) {
        const list = courses.filter((i) => i.category === cat.id).sort((a, b) => a.name.localeCompare(b.name, "fr"));
        if (list.length) out.push("", `${cat.icon} *${cat.label}*`, ...list.map(line));
      }
    }
    if (part !== "courses") {
      out.push("", "🍽️ *REPAS DE LA SEMAINE*");
      let any = false;
      DAYS.forEach((d, day) => {
        const rows: string[] = [];
        for (const s of st.slots.filter((x) => x.active && x.day === day)) {
          const dishes = st.dishes.filter((x) => x.slot_id === s.id);
          if (!dishes.length) continue;
          const h = headcount(st, s.id);
          rows.push(`  ${MEALS[s.meal]} (${h.estimated ? "≈" : ""}${h.count} pers.) : ${dishes.map((x) => dishTitle(st, x)).join(" + ")}`);
        }
        if (rows.length) { any = true; out.push(`*${d} ${dayLabel(weekStart, day)}*`, ...rows); }
      });
      if (!any) out.push("Aucun plat prévu pour l'instant.");
    }
    return out.join("\n").slice(0, 4000); // limite WhatsApp : 4096 caractères
  }

  /** Appel à l'API WhatsApp Cloud. Renvoie le code d'erreur Meta en cas d'échec. */
  async waApi(body: Body): Promise<{ ok: boolean; code?: number }> {
    if (!this.env.WA_TOKEN || !this.env.WA_PHONE_ID) return { ok: false, code: -1 };
    const base = this.env.WA_API_URL ?? "https://graph.facebook.com/v22.0";
    try {
      const res = await fetch(`${base}/${this.env.WA_PHONE_ID}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.WA_TOKEN.trim()}` },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
      if (!res.ok) console.error("whatsapp", res.status, JSON.stringify(out.error ?? out));
      return { ok: res.ok, code: out.error?.code };
    } catch (e) {
      console.error("whatsapp", e);
      return { ok: false };
    }
  }
  waText(to: string, text: string) {
    return this.waApi({ to: to.replace(/^\+/, ""), type: "text", text: { body: text, preview_url: false } });
  }

  /**
   * Envoi à des membres. Meta n'autorise un message libre que dans les 24 h qui suivent le dernier message
   * de la personne au bot (erreur 131047 sinon) : on envoie alors le modèle approuvé, s'il est configuré.
   */
  async sendWeek(weekStart: string, recipients: Row[], title?: string) {
    const text = (title ? `${title}\n\n` : "") + this.weekMessage(weekStart);
    const sent: string[] = [], failed: string[] = [], expired: string[] = [];
    for (const r of recipients) {
      const res = await this.waText(String(r.phone), text);
      if (res.ok) { sent.push(String(r.name)); continue; }
      if (res.code === 131047 && this.env.WA_TEMPLATE) {
        const t = await this.waApi({ to: String(r.phone).replace(/^\+/, ""), type: "template", template: { name: this.env.WA_TEMPLATE, language: { code: "fr" } } });
        (t.ok ? sent : failed).push(String(r.name));
      } else (res.code === 131047 ? expired : failed).push(String(r.name));
    }
    return { sent, failed, expired };
  }

  /** « M'envoyer » ou « Envoyer à toute la famille » depuis l'appli. */
  async whatsappSend(req: Request) {
    const dev = await this.member(req);
    const b = (await req.json().catch(() => ({}))) as Body;
    const week = this.weekParam(b.week);
    if (!this.env.WA_TOKEN || !this.env.WA_PHONE_ID) throw new Bad("Le bot WhatsApp n'est pas encore configuré.", 503);
    const recipients = b.to === "all"
      ? this.q("SELECT * FROM whatsapp")
      : this.q("SELECT * FROM whatsapp WHERE name_key = ?", nameKey(String(dev.name)));
    if (!recipients.length) throw new Bad(b.to === "all" ? "Personne n'a encore activé WhatsApp." : "Enregistrez d'abord votre numéro dans l'onglet Semaine.");
    return json(await this.sendWeek(week, recipients));
  }

  /** Jeudi 19 h (Paris) : courses et repas de la semaine suivante à ceux qui l'ont demandé, une seule fois par semaine. */
  async weeklyWhatsapp() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((p) => [p.type, p.value]));
    if (parts.weekday !== "Thu" || parts.hour !== "19") return json({ skipped: "pas jeudi 19 h à Paris" });
    if (!this.env.WA_TOKEN || !this.env.WA_PHONE_ID) return json({ skipped: "bot non configuré" });
    const next = addDaysIso(mondayOf(new Date()), 7);
    const key = `weekly_whatsapp_${next}`;
    if (this.one("SELECT key FROM meta WHERE key = ?", key)) return json({ skipped: "déjà envoyé" });
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?)", key, now());
    return json(await this.sendWeek(next, this.q("SELECT * FROM whatsapp WHERE weekly = 1"), "📅 Pour la semaine prochaine"));
  }

  /** Vérification du webhook par Meta (une fois, lors de la configuration). */
  waVerify(url: URL) {
    const token = this.env.WA_VERIFY_TOKEN ?? "";
    if (url.searchParams.get("hub.mode") === "subscribe" && token && safeEqual(url.searchParams.get("hub.verify_token") ?? "", token)) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return json({ error: "forbidden" }, 403);
  }

  /** Messages reçus par le bot : « courses », « repas », « semaine prochaine »… */
  async waWebhook(req: Request) {
    const raw = await req.text();
    const secret = this.env.WA_APP_SECRET?.trim();
    if (!secret) return json({ error: "non configuré" }, 503);
    const sig = (req.headers.get("X-Hub-Signature-256") ?? "").replace(/^sha256=/, "");
    if (!safeEqual(sig, await hmac(secret, raw))) return json({ error: "forbidden" }, 403);

    const body = JSON.parse(raw || "{}") as any;
    for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const from = String(m.from ?? "");
        const text = String(m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? "").toLowerCase();
        const member = this.q("SELECT * FROM whatsapp").find((r) => String(r.phone).replace(/^\+/, "") === from);
        if (!member) {
          await this.waText(from, "Bonjour ! Ce numéro n'est pas inscrit sur Popote. Ajoutez-le dans l'appli : onglet Semaine › WhatsApp.");
          continue;
        }
        const thisWeek = mondayOf(new Date());
        const week = /proch|suivant|recevoir/.test(text) ? addDaysIso(thisWeek, 7) : thisWeek;
        const part = /course|liste|achat/.test(text) ? "courses" : /repas|menu|plat|manger/.test(text) ? "repas" : "all";
        const help = "\n\n_Écrivez « courses », « repas » ou « semaine prochaine »._";
        await this.waText(from, this.weekMessage(week, part) + help);
      }
    }
    return json({ ok: true });
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

  /** Plats déjà faits (toutes semaines), le plus récent par nom, avec leurs ingrédients par personne. */
  library() {
    const out: { name_key: string; name: string; ingredients: Row[] }[] = [];
    const seen = new Set<string>();
    for (const d of this.q("SELECT id FROM dishes ORDER BY created_at DESC LIMIT 400")) {
      const ingredients = this.q(
        `SELECT i.name, i.unit, i.source, i.category, di.qty_per_person FROM dish_ingredients di JOIN items i ON i.id = di.item_id
         WHERE di.dish_id = ? ORDER BY di.rowid`, d.id,
      ).map((r) => ({ ...r, name: String(r.name), category: catOf(r) }));
      if (!ingredients.length) continue;
      const key = ingredients.map((g) => nameKey(String(g.name))).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name_key: key, name: ingredients.map((g) => String(g.name)).join(", "), ingredients });
      if (out.length >= 60) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
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
        const label = list.map((g) => str(g.name)).join(", ").slice(0, 80);
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
        for (const { wk, slot } of places) {
          const dishId = uuid();
          this.sql.exec("INSERT INTO dishes (id, week_id, name, slot_id, created_at) VALUES (?, ?, ?, ?, ?)", dishId, wk.id, label, slot, now());
          for (const g of list) {
            const itemId = this.addItem(wk, { name: g.name, unit: g.unit, source: g.source, category: g.category });
            this.sql.exec(
              `INSERT INTO dish_ingredients (id, dish_id, item_id, qty_per_person) VALUES (?, ?, ?, ?)
               ON CONFLICT(dish_id, item_id) DO UPDATE SET qty_per_person = excluded.qty_per_person`,
              uuid(), dishId, itemId, num(g.qty_per_person) ?? 0,
            );
          }
          this.touchedWeeks.push(String(wk.week_start));
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
      // WhatsApp : chacun enregistre son propre numéro (seuls ces numéros peuvent interroger le bot)
      case "wa.set": {
        const phone = typeof b.phone === "string" ? b.phone.replace(/[\s.()-]/g, "") : "";
        if (!/^\+\d{8,15}$/.test(phone)) throw new Bad("Numéro au format international, ex. +33612345678");
        const apikey = "";
        this.sql.exec(
          `INSERT INTO whatsapp (name_key, name, phone, apikey, weekly, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, phone = excluded.phone, apikey = excluded.apikey, weekly = excluded.weekly`,
          nameKey(me), me, phone, apikey, b.weekly === false ? 0 : 1, now(),
        );
        return;
      }
      case "wa.weekly":
        return this.sql.exec("UPDATE whatsapp SET weekly = ? WHERE name_key = ?", b.weekly === true ? 1 : 0, nameKey(me));
      case "wa.delete":
        return this.sql.exec("DELETE FROM whatsapp WHERE name_key = ?", nameKey(me));
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
        this.sql.exec("DELETE FROM exclusions WHERE ingredient_id = ?", ing.id);
        return this.sql.exec("DELETE FROM dish_ingredients WHERE id = ?", ing.id);
      }
      default:
        throw new Bad("Action inconnue");
    }
  }
}
