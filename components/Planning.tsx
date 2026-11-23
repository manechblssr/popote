"use client";
import { eatersLabel, headcount } from "@/lib/compute";
import { DAYS, MEALS, dayLabel, fmtAmount, nameKey, type WeekState } from "@/lib/types";
import type { Mutate } from "./App";
import { Empty, Stepper } from "./ui";

export default function Planning({ state, mutate, me }: { state: WeekState; mutate: Mutate; me: string }) {
  const { week, slots, dishes, ingredients, items, attendance } = state;
  const active = slots.filter((s) => s.active);
  if (active.length === 0) return <Empty>Aucun repas prévu cette semaine. Choisissez les créneaux dans l'onglet Semaine.</Empty>;
  const myKey = nameKey(me);

  return (
    <div className="planning">
      {DAYS.map((d, day) => {
        const daySlots = active.filter((s) => s.day === day);
        if (daySlots.length === 0) return null;
        return (
          <section key={d} className="pday">
            <h2 className="pday-title">{d} <span>{dayLabel(week.week_start, day)}</span></h2>
            {daySlots.map((s) => {
              const h = headcount(state, s.id);
              const here = attendance.some((a) => a.slot_id === s.id && a.name_key === myKey);
              const planned = dishes.filter((x) => x.slot_id === s.id);
              return (
                <div key={s.id} className="pmeal">
                  <div className="pmeal-head">
                    <span className="pmeal-name">{MEALS[s.meal]}</span>
                    <span className={h.estimated ? "people-badge est" : "people-badge"} title={h.estimated ? "Estimation" : undefined}>
                      {h.estimated ? "≈ " : ""}{h.count} pers.
                    </span>
                  </div>
                  <p className="eaters">{eatersLabel(h)}</p>
                  <div className="presence">
                    <button className={here ? "btn small btn-here on" : "btn small btn-here"} aria-pressed={here}
                      onClick={() => mutate("attend.set", { slot_id: s.id, present: !here })}>
                      {here ? "✓ Je mange ici" : "Je mange ici"}
                    </button>
                    <span className="guests">
                      Invités
                      <Stepper label={`Invités ${d} ${MEALS[s.meal]}`} min={0} max={30} value={s.guests ?? 0}
                        onChange={(v) => mutate("slot.update", { id: s.id, guests: v })} />
                    </span>
                  </div>
                  {planned.length === 0 ? (
                    <p className="muted">Aucun plat prévu.</p>
                  ) : planned.map((dish) => (
                    <div key={dish.id} className="pdish">
                      <h3>{dish.name}</h3>
                      <ul>
                        {ingredients.filter((i) => i.dish_id === dish.id).map((ing) => {
                          const item = items.find((i) => i.id === ing.item_id);
                          if (!item) return null;
                          return (
                            <li key={ing.id}>
                              <span>{item.name}</span>
                              <b>{ing.qty_per_person ? fmtAmount(ing.qty_per_person * h.count, item.unit) : "à doser"}</b>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
