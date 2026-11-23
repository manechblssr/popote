import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminChatId, broadcast, db, escapeHtml, tg, webhookSecret } from "@/lib/server";

function validSecret(h: string | null) {
  const a = Buffer.from(h ?? ""), b = Buffer.from(webhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!validSecret(req.headers.get("x-telegram-bot-api-secret-token"))) return new NextResponse("forbidden", { status: 403 });
  const update = await req.json().catch(() => null);

  // Aide à la configuration : /start ou /id renvoie l'identifiant de la conversation
  const msg = update?.message;
  if (msg?.text && /^\/(start|id)\b/.test(msg.text)) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: `Identifiant de cette conversation : ${msg.chat.id}` });
    return NextResponse.json({ ok: true });
  }

  const cb = update?.callback_query;
  if (!cb?.data) return NextResponse.json({ ok: true });
  if (String(cb.message?.chat?.id) !== adminChatId() && String(cb.from?.id) !== adminChatId()) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Action réservée à l'administrateur." });
    return NextResponse.json({ ok: true });
  }

  const m = /^(ok|no):([0-9a-f-]{36})$/.exec(cb.data);
  if (!m) return NextResponse.json({ ok: true });
  const status = m[1] === "ok" ? "approved" : "rejected";
  const { data: device } = await db()
    .from("devices").update({ status, decided_at: new Date().toISOString() }).eq("id", m[2]).select("id,name").maybeSingle();

  if (!device) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Demande introuvable." });
    return NextResponse.json({ ok: true });
  }
  await broadcast(`device-${device.id}`, "status", { status });
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: status === "approved" ? "Accès accordé" : "Accès refusé" });
  if (cb.message) {
    await tg("editMessageText", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      parse_mode: "HTML",
      text: `${status === "approved" ? "✅" : "❌"} <b>${escapeHtml(device.name)}</b> : accès ${status === "approved" ? "accordé" : "refusé"}.`,
    });
  }
  return NextResponse.json({ ok: true });
}
