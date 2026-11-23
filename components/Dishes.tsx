"use client";
import { useMemo, useRef, useState } from "react";
import { dishTitle, excludedFor, headcount, ingredientPeople } from "@/lib/compute";
import {
  DAYS, MEALS, THEMES, UNITS, dayLabel, fmtAmount, guessCategory, nameKey,
  type Dish, type DishIngredient, type DraftIngredient, type Meal, type Theme, type WeekState,
} from "@/lib/types";
import type { Mutate } from "./App";
import { Empty } from "./ui";

const MEAL_ORDER: Meal[] = ["lunch", "dinner"];
const WEEK_LABELS = ["Cette semaine", "Semaine prochaine", "Dans 2 semaines"];

const parseQty = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : 0; };
const showQty = (n: number) => (n ? String(n).replace(".", ",") : "");

type Option = DraftIngredient & { key: string };

/** Ingrédients à cocher : ceux des courses de la semaine (« du marché ») et les permanents, par thème. */
function useOptions(state: WeekState) {
  return useMemo(() => {
    // Quantité par personne déjà utilisée dans un plat passé, pour pré-remplir
    const lastQty = new Map<string, { q: number; unit: string }>();
    state.library.forEach((d) => d.ingredients.forEach((g) => {
      if (g.qty_per_person && !lastQty.has(nameKey(g.name))) lastQty.set(nameKey(g.name), { q: g.qty_per_person, unit: g.unit });
    }));
    const market: Option[] = state.items.filter((i) => i.source === "courses").map((i) => {
      const k = nameKey(i.name);
      return { key: k, name: i.name, unit: i.unit || lastQty.get(k)?.unit || "", qty_per_person: lastQty.get(k)?.q ?? 0, source: "courses", category: i.category };
    });
    const byTheme = new Map<Theme, Option[]>();
    for (const st of state.staples) {
      const list = byTheme.get(st.theme) ?? [];
      list.push({ key: st.name_key, name: st.name, unit: st.unit, qty_per_person: st.qty_per_person, source: "placard", category: guessCategory(st.name) });
      byTheme.set(st.theme, list);
    }
    return { market, byTheme };
  }, [state]);
}

function IngredientPicker({ state, selected, onToggle }: { state: WeekState; selected: Set<string>; onToggle: (o: Option) => void }) {
  const { market, byTheme } = useOptions(state);
  const chips = (list: Option[]) => (
    <ul className="chips">
      {list.map((o) => {
        const on = selected.has(o.key);
        return (
          <li key={o.key}>
            <button type="button" className={on ? "chip pick on" : "chip pick"} aria-pressed={on} onClick={() => onToggle(o)}>
              {on ? "✓" : "+"} {o.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="picker-groups">
      <div>
        <h4 className="group-title">Du marché <span className="muted small">(courses de la semaine)</span></h4>
        {market.length ? chips(market) : <p className="muted small">Rien dans les courses de la semaine pour l'instant.</p>}
      </div>
      {THEMES.map((t) => byTheme.get(t.id)?.length ? (
        <div key={t.id}>
          <h4 className="group-title">{t.label}</h4>
          {chips(byTheme.get(t.id)!)}
        </div>
      ) : null)}
    </div>
  );
}

/** Ajout d'un ingrédient permanent qui manque à la liste. */
function StapleAdder({ mutate }: { mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<Theme>("proteine");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("g");
  if (!open) return <button type="button" className="linkbtn" onClick={() => setOpen(true)}>+ Ajouter un ingrédient permanent</button>;
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await mutate("staple.add", { name, theme, unit, qty_per_person: parseQty(qty) })) { setName(""); setQty(""); setOpen(false); }
  }
  return (
    <form className="adder" onSubmit={add}>
      <strong>Nouvel ingrédient permanent</strong>
      <input className="input" placeholder="Nom" aria-label="Nom de l'ingrédient permanent" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <select className="input" aria-label="Thème" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <div className="addrow">
        <input className="input qty" inputMode="decimal" placeholder="Qté" aria-label="Quantité habituelle par personne" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="input unit" aria-label="Unité" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{u || "unité"}</option>)}
        </select>
        <span className="muted small">par personne</span>
      </div>
      <div className="addrow">
        <button type="button" className="btn btn-ghost small" onClick={() => setOpen(false)}>Annuler</button>
        <button className="btn btn-primary small" disabled={!name.trim()}>Ajouter</button>
      </div>
    </form>
  );
}

type Target = { week: string; day: number; meal: Meal };
const tkey = (t: Target) => `${t.week}|${t.day}|${t.meal}`;

/** Choix de plusieurs repas d'un coup, sur cette semaine et les 2 suivantes. */
function MealPicker({ state, selected, onToggle }: { state: WeekState; selected: Map<string, Target>; onToggle: (t: Target) => void }) {
  const [w, setW] = useState(0);
  const plan = state.plan[w];
  const perWeek = state.plan.map((p) => [...selected.values()].filter((t) => t.week === p.week_start).length);
  if (!plan) return null;
  return (
    <div className="picker3">
      <div className="segmented small" role="tablist" aria-label="Semaine">
        {state.plan.map((p, i) => (
          <button key={p.week_start} role="tab" aria-selected={w === i} className={w === i ? "on" : ""} onClick={() => setW(i)}>
            {WEEK_LABELS[i]}{perWeek[i] ? ` (${perWeek[i]})` : ""}
          </button>
        ))}
      </div>
      <ul className="daygrid">
        {DAYS.map((d, day) => (
          <li key={d}>
            <span className="daygrid-day">{d.slice(0, 3)}<small>{dayLabel(plan.week_start, day)}</small></span>
            {MEAL_ORDER.map((meal) => {
              const s = plan.slots.find((x) => x.day === day && x.meal === meal);
              if (!s || !s.active) return <span key={meal} className="cell ghost" aria-hidden />;
              const t = { week: plan.week_start, day, meal };
              const on = selected.has(tkey(t));
              return (
                <button key={meal} className={on ? "cell me on" : "cell me"} aria-pressed={on}
                  aria-label={`${d} ${MEALS[meal]}${s.taken.length ? `, déjà prévu : ${s.taken.join(" ; ")}` : ""}`}
                  onClick={() => onToggle(t)}>
                  <span>{on ? "✓ " : ""}{MEALS[meal]}</span>
                  {s.taken.length > 0 && <small className="taken">{s.taken[0]}</small>}
                </button>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dishes({ state, mutate, me }: { state: WeekState; mutate: Mutate; me: string }) {
  const [draft, setDraft] = useState<DraftIngredient[]>([]);
  const [targets, setTargets] = useState<Map<string, Target>>(new Map());
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<HTMLElement>(null);

  function toggleDraft(o: Option) {
    setDraft((d) => (d.some((x) => nameKey(x.name) === o.key)
      ? d.filter((x) => nameKey(x.name) !== o.key)
      : [...d, { name: o.name, qty_per_person: o.qty_per_person, unit: o.unit, source: o.source, category: o.category }]));
  }
  function toggleTarget(t: Target) {
    setTargets((m) => { const n = new Map(m); if (n.has(tkey(t))) n.delete(tkey(t)); else n.set(tkey(t), t); return n; });
  }
  function reuse(ingredients: DraftIngredient[]) {
    setDraft(ingredients.map((g) => ({ ...g })));
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function create() {
    if (!draft.length) return;
    setBusy(true);
    const ok = await mutate("dish.create", { ingredients: draft, targets: [...targets.values()] });
    setBusy(false);
    if (ok) { setDraft([]); setTargets(new Map()); }
  }

  const order = (d: Dish) => {
    const s = state.slots.find((x) => x.id === d.slot_id);
    return s ? s.day * 2 + (s.meal === "dinner" ? 1 : 0) : 99;
  };
  const dishes = [...state.dishes].sort((a, b) => order(a) - order(b));
  const n = targets.size;

  return (
    <div className="stack">
      <section className="panel composer" ref={composerRef}>
        <h2>Nouveau plat</h2>
        <h3 className="subhead">1. Cochez les ingrédients</h3>
        <IngredientPicker state={state} selected={new Set(draft.map((g) => nameKey(g.name)))} onToggle={toggleDraft} />
        <StapleAdder mutate={mutate} />

        <h3 className="subhead">Quantités pour une personne</h3>
        {draft.length === 0 ? (
          <p className="muted">Les ingrédients cochés apparaissent ici : ajustez la quantité pour une personne (ex. lentilles : 200 g).</p>
        ) : (
          <ul className="inglist">
            {draft.map((g, i) => (
              <li key={nameKey(g.name)}>
                <span className="ingname">{g.name}</span>
                <label className="perperson">
                  <input className="input qty" inputMode="decimal" placeholder="0" aria-label={`Quantité par personne de ${g.name}`}
                    value={showQty(g.qty_per_person)} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, qty_per_person: parseQty(e.target.value) } : x)))} />
                  <span>{g.unit || "u."}/pers.</span>
                </label>
                <button className="iconbtn small" aria-label={`Retirer ${g.name}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="subhead">2. Pour quels repas&nbsp;?</h3>
        <p className="muted">Touchez autant de repas que vous voulez, sur 3 semaines. Les quantités s'adaptent au nombre de personnes à chaque repas.</p>
        <MealPicker state={state} selected={targets} onToggle={toggleTarget} />

        <button className="btn btn-primary btn-block" onClick={create} disabled={busy || !draft.length}>
          {!draft.length ? "Ajoutez un ingrédient" : n ? `Créer le plat sur ${n} repas` : "Créer le plat (sans repas)"}
        </button>
      </section>

      {state.library.length > 0 && (
        <section className="panel">
          <h2>Plats déjà faits</h2>
          <p className="muted">Reprenez un plat : ses ingrédients sont recopiés ci-dessus, modifiables avant de le créer.</p>
          <ul className="library">
            {state.library.map((d) => (
              <li key={d.name_key}>
                <div>
                  <strong>{d.name}</strong>
                  <span className="muted small">
                    {d.ingredients.map((g) => (g.qty_per_person ? `${g.name} ${fmtAmount(g.qty_per_person, g.unit)}` : g.name)).join(" · ")} par pers.
                  </span>
                </div>
                <button className="btn btn-ghost small" onClick={() => reuse(d.ingredients)}>Reprendre</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="section-title">Plats de la semaine</h2>
      {dishes.length === 0 && <Empty>Aucun plat cette semaine. Composez-en un ci-dessus ou reprenez un plat déjà fait.</Empty>}
      {dishes.map((d) => <DishCard key={d.id} dish={d} state={state} mutate={mutate} me={me} />)}
    </div>
  );
}

function SlotSelect({ state, value, onChange }: { state: WeekState; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Repas">
      <option value="">Pas encore placé</option>
      {state.slots.filter((s) => s.active || s.id === value).map((s) => (
        <option key={s.id} value={s.id}>{DAYS[s.day]} {MEALS[s.meal].toLowerCase()}{!s.active ? " (plus prévu)" : ""}</option>
      ))}
    </select>
  );
}

/** Ligne d'ingrédient d'un plat : quantité/pers, total réel et « Je n'en mange pas ». */
export function IngredientLine({ state, dish, ing, me, mutate, editable }: {
  state: WeekState; dish: Dish; ing: DishIngredient; me: string; mutate: Mutate; editable: boolean;
}) {
  const item = state.items.find((i) => i.id === ing.item_id);
  if (!item) return null;
  const without = excludedFor(state, dish, ing.id);
  const mine = state.exclusions.some((e) => e.ingredient_id === ing.id && e.name_key === nameKey(me));
  const people = ingredientPeople(state, dish, ing.id);
  return (
    <li className="ingrow">
      <div className="ingrow-top">
        <span className="ingname">{item.name}{item.source === "placard" && <em> placard</em>}</span>
        <span className="ingrow-end">
          <b className="ingtotal">{ing.qty_per_person ? (people ? fmtAmount(ing.qty_per_person * people, item.unit) : "aucun") : "à doser"}</b>
          {editable && <button className="iconbtn small" aria-label={`Retirer ${item.name}`} onClick={() => mutate("ing.delete", { id: ing.id })}>×</button>}
        </span>
      </div>
      {without.length > 0 && <p className="sauf">Sauf {without.join(", ")}</p>}
      <div className="ingrow-actions">
        {editable && (
          <QtyInput key={ing.qty_per_person} value={ing.qty_per_person} unit={item.unit}
            onCommit={(v) => mutate("ing.set", { dish_id: dish.id, item_id: item.id, qty_per_person: v })} />
        )}
        <button className={mine ? "chip-toggle on" : "chip-toggle"} aria-pressed={mine}
          onClick={() => mutate("ing.exclude", { id: ing.id, excluded: !mine })}>
          {mine ? "✓ Je n'en mange pas" : "Je n'en mange pas"}
        </button>
      </div>
    </li>
  );
}

function DishCard({ dish, state, mutate, me }: { dish: Dish; state: WeekState; mutate: Mutate; me: string }) {
  const hc = headcount(state, dish.slot_id);
  const ings = state.ingredients.filter((i) => i.dish_id === dish.id);
  const [adding, setAdding] = useState(false);
  const keyOf = (i: DishIngredient) => nameKey(state.items.find((x) => x.id === i.item_id)?.name ?? "");
  const used = new Set(ings.map(keyOf));
  function toggle(o: Option) {
    const ing = ings.find((i) => keyOf(i) === o.key);
    if (ing) mutate("ing.delete", { id: ing.id });
    else mutate("ing.set", { dish_id: dish.id, name: o.name, unit: o.unit, source: o.source, category: o.category, qty_per_person: o.qty_per_person });
  }

  return (
    <article className="panel dish">
      <header className="dishhead">
        <h3>{dishTitle(state, dish)}</h3>
        <span className={hc.estimated ? "people-badge est" : "people-badge"} title={hc.estimated ? "Estimation : personne n'a encore coché ce repas" : "Convives"}>
          {hc.estimated ? "≈ " : ""}{hc.count} pers.
        </span>
      </header>

      <SlotSelect state={state} value={dish.slot_id} onChange={(v) => mutate("dish.update", { id: dish.id, slot_id: v })} />
      {state.slots.some((s) => s.id === dish.slot_id && !s.active) && (
        <p className="warn" role="status">Ce repas n'est plus prévu cette semaine : choisissez un autre créneau.</p>
      )}

      {ings.length === 0 ? <p className="muted">Aucun ingrédient.</p> : (
        <ul className="inglist">
          {ings.map((ing) => <IngredientLine key={ing.id} state={state} dish={dish} ing={ing} me={me} mutate={mutate} editable />)}
        </ul>
      )}

      {adding ? (
        <>
          <IngredientPicker state={state} selected={used} onToggle={toggle} />
          <button className="btn btn-ghost small" onClick={() => setAdding(false)}>Fermer</button>
        </>
      ) : (
        <button className="btn btn-ghost small" onClick={() => setAdding(true)}>+ Ajouter ou retirer des ingrédients</button>
      )}

      <button className="linkbtn danger" onClick={() => confirm("Supprimer ce plat ?") && mutate("dish.delete", { id: dish.id })}>Supprimer le plat</button>
    </article>
  );
}

function QtyInput({ value, unit, onCommit }: { value: number; unit: string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(showQty(value));
  function commit() {
    const n = parseQty(v);
    if (n !== value) onCommit(n);
  }
  return (
    <label className="perperson">
      <input className="input qty" inputMode="decimal" placeholder="0" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label="Quantité par personne" />
      <span>{unit || "u."}/pers.</span>
    </label>
  );
}
