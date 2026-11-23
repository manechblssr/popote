"use client";
import { DAYS, MEALS, dayLabel, type Meal, type WeekState } from "@/lib/types";
import type { Mutate } from "./App";
import { Stepper } from "./ui";

export default function Settings({ state, mutate, onDone }: { state: WeekState; mutate: Mutate; onDone: () => void }) {
  const { week, slots } = state;
  const active = slots.filter((s) => s.active);
  const preset = active.length === 14 ? "both" : active.length === 7 && active.every((s) => s.meal === "dinner") ? "dinner" : "custom";

  async function finish() {
    if (await mutate("week.update", { configured: true })) onDone();
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Combien êtes-vous&nbsp;?</h2>
        <p className="muted">Nombre de personnes par défaut à chaque repas de la semaine.</p>
        <div className="row-between">
          <span className="big-number">{week.default_people} <small>{week.default_people > 1 ? "personnes" : "personne"}</small></span>
          <Stepper label="Personnes par défaut" value={week.default_people} onChange={(v) => mutate("week.update", { default_people: v })} />
        </div>
      </section>

      <section className="panel">
        <h2>Repas à prévoir</h2>
        <div className="segmented" role="radiogroup" aria-label="Créneaux de la semaine">
          <button role="radio" aria-checked={preset === "both"} className={preset === "both" ? "on" : ""} onClick={() => mutate("slots.preset", { preset: "both" })}>Midi et soir</button>
          <button role="radio" aria-checked={preset === "dinner"} className={preset === "dinner" ? "on" : ""} onClick={() => mutate("slots.preset", { preset: "dinner" })}>Soir uniquement</button>
          <span className={preset === "custom" ? "seg-note on" : "seg-note"}>Sur mesure</span>
        </div>
        <p className="muted">Touchez un créneau pour l'activer ou le retirer, et ajustez les convives pour un repas précis.</p>

        <ul className="slotgrid">
          {DAYS.map((d, day) => (
            <li key={d}>
              <div className="slotday"><strong>{d}</strong><span>{dayLabel(week.week_start, day)}</span></div>
              {(["lunch", "dinner"] as Meal[]).map((meal) => {
                const s = slots.find((x) => x.day === day && x.meal === meal);
                if (!s) return null;
                const n = s.people ?? week.default_people;
                return (
                  <div key={meal} className={s.active ? "slotcell on" : "slotcell"}>
                    <button className="slottoggle" aria-pressed={s.active} onClick={() => mutate("slot.update", { id: s.id, active: !s.active })}>
                      {MEALS[meal]}
                    </button>
                    {s.active && (
                      <div className="slotpeople">
                        <Stepper label={`Convives ${d} ${MEALS[meal]}`} value={n} dim={s.people === null}
                          onChange={(v) => mutate("slot.update", { id: s.id, people: v === week.default_people ? null : v })} />
                      </div>
                    )}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      </section>

      <button className="btn btn-primary btn-block" onClick={finish}>
        {week.configured ? "Passer aux courses" : `Valider ${active.length} repas et passer aux courses`}
      </button>
    </div>
  );
}
