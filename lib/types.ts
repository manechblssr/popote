export type Meal = "lunch" | "dinner";
export type Source = "courses" | "placard";

export interface Week { id: string; week_start: string; default_people: number; configured: boolean }
export interface Slot { id: string; week_id: string; day: number; meal: Meal; active: boolean; people: number | null }
export interface Item {
  id: string; week_id: string; name: string; source: Source; quantity: number | null;
  unit: string; per_person: boolean; checked: boolean; created_at: string;
}
export interface Dish { id: string; week_id: string; name: string; slot_id: string | null; created_at: string }
export interface DishIngredient { id: string; dish_id: string; item_id: string; qty_per_person: number }
export interface Recent { name_key: string; name: string; source: Source; unit: string; quantity: number | null; per_person: boolean; last_week: string; uses: number }

export interface WeekState {
  week: Week; slots: Slot[]; items: Item[]; dishes: Dish[]; ingredients: DishIngredient[]; recents: Recent[];
}

export const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const MEALS: Record<Meal, string> = { lunch: "Midi", dinner: "Soir" };
export const UNITS = ["", "g", "kg", "ml", "cl", "L", "pièce", "tranche", "c. à s.", "c. à c.", "pincée", "boîte", "paquet", "botte"];

/** Lundi (YYYY-MM-DD) de la semaine contenant `d`, en heure locale. */
export function mondayOf(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoDate(x);
}
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}
export function isMonday(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  return x.getDate() === d && x.getDay() === 1;
}
export function dayLabel(weekStart: string, day: number): string {
  const [y, m, d] = addDays(weekStart, day).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function slotPeople(slot: Slot | undefined, week: Week): number {
  return slot?.people ?? week.default_people;
}

/** Arrondi lisible : 0,25 · 1,5 · 120 · 1 250 */
export function fmtQty(q: number): string {
  const r = q >= 100 ? Math.round(q) : q >= 10 ? Math.round(q * 10) / 10 : Math.round(q * 100) / 100;
  return r.toLocaleString("fr-FR");
}
export function fmtAmount(q: number | null, unit: string): string {
  if (q == null || q === 0) return unit ? unit : "";
  return unit ? `${fmtQty(q)} ${unit}` : fmtQty(q);
}
export const nameKey = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
