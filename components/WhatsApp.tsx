"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { WeekState } from "@/lib/types";
import type { Mutate } from "./App";

/** Recevoir les courses et les repas sur WhatsApp : inscription du numéro, envoi du jeudi soir et envoi à la demande. */
export default function WhatsApp({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const { me, members, bot } = state.whatsapp;
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const chat = bot ? `https://wa.me/${bot.replace(/\D/g, "")}?text=${encodeURIComponent("courses")}` : null;

  async function send(to: "me" | "all") {
    setBusy(true); setMsg("");
    const { ok, data } = await api<{ sent: string[]; failed: string[]; expired: string[] }>("/api/whatsapp/send", { method: "POST", body: { week: state.week.week_start, to } });
    setBusy(false);
    if (!ok) return setMsg(data.error ?? "Envoi impossible.");
    const parts = [];
    if (data.sent.length) parts.push(`Envoyé à ${data.sent.join(", ")}.`);
    if (data.expired?.length) parts.push(`${data.expired.join(", ")} : écrivez d'abord au bot (WhatsApp n'autorise l'envoi que dans les 24 h après votre dernier message).`);
    if (data.failed.length) parts.push(`Échec pour ${data.failed.join(", ")}.`);
    setMsg(parts.join(" "));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const ok = await mutate("wa.set", { phone, weekly: me?.weekly ?? true });
    setBusy(false);
    if (ok) { setEditing(false); setMsg("Numéro enregistré. Écrivez maintenant « courses » au bot."); }
  }

  return (
    <section className="panel">
      <h2>WhatsApp</h2>
      <p className="muted">Recevez les courses à faire et les repas de la semaine dans WhatsApp.</p>
      {!bot && <p className="warn">Le bot WhatsApp n'est pas encore branché : vous pouvez déjà enregistrer votre numéro.</p>}

      {!me || editing ? (
        <form className="adder" onSubmit={save}>
          <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="Votre numéro : +33612345678" aria-label="Numéro WhatsApp"
            value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <div className="addrow">
            {me && <button type="button" className="btn btn-ghost small" onClick={() => setEditing(false)}>Annuler</button>}
            <button className="btn btn-primary small" disabled={busy || !phone.trim()}>Enregistrer mon numéro</button>
          </div>
        </form>
      ) : (
        <>
          <p><b>📱 {me.phone}</b></p>
          {chat && (
            <a className="btn btn-primary btn-block" href={chat} target="_blank" rel="noopener noreferrer">Écrire au bot ({bot})</a>
          )}
          <p className="muted small">Écrivez-lui « courses », « repas » ou « semaine prochaine » : il répond avec la liste à jour.</p>
          <label className="check wrap">
            <input type="checkbox" checked={me.weekly} onChange={(e) => mutate("wa.weekly", { weekly: e.target.checked })} />
            Chaque jeudi à 19 h : courses et repas de la semaine suivante
          </label>
          <p className="muted small">WhatsApp n'autorise le bot à vous écrire que dans les 24 h après votre dernier message : écrivez-lui le jeudi pour être sûr de le recevoir.</p>
          <button className="btn btn-ghost btn-block" disabled={busy || !bot} onClick={() => send("me")}>M'envoyer cette semaine</button>
          {members.length > 1 && (
            <button className="btn btn-ghost btn-block" disabled={busy || !bot} onClick={() => send("all")}>Envoyer à toute la famille ({members.length})</button>
          )}
          <div className="addrow">
            <button className="linkbtn" onClick={() => { setPhone(""); setEditing(true); }}>Changer de numéro</button>
            <button className="linkbtn danger" onClick={() => confirm("Ne plus recevoir Popote sur WhatsApp ?") && mutate("wa.delete")}>Désactiver</button>
          </div>
        </>
      )}

      {msg && <p className="notice" role="status">{msg}</p>}
      {members.length > 0 && <p className="muted small">Inscrits sur WhatsApp : {members.join(", ")}</p>}
    </section>
  );
}
