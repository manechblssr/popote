"use client";
import { useState } from "react";
import { headcount } from "@/lib/compute";
import { DAYS, MEALS, UNITS, fmtAmount, nameKey, type Dish, type WeekState } from "@/lib/types";
import type { Mutate } from "./App";
import { Empty } from "./ui";

function SlotSelect({ state, value, onChange, id }: { state: WeekState; value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const taken = new Map(state.dishes.filter((d) => d.slot_id).map((d) => [d.slot_id!, d.name]));
  return (
    <select id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Créneau">
      <option value="">Pas encore placé</option>
      {state.slots.filter((s) => s.active || s.id === value).map((s) => (
        <option key={s.id} value={s.id}>
          {DAYS[s.day]} {MEALS[s.meal].toLowerCase()}{taken.has(s.id) && s.id !== value ? ` (${taken.get(s.id)})` : ""}
        </option>
      ))}
    </select>
  );
}

export default function Dishes({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    if (await mutate("dish.add", { name, slot_id: slot })) { setName(""); setSlot(null); }
    setBusy(false);
  }

  const order = (d: Dish) => {
    const s = state.slots.find((x) => x.id === d.slot_id);
    return s ? s.day * 2 + (s.meal === "dinner" ? 1 : 0) : 99;
  };
  const dishes = [...state.dishes].sort((a, b) => order(a) - order(b));

  return (
    <div className="stack">
      <form className="panel addform" onSubmit={add}>
        <h2>Nouveau plat</h2>
        <input className="input" placeholder="Gratin dauphinois, curry de lentilles…" aria-label="Nom du plat"
          value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <SlotSelect state={state} value={slot} onChange={setSlot} />
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>Créer le plat</button>
      </form>

      {dishes.length === 0 && <Empty>Créez un premier plat, puis piochez ses ingrédients dans vos courses et votre placard.</Empty>}
      {dishes.map((d) => <DishCard key={d.id} dish={d} state={state} mutate={mutate} />)}
    </div>
  );
}

function DishCard({ dish, state, mutate }: { dish: Dish; state: WeekState; mutate: Mutate }) {
  const hc = headcount(state, dish.slot_id);
  const people = hc.count;
  const ings = state.ingredients.filter((i) => i.dish_id === dish.id);
  const [search, setSearch] = useState("");
  const [newUnit, setNewUnit] = useState("g");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(dish.name);

  const used = new Set(ings.map((i) => i.item_id));
  const q = nameKey(search);
  const candidates = state.items.filter((i) => !used.has(i.id) && (!q || nameKey(i.name).includes(q)));
  const exact = state.items.some((i) => nameKey(i.name) === q);

  async function addNew() {
    if (await mutate("ing.set", { dish_id: dish.id, name: search, unit: newUnit, source: "courses", qty_per_person: 0 })) setSearch("");
  }

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
        <span className={hc.estimated ? "people-badge est" : "people-badge"} title={hc.estimated ? "Estimation : personne n'a encore coché ce repas" : "Convives"}>{hc.estimated ? "≈ " : ""}{people} pers.</span>
      </header>

      <SlotSelect state={state} value={dish.slot_id} onChange={(v) => mutate("dish.update", { id: dish.id, slot_id: v })} />

      {ings.length > 0 && (
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

      <div className="picker">
        <input className="input" placeholder="Piocher un ingrédient…" aria-label={`Ajouter un ingrédient à ${dish.name}`}
          value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} />
        <ul className="chips">
          {candidates.slice(0, search ? 12 : 8).map((i) => (
            <li key={i.id}>
              <button className="chip" onClick={() => { mutate("ing.set", { dish_id: dish.id, item_id: i.id, qty_per_person: 0 }); setSearch(""); }}>
                <span aria-hidden>+</span> {i.name}{i.source === "placard" && <em>placard</em>}
              </button>
            </li>
          ))}
        </ul>
        {search.trim() && !exact && (
          <div className="addrow">
            <select className="input unit" aria-label="Unité" value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{u || "unité"}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={addNew}>Créer « {search.trim()} » dans les courses</button>
          </div>
        )}
      </div>

      <button className="linkbtn danger" onClick={() => confirm(`Supprimer le plat « ${dish.name} » ?`) && mutate("dish.delete", { id: dish.id })}>Supprimer le plat</button>
    </article>
  );
}

function QtyInput({ value, unit, onCommit }: { value: number; unit: string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value ? String(value).replace(".", ",") : "");
  function commit() {
    const n = Number(v.replace(",", ".") || 0);
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
  }
  return (
    <label className="perperson">
      <input className="input qty" inputMode="decimal" placeholder="0" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label="Quantité par personne" />
      <span>{unit || "u."}/pers.</span>
    </label>
  );
}
