"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { headcount } from "@/lib/compute";
import {
  DAYS, MEALS, UNITS, fmtAmount, guessCategory, nameKey,
  type Category, type Dish, type DraftIngredient, type Source, type WeekState,
} from "@/lib/types";
import type { Mutate } from "./App";
import { Empty } from "./ui";

type Known = Map<string, { name: string; unit: string; source: Source; category: Category }>;

/** Tous les ingrédients déjà connus (liste de la semaine, récents, plats déjà faits) pour l'autocomplétion. */
function useKnown(state: WeekState): Known {
  return useMemo(() => {
    const m: Known = new Map();
    const put = (x: { name: string; unit: string; source: Source; category: Category }) => { if (!m.has(nameKey(x.name))) m.set(nameKey(x.name), x); };
    state.items.forEach(put);
    state.recents.forEach(put);
    state.library.forEach((d) => d.ingredients.forEach(put));
    return m;
  }, [state]);
}

const parseQty = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : 0; };
const showQty = (n: number) => (n ? String(n).replace(".", ",") : "");

function SlotSelect({ state, value, onChange }: { state: WeekState; value: string | null; onChange: (v: string | null) => void }) {
  const taken = new Map(state.dishes.filter((d) => d.slot_id).map((d) => [d.slot_id!, d.name]));
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Repas">
      <option value="">Pas encore placé</option>
      {state.slots.filter((s) => s.active || s.id === value).map((s) => (
        <option key={s.id} value={s.id}>
          {DAYS[s.day]} {MEALS[s.meal].toLowerCase()}{!s.active ? " (plus prévu)" : taken.has(s.id) && s.id !== value ? ` (${taken.get(s.id)})` : ""}
        </option>
      ))}
    </select>
  );
}

/** Ligne « ajouter un ingrédient » : nom, quantité par personne, unité. */
function IngredientAdder({ known, onAdd, exclude }: { known: Known; onAdd: (g: DraftIngredient) => void | Promise<unknown>; exclude?: Set<string> }) {
  const listId = useId();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("g");
  const match = known.get(nameKey(name));
  useEffect(() => { if (match?.unit) setUnit(match.unit); }, [match?.unit]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    await onAdd({ name: match?.name ?? n, qty_per_person: parseQty(qty), unit, source: match?.source ?? "courses", category: match?.category ?? guessCategory(n) });
    setName(""); setQty("");
  }

  return (
    <form className="adder" onSubmit={add}>
      <input className="input" placeholder="Ingrédient : lentilles, oignon…" aria-label="Ingrédient" list={listId}
        value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
      <datalist id={listId}>
        {[...known.values()].filter((k) => !exclude?.has(nameKey(k.name))).map((k) => <option key={k.name} value={k.name} />)}
      </datalist>
      <div className="addrow">
        <label className="perperson">
          <input className="input qty" inputMode="decimal" placeholder="Qté" aria-label="Quantité par personne" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <select className="input unit" aria-label="Unité" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {(UNITS.includes(unit) ? UNITS : [...UNITS, unit]).map((u) => <option key={u} value={u}>{u || "unité"}</option>)}
        </select>
        <span className="muted small">par personne</span>
      </div>
      <button className="btn btn-ghost btn-block" disabled={!name.trim()}>+ Ajouter l'ingrédient</button>
    </form>
  );
}

export default function Dishes({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const known = useKnown(state);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftIngredient[]>([]);
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<HTMLElement>(null);
  const preview = headcount(state, slot);

  function addDraft(g: DraftIngredient) {
    setDraft((d) => [...d.filter((x) => nameKey(x.name) !== nameKey(g.name)), g]);
  }

  function reuse(libName: string, ingredients: DraftIngredient[]) {
    setName(libName);
    setDraft(ingredients.map((g) => ({ ...g })));
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await mutate("dish.create", { name, slot_id: slot, ingredients: draft });
    setBusy(false);
    if (ok) { setName(""); setSlot(null); setDraft([]); }
  }

  const order = (d: Dish) => {
    const s = state.slots.find((x) => x.id === d.slot_id);
    return s ? s.day * 2 + (s.meal === "dinner" ? 1 : 0) : 99;
  };
  const dishes = [...state.dishes].sort((a, b) => order(a) - order(b));

  return (
    <div className="stack">
      <section className="panel composer" ref={composerRef}>
        <h2>Nouveau plat</h2>
        <input className="input" placeholder="Nom du plat : dahl de lentilles…" aria-label="Nom du plat"
          value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />

        <h3 className="subhead">Ingrédients pour une personne</h3>
        {draft.length === 0 ? (
          <p className="muted">Ajoutez les ingrédients un par un, avec la quantité pour une personne (ex. lentilles : 200 g).</p>
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
                <b className="ingtotal">{g.qty_per_person ? fmtAmount(g.qty_per_person * preview.count, g.unit) : "—"}</b>
                <button className="iconbtn small" aria-label={`Retirer ${g.name}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <IngredientAdder known={known} onAdd={addDraft} exclude={new Set(draft.map((g) => nameKey(g.name)))} />

        <h3 className="subhead">Pour quel repas&nbsp;?</h3>
        <SlotSelect state={state} value={slot} onChange={setSlot} />
        {draft.length > 0 && (
          <p className="muted">Totaux calculés pour {preview.estimated ? "≈ " : ""}{preview.count} personne{preview.count > 1 ? "s" : ""}{slot ? "" : " (estimation)"}.</p>
        )}
        <button className="btn btn-primary btn-block" onClick={create} disabled={busy || !name.trim()}>
          {draft.length ? `Créer le plat (${draft.length} ingrédient${draft.length > 1 ? "s" : ""})` : "Créer le plat"}
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
                  <span className="muted small">{d.ingredients.length ? d.ingredients.map((g) => g.name).join(", ") : "sans ingrédient"}</span>
                </div>
                <button className="btn btn-ghost small" onClick={() => reuse(d.name, d.ingredients)}>Reprendre</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="section-title">Plats de la semaine</h2>
      {dishes.length === 0 && <Empty>Aucun plat pour l'instant. Composez-en un ci-dessus ou reprenez un plat déjà fait.</Empty>}
      {dishes.map((d) => <DishCard key={d.id} dish={d} state={state} mutate={mutate} known={known} />)}
    </div>
  );
}

function DishCard({ dish, state, mutate, known }: { dish: Dish; state: WeekState; mutate: Mutate; known: Known }) {
  const hc = headcount(state, dish.slot_id);
  const people = hc.count;
  const ings = state.ingredients.filter((i) => i.dish_id === dish.id);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(dish.name);
  const [adding, setAdding] = useState(false);
  const used = new Set(ings.map((i) => nameKey(state.items.find((x) => x.id === i.item_id)?.name ?? "")));

  return (
    <article className="panel dish">
      <header className="dishhead">
        {renaming ? (
          <form className="addrow" onSubmit={async (e) => { e.preventDefault(); if (await mutate("dish.update", { id: dish.id, name: title })) setRenaming(false); }}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nom du plat" maxLength={80} autoFocus />
            <button className="btn btn-primary">OK</button>
          </form>
        ) : (
          <h3><button className="linkbtn title" onClick={() => setRenaming(true)} aria-label={`Renommer ${dish.name}`}>{dish.name}</button></h3>
        )}
        <span className={hc.estimated ? "people-badge est" : "people-badge"} title={hc.estimated ? "Estimation : personne n'a encore coché ce repas" : "Convives"}>
          {hc.estimated ? "≈ " : ""}{people} pers.
        </span>
      </header>

      <SlotSelect state={state} value={dish.slot_id} onChange={(v) => mutate("dish.update", { id: dish.id, slot_id: v })} />
      {state.slots.some((s) => s.id === dish.slot_id && !s.active) && (
        <p className="warn" role="status">Ce repas n'est plus prévu cette semaine : choisissez un autre créneau.</p>
      )}

      {ings.length === 0 ? <p className="muted">Aucun ingrédient.</p> : (
        <ul className="inglist">
          {ings.map((ing) => {
            const item = state.items.find((i) => i.id === ing.item_id);
            if (!item) return null;
            return (
              <li key={ing.id}>
                <span className="ingname">{item.name}{item.source === "placard" && <em> placard</em>}</span>
                <QtyInput key={ing.qty_per_person} value={ing.qty_per_person} unit={item.unit}
                  onCommit={(v) => mutate("ing.set", { dish_id: dish.id, item_id: item.id, qty_per_person: v })} />
                <b className="ingtotal">{ing.qty_per_person ? fmtAmount(ing.qty_per_person * people, item.unit) : "—"}</b>
                <button className="iconbtn small" aria-label={`Retirer ${item.name}`} onClick={() => mutate("ing.delete", { id: ing.id })}>×</button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <IngredientAdder known={known} exclude={used}
          onAdd={(g) => mutate("ing.set", { dish_id: dish.id, name: g.name, unit: g.unit, source: g.source, category: g.category, qty_per_person: g.qty_per_person })} />
      ) : (
        <button className="btn btn-ghost small" onClick={() => setAdding(true)}>+ Ajouter un ingrédient</button>
      )}

      <button className="linkbtn danger" onClick={() => confirm(`Supprimer le plat « ${dish.name} » ?`) && mutate("dish.delete", { id: dish.id })}>Supprimer le plat</button>
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
