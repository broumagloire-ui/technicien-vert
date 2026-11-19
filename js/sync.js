// Synchronisation avec l'espace privé GitHub : c'est le « pont » entre l'appareil et Claude.
// Le téléphone y lit les leçons et les réponses de Claude, et y dépose sa progression.
import { fusionner, listeLecons } from './etat.js';

export class ErreurSynchro extends Error {
  constructor(code, statut = 0, detail = '') {
    super(code);
    this.code = code;
    this.statut = statut;
    this.detail = detail;
  }
}

const MESSAGES = {
  'jeton-vide': "Colle ta clé d'accès GitHub pour continuer.",
  'jeton-invalide':
    "Ta clé d'accès n'est pas reconnue par GitHub (elle est peut-être expirée). Crée une nouvelle clé et colle-la dans les réglages.",
  'depot-introuvable':
    'Ton dépôt privé est introuvable. Vérifie son nom, et que ta clé a bien accès à ce dépôt.',
  'acces-refuse':
    "GitHub refuse l'accès. Vérifie que ta clé a la permission « Contents : Read and write » sur ton dépôt privé.",
  limite: "GitHub demande de patienter un peu avant la prochaine synchronisation. Réessaie dans quelques minutes.",
  reseau: "Impossible de joindre GitHub pour l'instant. Vérifie ta connexion et réessaie.",
  'hors-ligne': 'Tu es hors ligne. Connecte-toi à internet pour cette étape.',
  'donnees-invalides': 'Un fichier de ton espace privé est abîmé. Signale-le à Claude lors de votre prochaine séance.',
};

export function messageErreur(e) {
  if (e instanceof ErreurSynchro) return MESSAGES[e.code] || `Erreur de synchronisation (code ${e.statut || e.code}).`;
  return 'Erreur inattendue : ' + (e && e.message ? e.message : String(e));
}

async function fetchSur(url, options = {}) {
  try {
    return await fetch(url, { cache: 'no-store', ...options });
  } catch {
    throw new ErreurSynchro(navigator.onLine === false ? 'hors-ligne' : 'reseau');
  }
}

function controler(rep) {
  if (rep.status === 401) throw new ErreurSynchro('jeton-invalide', 401);
  if (rep.status === 403 || rep.status === 429) {
    const limite = rep.status === 429 || rep.headers.get('x-ratelimit-remaining') === '0';
    throw new ErreurSynchro(limite ? 'limite' : 'acces-refuse', rep.status);
  }
  if (!rep.ok) throw new ErreurSynchro('http', rep.status);
}

function enTetes(jeton, extra = {}) {
  return { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', ...extra };
}

const encoderChemin = (c) => c.split('/').map(encodeURIComponent).join('/');

export function enBase64(texte) {
  const octets = new TextEncoder().encode(texte);
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  }
  return btoa(binaire);
}

export function deBase64(b64) {
  const binaire = atob(b64.replace(/\s/g, ''));
  const octets = Uint8Array.from(binaire, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(octets);
}

// Empreinte courte d'un texte, pour ne pas renvoyer une progression inchangée.
export function empreinte(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + texte.length;
}

export class SourceGitHub {
  constructor({ jeton, proprietaire, depot }) {
    if (!jeton || !proprietaire || !depot) throw new ErreurSynchro('jeton-vide');
    this.jeton = jeton;
    this.lectureSeule = false;
    this.base = `https://api.github.com/repos/${encodeURIComponent(proprietaire)}/${encodeURIComponent(depot)}/contents/`;
    this.shas = new Map();
  }

  requete(chemin, options = {}) {
    return fetchSur(this.base + encoderChemin(chemin), { ...options, headers: enTetes(this.jeton, options.headers) });
  }

  async lireJSON(chemin) {
    const rep = await this.requete(chemin);
    if (rep.status === 404) {
      this.shas.set(chemin, null);
      return null;
    }
    controler(rep);
    const info = await rep.json();
    if (Array.isArray(info)) throw new ErreurSynchro('donnees-invalides', 0, chemin);
    this.shas.set(chemin, info.sha);
    let texte;
    if (info.encoding === 'base64' && info.content) {
      texte = deBase64(info.content);
    } else {
      const brut = await this.requete(chemin, { headers: { Accept: 'application/vnd.github.raw+json' } });
      controler(brut);
      texte = await brut.text();
    }
    try {
      return JSON.parse(texte);
    } catch {
      throw new ErreurSynchro('donnees-invalides', 0, chemin);
    }
  }

  async listerDossier(chemin) {
    const rep = await this.requete(chemin);
    if (rep.status === 404) return [];
    controler(rep);
    const liste = await rep.json();
    return Array.isArray(liste) ? liste.filter((f) => f.type === 'file').map((f) => ({ nom: f.name, chemin: f.path })) : [];
  }

  async ecrireJSON(chemin, objet, message) {
    const corps = { message, content: enBase64(JSON.stringify(objet, null, 1) + '\n') };
    if (!this.shas.has(chemin)) await this.chargerSha(chemin);
    const sha = this.shas.get(chemin);
    if (sha) corps.sha = sha;
    let rep = await this.envoyer(chemin, corps);
    if (rep.status === 409 || rep.status === 422) {
      // Le fichier a changé entre-temps : on relit sa version et on réessaie une fois.
      await this.chargerSha(chemin);
      const s = this.shas.get(chemin);
      if (s) corps.sha = s;
      else delete corps.sha;
      rep = await this.envoyer(chemin, corps);
    }
    controler(rep);
    const res = await rep.json();
    this.shas.set(chemin, res.content ? res.content.sha : null);
  }

  envoyer(chemin, corps) {
    return this.requete(chemin, { method: 'PUT', body: JSON.stringify(corps), headers: { 'Content-Type': 'application/json' } });
  }

  async chargerSha(chemin) {
    const rep = await this.requete(chemin);
    if (rep.status === 404) {
      this.shas.set(chemin, null);
      return;
    }
    controler(rep);
    const info = await rep.json();
    this.shas.set(chemin, info.sha || null);
  }
}

// Source de test sur le PC : lit le dossier « donnees » local, n'écrit rien.
export class SourceLocale {
  constructor(base) {
    this.base = base;
    this.lectureSeule = true;
  }

  async lireJSON(chemin) {
    const rep = await fetchSur(this.base + chemin);
    if (rep.status === 404) return null;
    if (!rep.ok) throw new ErreurSynchro('http', rep.status);
    try {
      return await rep.json();
    } catch {
      throw new ErreurSynchro('donnees-invalides', 0, chemin);
    }
  }

  async listerDossier() {
    return [];
  }

  async ecrireJSON() {
    /* lecture seule */
  }
}

// Vérifie la clé et trouve le propriétaire du dépôt.
export async function verifierConnexion({ jeton, depot, proprietaire }) {
  if (!jeton) throw new ErreurSynchro('jeton-vide');
  if (navigator.onLine === false) throw new ErreurSynchro('hors-ligne');
  let proprio = proprietaire;
  if (!proprio) {
    const rep = await fetchSur('https://api.github.com/user', { headers: enTetes(jeton) });
    controler(rep);
    proprio = (await rep.json()).login;
  }
  const rep = await fetchSur(
    `https://api.github.com/repos/${encodeURIComponent(proprio)}/${encodeURIComponent(depot)}`,
    { headers: enTetes(jeton) },
  );
  if (rep.status === 404) throw new ErreurSynchro('depot-introuvable', 404);
  controler(rep);
  const info = await rep.json();
  return { proprietaire: proprio, prive: !!info.private };
}

// Une synchronisation complète : leçons, réponses de Claude, progression des autres appareils, envoi.
export async function synchroniser(source, { etat, lecons, appareil, dernierEnvoi }) {
  const catalogue = await source.lireJSON('catalogue.json');
  const nouvelles = { ...lecons };
  const misesAJour = [];
  for (const { lecon } of listeLecons(catalogue)) {
    const actuelle = nouvelles[lecon.id];
    if (!actuelle || (actuelle.version || 0) < (lecon.version || 0)) {
      const contenu = await source.lireJSON(lecon.fichier || `lecons/${lecon.id}.json`);
      if (contenu) {
        nouvelles[lecon.id] = contenu;
        misesAJour.push(lecon.id);
      }
    }
  }

  const reponses = (await source.lireJSON('reponses.json')) || {};

  let fusion = etat;
  for (const f of await source.listerDossier('progression')) {
    if (!f.nom.endsWith('.json')) continue;
    const donnees = await source.lireJSON(f.chemin);
    if (donnees && donnees.etat) fusion = fusionner(fusion, donnees.etat);
  }

  let envoi = dernierEnvoi;
  if (!source.lectureSeule) {
    const e = empreinte(JSON.stringify(fusion));
    if (e !== dernierEnvoi) {
      await source.ecrireJSON(
        `progression/${appareil.id}.json`,
        { appareil: appareil.nom, id: appareil.id, maj: new Date().toISOString(), version: 1, etat: fusion },
        `Progression envoyée depuis ${appareil.nom}`,
      );
      envoi = e;
    }
  }

  return { catalogue, lecons: nouvelles, misesAJour, reponses, etat: fusion, envoi };
}
