import { NextResponse } from "next/server";
import { broadcast, currentUser, db } from "@/lib/server";
import { isMonday, nameKey, type Item, type Recent, type Week, type WeekState } from "@/lib/types";

type Body = Record<string, unknown>;
class Bad extends Error {}

const str = (v: unknown, max = 80) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s || s.length > max) throw new Bad("Texte invalide");
  return s;
};
const unit = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 20) : "");
const num = (v: unknown, min = 0, max = 100000): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Bad("Nombre invalide");
  return n;
};
const people = (v: unknown) => {
  const n = num(v, 1, 50);
  return n === null ? null : Math.round(n);
};
const id = (v: unknown) => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/.test(v)) throw new Bad("Identifiant invalide");
  return v;
};
const source = (v: unknown) => (v === "placard" ? "placard" : "courses");

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function ensureWeek(weekStart: string): Promise<Week> {
  const sb = db();
  let week = await check(sb.from("weeks").select("*").eq("week_start", weekStart).maybeSingle());
  if (!week) {
    // Reprend le nombre de personnes de la semaine précédente si elle existe
    const prev = await check(sb.from("weeks").select("default_people").lt("week_start", weekStart).order("week_start", { ascending: false }).limit(1).maybeSingle());
    await check(sb.from("weeks").upsert({ week_start: weekStart, default_people: prev?.default_people ?? 4 }, { onConflict: "week_start", ignoreDuplicates: true }));
    week = await check(sb.from("weeks").select("*").eq("week_start", weekStart).single());
    const slots = Array.from({ length: 14 }, (_, i) => ({ week_id: week!.id, day: i >> 1, meal: i % 2 ? "dinner" : "lunch", active: true }));
    await check(sb.from("slots").upsert(slots, { onConflict: "week_id,day,meal", ignoreDuplicates: true }));
  }
  return week as Week;
}

async function loadState(weekStart: string): Promise<WeekState> {
  const sb = db();
  const week = await ensureWeek(weekStart);
  const [slots, items, dishes, memory] = await Promise.all([
    check(sb.from("slots").select("*").eq("week_id", week.id).order("day").order("meal", { ascending: false })),
    check(sb.from("items").select("*").eq("week_id", week.id).order("created_at")),
    check(sb.from("dishes").select("*").eq("week_id", week.id).order("created_at")),
    check(sb.from("ingredient_memory").select("*").order("last_week", { ascending: false }).order("uses", { ascending: false }).limit(120)),
  ]);
  const dishIds = (dishes as { id: string }[]).map((d) => d.id);
  const ingredients = dishIds.length ? await check(sb.from("dish_ingredients").select("*").in("dish_id", dishIds)) : [];
  const present = new Set((items as Item[]).map((i) => nameKey(i.name)));
  const recents = (memory as Recent[]).filter((r) => !present.has(r.name_key)).slice(0, 40);
  return { week, slots, items, dishes, ingredients, recents } as WeekState;
}

async function remember(weekStart: string, it: { name: string; source: string; unit: string; quantity: number | null; per_person: boolean }) {
  const sb = db();
  const key = nameKey(it.name);
  const prev = await check(sb.from("ingredient_memory").select("uses").eq("name_key", key).maybeSingle());
  await check(sb.from("ingredient_memory").upsert({
    name_key: key, name: it.name, source: it.source, unit: it.unit, quantity: it.quantity, per_person: it.per_person,
    last_week: weekStart, uses: (prev?.uses ?? 0) + 1,
  }));
}

async function addItem(week: Week, b: Body): Promise<Item> {
  const name = str(b.name);
  const existing = await check(sb().from("items").select("*").eq("week_id", week.id));
  const dup = (existing as Item[]).find((i) => nameKey(i.name) === nameKey(name));
  if (dup) return dup;
  const row = { week_id: week.id, name, source: source(b.source), quantity: num(b.quantity), unit: unit(b.unit), per_person: b.per_person === true };
  const item = await check(sb().from("items").insert(row).select().single());
  await remember(week.week_start, row);
  return item as Item;
}
const sb = db;

async function apply(week: Week, b: Body) {
  const w = week.id;
  switch (b.op) {
    case "week.update": {
      const patch: Record<string, unknown> = {};
      if (b.default_people !== undefined) patch.default_people = people(b.default_people) ?? week.default_people;
      if (typeof b.configured === "boolean") patch.configured = b.configured;
      return check(sb().from("weeks").update(patch).eq("id", w));
    }
    case "slots.preset": {
      if (b.preset === "dinner") {
        await check(sb().from("slots").update({ active: false }).eq("week_id", w).eq("meal", "lunch"));
        return check(sb().from("slots").update({ active: true }).eq("week_id", w).eq("meal", "dinner"));
      }
      return check(sb().from("slots").update({ active: true }).eq("week_id", w));
    }
    case "slot.update": {
      const patch: Record<string, unknown> = {};
      if (typeof b.active === "boolean") patch.active = b.active;
      if ("people" in b) patch.people = people(b.people);
      return check(sb().from("slots").update(patch).eq("id", id(b.id)).eq("week_id", w));
    }
    case "item.add":
      return addItem(week, b);
    case "item.update": {
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch.name = str(b.name);
      if (b.source !== undefined) patch.source = source(b.source);
      if ("quantity" in b) patch.quantity = num(b.quantity);
      if (b.unit !== undefined) patch.unit = unit(b.unit);
      if (typeof b.per_person === "boolean") patch.per_person = b.per_person;
      if (typeof b.checked === "boolean") patch.checked = b.checked;
      const item = await check(sb().from("items").update(patch).eq("id", id(b.id)).eq("week_id", w).select().single());
      if (patch.name || patch.unit !== undefined || "quantity" in patch) await remember(week.week_start, item as Item);
      return item;
    }
    case "item.delete":
      return check(sb().from("items").delete().eq("id", id(b.id)).eq("week_id", w));
    case "items.uncheckAll":
      return check(sb().from("items").update({ checked: false }).eq("week_id", w));
    case "recent.add": {
      const r = await check(sb().from("ingredient_memory").select("*").eq("name_key", str(b.name_key)).single()) as Recent;
      return addItem(week, { ...r });
    }
    case "recent.forget":
      return check(sb().from("ingredient_memory").delete().eq("name_key", str(b.name_key)));
    case "dish.add": {
      const slot = b.slot_id ? id(b.slot_id) : null;
      return check(sb().from("dishes").insert({ week_id: w, name: str(b.name), slot_id: slot }).select().single());
    }
    case "dish.update": {
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch.name = str(b.name);
      if ("slot_id" in b) patch.slot_id = b.slot_id ? id(b.slot_id) : null;
      return check(sb().from("dishes").update(patch).eq("id", id(b.id)).eq("week_id", w));
    }
    case "dish.delete":
      return check(sb().from("dishes").delete().eq("id", id(b.id)).eq("week_id", w));
    case "ing.set": {
      const dish = await check(sb().from("dishes").select("id").eq("id", id(b.dish_id)).eq("week_id", w).maybeSingle());
      if (!dish) throw new Bad("Plat introuvable");
      let itemId: string;
      if (b.item_id) {
        const it = await check(sb().from("items").select("id").eq("id", id(b.item_id)).eq("week_id", w).maybeSingle());
        if (!it) throw new Bad("Ingrédient introuvable");
        itemId = it.id;
      } else {
        itemId = (await addItem(week, b)).id; // nouvel ingrédient créé à la volée
      }
      return check(sb().from("dish_ingredients").upsert(
        { dish_id: dish.id, item_id: itemId, qty_per_person: num(b.qty_per_person) ?? 0 },
        { onConflict: "dish_id,item_id" },
      ));
    }
    case "ing.delete": {
      const ing = await check(sb().from("dish_ingredients").select("id, dishes!inner(week_id)").eq("id", id(b.id)).eq("dishes.week_id", w).maybeSingle());
      if (!ing) throw new Bad("Ingrédient introuvable");
      return check(sb().from("dish_ingredients").delete().eq("id", ing.id));
    }
    default:
      throw new Bad("Action inconnue");
  }
}

function weekParam(v: unknown) {
  if (typeof v !== "string" || !isMonday(v)) throw new Bad("Semaine invalide");
  return v;
}

function fail(e: unknown) {
  if (e instanceof Bad) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(e);
  return NextResponse.json({ error: "Erreur serveur, réessayez." }, { status: 500 });
}

export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Session expirée" }, { status: 401 });
  try {
    return NextResponse.json(await loadState(weekParam(new URL(req.url).searchParams.get("week"))));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Session expirée" }, { status: 401 });
  try {
    const b = (await req.json()) as Body;
    const weekStart = weekParam(b.week);
    await apply(await ensureWeek(weekStart), b);
    await broadcast("popote-family", "change", { week: weekStart });
    return NextResponse.json(await loadState(weekStart));
  } catch (e) {
    return fail(e);
  }
}
