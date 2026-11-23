"use client";
import { useMemo, useState } from "react";
import { neededByItem } from "@/lib/compute";
import { CATEGORIES, UNITS, fmtAmount, guessCategory, type Category, type Item, type Source, type WeekState } from "@/lib/types";
import type { Mutate } from "./App";
import { Empty } from "./ui";

/** Quantité affichée : celle saisie à la main, sinon celle calculée d'après les plats. */
function amountOf(item: Item, people: number, needed?: number) {
  if (item.quantity != null && item.quantity > 0) {
    return { main: fmtAmount(item.per_person ? item.quantity * people : item.quantity, item.unit), fromDishes: false };
  }
  return { main: needed ? fmtAmount(needed, item.unit) : "", fromDishes: !!needed };
}

export default function Shopping({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const needed = useMemo(() => neededByItem(state), [state]);
  const [open, setOpen] = useState<string | null>(null);
  const people = state.week.default_people;
  const courses = state.items.filter((i) => i.source === "courses");
  const placard = state.items.filter((i) => i.source === "placard");
  const left = courses.filter((i) => !i.checked).length;
  const checked = state.items.filter((i) => i.checked).length;
  const sortItems = (list: Item[]) => [...list].sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, "fr"));

  const row = (it: Item) => (
    <ItemRow key={it.id} item={it} people={people} needed={needed.get(it.id)}
      open={open === it.id} onToggleOpen={() => setOpen(open === it.id ? null : it.id)} mutate={mutate} />
  );

  return (
    <div className="stack">
      <AddItem state={state} mutate={mutate} />

      <section className="panel">
        <div className="row-between">
          <h2>Courses de la semaine</h2>
          <span className="count" aria-label={`${left} à acheter`}>{left}</span>
        </div>
        {courses.length === 0 ? <Empty>Rien à acheter pour l'instant. Les ingrédients des plats s'ajoutent ici tout seuls.</Empty> : (
          CATEGORIES.map((cat) => {
            const list = sortItems(courses.filter((i) => i.category === cat.id));
            if (list.length === 0) return null;
            return (
              <div key={cat.id} className="aisle">
                <h3 className="aisle-title"><span aria-hidden>{cat.icon}</span> {cat.label}</h3>
                <ul className="items">{list.map(row)}</ul>
              </div>
            );
          })
        )}
      </section>

      <section className="panel">
        <div className="row-between">
          <h2>Placard</h2>
          <span className="count">{placard.length}</span>
        </div>
        {placard.length === 0 ? <Empty>Pâtes, riz, épices, sauces… ce que vous avez déjà à la maison.</Empty> : (
          <ul className="items">{sortItems(placard).map(row)}</ul>
        )}
      </section>

      {checked > 0 && (
        <button className="btn btn-ghost btn-block" onClick={() => mutate("items.uncheckAll")}>Tout décocher ({checked})</button>
      )}

      <section className="panel">
        <h2>Ingrédients récents</h2>
        {state.recents.length === 0 ? (
          <Empty>Les ingrédients que vous ajoutez sont mémorisés ici pour les semaines suivantes.</Empty>
        ) : (
          <>
            <p className="muted">Un toucher pour les remettre dans la liste.</p>
            <ul className="chips">
              {state.recents.map((r) => (
                <li key={r.name_key}>
                  <button className="chip" onClick={() => mutate("recent.add", { name_key: r.name_key })}>
                    <span aria-hidden>+</span> {r.name}
                    {r.source === "placard" && <em>placard</em>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  return (
    <select className="input" aria-label="Rayon" value={value} onChange={(e) => onChange(e.target.value as Category)}>
      {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
    </select>
  );
}

function AddItem({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [perPerson, setPerPerson] = useState(false);
  const [source, setSource] = useState<Source>("courses");
  const [category, setCategory] = useState<Category | null>(null); // null = deviné d'après le nom
  const [busy, setBusy] = useState(false);
  const cat = category ?? guessCategory(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const ok = await mutate("item.add", { name, quantity: qty.replace(",", ".") || null, unit, per_person: perPerson, source, category: cat });
    setBusy(false);
    if (ok) { setName(""); setQty(""); setUnit(""); setPerPerson(false); setCategory(null); }
  }

  return (
    <form className="panel addform" onSubmit={submit}>
      <div className="segmented small" role="radiogroup" aria-label="Ajouter dans">
        <button type="button" role="radio" aria-checked={source === "courses"} className={source === "courses" ? "on" : ""} onClick={() => setSource("courses")}>Courses</button>
        <button type="button" role="radio" aria-checked={source === "placard"} className={source === "placard" ? "on" : ""} onClick={() => setSource("placard")}>Placard</button>
      </div>
      <label className="sr-only" htmlFor="add-name">Ingrédient</label>
      <input id="add-name" className="input" placeholder={source === "courses" ? "Ajouter : tomates, lait…" : "Ajouter : riz, curry…"} list="recent-names"
        value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
      <datalist id="recent-names">{state.recents.map((r) => <option key={r.name_key} value={r.name} />)}</datalist>
      {source === "courses" && name.trim() && <CategorySelect value={cat} onChange={setCategory} />}
      <div className="addrow">
        <input className="input qty" inputMode="decimal" placeholder="Qté" aria-label="Quantité" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="input unit" aria-label="Unité" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{u || "unité"}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={perPerson} onChange={(e) => setPerPerson(e.target.checked)} /> par pers.
        </label>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>Ajouter</button>
      </div>
    </form>
  );
}

function ItemRow({ item, people, needed, open, onToggleOpen, mutate }: {
  item: Item; people: number; needed?: number; open: boolean; onToggleOpen: () => void; mutate: Mutate;
}) {
  const { main, fromDishes } = amountOf(item, people, needed);
  return (
    <li className={item.checked ? "item done" : "item"}>
      <div className="itemline">
        <label className="tick">
          <input type="checkbox" checked={item.checked} onChange={(e) => mutate("item.update", { id: item.id, checked: e.target.checked })} />
          <span className="sr-only">Cocher {item.name}</span>
        </label>
        <button className="itemmain" onClick={onToggleOpen} aria-expanded={open}>
          <span className="itemname">{item.name}</span>
          {fromDishes && <span className="itemmeta">pour les plats</span>}
          {item.per_person && item.quantity != null && <span className="itemmeta">{fmtAmount(item.quantity, item.unit)} × {people} pers.</span>}
        </button>
        {main && <b className="itemqty">{main}</b>}
      </div>
      {open && <ItemEditor item={item} needed={needed} mutate={mutate} onClose={onToggleOpen} />}
    </li>
  );
}

function ItemEditor({ item, needed, mutate, onClose }: { item: Item; needed?: number; mutate: Mutate; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.quantity?.toString().replace(".", ",") ?? "");
  const [unit, setUnit] = useState(item.unit);
  const [perPerson, setPerPerson] = useState(item.per_person);
  const [category, setCategory] = useState<Category>(item.category);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await mutate("item.update", { id: item.id, name, quantity: qty.replace(",", ".") || null, unit, per_person: perPerson, category })) onClose();
  }

  return (
    <form className="editor" onSubmit={save}>
      <input className="input" aria-label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      {item.source === "courses" && <CategorySelect value={category} onChange={setCategory} />}
      <div className="addrow">
        <input className="input qty" inputMode="decimal" placeholder="Qté" aria-label="Quantité" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="input unit" aria-label="Unité" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {(UNITS.includes(unit) ? UNITS : [...UNITS, unit]).map((u) => <option key={u} value={u}>{u || "unité"}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={perPerson} onChange={(e) => setPerPerson(e.target.checked)} /> par pers.</label>
      </div>
      {needed ? (
        <p className="muted small">Laissez la quantité vide pour suivre automatiquement les plats ({fmtAmount(needed, item.unit)}).</p>
      ) : null}
      <div className="addrow">
        <button type="button" className="btn btn-danger" onClick={() => confirm(`Supprimer « ${item.name} » ? Il sera aussi retiré des plats.`) && mutate("item.delete", { id: item.id })}>Supprimer</button>
        <button type="button" className="btn btn-ghost" onClick={() => mutate("item.update", { id: item.id, source: item.source === "courses" ? "placard" : "courses" })}>
          {item.source === "courses" ? "Vers placard" : "Vers courses"}
        </button>
        <button className="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  );
}
