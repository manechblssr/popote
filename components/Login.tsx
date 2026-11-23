"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, deviceToken, live } from "@/lib/api";

export interface Access {
  status: "approved" | "pending" | "rejected" | "unknown" | "offline";
  id?: string;
  name?: string;
  error?: string;
}
type Phase = "form" | "pending" | "rejected";

export default function Login({ initial, onApproved }: { initial: Access; onApproved: (name: string) => void }) {
  const [name, setName] = useState(initial.name ?? "");
  const [phase, setPhase] = useState<Phase>(initial.status === "pending" ? "pending" : initial.status === "rejected" ? "rejected" : "form");
  const [error, setError] = useState(initial.status === "offline" ? initial.error ?? "Serveur injoignable." : "");
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  const check = useCallback(async () => {
    if (done.current) return;
    const { ok, data } = await api<Access>("/api/auth/status", { method: "POST", body: { token: deviceToken() } });
    if (!ok || done.current) return;
    if (data.status === "approved") { done.current = true; onApproved(data.name ?? name); }
    else if (data.status === "rejected") setPhase("rejected");
    else if (data.status === "unknown") setPhase("form");
  }, [name, onApproved]);

  // Attente : signal temps réel dès la décision sur Telegram + vérification de secours toutes les 5 s
  useEffect(() => {
    if (phase !== "pending") return;
    const close = live((m) => { if (m.type === "status") check(); });
    const t = setInterval(check, 5000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { close(); clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [phase, check]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const { ok, data } = await api<Access>("/api/auth/request", { method: "POST", body: { name, token: deviceToken() } });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Connexion impossible.");
    if (data.status === "approved") { done.current = true; return onApproved(data.name ?? name.trim()); }
    setPhase(data.status === "rejected" ? "rejected" : "pending");
  }

  return (
    <main className="gate">
      <div className="gate-brand" aria-hidden>Popote</div>
      {phase === "form" && (
        <form onSubmit={submit} className="gate-form">
          <h1>Qui est à table&nbsp;?</h1>
          <label htmlFor="name" className="sr-only">Votre prénom</label>
          <input id="name" className="input input-xl" autoFocus autoComplete="given-name" placeholder="Votre prénom"
            value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>{busy ? "Envoi…" : "Entrer"}</button>
        </form>
      )}
      {phase === "pending" && (
        <section className="gate-form" aria-live="polite">
          <div className="steam" aria-hidden><span /><span /><span /></div>
          <h1>Bonjour {name.trim()}</h1>
          <p className="muted">Votre demande d'accès a été envoyée. Cet écran s'ouvrira tout seul dès qu'elle sera acceptée.</p>
          <button className="btn btn-ghost" onClick={() => setPhase("form")}>Changer de prénom</button>
        </section>
      )}
      {phase === "rejected" && (
        <section className="gate-form" aria-live="polite">
          <h1>Accès refusé</h1>
          <p className="muted">La demande{name.trim() ? ` pour « ${name.trim()} »` : ""} a été refusée sur cet appareil.</p>
          <button className="btn btn-ghost" onClick={() => setPhase("form")}>Essayer un autre prénom</button>
        </section>
      )}
    </main>
  );
}
