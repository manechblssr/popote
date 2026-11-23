"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@/lib/realtime";

type Phase = "form" | "pending" | "rejected";
const TOKEN = "popote_device", REQ = "popote_request";

function deviceToken(): string {
  let t = localStorage.getItem(TOKEN);
  if (!t) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    t = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem(TOKEN, t);
  }
  return t;
}

export default function Login() {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [reqId, setReqId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  const check = useCallback(async (id: string) => {
    if (done.current) return;
    const r = await fetch("/api/auth/status", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, token: deviceToken() }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.status === "approved") {
      done.current = true;
      localStorage.removeItem(REQ);
      window.location.reload();
    } else if (r?.status === "rejected") {
      setPhase("rejected");
    } else if (r?.status === "unknown") {
      localStorage.removeItem(REQ);
      setPhase("form");
    }
  }, []);

  // Reprise d'une demande en cours (ou d'un appareil déjà validé dont le cookie a expiré)
  useEffect(() => {
    const saved = localStorage.getItem(REQ);
    if (saved) {
      const { id, name: n } = JSON.parse(saved);
      setReqId(id); setName(n); setPhase("pending");
      check(id);
    }
  }, [check]);

  // Attente : signal temps réel + vérification de secours toutes les 5 s
  useEffect(() => {
    if (phase !== "pending" || !reqId) return;
    const off = listen(`device-${reqId}`, "status", () => check(reqId));
    const t = setInterval(() => check(reqId), 5000);
    const onFocus = () => check(reqId);
    window.addEventListener("focus", onFocus);
    return () => { off(); clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [phase, reqId, check]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await fetch("/api/auth/request", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, token: deviceToken() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Connexion impossible.");
      if (j.status === "approved") { window.location.reload(); return; }
      localStorage.setItem(REQ, JSON.stringify({ id: j.id, name: name.trim() }));
      setReqId(j.id);
      setPhase(j.status === "rejected" ? "rejected" : "pending");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    localStorage.removeItem(REQ);
    setReqId(null); setPhase("form");
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
          <button className="btn btn-ghost" onClick={restart}>Changer de prénom</button>
        </section>
      )}
      {phase === "rejected" && (
        <section className="gate-form" aria-live="polite">
          <h1>Accès refusé</h1>
          <p className="muted">La demande pour « {name.trim()} » a été refusée sur cet appareil.</p>
          <button className="btn btn-ghost" onClick={restart}>Essayer un autre prénom</button>
        </section>
      )}
    </main>
  );
}
