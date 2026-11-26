"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { WeekState } from "@/lib/types";

/** Bouton « Valider le planning » : envoie au bot Telegram les courses et le menu de cette semaine et des 2 suivantes. */
export default function Validate({ state }: { state: WeekState }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setBusy(true); setDone(false); setErr("");
    const { ok, data } = await api<{ ok: boolean }>("/api/plan/validate", { method: "POST", body: { week: state.week.week_start } });
    setBusy(false);
    if (ok) { setDone(true); setTimeout(() => setDone(false), 3000); }
    else setErr(data.error ?? "Envoi impossible, réessayez.");
  }

  return (
    <div className="validate">
      <button className="btn btn-primary btn-block" onClick={send} disabled={busy}>
        {busy ? "Envoi…" : done ? "✓ Planning validé" : "Valider le planning"}
      </button>
      {err && <p className="warn" role="alert">{err}</p>}
    </div>
  );
}
