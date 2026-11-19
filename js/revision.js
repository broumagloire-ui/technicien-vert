// Fiches de révision à répétition espacée (inspirée de l'algorithme SM-2), au jour près.
// Une fiche ratée revient le jour même ; une fiche sue revient de plus en plus tard.

export const NOUVELLES_PAR_JOUR = 10;

const deux = (n) => String(n).padStart(2, '0');

export function aujourdhui(d = new Date()) {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

export function ajouterJours(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  return aujourdhui(new Date(a, m - 1, j + n));
}

export const cleFiche = (idLecon, idFiche) => `${idLecon}/${idFiche}`;

// note : 0 = « Je ne savais pas », 1 = « Difficile », 2 = « Je savais »
export function noter(precedent, note, jour = aujourdhui()) {
  const f = { reps: 0, intervalle: 0, facilite: 2.5, erreurs: 0, ...(precedent || {}) };
  if (!f.premiere) f.premiere = jour;
  if (note === 0) {
    f.reps = 0;
    f.intervalle = 0;
    f.facilite = Math.max(1.3, f.facilite - 0.2);
    f.erreurs += 1;
    f.echeance = jour;
  } else if (note === 1) {
    f.intervalle = Math.max(1, Math.round(f.intervalle * 1.2));
    f.facilite = Math.max(1.3, f.facilite - 0.15);
    f.reps += 1;
    f.echeance = ajouterJours(jour, f.intervalle);
  } else {
    f.intervalle = f.reps === 0 ? 1 : f.reps === 1 ? 3 : Math.max(f.intervalle + 1, Math.round(f.intervalle * f.facilite));
    f.reps += 1;
    f.echeance = ajouterJours(jour, f.intervalle);
  }
  f.vue = jour;
  f.t = Date.now();
  return f;
}

// Les fiches d'une leçon sont débloquées quand la leçon est terminée.
export function fichesDebloquees(etat, lecons) {
  const r = [];
  for (const [idLecon, lecon] of Object.entries(lecons || {})) {
    if (!etat.lecons[idLecon]?.terminee) continue;
    for (const fiche of lecon.fiches || []) r.push({ cle: cleFiche(idLecon, fiche.id), idLecon, fiche });
  }
  return r;
}

// Séance du jour : d'abord les fiches à revoir, puis quelques nouvelles.
export function construireSession(etat, lecons, jour = aujourdhui()) {
  const dues = [];
  const nouvelles = [];
  for (const x of fichesDebloquees(etat, lecons)) {
    const st = etat.fiches[x.cle];
    if (!st) nouvelles.push({ ...x, etat: null });
    else if (st.echeance <= jour) dues.push({ ...x, etat: st });
  }
  dues.sort((a, b) => a.etat.echeance.localeCompare(b.etat.echeance));
  const introduites = Object.values(etat.fiches).filter((f) => f.premiere === jour).length;
  return [...dues, ...nouvelles.slice(0, Math.max(0, NOUVELLES_PAR_JOUR - introduites))];
}

export function prochaineRevision(etat, jour = aujourdhui()) {
  let p = null;
  for (const f of Object.values(etat.fiches)) {
    if (f.echeance > jour && (!p || f.echeance < p)) p = f.echeance;
  }
  return p;
}
