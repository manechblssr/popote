import { NextResponse } from "next/server";
import { tg, webhookSecret } from "@/lib/server";

/** Activation du webhook en une visite : /api/telegram/setup?secret=TELEGRAM_WEBHOOK_SECRET */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== webhookSecret()) return new NextResponse("forbidden", { status: 403 });
  const hook = `${url.origin}/api/telegram/webhook`;
  const res = await tg("setWebhook", {
    url: hook,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  return NextResponse.json({ webhook: hook, telegram: res });
}
