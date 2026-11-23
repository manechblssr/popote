import { NextResponse } from "next/server";
import { clearSession, db, hashToken, setSession } from "@/lib/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) return NextResponse.json({ status: "unknown" });

  const { data } = await db().from("devices").select("id,status,token_hash").eq("id", id).maybeSingle();
  if (!data || data.token_hash !== hashToken(token)) return NextResponse.json({ status: "unknown" });
  if (data.status === "approved") await setSession(data.id);
  return NextResponse.json({ status: data.status });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
