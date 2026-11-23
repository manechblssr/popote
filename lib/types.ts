export type Meal = "lunch" | "dinner";
export type Source = "courses" | "placard";

export interface Week { id: string; week_start: string; default_people: number; configured: boolean }
export interface Slot { id: string; week_id: string; day: number; meal: Meal; active: boolean; guests: number }
export interface Attendance { slot_id: string; name_key: string; name: string }
export interface Item {
  id: string; week_id: string; name: string; source: Source; quantity: number | null;
  unit: string; per_person: boolean; checked: boolean; created_at: string; category: Category;
}
export interface Dish { id: string; week_id: string; name: string; slot_id: string | null; created_at: string }
export interface DishIngredient { id: string; dish_id: string; item_id: string; qty_per_person: number }
export interface Recent { name_key: string; name: string; source: Source; unit: string; quantity: number | null; per_person: boolean; last_week: string; uses: number; category: Category }
/** Ingrédient d'un plat à composer ou d'un plat déjà fait (quantité par personne). */
export interface DraftIngredient { name: string; qty_per_person: number; unit: string; source: Source; category: Category }
/** Quelqu'un qui mange au repas mais pas cet ingrédient du plat. */
export interface Exclusion { ingredient_id: string; name_key: string; name: string }
/** Repas d'une des 3 semaines planifiables (avec les plats déjà placés). */
export interface PlanSlot { id: string; day: number; meal: Meal; active: boolean; taken: string[] }
export interface PlanWeek { week_start: string; slots: PlanSlot[] }
/* ---------- Ingrédients permanents, classés par thème ---------- */
export type Theme = "proteine" | "feculent" | "legume" | "sauce" | "epice";
export const THEMES: { id: Theme; label: string }[] = [
  { id: "proteine", label: "Protéines" },
  { id: "feculent", label: "Féculents et glucides" },
  { id: "legume", label: "Légumes" },
  { id: "sauce", label: "Sauces et matières grasses" },
  { id: "epice", label: "Épices et aromates" },
];
export const isTheme = (v: unknown): v is Theme => THEMES.some((t) => t.id === v);
export interface Staple { name_key: string; name: string; theme: Theme; unit: string; qty_per_person: number }

/** Liste de départ (modifiable ensuite dans l'appli). Quantités indicatives pour une personne. */
export const DEFAULT_STAPLES: [string, Theme, number, string][] = [
  ["Cordon bleu", "proteine", 1, "pièce"], ["Steak haché", "proteine", 1, "pièce"], ["Bœuf haché", "proteine", 120, "g"],
  ["Lentilles", "proteine", 200, "g"], ["Haricots rouges", "proteine", 80, "g"],
  ["Pâtes", "feculent", 100, "g"], ["Riz", "feculent", 75, "g"], ["Quinoa", "feculent", 70, "g"], ["Boulgour", "feculent", 70, "g"],
  ["Pain burger", "feculent", 1, "pièce"],
  ["Oignons", "legume", 0.5, "pièce"], ["Petits pois", "legume", 80, "g"], ["Ratatouille", "legume", 150, "g"],
  ["Haricots verts", "legume", 120, "g"], ["Brocolis", "legume", 150, "g"], ["Épinards", "legume", 120, "g"],
  ["Crème moutarde", "sauce", 2, "c. à s."], ["Sauce tomate", "sauce", 80, "g"], ["Pesto", "sauce", 1, "c. à s."],
  ["Bouillon de légumes", "sauce", 0.5, "cube"], ["Huile d'olive", "sauce", 1, "c. à s."],
  ["Ail", "epice", 1, "gousse"], ["Curry", "epice", 1, "c. à c."], ["Curcuma", "epice", 0.5, "c. à c."], ["Cumin", "epice", 0.5, "c. à c."],
  ["Coriandre", "epice", 1, "c. à c."], ["Paprika", "epice", 0.5, "c. à c."],
];

export interface LibraryDish { name_key: string; name: string; ingredients: DraftIngredient[] }

export interface WeekState {
  week: Week; slots: Slot[]; attendance: Attendance[]; items: Item[]; dishes: Dish[]; ingredients: DishIngredient[]; recents: Recent[]; library: LibraryDish[]; exclusions: Exclusion[]; plan: PlanWeek[]; staples: Staple[];
}

/* ---------- Rayons des courses ---------- */
export type Category = "viande" | "volaille" | "fruits_legumes" | "fromage" | "boulangerie" | "poisson" | "autre";
export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "viande", label: "Viande rouge", icon: "🥩" },
  { id: "volaille", label: "Poulet, œufs et jambon", icon: "🍗" },
  { id: "fruits_legumes", label: "Fruits et légumes", icon: "🥕" },
  { id: "fromage", label: "Fromage", icon: "🧀" },
  { id: "boulangerie", label: "Boulangerie", icon: "🥖" },
  { id: "poisson", label: "Poissons et fruits de mer", icon: "🐟" },
  { id: "autre", label: "Autres", icon: "🛒" },
];
export const isCategory = (v: unknown): v is Category => CATEGORIES.some((c) => c.id === v);

const KEYWORDS: [Category, string[]][] = [
  ["poisson", ["poisson", "saumon", "thon", "cabillaud", "colin", "merlu", "lieu", "truite", "sardine", "maquereau", "crevette", "moule", "calamar", "encornet", "surimi", "dorade", "bar ", "sole", "hareng", "anchois", "fruits de mer", "noix de saint", "saint-jacques", "crabe", "homard", "langoustine", "poulpe"]],
  ["volaille", ["poulet", "dinde", "canard", "volaille", "oeuf", "œuf", "jambon", "blanc de", "cordon bleu", "nugget", "pintade", "lardon", "bacon"]],
  ["viande", ["boeuf", "bœuf", "steak", "veau", "agneau", "porc", "viande", "hache", "haché", "saucisse", "merguez", "chipolata", "cote", "côte", "roti", "rôti", "bavette", "entrecote", "entrecôte", "boulette", "chorizo", "filet mignon", "escalope"]],
  ["fromage", ["fromage", "emmental", "gruyere", "gruyère", "comte", "comté", "mozzarella", "parmesan", "chevre", "chèvre", "camembert", "brie", "raclette", "feta", "ricotta", "mascarpone", "cheddar", "roquefort", "reblochon", "beaufort", "tomme"]],
  ["boulangerie", ["pain", "baguette", "brioche", "croissant", "viennoiserie", "burger", "bun", "tortilla", "wrap", "pita", "focaccia", "biscotte", "pate a pizza", "pâte à pizza", "pate feuilletee", "pâte feuilletée", "pate brisee", "pâte brisée"]],
  ["fruits_legumes", ["tomate", "salade", "carotte", "oignon", "ail", "echalote", "échalote", "pomme", "poire", "banane", "orange", "citron", "fraise", "framboise", "raisin", "kiwi", "melon", "pasteque", "pastèque", "courgette", "aubergine", "poivron", "concombre", "brocoli", "chou", "epinard", "épinard", "haricot vert", "petit pois", "champignon", "poireau", "navet", "patate", "pomme de terre", "avocat", "mangue", "ananas", "herbe", "basilic", "persil", "coriandre", "ciboulette", "menthe", "thym", "radis", "betterave", "celeri", "céleri", "potiron", "courge", "butternut", "endive", "fenouil", "artichaut", "asperge", "legume", "légume", "fruit", "mache", "mâche", "roquette", "gingembre", "clementine", "clémentine", "peche", "pêche", "abricot", "cerise", "prune"]],
];

/** Rayon deviné d'après le nom (modifiable ensuite). */
export function guessCategory(name: string): Category {
  const n = ` ${name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  for (const [cat, words] of KEYWORDS) {
    // Le mot doit commencer un mot du nom (« ail » ne doit pas matcher « volaille »)
    if (words.some((w) => n.includes(" " + w.normalize("NFD").replace(/[̀-ͯ]/g, "")))) return cat;
  }
  return "autre";
}

export const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const MEALS: Record<Meal, string> = { lunch: "Midi", dinner: "Soir" };
export const UNITS = ["", "g", "kg", "ml", "cl", "L", "pièce", "tranche", "c. à s.", "c. à c.", "pincée", "gousse", "cube", "boîte", "paquet", "botte"];

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


/** Arrondi lisible : 0,25 · 1,5 · 120 · 1 250 */
export function fmtQty(q: number): string {
  const r = q >= 100 ? Math.round(q) : q >= 10 ? Math.round(q * 10) / 10 : Math.round(q * 100) / 100;
  return r.toLocaleString("fr-FR");
}
export function fmtAmount(q: number | null, unit: string): string {
  if (q == null || q === 0) return "";
  return unit ? `${fmtQty(q)} ${unit}` : fmtQty(q);
}
export const nameKey = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
