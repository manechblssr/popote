"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { WeekState } from "@/lib/types";
import type { Mutate } from "./App";

const CALLMEBOT_PAGE = "https://www.callmebot.com/blog/free-api-whatsapp-messages/";

/** Recevoir les courses et les repas sur WhatsApp (CallMeBot) : activation, envoi du jeudi soir et envoi à la demande. */
export default function WhatsApp({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const { me, members } = state.whatsapp;
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [apikey, setApikey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send(to: "me" | "all") {
    setBusy(true); setMsg("");
    const { ok, data } = await api<{ sent: string[]; failed: string[] }>("/api/whatsapp/send", { method: "POST", body: { week: state.week.week_start, to } });
    setBusy(false);
    if (!ok) return setMsg(data.error ?? "Envoi impossible.");
    const parts = [];
    if (data.sent.length) parts.push(`Envoyé à ${data.sent.join(", ")}.`);
    if (data.failed.length) parts.push(`Échec pour ${data.failed.join(", ")} : vérifiez le numéro et la clé.`);
    setMsg(parts.join(" "));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const ok = await mutate("wa.set", { phone, apikey, weekly: me?.weekly ?? true });
    setBusy(false);
    if (ok) { setEditing(false); setApikey(""); setMsg("WhatsApp activé. Envoyez-vous un test."); }
  }

  const form = (
    <form className="adder" onSubmit={save}>
      <ol className="steps">
        <li>Ouvrez la <a href={CALLMEBOT_PAGE} target="_blank" rel="noopener noreferrer">page CallMeBot</a> et enregistrez leur numéro WhatsApp dans vos contacts.</li>
        <li>Envoyez-lui sur WhatsApp : <b>I allow callmebot to send me messages</b></li>
        <li>Il vous répond avec une clé (apikey). Saisissez-la ici avec votre numéro.</li>
      </ol>
      <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="Votre numéro : +33612345678" aria-label="Numéro WhatsApp"
        value={phone} onChange={(e) => setPhone(e.target.value)} required />
      <input className="input" inputMode="numeric" autoComplete="off" placeholder={me ? "Clé CallMeBot (vide = garder l'actuelle)" : "Clé CallMeBot"} aria-label="Clé CallMeBot"
        value={apikey} onChange={(e) => setApikey(e.target.value)} required={!me} />
      <div className="addrow">
        {me && <button type="button" className="btn btn-ghost small" onClick={() => setEditing(false)}>Annuler</button>}
        <button className="btn btn-primary small" disabled={busy || !phone.trim()}>Activer WhatsApp</button>
      </div>
    </form>
  );

  return (
    <section className="panel">
      <h2>WhatsApp</h2>
      <p className="muted">Recevez les courses à faire et les repas de la semaine dans WhatsApp.</p>

      {!me || editing ? form : (
        <>
          <p><b>📱 {me.phone}</b></p>
          <label className="check wrap">
            <input type="checkbox" checked={me.weekly} onChange={(e) => mutate("wa.weekly", { weekly: e.target.checked })} />
            Chaque jeudi à 19 h : courses et repas de la semaine suivante
          </label>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => send("me")}>M'envoyer cette semaine</button>
          {members.length > 1 && (
            <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => send("all")}>Envoyer à toute la famille ({members.length})</button>
          )}
          <div className="addrow">
            <button className="linkbtn" onClick={() => { setPhone(""); setEditing(true); }}>Changer de numéro</button>
            <button className="linkbtn danger" onClick={() => confirm("Ne plus recevoir Popote sur WhatsApp ?") && mutate("wa.delete")}>Désactiver</button>
          </div>
        </>
      )}

      {msg && <p className="notice" role="status">{msg}</p>}
      {members.length > 0 && <p className="muted small">Reçoivent sur WhatsApp : {members.join(", ")}</p>}
    </section>
  );
}
