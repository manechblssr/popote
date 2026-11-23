"use client";
import { DAYS, MEALS, dayLabel, fmtAmount, slotPeople, type WeekState } from "@/lib/types";
import { Empty } from "./ui";

export default function Planning({ state }: { state: WeekState }) {
  const { week, slots, dishes, ingredients, items } = state;
  const active = slots.filter((s) => s.active);
  if (active.length === 0) return <Empty>Aucun repas actif cette semaine. Activez des créneaux dans l'onglet Semaine.</Empty>;

  return (
    <div className="planning">
      {DAYS.map((d, day) => {
        const daySlots = active.filter((s) => s.day === day);
        if (daySlots.length === 0) return null;
        return (
          <section key={d} className="pday">
            <h2 className="pday-title">{d} <span>{dayLabel(week.week_start, day)}</span></h2>
            {daySlots.map((s) => {
              const people = slotPeople(s, week);
              const planned = dishes.filter((x) => x.slot_id === s.id);
              return (
                <div key={s.id} className="pmeal">
                  <div className="pmeal-head">
                    <span className="pmeal-name">{MEALS[s.meal]}</span>
                    <span className="people-badge">{people} pers.</span>
                  </div>
                  {planned.length === 0 ? (
                    <p className="muted">Rien de prévu.</p>
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
                              <b>{ing.qty_per_person ? fmtAmount(ing.qty_per_person * people, item.unit) : "à doser"}</b>
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
