"use client";
import { useEffect, useState } from "react";
import { api, deviceToken } from "@/lib/api";
import App from "@/components/App";
import Login, { type Access } from "@/components/Login";

const IN = "popote_in";

export default function Home() {
  const [access, setAccess] = useState<Access | null>(null);

  useEffect(() => {
    deviceToken();
    api<Access>("/api/auth/status", { method: "POST", body: { token: deviceToken() } }).then(({ ok, data }) => {
      if (!ok) return setAccess({ status: "offline", error: data.error });
      // Après une déconnexion volontaire, on redemande le prénom même si l'appareil est validé
      setAccess(data.status === "approved" && !localStorage.getItem(IN) ? { status: "unknown" } : data);
    });
  }, []);

  if (!access) return <div className="loading">Popote se prépare…</div>;
  if (access.status === "approved") {
    return <App userName={access.name ?? ""} onLogout={() => { localStorage.removeItem(IN); setAccess({ status: "unknown" }); }} />;
  }
  return <Login initial={access} onApproved={(name) => { localStorage.setItem(IN, "1"); setAccess({ status: "approved", name }); }} />;
}
