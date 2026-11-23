"use client";
import { useMemo, useState } from "react";
import { neededByItem } from "@/lib/compute";
import { UNITS, fmtAmount, type Item, type Source, type WeekState } from "@/lib/types";
import type { Mutate } from "./App";
import { Empty } from "./ui";

const SECTIONS: { id: Source; title: string; hint: string }[] = [
  { id: "courses", title: "Courses de la semaine", hint: "Ajoutez ce qu'il faut acheter." },
  { id: "placard", title: "Placard", hint: "Pâtes, riz, épices, sauces… ce que vous avez déjà." },
];

export default function Shopping({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const needed = useMemo(() => neededByItem(state), [state]);
  const [open, setOpen] = useState<string | null>(null);
  const checked = state.items.filter((i) => i.checked).length;

  return (
    <div className="stack">
      <AddItem state={state} mutate={mutate} />

      {SECTIONS.map((sec) => {
        const items = state.items.filter((i) => i.source === sec.id).sort((a, b) => Number(a.checked) - Number(b.checked));
        return (
          <section key={sec.id} className="panel">
            <div className="row-between">
              <h2>{sec.title}</h2>
              <span className="count">{items.filter((i) => !i.checked).length}</span>
            </div>
            {items.length === 0 ? <Empty>{sec.hint}</Empty> : (
              <ul className="items">
                {items.map((it) => (
                  <ItemRow key={it.id} item={it} people={state.week.default_people} needed={needed.get(it.id)}
                    open={open === it.id} onToggleOpen={() => setOpen(open === it.id ? null : it.id)} mutate={mutate} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

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

function AddItem({ state, mutate }: { state: WeekState; mutate: Mutate }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [perPerson, setPerPerson] = useState(false);
  const [source, setSource] = useState<Source>("courses");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const ok = await mutate("item.add", { name, quantity: qty.replace(",", ".") || null, unit, per_person: perPerson, source });
    setBusy(false);
    if (ok) { setName(""); setQty(""); setUnit(""); setPerPerson(false); }
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
  const total = item.quantity != null ? (item.per_person ? item.quantity * people : item.quantity) : null;
  const amount = fmtAmount(total, item.unit);
  return (
    <li className={item.checked ? "item done" : "item"}>
      <div className="itemline">
        <label className="tick">
          <input type="checkbox" checked={item.checked} onChange={(e) => mutate("item.update", { id: item.id, checked: e.target.checked })} />
          <span className="sr-only">Cocher {item.name}</span>
        </label>
        <button className="itemmain" onClick={onToggleOpen} aria-expanded={open}>
          <span className="itemname">{item.name}</span>
          <span className="itemmeta">
            {amount && <b>{amount}</b>}
            {item.per_person && item.quantity != null && <span> ({fmtAmount(item.quantity, item.unit)} × {people})</span>}
            {needed ? <span className="need">Plats : {fmtAmount(needed, item.unit)}</span> : null}
          </span>
        </button>
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await mutate("item.update", { id: item.id, name, quantity: qty.replace(",", ".") || null, unit, per_person: perPerson })) onClose();
  }

  return (
    <form className="editor" onSubmit={save}>
      <input className="input" aria-label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <div className="addrow">
        <input className="input qty" inputMode="decimal" placeholder="Qté" aria-label="Quantité" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="input unit" aria-label="Unité" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {(UNITS.includes(unit) ? UNITS : [...UNITS, unit]).map((u) => <option key={u} value={u}>{u || "unité"}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={perPerson} onChange={(e) => setPerPerson(e.target.checked)} /> par pers.</label>
      </div>
      {needed ? (
        <button type="button" className="linkbtn" onClick={() => { setQty(String(Math.round(needed * 100) / 100).replace(".", ",")); setPerPerson(false); }}>
          Reprendre la quantité des plats ({fmtAmount(needed, item.unit)})
        </button>
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
