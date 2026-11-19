// État de progression, partagé entre appareils : chaque appareil écrit son propre fichier,
// et la fusion garde toujours l'information la plus récente, sans conflit.
// Ce module ne dépend pas du navigateur : il sert aussi aux outils de Claude (Node).

export const SEUIL = 0.7; // part de bonnes réponses pour valider un quiz

const CLES = ['lecons', 'quiz', 'fiches', 'questions', 'activite'];

export function etatVide() {
  return { version: 1, lecons: {}, quiz: {}, fiches: {}, questions: {}, activite: {} };
}

function normaliser(e) {
  const r = etatVide();
  if (e && typeof e === 'object') {
    for (const k of CLES) if (e[k] && typeof e[k] === 'object') r[k] = e[k];
  }
  return r;
}

const cles = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])];

function plusRecent(x, y) {
  if (!x) return y;
  if (!y) return x;
  return (y.t || 0) > (x.t || 0) ? y : x;
}

export function fusionner(a, b) {
  const x = normaliser(a);
  const y = normaliser(b);
  const r = etatVide();
  for (const id of cles(x.lecons, y.lecons)) {
    const p = plusRecent(x.lecons[id], y.lecons[id]);
    r.lecons[id] = { ...p, terminee: !!(x.lecons[id]?.terminee || y.lecons[id]?.terminee) };
  }
  for (const id of cles(x.quiz, y.quiz)) {
    const p = x.quiz[id] || {};
    const q = y.quiz[id] || {};
    r.quiz[id] = { tentatives: { ...(p.tentatives || {}), ...(q.tentatives || {}) }, t: Math.max(p.t || 0, q.t || 0) };
  }
  for (const id of cles(x.fiches, y.fiches)) r.fiches[id] = plusRecent(x.fiches[id], y.fiches[id]);
  for (const id of cles(x.questions, y.questions)) r.questions[id] = plusRecent(x.questions[id], y.questions[id]);
  r.activite = { ...x.activite, ...y.activite };
  return r;
}

// Liste ordonnée des leçons publiées dans le catalogue.
export function listeLecons(catalogue) {
  const r = [];
  for (const bloc of catalogue?.blocs || []) {
    for (const module of bloc.modules || []) {
      for (const lecon of module.lecons || []) r.push({ bloc, module, lecon });
    }
  }
  return r;
}

export function tentatives(etat, idLecon) {
  return Object.entries(etat?.quiz?.[idLecon]?.tentatives || {})
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function meilleureTentative(etat, idLecon) {
  let meilleure = null;
  for (const t of tentatives(etat, idLecon)) {
    if (!meilleure || t.score / t.total > meilleure.score / meilleure.total) meilleure = t;
  }
  return meilleure;
}

export function quizValide(etat, idLecon) {
  const m = meilleureTentative(etat, idLecon);
  return !!m && m.total > 0 && m.score / m.total >= SEUIL;
}
