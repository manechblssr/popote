"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { WeekState } from "@/lib/types";

/** Bouton « Valider » : envoie au bot Telegram les courses et le menu de cette semaine et des 2 suivantes. */
export default function Validate({ state }: { state: WeekState }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const meals = state.plan.flatMap((p) => p.slots.filter((s) => s.active));
  const filled = meals.filter((s) => s.taken.length > 0).length;
  const v = state.validated;

  async function send() {
    if (filled < meals.length && !confirm(`${meals.length - filled} repas n'ont pas encore de plat. Valider quand même ?`)) return;
    setBusy(true); setMsg(""); setErr("");
    const { ok, data } = await api<{ ok: boolean }>("/api/plan/validate", { method: "POST", body: { week: state.week.week_start } });
    setBusy(false);
    if (ok) setMsg("Envoyé sur Telegram : un message par semaine.");
    else setErr(data.error ?? "Envoi impossible, réessayez.");
  }

  return (
    <section className="panel validate">
      <h2>Valider le planning</h2>
      <p className="muted">
        Envoie sur Telegram les courses à faire et le menu de cette semaine et des 2 suivantes, chaque semaine séparément.
      </p>
      <p className="muted small">Et chaque vendredi à 16 h, le récap de la semaine (courses, portions et nombre de personnes) arrive tout seul.</p>
      <p className="small"><b>{filled}</b> repas sur <b>{meals.length}</b> ont un plat sur les 3 semaines.</p>
      {v && (
        <p className="muted small">
          Déjà validé par {v.by} le {new Date(v.at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} à{" "}
          {new Date(v.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
        </p>
      )}
      <button className="btn btn-primary btn-block" onClick={send} disabled={busy}>
        {busy ? "Envoi…" : v ? "Valider à nouveau et renvoyer" : "Valider et envoyer sur Telegram"}
      </button>
      {msg && <p className="notice" role="status">{msg}</p>}
      {err && <p className="warn" role="alert">{err}</p>}
    </section>
  );
}
