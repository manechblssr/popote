"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@/lib/realtime";
import { addDays, dayLabel, mondayOf, type WeekState } from "@/lib/types";
import Settings from "./Settings";
import Shopping from "./Shopping";
import Dishes from "./Dishes";
import Planning from "./Planning";

export type Mutate = (op: string, payload?: Record<string, unknown>) => Promise<boolean>;
type Tab = "semaine" | "courses" | "plats" | "planning";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "semaine", label: "Semaine", icon: "M4 6h16M4 12h10M4 18h6" },
  { id: "courses", label: "Courses", icon: "M5 7h14l-1.5 11h-11zM9 7a3 3 0 0 1 6 0" },
  { id: "plats", label: "Plats", icon: "M4 12h16a8 8 0 0 1-16 0zM3 12h18M10 6c0-1.5 1.5-1.5 1.5-3M14 6c0-1.5 1.5-1.5 1.5-3" },
  { id: "planning", label: "Planning", icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" },
];

export default function App({ userName }: { userName: string }) {
  const [week, setWeek] = useState(() => mondayOf());
  const [state, setState] = useState<WeekState | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const weekRef = useRef(week);
  weekRef.current = week;

  const load = useCallback(async (w: string) => {
    const r = await fetch(`/api/data?week=${w}`, { cache: "no-store" }).catch(() => null);
    if (!r) { setOnline(false); return; }
    if (r.status === 401) { window.location.reload(); return; }
    const j = await r.json();
    if (!r.ok) { setError(j.error); return; }
    setOnline(true);
    if (w === weekRef.current) setState(j);
  }, []);

  useEffect(() => { setState(null); load(week); }, [week, load]);

  useEffect(() => {
    const off = listen("popote-family", "change", (p) => { if (p.week === weekRef.current) load(weekRef.current); });
    const refresh = () => { if (document.visibilityState === "visible") load(weekRef.current); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => { off(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [load]);

  useEffect(() => {
    if (state && tab === null) setTab(state.week.configured ? "courses" : "semaine");
  }, [state, tab]);

  const mutate: Mutate = useCallback(async (op, payload = {}) => {
    setError("");
    const r = await fetch("/api/data", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: weekRef.current, op, ...payload }),
    }).catch(() => null);
    if (!r) { setOnline(false); setError("Pas de connexion : modification non enregistrée."); return false; }
    if (r.status === 401) { window.location.reload(); return false; }
    const j = await r.json();
    if (!r.ok) { setError(j.error ?? "Modification impossible."); return false; }
    setOnline(true);
    if (j.week.week_start === weekRef.current) setState(j);
    return true;
  }, []);

  async function logout() {
    if (!confirm("Se déconnecter de cet appareil ?")) return;
    await fetch("/api/auth/status", { method: "DELETE" });
    window.location.reload();
  }

  const current = mondayOf();
  return (
    <div className="shell">
      <header className="topbar">
        <button className="iconbtn" aria-label="Semaine précédente" onClick={() => setWeek(addDays(week, -7))}>‹</button>
        <div className="weekname">
          <strong>{week === current ? "Cette semaine" : week === addDays(current, 7) ? "Semaine prochaine" : `Semaine du ${dayLabel(week, 0)}`}</strong>
          <span>{dayLabel(week, 0)} – {dayLabel(week, 6)}</span>
        </div>
        <button className="iconbtn" aria-label="Semaine suivante" onClick={() => setWeek(addDays(week, 7))}>›</button>
        <button className="avatar" onClick={logout} aria-label={`Connecté : ${userName}. Se déconnecter`}>{userName.slice(0, 1).toUpperCase()}</button>
      </header>

      {!online && <div className="banner">Hors ligne : les modifications ne sont pas enregistrées.</div>}
      {error && <div className="banner banner-error" role="alert" onClick={() => setError("")}>{error}</div>}

      <main className="content">
        {!state || !tab ? (
          <div className="loading" aria-busy>Chargement de la semaine…</div>
        ) : tab === "semaine" ? (
          <Settings state={state} mutate={mutate} onDone={() => setTab("courses")} />
        ) : tab === "courses" ? (
          <Shopping state={state} mutate={mutate} />
        ) : tab === "plats" ? (
          <Dishes state={state} mutate={mutate} />
        ) : (
          <Planning state={state} />
        )}
      </main>

      <nav className="tabbar" aria-label="Navigation">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "tab on" : "tab"} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <svg viewBox="0 0 24 24" aria-hidden><path d={t.icon} /></svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
