"use client";

// Écran de secours si un affichage plante : on propose de recharger plutôt qu'une page blanche
export default function ErrorScreen({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="gate">
      <div className="gate-brand" aria-hidden>Popote</div>
      <section className="gate-form" role="alert">
        <h1>Un souci d'affichage</h1>
        <p className="muted">Vos données sont en sécurité. Rechargez la page pour reprendre.</p>
        <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>Recharger</button>
        <button className="btn btn-ghost btn-block" onClick={reset}>Réessayer sans recharger</button>
      </section>
    </main>
  );
}
