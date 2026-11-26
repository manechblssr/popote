"use client";
import { headcount } from "@/lib/compute";
import { DAYS, MEALS, dayLabel, nameKey, type Meal, type WeekState } from "@/lib/types";
import type { Mutate } from "./App";
import { Stepper } from "./ui";

const MEAL_ORDER: Meal[] = ["lunch", "dinner"];

export default function Settings({ state, mutate, me, onDone }: { state: WeekState; mutate: Mutate; me: string; onDone: () => void }) {
  const { week, slots, attendance } = state;
  const active = slots.filter((s) => s.active);
  const preset = active.length === 14 ? "both" : active.length === 7 && active.every((s) => s.meal === "dinner") ? "dinner" : "custom";
  const myKey = nameKey(me);
  const mine = new Set(attendance.filter((a) => a.name_key === myKey).map((a) => a.slot_id));
  const myCount = active.filter((s) => mine.has(s.id)).length;

  async function finish() {
    if (await mutate("week.update", { configured: true })) onDone();
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Repas à prévoir</h2>
        <div className="segmented" role="radiogroup" aria-label="Créneaux de la semaine">
          <button role="radio" aria-checked={preset === "both"} className={preset === "both" ? "on" : ""} onClick={() => mutate("slots.preset", { preset: "both" })}>Midi et soir</button>
          <button role="radio" aria-checked={preset === "dinner"} className={preset === "dinner" ? "on" : ""} onClick={() => mutate("slots.preset", { preset: "dinner" })}>Soir uniquement</button>
          <span className={preset === "custom" ? "seg-note on" : "seg-note"}>Sur mesure</span>
        </div>
        <p className="muted">Touchez un créneau pour l'ajouter ou le retirer de la semaine, pour toute la famille.</p>
        <ul className="daygrid">
          {DAYS.map((d, day) => (
            <li key={d}>
              <span className="daygrid-day">{d.slice(0, 3)}<small>{dayLabel(week.week_start, day)}</small></span>
              {MEAL_ORDER.map((meal) => {
                const s = slots.find((x) => x.day === day && x.meal === meal);
                return s ? (
                  <button key={meal} className={s.active ? "cell on" : "cell"} aria-pressed={s.active}
                    aria-label={`${d} ${MEALS[meal]} : ${s.active ? "prévu" : "pas prévu"}`}
                    onClick={() => mutate("slot.update", { id: s.id, active: !s.active })}>
                    {MEALS[meal]}
                  </button>
                ) : null;
              })}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Quand manges-tu ici, {me}&nbsp;?</h2>
        <p className="muted">Coche tes repas. Chacun coche les siens depuis son téléphone.</p>
        <div className="addrow">
          <button className="btn btn-ghost small" onClick={() => mutate("attend.all", { present: true })} disabled={myCount === active.length}>Tous les repas</button>
          <button className="btn btn-ghost small" onClick={() => mutate("attend.all", { present: false })} disabled={myCount === 0}>Aucun</button>
        </div>
        {active.length === 0 ? <p className="empty">Aucun repas prévu cette semaine.</p> : (
          <ul className="daygrid">
            {DAYS.map((d, day) => {
              const daySlots = MEAL_ORDER.map((meal) => active.find((x) => x.day === day && x.meal === meal));
              if (!daySlots.some(Boolean)) return null;
              return (
                <li key={d}>
                  <span className="daygrid-day">{d.slice(0, 3)}<small>{dayLabel(week.week_start, day)}</small></span>
                  {daySlots.map((s, i) => {
                    if (!s) return <span key={i} className="cell ghost" aria-hidden />;
                    const on = mine.has(s.id);
                    const h = headcount(state, s.id);
                    return (
                      <button key={s.id} className={on ? "cell me on" : "cell me"} aria-pressed={on}
                        aria-label={`${d} ${MEALS[s.meal]} : ${on ? "je mange ici" : "je ne mange pas ici"}`}
                        onClick={() => mutate("attend.set", { slot_id: s.id, present: !on })}>
                        <span>{on ? "✓ " : ""}{MEALS[s.meal]}</span>
                        <small>{h.estimated ? "personne" : `${h.count} pers.`}</small>
                      </button>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="row-between">
          <div>
            <h2>Estimation</h2>
            <p className="muted">Nombre de convives retenu pour un repas où personne n'a encore coché.</p>
          </div>
          <Stepper label="Convives estimés" value={week.default_people} onChange={(v) => mutate("week.update", { default_people: v })} />
        </div>
      </section>

      <button className="btn btn-primary btn-block" onClick={finish}>
        {week.configured ? "Passer aux courses" : `Valider ${active.length} repas et passer aux courses`}
      </button>
    </div>
  );
}
