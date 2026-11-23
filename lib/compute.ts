import { slotPeople, type Dish, type WeekState } from "./types";

/** Nombre de convives d'un plat : celui de son créneau, sinon le défaut de la semaine. */
export function dishPeople(state: WeekState, dish: Dish): number {
  return slotPeople(state.slots.find((s) => s.id === dish.slot_id), state.week);
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
