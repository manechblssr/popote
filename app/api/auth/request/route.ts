import { NextResponse } from "next/server";
import { adminChatId, db, escapeHtml, hashToken, setSession, tg } from "@/lib/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (name.length < 1 || name.length > 40) return NextResponse.json({ error: "Saisissez un prénom (40 caractères max)." }, { status: 400 });
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return NextResponse.json({ error: "Appareil non reconnu, rechargez la page." }, { status: 400 });

  const hash = hashToken(token);
  const { data: existing } = await db().from("devices").select("*").eq("token_hash", hash).maybeSingle();
  const sameName = existing && existing.name.toLowerCase() === name.toLowerCase();

  if (existing && sameName && existing.status === "approved") {
    await db().from("devices").update({ last_seen: new Date().toISOString() }).eq("id", existing.id);
    await setSession(existing.id);
    return NextResponse.json({ id: existing.id, status: "approved" });
  }
  if (existing && sameName && existing.status === "rejected") {
    return NextResponse.json({ id: existing.id, status: "rejected" });
  }
  // Demande déjà en attente pour ce prénom : pas de nouveau message (anti-spam)
  if (existing && sameName && existing.status === "pending" && Date.now() - new Date(existing.created_at).getTime() < 10 * 60_000) {
    return NextResponse.json({ id: existing.id, status: "pending" });
  }

  const row = { name, token_hash: hash, status: "pending", created_at: new Date().toISOString(), decided_at: null };
  const { data: device, error } = existing
    ? await db().from("devices").update(row).eq("id", existing.id).select().single()
    : await db().from("devices").insert(row).select().single();
  if (error || !device) return NextResponse.json({ error: "Enregistrement impossible, réessayez." }, { status: 500 });

  const sent = await tg("sendMessage", {
    chat_id: adminChatId(),
    parse_mode: "HTML",
    text: `🍲 <b>${escapeHtml(name)}</b> demande l'accès à Popote depuis un nouvel appareil.`,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Accepter", callback_data: `ok:${device.id}` },
        { text: "❌ Refuser", callback_data: `no:${device.id}` },
      ]],
    },
  });
  if (!sent.ok) return NextResponse.json({ error: "Le bot Telegram ne répond pas. Prévenez l'administrateur." }, { status: 502 });
  return NextResponse.json({ id: device.id, status: "pending" });
}
