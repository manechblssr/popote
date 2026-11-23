import type { Dish, WeekState } from "./types";

export interface Headcount {
  count: number;      // convives retenus pour les quantités
  names: string[];    // membres qui ont coché « je mange ici »
  guests: number;     // invités ajoutés
  estimated: boolean; // personne n'a encore répondu : estimation de la semaine
}

/** Qui mange à ce repas : les membres qui ont coché + les invités. Sans réponse, on garde l'estimation de la semaine. */
export function headcount(state: WeekState, slotId: string | null): Headcount {
  const slot = state.slots.find((s) => s.id === slotId);
  if (!slot) return { count: state.week.default_people, names: [], guests: 0, estimated: true };
  const names = state.attendance.filter((a) => a.slot_id === slot.id).map((a) => a.name);
  const guests = slot.guests ?? 0;
  const count = names.length + guests;
  return count > 0 ? { count, names, guests, estimated: false } : { count: state.week.default_people, names, guests, estimated: true };
}

export const dishPeople = (state: WeekState, dish: Dish) => headcount(state, dish.slot_id).count;

/** Texte « Mangent ici : Manech, Calista + 1 invité ». */
export function eatersLabel(h: Headcount): string {
  if (h.names.length === 0 && h.guests === 0) return "Personne n'a encore coché";
  const g = h.guests ? `${h.guests} invité${h.guests > 1 ? "s" : ""}` : "";
  return `Mangent ici : ${[h.names.join(", "), g].filter(Boolean).join(" + ")}`;
}

/** Quantité totale de chaque ingrédient requise par les plats planifiés sur des créneaux actifs. */
export function neededByItem(state: WeekState): Map<string, number> {
  const out = new Map<string, number>();
  for (const ing of state.ingredients) {
    const dish = state.dishes.find((d) => d.id === ing.dish_id);
    if (!dish) continue;
    const slot = state.slots.find((s) => s.id === dish.slot_id);
    if (slot && !slot.active) continue;
    out.set(ing.item_id, (out.get(ing.item_id) ?? 0) + ing.qty_per_person * dishPeople(state, dish));
  }
  return out;
}
