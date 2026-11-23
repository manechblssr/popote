"use client";
import { useEffect, useRef, useState } from "react";

/** Compteur +/− : affichage immédiat, enregistrement groupé après 400 ms sans toucher. */
export function Stepper({ value, onChange, min = 1, max = 50, label, dim }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; dim?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!timer.current) setLocal(value); }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function step(d: number) {
    const v = Math.min(max, Math.max(min, local + d));
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; if (v !== value) onChange(v); }, 400);
  }

  return (
    <div className={dim && local === value ? "stepper dim" : "stepper"} role="group" aria-label={label}>
      <button type="button" aria-label="Moins" disabled={local <= min} onClick={() => step(-1)}>−</button>
      <output aria-live="polite">{local}</output>
      <button type="button" aria-label="Plus" disabled={local >= max} onClick={() => step(1)}>+</button>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
