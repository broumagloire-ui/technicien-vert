// Technicien Vert — interface de l'application
import { lire, ecrire, toutEffacer, demanderPersistance } from './stockage.js';
import { SourceGitHub, SourceLocale, synchroniser, verifierConnexion, messageErreur } from './sync.js';
import { etatVide, fusionner, meilleureTentative, quizValide, SEUIL, listeLecons } from './etat.js';
import { aujourdhui, ajouterJours, noter, construireSession, fichesDebloquees, prochaineRevision } from './revision.js';

const VERSION_APP = '1.0.2';
const DEPOT_PAR_DEFAUT = 'technicien-vert-donnees';
const zone = document.getElementById('vue');

const app = {
  config: {},
  etat: etatVide(),
  catalogue: null,
  lecons: {},
  reponses: {},
  synchro: { statut: 'inactif', derniere: null, erreur: null },
  session: null, // séance de fiches en cours
  quiz: null, // quiz en cours { id, index, reponses }
  section: null, // partie de leçon affichée { id, i }
  installation: null, // invitation d'installation du navigateur
};

// ---------- Utilitaires ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const brut = (s) => String(s ?? '').replace(/\*\*/g, '');
const pl = (n, mot, motPluriel = mot + 's') => `${n} ${n > 1 ? motPluriel : mot}`;
const MOIS_COURTS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function pref(cle, defaut = null) {
  try {
    const v = localStorage.getItem('tv-' + cle);
    return v === null ? defaut : v;
  } catch {
    return defaut;
  }
}
function definirPref(cle, valeur) {
  try {
    localStorage.setItem('tv-' + cle, valeur);
  } catch {
    /* stockage plein ou bloqué */
  }
}
function idAleatoire() {
  const brutId = self.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  return brutId.replace(/-/g, '').slice(0, 12);
}
const estLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function nomAppareilParDefaut() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Windows/i.test(ua)) return 'PC Windows';
  return 'Appareil';
}

const trait = (d, t = 20) =>
  `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const plein = (d, t = 20) => `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="currentColor" aria-hidden="true">${d}</svg>`;
const I = {
  gauche: trait('<path d="M15 18l-6-6 6-6"/>'),
  droite: trait('<path d="M9 18l6-6-6-6"/>'),
  coche: trait('<path d="M20 6 9 17l-5-5"/>'),
  croix: trait('<path d="M18 6 6 18M6 6l12 12"/>'),
  jouer: plein('<path d="M8 5v14l11-7z"/>'),
  pause: plein('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'),
  stop: plein('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  livre: trait('<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>', 18),
  horloge: trait('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 18),
  cercle: trait('<circle cx="12" cy="12" r="7"/>', 18),
  cocheP: trait('<path d="M20 6 9 17l-5-5"/>', 18),
  cartes: trait('<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>'),
  bulle: trait('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  synchro: trait('<path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5"/>'),
  telecharger: trait('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
};

function toast(message, type = 'info') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => t.remove(), 300);
  }, 4500);
}

function vide(message, actions = '') {
  return `<div class="vide"><p>${esc(message)}</p>${actions}</div>`;
}

function dateLisible(jour) {
  const auj = aujourdhui();
  if (jour === auj) return "aujourd'hui";
  if (jour === ajouterJours(auj, 1)) return 'demain';
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function dateCourte(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function ilYa(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${pl(Math.round(h / 24), 'jour')}`;
}
function paragraphes(texte) {
  return String(texte || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${fmt(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ---------- Configuration et source des données ----------
function chargerConfig() {
  let c = {};
  try {
    c = JSON.parse(localStorage.getItem('tv-config') || '{}') || {};
  } catch {
    c = {};
  }
  if (!c.appareilId) c.appareilId = idAleatoire();
  if (!c.appareilNom) c.appareilNom = nomAppareilParDefaut();
  app.config = c;
  sauverConfig();
}
function sauverConfig() {
  try {
    localStorage.setItem('tv-config', JSON.stringify(app.config));
  } catch {
    /* stockage bloqué */
  }
}
function source() {
  if (app.config.jeton && app.config.proprietaire) return new SourceGitHub(app.config);
  if (estLocal()) return new SourceLocale(new URL('../donnees/', location.href).href);
  return null;
}

// ---------- Sauvegarde et synchronisation ----------
let minuteurSynchro = null;
let synchroEnCours = null;

function marquerActivite() {
  app.etat.activite[aujourdhui()] = Date.now();
}
async function sauver() {
  await ecrire('etat', app.etat);
  clearTimeout(minuteurSynchro);
  minuteurSynchro = setTimeout(() => lancerSynchro({ silencieux: true }), 5000);
}

const VUES_PASSIVES = new Set(['accueil', 'lecons', 'questions', 'reglages']);

function lancerSynchro({ silencieux = false } = {}) {
  const src = source();
  if (!src) return Promise.resolve();
  if (navigator.onLine === false) {
    majIndicateur();
    if (!silencieux) toast('Hors ligne : tout est gardé sur cet appareil. La synchronisation se fera au retour du réseau.');
    return Promise.resolve();
  }
  if (synchroEnCours) return synchroEnCours;
  app.synchro.statut = 'encours';
  majIndicateur();
  synchroEnCours = (async () => {
    const avantLecons = new Set(Object.keys(app.lecons));
    const avantReponses = new Set(Object.keys(app.reponses));
    try {
      const res = await synchroniser(src, {
        etat: app.etat,
        lecons: app.lecons,
        appareil: { id: app.config.appareilId, nom: app.config.appareilNom },
        dernierEnvoi: await lire('dernierEnvoi', null),
      });
      if (res.catalogue) {
        app.catalogue = res.catalogue;
        await ecrire('catalogue', app.catalogue);
      }
      app.lecons = res.lecons;
      for (const id of res.misesAJour) await ecrire('lecon:' + id, app.lecons[id]);
      app.reponses = res.reponses;
      await ecrire('reponses', app.reponses);
      // Fusion avec ce qui a pu changer pendant la synchronisation.
      app.etat = fusionner(app.etat, res.etat);
      await ecrire('etat', app.etat);
      if (res.envoi) await ecrire('dernierEnvoi', res.envoi);
      app.synchro.derniere = Date.now();
      await ecrire('derniereSynchro', app.synchro.derniere);
      app.synchro.statut = 'ok';
      app.synchro.erreur = null;

      const nouvellesLecons = res.misesAJour.filter((id) => !avantLecons.has(id)).length;
      const nouvellesReponses = Object.keys(app.reponses).filter((id) => !avantReponses.has(id) && app.etat.questions[id]).length;
      const messages = [];
      if (nouvellesLecons) messages.push(`${pl(nouvellesLecons, 'nouvelle leçon', 'nouvelles leçons')} disponible${nouvellesLecons > 1 ? 's' : ''}`);
      if (nouvellesReponses) messages.push(`Claude a répondu à ${pl(nouvellesReponses, 'question')}`);
      if (messages.length) toast(messages.join(' · ') + ' !');
      else if (!silencieux) toast('Synchronisation réussie : tout est à jour.');
      if (VUES_PASSIVES.has(route().nom)) afficher({ garderDefilement: true });
    } catch (e) {
      app.synchro.statut = 'erreur';
      app.synchro.erreur = messageErreur(e);
      if (!silencieux) toast(app.synchro.erreur, 'erreur');
      if (route().nom === 'reglages') afficher({ garderDefilement: true });
    } finally {
      synchroEnCours = null;
      majIndicateur();
      majBadges();
    }
  })();
  return synchroEnCours;
}

function texteSynchro() {
  if (!app.config.jeton) return estLocal() ? 'Mode test sur ce PC : la progression reste sur cet appareil.' : '';
  if (navigator.onLine === false) return 'Hors ligne : tout est enregistré sur cet appareil. La synchronisation se fera au retour du réseau.';
  if (!app.synchro.derniere) return 'Pas encore synchronisé.';
  return `Dernière synchronisation ${ilYa(app.synchro.derniere)}.`;
}

function majIndicateur() {
  const el = document.getElementById('etat-synchro');
  if (!el) return;
  let classe = 'ok';
  let texte = 'À jour';
  if (!source()) {
    el.hidden = true;
    return;
  }
  if (!app.config.jeton) {
    classe = 'test';
    texte = 'Mode test';
  } else if (navigator.onLine === false) {
    classe = 'horsligne';
    texte = 'Hors ligne';
  } else if (app.synchro.statut === 'encours') {
    classe = 'encours';
    texte = 'Synchro…';
  } else if (app.synchro.statut === 'erreur') {
    classe = 'erreur';
    texte = 'À vérifier';
  } else if (!app.synchro.derniere) {
    classe = 'horsligne';
    texte = 'Synchroniser';
  }
  el.hidden = false;
  el.className = 'synchro ' + classe;
  el.querySelector('.texte').textContent = texte;
}

function reponsesNonVues() {
  return Object.entries(app.etat.questions).filter(([id, q]) => app.reponses[id] && !q.reponseVue);
}
function majBadges() {
  const regler = (id, n) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  };
  regler('badge-fiches', source() ? construireSession(app.etat, app.lecons).length : 0);
  regler('badge-questions', reponsesNonVues().length);
}

// ---------- Lecture audio (voix du téléphone, marche hors ligne si la voix est installée) ----------
const audio = {
  morceaux: [],
  index: 0,
  actif: false,
  enPause: false,
  disponible: 'speechSynthesis' in self,
  voixDispo() {
    if (!this.disponible) return [];
    return speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang));
  },
  voix() {
    const toutes = this.voixDispo();
    const nom = pref('voix');
    return (
      toutes.find((v) => v.name === nom) ||
      toutes.find((v) => /fr[-_]FR/i.test(v.lang) && v.localService) ||
      toutes.find((v) => v.localService) ||
      toutes[0] ||
      null
    );
  },
  lire(texte) {
    if (!this.disponible) return;
    this.arreter();
    this.morceaux = decouper(texte);
    this.index = 0;
    this.actif = true;
    this.enPause = false;
    this.suivant();
    majAudio();
  },
  suivant() {
    if (!this.actif || this.enPause) return;
    if (this.index >= this.morceaux.length) {
      this.actif = false;
      majAudio();
      return;
    }
    const u = new SpeechSynthesisUtterance(this.morceaux[this.index]);
    u.lang = 'fr-FR';
    const v = this.voix();
    if (v) u.voice = v;
    u.rate = Number(pref('vitesse', '1')) || 1;
    u.onend = () => {
      if (!this.actif || this.enPause) return;
      this.index += 1;
      this.suivant();
    };
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.actif = false;
      majAudio();
      toast("La lecture audio n'a pas fonctionné. Vérifie la voix dans les réglages.", 'erreur');
    };
    speechSynthesis.speak(u);
  },
  pause() {
    this.enPause = true;
    speechSynthesis.cancel();
    majAudio();
  },
  reprendre() {
    this.enPause = false;
    this.suivant();
    majAudio();
  },
  arreter() {
    const etaitActif = this.actif;
    this.actif = false;
    this.enPause = false;
    if (this.disponible && etaitActif) speechSynthesis.cancel();
    majAudio();
  },
};

// Les longs textes sont lus par petits morceaux (plus fiable sur Android).
function decouper(texte) {
  const phrases = texte.split(/(?<=[.!?;:])\s+/);
  const morceaux = [];
  let courant = '';
  for (const p of phrases) {
    if ((courant + ' ' + p).length > 220 && courant) {
      morceaux.push(courant);
      courant = p;
    } else {
      courant = courant ? courant + ' ' + p : p;
    }
  }
  if (courant) morceaux.push(courant);
  return morceaux;
}

function majAudio() {
  const b = document.getElementById('bouton-audio');
  if (!b) return;
  const enLecture = audio.actif && !audio.enPause;
  b.innerHTML = enLecture ? `${I.pause} Pause` : audio.actif ? `${I.jouer} Reprendre` : `${I.jouer} Écouter cette partie`;
  b.setAttribute('aria-pressed', String(enLecture));
  const s = document.getElementById('bouton-stop');
  if (s) s.hidden = !audio.actif;
}

function texteSection(s) {
  const morceaux = [s.titre + '.'];
  for (const b of s.blocs) {
    if (b.type === 'p') morceaux.push(brut(b.texte));
    else if (b.type === 'liste') b.items.forEach((t) => morceaux.push(brut(t)));
    else if (b.type === 'etapes') b.items.forEach((t, i) => morceaux.push(`Étape ${i + 1}. ${brut(t)}`));
    else if (b.type === 'encadre') morceaux.push(`${brut(b.titre)}. ${brut(b.texte)}`);
    else if (b.type === 'definitions') b.items.forEach((d) => morceaux.push(`${brut(d.terme)} : ${brut(d.def)}.`));
    else if (b.type === 'tableau') b.lignes.forEach((l) => morceaux.push(l.map(brut).join(', ') + '.'));
    else if (b.type === 'calendrier') {
      morceaux.push(brut(b.titre) + '.');
      b.zones.forEach((z) =>
        morceaux.push(`${brut(z.nom)} : pluies ${z.pluies.map(([a, f]) => `de ${MOIS_LONGS[a - 1]} à ${MOIS_LONGS[f - 1]}`).join(', puis ')}.`),
      );
    }
  }
  return morceaux.join(' ').replace(/·/g, ',').replace(/\s+/g, ' ');
}

// ---------- Rendu des blocs de leçon ----------
function rendreBloc(b) {
  switch (b.type) {
    case 'p':
      return `<p>${fmt(b.texte)}</p>`;
    case 'liste':
      return `<ul>${b.items.map((t) => `<li>${fmt(t)}</li>`).join('')}</ul>`;
    case 'etapes':
      return `<ol class="etapes">${b.items.map((t) => `<li>${fmt(t)}</li>`).join('')}</ol>`;
    case 'encadre':
      return `<aside class="encadre ${esc(b.variante || '')}"><strong>${fmt(b.titre)}</strong><p>${fmt(b.texte)}</p></aside>`;
    case 'definitions':
      return `<dl class="definitions">${b.items.map((d) => `<div><dt>${fmt(d.terme)}</dt><dd>${fmt(d.def)}</dd></div>`).join('')}</dl>`;
    case 'tableau':
      return `<div class="tableau-defile"><table><thead><tr>${b.entetes.map((e) => `<th>${fmt(e)}</th>`).join('')}</tr></thead><tbody>${b.lignes
        .map((l) => `<tr>${l.map((c) => `<td>${fmt(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
    case 'calendrier':
      return rendreCalendrier(b);
    default:
      return '';
  }
}

function rendreCalendrier(b) {
  const cases = Array.from({ length: 12 }, (_, i) => `<span class="cal-case" style="grid-column:${i + 1}"></span>`).join('');
  const zones = b.zones
    .map((z) => {
      const description = z.pluies.map(([a, f]) => `pluies de ${MOIS_LONGS[a - 1]} à ${MOIS_LONGS[f - 1]}`).join(', puis ');
      const pluies = z.pluies.map(([a, f]) => `<span class="cal-pluie" style="grid-column:${a} / ${f + 1}"></span>`).join('');
      return `<div class="cal-zone"><b>${fmt(z.nom)}</b>${z.exemples ? `<small>${fmt(z.exemples)}</small>` : ''}<div class="cal-piste" role="img" aria-label="${esc(description)}">${cases}${pluies}</div></div>`;
    })
    .join('');
  return `<figure class="calendrier"><figcaption><strong>${fmt(b.titre)}</strong>${b.note ? `<span>${fmt(b.note)}</span>` : ''}</figcaption>
    <div class="cal-mois" aria-hidden="true">${MOIS_COURTS.map((m) => `<span>${m}</span>`).join('')}</div>${zones}
    <div class="cal-legende"><span><i></i>saison des pluies</span><span><i class="sec"></i>saison sèche</span></div></figure>`;
}

// ---------- Navigation ----------
function route() {
  const morceaux = location.hash.replace(/^#\/?/, '').split('/').map((m) => decodeURIComponent(m));
  return { nom: morceaux[0] || 'accueil', params: morceaux.slice(1) };
}
function ongletDe(nom) {
  if (['lecons', 'lecon', 'quiz', 'resultat'].includes(nom)) return 'lecons';
  if (['fiches', 'questions'].includes(nom)) return nom;
  if (nom === 'accueil') return 'accueil';
  return '';
}

function afficher({ garderDefilement = false } = {}) {
  audio.arreter();
  const { nom, params } = route();
  app.section = null;
  let html;
  if (!source() && nom !== 'reglages') html = vueBienvenue();
  else {
    switch (nom) {
      case 'lecons': html = vueLecons(); break;
      case 'lecon': html = vueLecture(params[0], params[1]); break;
      case 'quiz': html = vueQuiz(params[0]); break;
      case 'resultat': html = vueResultat(params[0], params[1]); break;
      case 'fiches': html = vueFiches(); break;
      case 'questions': html = vueQuestions(); break;
      case 'reglages': html = vueReglages(); break;
      case 'bienvenue': html = vueBienvenue(); break;
      default: html = vueAccueil();
    }
  }
  zone.innerHTML = html;
  const onglet = source() ? ongletDe(nom) : '';
  document.querySelectorAll('[data-onglet]').forEach((a) => {
    const actif = a.dataset.onglet === onglet;
    a.classList.toggle('actif', actif);
    if (actif) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const concentration = nom === 'quiz' || (nom === 'fiches' && app.session && app.session.index < app.session.file.length);
  document.body.classList.toggle('sans-onglets', !source() || nom === 'bienvenue' || concentration);
  if (!garderDefilement) window.scrollTo(0, 0);
  apresAffichage(nom);
  majBadges();
  majIndicateur();
}

function apresAffichage(nom) {
  if (nom === 'questions') {
    let change = false;
    for (const [id, q] of Object.entries(app.etat.questions)) {
      if (app.reponses[id] && !q.reponseVue) {
        app.etat.questions[id] = { ...q, reponseVue: true, t: Date.now() };
        change = true;
      }
    }
    if (change) sauver();
  }
}

// ---------- Accueil ----------
function salutation() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour !';
  if (h < 18) return 'Bon après-midi !';
  return 'Bonsoir !';
}

function prochaineEtape() {
  const liste = listeLecons(app.catalogue).filter((x) => app.lecons[x.lecon.id]);
  if (!liste.length) return { type: 'vide' };
  for (const x of liste) {
    const st = app.etat.lecons[x.lecon.id];
    if (!st || !st.terminee) return { type: 'lire', item: x, position: st ? st.position || 0 : 0 };
  }
  for (const x of liste) if (!quizValide(app.etat, x.lecon.id)) return { type: 'quiz', item: x };
  return { type: 'fin' };
}

function serieJours() {
  let n = 0;
  let jour = aujourdhui();
  if (!app.etat.activite[jour]) jour = ajouterJours(jour, -1);
  while (app.etat.activite[jour]) {
    n += 1;
    jour = ajouterJours(jour, -1);
  }
  return n;
}

function carteEtape(e) {
  if (e.type === 'vide') {
    return `<div class="carte carte-etape"><p class="surtitre">Pour commencer</p><p class="titre">Aucune leçon sur cet appareil</p>
      <p class="aide">Connecte-toi à internet, puis synchronise pour récupérer tes leçons.</p>
      <button class="bouton primaire large" data-action="synchroniser">${I.synchro} Synchroniser</button></div>`;
  }
  if (e.type === 'fin') {
    return `<div class="carte carte-etape"><p class="surtitre">Bravo</p><p class="titre">Tu as terminé toutes les leçons disponibles</p>
      <p class="aide">La suite arrivera après ta prochaine séance avec Claude. En attendant, entraîne-toi sur tes fiches.</p></div>`;
  }
  const { lecon: meta, module } = e.item;
  const lec = app.lecons[meta.id];
  if (e.type === 'quiz') {
    return `<div class="carte carte-etape"><p class="surtitre">Prochaine étape · ${esc(module.id)}</p><p class="titre">Quiz : ${esc(lec.titre)}</p>
      <p class="aide">${pl(lec.quiz.length, 'question')}. Tu verras ta note, puis la correction expliquée.</p>
      <a class="bouton primaire large" href="#/quiz/${esc(lec.id)}">Faire le quiz</a></div>`;
  }
  const n = lec.sections.length;
  const pos = Math.min(e.position, n - 1);
  const commence = pos > 0;
  const pct = commence ? Math.round(((pos + 1) / n) * 100) : 0;
  return `<div class="carte carte-etape"><p class="surtitre">${commence ? 'Leçon en cours' : 'Prochaine leçon'} · ${esc(module.id)}</p>
    <p class="titre">${esc(lec.titre)}</p>
    <div class="progression"><div class="barre"><span style="width:${pct}%"></span></div><span class="etiquette">${commence ? `Partie ${pos + 1}/${n}` : `${lec.duree || 30} min`}</span></div>
    <a class="bouton primaire large" href="#/lecon/${esc(lec.id)}">${commence ? 'Continuer la leçon' : 'Commencer la leçon'}</a></div>`;
}

function carteInstallation() {
  if (!app.installation) return '';
  return `<div class="carte ligne-action"><span class="icone-ronde">${I.telecharger}</span><span class="texte-action"><strong>Installer l'application</strong><small>Une icône sur ton écran d'accueil, utilisable sans internet</small></span><button class="bouton primaire petit" data-action="installer">Installer</button></div>`;
}

function vueAccueil() {
  const etape = prochaineEtape();
  const aReviser = construireSession(app.etat, app.lecons).length;
  const nonVues = reponsesNonVues().length;
  const toutes = listeLecons(app.catalogue);
  const dispo = toutes.filter((x) => app.lecons[x.lecon.id]);
  const lues = dispo.filter((x) => app.etat.lecons[x.lecon.id]?.terminee).length;
  const valides = dispo.filter((x) => quizValide(app.etat, x.lecon.id)).length;
  const etudiees = Object.keys(app.etat.fiches).length;
  const serie = serieJours();
  let phrase = 'Prêt pour une séance d’étude ?';
  if (aReviser) phrase = 'Commence par tes révisions, puis avance dans ta leçon.';
  else if (etape.type === 'lire' && etape.position > 0) phrase = 'On reprend là où tu t’étais arrêté.';
  return `
    <section class="salut"><h1>${salutation()}</h1><p>${phrase}</p></section>
    ${carteInstallation()}
    ${carteEtape(etape)}
    <a class="carte ligne-action" href="#/fiches"><span class="icone-ronde">${I.cartes}</span>
      <span class="texte-action"><strong>Révisions</strong><small>${aReviser ? `${pl(aReviser, 'fiche')} à revoir aujourd'hui` : "Rien à revoir aujourd'hui"}</small></span>${I.droite}</a>
    ${
      nonVues
        ? `<a class="carte ligne-action nouveaute" href="#/questions"><span class="icone-ronde">${I.bulle}</span>
      <span class="texte-action"><strong>Claude a répondu à ${pl(nonVues, 'question')}</strong><small>Touche pour lire ${nonVues > 1 ? 'les réponses' : 'la réponse'}</small></span>${I.droite}</a>`
        : ''
    }
    <section class="carte"><h2>Ta progression</h2><div class="stats">
      <div class="stat"><b>${lues}/${toutes.length}</b><span>leçons lues</span></div>
      <div class="stat"><b>${valides}</b><span>${valides > 1 ? 'quiz validés' : 'quiz validé'}</span></div>
      <div class="stat"><b>${serie}</b><span>${serie > 1 ? "jours d'affilée" : "jour d'affilée"}</span></div>
      <div class="stat"><b>${etudiees}</b><span>${etudiees > 1 ? 'fiches étudiées' : 'fiche étudiée'}</span></div>
    </div></section>
    <p class="note-synchro">${esc(texteSynchro())}</p>`;
}

// ---------- Liste des leçons ----------
function vueLecons() {
  if (!app.catalogue) {
    return `<h1>Leçons</h1>${vide("Le programme n'est pas encore sur cet appareil.", `<button class="bouton primaire" data-action="synchroniser">${I.synchro} Synchroniser</button>`)}`;
  }
  const blocs = app.catalogue.blocs || [];
  const nbModules = blocs.reduce((n, b) => n + (b.modules || []).length, 0);
  const nbDispo = listeLecons(app.catalogue).filter((x) => app.lecons[x.lecon.id]).length;
  return `<h1>Leçons</h1><p class="sous-titre">${nbModules} modules · ${pl(nbDispo, 'leçon disponible', 'leçons disponibles')}</p>
    ${blocs.map((b) => `<section><h2 class="titre-bloc">${esc(b.titre)}</h2>${(b.modules || []).map(carteModule).join('')}</section>`).join('')}`;
}

function carteModule(m) {
  const dispo = (m.lecons || []).filter((l) => app.lecons[l.id]);
  if (!dispo.length) {
    return `<div class="module module-verrouille"><span class="code-module">${esc(m.id)}</span><div><strong>${esc(m.titre)}</strong><small>Bientôt disponible</small></div></div>`;
  }
  const detail = `${pl(dispo.length, 'leçon disponible', 'leçons disponibles')}${m.prevues ? ` sur ${m.prevues}` : ''}`;
  return `<div class="module"><div class="entete-module"><span class="code-module">${esc(m.id)}</span><div><strong>${esc(m.titre)}</strong><small>${detail}</small></div></div>
    <ul class="liste-lecons">${dispo.map(ligneLecon).join('')}</ul></div>`;
}

function ligneLecon(meta) {
  const lec = app.lecons[meta.id];
  const st = app.etat.lecons[meta.id];
  const meilleure = meilleureTentative(app.etat, meta.id);
  let statut;
  let classe;
  let icone;
  if (quizValide(app.etat, meta.id)) {
    statut = `Quiz validé · ${meilleure.score}/${meilleure.total}`;
    classe = 'valide';
    icone = I.cocheP;
  } else if (st && st.terminee) {
    statut = meilleure ? `Lue · quiz ${meilleure.score}/${meilleure.total}, à retenter` : 'Lue · quiz à faire';
    classe = 'lue';
    icone = I.livre;
  } else if (st && st.position > 0) {
    statut = `En cours · partie ${st.position + 1} sur ${lec.sections.length}`;
    classe = 'encours';
    icone = I.horloge;
  } else {
    statut = `À lire · environ ${lec.duree || 30} min`;
    classe = '';
    icone = I.cercle;
  }
  return `<li><a href="#/lecon/${esc(meta.id)}" class="ligne-lecon"><span class="statut-icone ${classe}">${icone}</span>
    <span><strong>Leçon ${esc(lec.numero)} · ${esc(lec.titre)}</strong><small>${statut}</small></span></a></li>`;
}

// ---------- Lecture d'une leçon ----------
function memoriserPosition(id, i) {
  const st = app.etat.lecons[id];
  if (!st || st.position !== i) {
    app.etat.lecons[id] = { ...(st || {}), position: i, terminee: !!(st && st.terminee), t: Date.now() };
    marquerActivite();
    sauver();
  }
}

function vueLecture(id, partie) {
  const lec = app.lecons[id];
  if (!lec) return vide("Cette leçon n'est pas disponible sur cet appareil.", '<a class="bouton primaire" href="#/lecons">Voir les leçons</a>');
  if (partie === 'fin') return vueFinLecon(lec);
  const n = lec.sections.length;
  let i = partie !== undefined ? parseInt(partie, 10) : (app.etat.lecons[id]?.position || 0);
  if (!Number.isFinite(i) || i < 0) i = 0;
  if (i >= n) i = n - 1;
  memoriserPosition(id, i);
  app.section = { id, i };
  const s = lec.sections[i];
  const pct = Math.round(((i + 1) / n) * 100);
  const precedent = i > 0 ? `<a class="bouton secondaire" href="#/lecon/${esc(id)}/${i - 1}">${I.gauche} Précédent</a>` : '<span></span>';
  const suivant =
    i < n - 1
      ? `<a class="bouton primaire" href="#/lecon/${esc(id)}/${i + 1}">Suivant ${I.droite}</a>`
      : `<button class="bouton primaire" data-action="terminer-lecon" data-id="${esc(id)}">J'ai terminé ${I.coche}</button>`;
  return `<div class="lecture">
    <a class="retour" href="#/lecons">${I.gauche} Leçons</a>
    <p class="surtitre">${esc(lec.module)} · Leçon ${esc(lec.numero)}</p>
    <h1 class="titre-lecon">${esc(lec.titre)}</h1>
    <div class="progression"><div class="barre" role="progressbar" aria-label="Avancement dans la leçon" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${i + 1}"><span style="width:${pct}%"></span></div><span class="etiquette">Partie ${i + 1} sur ${n}</span></div>
    <article class="section-lecon"><h2>${esc(s.titre)}</h2>${s.blocs.map(rendreBloc).join('')}</article>
    ${
      audio.disponible
        ? `<div class="audio"><button class="bouton secondaire" id="bouton-audio" data-action="audio" aria-pressed="false">${I.jouer} Écouter cette partie</button>
      <button class="bouton secondaire" id="bouton-stop" data-action="audio-stop" aria-label="Arrêter la lecture" hidden>${I.stop}</button></div>`
        : ''
    }
    <button class="bouton discret" data-action="demander-section" data-lecon="${esc(id)}" data-section="${i}">${I.bulle} Une question sur cette partie ?</button>
    <div class="nav-lecture">${precedent}${suivant}</div>
  </div>`;
}

function vueFinLecon(lec) {
  const nbFiches = (lec.fiches || []).length;
  return `<div class="ecran-fin"><div class="medaille">${I.coche}</div><h1>Leçon terminée !</h1>
    <p>${pl(nbFiches, 'fiche de révision débloquée', 'fiches de révision débloquées')} dans l'onglet Révisions.</p>
    <div class="carte"><h2>Prochaine étape : le quiz</h2>
      <p class="aide">${pl(lec.quiz.length, 'question')}, environ ${Math.max(5, lec.quiz.length)} minutes. Tu réponds à tout, puis tu vois ta note et la correction expliquée.</p>
      <a class="bouton primaire large" href="#/quiz/${esc(lec.id)}" data-action="nouveau-quiz" data-id="${esc(lec.id)}">Faire le quiz</a>
      <a class="bouton discret large" href="#/accueil">Plus tard</a></div></div>`;
}

async function terminerLecon(id) {
  const lec = app.lecons[id];
  if (!lec) return;
  const st = app.etat.lecons[id] || {};
  app.etat.lecons[id] = { ...st, position: lec.sections.length - 1, terminee: true, t: Date.now() };
  marquerActivite();
  await sauver();
  location.hash = `#/lecon/${id}/fin`;
}

// ---------- Quiz ----------
function vueQuiz(id) {
  const lec = app.lecons[id];
  if (!lec) return vide("Ce quiz n'est pas disponible sur cet appareil.", '<a class="bouton primaire" href="#/lecons">Voir les leçons</a>');
  if (!app.quiz || app.quiz.id !== id) app.quiz = { id, index: 0, reponses: {} };
  const n = lec.quiz.length;
  app.quiz.index = Math.min(Math.max(0, app.quiz.index), n - 1);
  const q = lec.quiz[app.quiz.index];
  const choisi = app.quiz.reponses[q.id];
  const repondues = lec.quiz.filter((x) => app.quiz.reponses[x.id] !== undefined).length;
  const dernier = app.quiz.index === n - 1;
  const boutonFin = dernier
    ? `<button class="bouton primaire" data-action="quiz-terminer" ${repondues < n ? 'disabled' : ''}>Voir mon résultat</button>`
    : `<button class="bouton primaire" data-action="quiz-suivant" ${choisi === undefined ? 'disabled' : ''}>Suivant</button>`;
  return `<div class="quiz">
    <div class="entete-exercice"><button class="bouton-icone" data-action="quitter-quiz" aria-label="Quitter le quiz">${I.croix}</button>
      <div class="barre"><span style="width:${((app.quiz.index + 1) / n) * 100}%"></span></div><span class="etiquette">${app.quiz.index + 1}/${n}</span></div>
    <p class="surtitre">Quiz · ${esc(lec.titre)}</p>
    <h1 class="question">${fmt(q.question)}</h1>
    <div class="choix-liste" role="radiogroup" aria-label="Réponses possibles">
      ${q.choix
        .map(
          (c, k) =>
            `<button class="choix ${choisi === k ? 'choisi' : ''}" role="radio" aria-checked="${choisi === k}" data-action="choisir" data-q="${esc(q.id)}" data-k="${k}"><span class="lettre">${'ABCDEF'[k]}</span><span>${fmt(c)}</span></button>`,
        )
        .join('')}
    </div>
    <div class="nav-quiz">${app.quiz.index > 0 ? '<button class="bouton secondaire" data-action="quiz-precedent">Précédent</button>' : '<span></span>'}${boutonFin}</div>
    ${
      dernier && repondues < n
        ? `<p class="aide">Il te reste ${pl(n - repondues, 'question')} sans réponse. <button class="lien" data-action="quiz-premiere-vide">Y aller</button></p>`
        : ''
    }
  </div>`;
}

function sauverQuiz() {
  ecrire('quizEnCours', app.quiz);
}

async function terminerQuiz() {
  if (!app.quiz) return;
  const lec = app.lecons[app.quiz.id];
  const rep = app.quiz.reponses;
  if (!lec || lec.quiz.some((q) => rep[q.id] === undefined)) return;
  const score = lec.quiz.filter((q) => rep[q.id] === q.bonne).length;
  const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const precedent = app.etat.quiz[lec.id] || { tentatives: {} };
  app.etat.quiz[lec.id] = {
    tentatives: { ...precedent.tentatives, [tid]: { date: new Date().toISOString(), score, total: lec.quiz.length, reponses: { ...rep } } },
    t: Date.now(),
  };
  marquerActivite();
  app.quiz = null;
  await ecrire('quizEnCours', null);
  await sauver();
  location.hash = `#/resultat/${lec.id}/${tid}`;
}

function vueResultat(id, tid) {
  const lec = app.lecons[id];
  const t = app.etat.quiz[id]?.tentatives?.[tid];
  if (!lec || !t) return vide('Résultat introuvable.', '<a class="bouton primaire" href="#/lecons">Retour aux leçons</a>');
  const valide = t.score / t.total >= SEUIL;
  const minimum = Math.ceil(SEUIL * t.total - 1e-9);
  return `<div class="resultat ${valide ? 'reussi' : 'a-revoir'}">
      <p class="score"><b>${t.score}</b> / ${t.total}</p>
      <h1>${valide ? 'Quiz validé !' : 'Pas encore validé'}</h1>
      <p>${valide ? `Bravo ! Il fallait au moins ${minimum} bonnes réponses.` : `Il faut au moins ${minimum} bonnes réponses. Lis bien la correction, puis réessaie quand tu veux.`}</p>
      <div class="actions">
        <a class="bouton primaire" href="#/quiz/${esc(id)}" data-action="nouveau-quiz" data-id="${esc(id)}">Refaire le quiz</a>
        <a class="bouton secondaire" href="#/lecon/${esc(id)}/0">Revoir la leçon</a>
      </div>
    </div>
    <h2>Correction expliquée</h2>
    ${lec.quiz.map((q, i) => carteCorrection(lec, q, i, t.reponses[q.id])).join('')}
    <a class="bouton secondaire large" href="#/accueil">Retour à l'accueil</a>`;
}

function carteCorrection(lec, q, i, choisi) {
  const juste = choisi === q.bonne;
  const ref = `${lec.id}/${q.id}`;
  const dejaPosee = Object.values(app.etat.questions).some((x) => x.ref === ref);
  const reponses = juste
    ? `<p class="reponse">Ta réponse : <strong>${fmt(q.choix[choisi])}</strong></p>`
    : `<p class="reponse">Ta réponse : ${choisi === undefined ? '<em>aucune</em>' : fmt(q.choix[choisi])}</p><p class="reponse">Bonne réponse : <strong>${fmt(q.choix[q.bonne])}</strong></p>`;
  return `<article class="correction ${juste ? 'juste' : 'faux'}">
    <p class="etat-reponse">${juste ? `${I.coche} Juste` : `${I.croix} Faux`} · question ${i + 1}</p>
    <h3>${fmt(q.question)}</h3>${reponses}
    <div class="explication">${fmt(q.explication)}</div>
    <button class="bouton discret" data-action="demander" data-lecon="${esc(lec.id)}" data-q="${esc(q.id)}" data-choisi="${choisi ?? ''}">${I.bulle} ${dejaPosee ? 'Poser une autre question à Claude' : 'Demander à Claude'}</button>
  </article>`;
}

// ---------- Questions à Claude ----------
function ouvrirQuestion({ lecon, q, choisi, section } = {}) {
  const dlg = document.getElementById('dialogue-question');
  const form = dlg.querySelector('form');
  form.reset();
  const lec = lecon ? app.lecons[lecon] : null;
  let contexte = '';
  let ref = '';
  let sujet = '';
  if (lec && q) {
    const qq = lec.quiz.find((x) => x.id === q);
    const c = choisi === '' || choisi === undefined ? undefined : Number(choisi);
    if (qq) {
      contexte = `Leçon : ${lec.titre}\nQuestion du quiz : ${brut(qq.question)}\nMa réponse : ${c === undefined ? 'aucune' : brut(qq.choix[c])}\nBonne réponse : ${brut(qq.choix[qq.bonne])}`;
      ref = `${lec.id}/${qq.id}`;
      sujet = brut(qq.question);
    }
  } else if (lec && section !== undefined) {
    const s = lec.sections[Number(section)];
    if (s) {
      contexte = `Leçon : ${lec.titre}\nPartie : ${s.titre}`;
      ref = `${lec.id}/${s.id}`;
      sujet = `${s.titre} (${lec.titre})`;
    }
  }
  form.elements.lecon.value = lecon || '';
  form.elements.ref.value = ref;
  form.elements.contexte.value = contexte;
  dlg.querySelector('.contexte-dialogue').textContent = sujet ? `À propos de : ${sujet}` : "Pose ta question sur n'importe quel sujet de la formation.";
  dlg.showModal();
  form.elements.texte.focus();
}

async function enregistrerQuestion(form) {
  const texte = form.elements.texte.value.trim();
  if (!texte) return;
  const id = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  app.etat.questions[id] = {
    lecon: form.elements.lecon.value || null,
    ref: form.elements.ref.value || null,
    texte,
    contexte: form.elements.contexte.value || '',
    date: new Date().toISOString(),
    appareil: app.config.appareilNom,
    t: Date.now(),
  };
  marquerActivite();
  await sauver();
  toast('Question enregistrée. Claude y répondra lors de votre prochaine séance.');
  if (route().nom === 'questions' || route().nom === 'resultat') afficher({ garderDefilement: true });
}

function vueQuestions() {
  const liste = Object.entries(app.etat.questions)
    .map(([id, q]) => ({ id, ...q }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `<h1>Questions à Claude</h1>
    <p class="sous-titre">Tes questions partent à chaque synchronisation. Claude y répond lors de vos séances, et la réponse arrive ici.</p>
    <button class="bouton primaire large" data-action="question-libre">${I.bulle} Poser une question</button>
    <div style="height:14px"></div>
    ${liste.length ? liste.map(carteQuestion).join('') : vide("Tu n'as pas encore posé de question.")}`;
}

function carteQuestion(q) {
  const r = app.reponses[q.id];
  const etiquette = r ? (q.reponseVue ? '' : '<span class="tag nouveau">Nouveau</span>') : '<span class="tag">En attente de Claude</span>';
  return `<article class="carte">
    <p class="meta">${esc(dateCourte(q.date))} ${etiquette}</p>
    <p><strong>${esc(q.texte)}</strong></p>
    ${q.contexte ? `<p class="contexte">${esc(q.contexte)}</p>` : ''}
    ${r ? `<div class="reponse-claude"><p class="meta">Réponse de Claude${r.date ? ' · ' + esc(dateCourte(r.date)) : ''}</p>${paragraphes(r.texte)}</div>` : ''}
  </article>`;
}

// ---------- Fiches de révision ----------
function melanger(liste) {
  const l = [...liste];
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

function titreLecon(id) {
  const l = app.lecons[id];
  return l ? `${l.module} · leçon ${l.numero}` : '';
}

function vueFiches() {
  const s = app.session;
  if (!s) {
    const file = construireSession(app.etat, app.lecons);
    const debloquees = fichesDebloquees(app.etat, app.lecons).length;
    if (!debloquees) {
      return `<h1>Révisions</h1>${vide('Termine ta première leçon pour débloquer tes fiches de révision.', '<a class="bouton primaire" href="#/lecons">Voir les leçons</a>')}`;
    }
    const prochaine = prochaineRevision(app.etat);
    return `<h1>Révisions</h1>
      <p class="sous-titre">Les notions que tu oublies reviennent plus souvent, celles que tu sais reviennent plus tard.</p>
      <div class="carte carte-centre">
        <p class="chiffre">${file.length}</p>
        <p>${file.length ? `${file.length > 1 ? 'fiches' : 'fiche'} à revoir aujourd'hui` : "Rien à revoir aujourd'hui. Bravo !"}</p>
        ${file.length ? '<button class="bouton primaire large" data-action="fiches-commencer">Commencer</button>' : prochaine ? `<p class="aide">Prochaine révision : ${esc(dateLisible(prochaine))}.</p>` : ''}
        <button class="bouton ${file.length ? 'discret' : 'secondaire'} large" data-action="fiches-entrainement">S'entraîner sur toutes mes fiches</button>
      </div>
      <p class="aide">${pl(debloquees, 'fiche débloquée', 'fiches débloquées')} au total.</p>`;
  }
  if (s.index >= s.file.length) return vueFinSession(s);
  const item = s.file[s.index];
  const surtitre = s.mode === 'entrainement' ? 'Entraînement libre · ne change pas ton planning' : `${item.etat ? 'À revoir' : 'Nouvelle fiche'} · ${titreLecon(item.idLecon)}`;
  return `<div class="session-fiches">
    <div class="entete-exercice"><button class="bouton-icone" data-action="fiches-quitter" aria-label="Arrêter la séance">${I.croix}</button>
      <div class="barre"><span style="width:${(s.index / s.file.length) * 100}%"></span></div><span class="etiquette">${s.index + 1}/${s.file.length}</span></div>
    <p class="surtitre">${esc(surtitre)}</p>
    <button class="fiche" data-action="fiche-retourner" aria-label="${s.retournee ? 'Fiche' : 'Retourner la fiche'}">
      <span class="recto">${fmt(item.fiche.recto)}</span>
      ${s.retournee ? `<span class="separateur"></span><span class="verso">${fmt(item.fiche.verso)}</span>` : '<span class="indice">Touche pour voir la réponse</span>'}
    </button>
    ${
      s.retournee
        ? `<div class="notes"><button class="bouton note rate" data-action="noter" data-note="0">Je ne savais pas</button>
        <button class="bouton note difficile" data-action="noter" data-note="1">Difficile</button>
        <button class="bouton note sue" data-action="noter" data-note="2">Je savais</button></div>`
        : '<button class="bouton primaire large" data-action="fiche-retourner">Voir la réponse</button>'
    }
  </div>`;
}

function vueFinSession(s) {
  const prochaine = prochaineRevision(app.etat);
  return `<div class="ecran-fin"><div class="medaille">${I.coche}</div><h1>Séance terminée</h1>
    <p>${pl(s.vues, 'fiche revue', 'fiches revues')}, dont ${s.sues} « Je savais ».</p>
    ${s.mode === 'normal' && prochaine ? `<p class="aide">Prochaine révision : ${esc(dateLisible(prochaine))}.</p>` : ''}
    <button class="bouton primaire large" data-action="fiches-fin">Retour à l'accueil</button>
    <button class="bouton discret large" data-action="fiches-entrainement">S'entraîner encore</button></div>`;
}

function demarrerSession(mode) {
  let file;
  if (mode === 'entrainement') {
    file = melanger(fichesDebloquees(app.etat, app.lecons))
      .slice(0, 20)
      .map((x) => ({ ...x, etat: app.etat.fiches[x.cle] || null }));
  } else {
    file = construireSession(app.etat, app.lecons);
  }
  if (!file.length) {
    toast('Aucune fiche à réviser pour le moment.');
    return;
  }
  app.session = { mode, file, index: 0, retournee: false, vues: 0, sues: 0 };
  if (route().nom !== 'fiches') location.hash = '#/fiches';
  else afficher();
}

function noterFiche(note) {
  const s = app.session;
  if (!s || !s.retournee) return;
  const item = s.file[s.index];
  if (s.mode === 'normal' && !(item.repetee && note === 0)) {
    app.etat.fiches[item.cle] = noter(app.etat.fiches[item.cle], note);
  }
  marquerActivite();
  sauver();
  s.vues += 1;
  if (note === 2) s.sues += 1;
  if (note === 0 && (item.repetitions || 0) < 2) {
    // Une fiche ratée revient un peu plus loin dans la même séance.
    s.file.splice(Math.min(s.index + 4, s.file.length), 0, { ...item, repetee: true, repetitions: (item.repetitions || 0) + 1 });
  }
  s.index += 1;
  s.retournee = false;
  afficher({ garderDefilement: true });
}

// ---------- Réglages ----------
function vueReglages() {
  const connecte = !!app.config.jeton;
  const voix = audio.voixDispo();
  const choisie = audio.voix();
  let etatConnexion = '<p>Cet appareil n’est pas encore relié à ton espace privé.</p>';
  if (connecte) etatConnexion = `<p>Relié à ton espace privé <strong>${esc(app.config.proprietaire)}/${esc(app.config.depot)}</strong>.</p>`;
  else if (estLocal()) etatConnexion = '<p>Mode test sur ce PC : les leçons viennent du dossier local, et la progression reste sur cet appareil.</p>';
  const vitesses = [
    ['0.8', 'Lente'],
    ['1', 'Normale'],
    ['1.2', 'Rapide'],
    ['1.4', 'Très rapide'],
  ];
  const sectionAudio = audio.disponible
    ? `${
        voix.length
          ? `<label for="choix-voix">Voix</label><select id="choix-voix" data-reglage="voix">${voix
              .map((v) => `<option value="${esc(v.name)}" ${choisie && v.name === choisie.name ? 'selected' : ''}>${esc(v.name)}${v.localService ? ' · hors ligne' : ''}</option>`)
              .join('')}</select>`
          : '<p class="message-erreur">Aucune voix française trouvée sur cet appareil pour le moment.</p>'
      }
      <label for="choix-vitesse">Vitesse</label><select id="choix-vitesse" data-reglage="vitesse">${vitesses
        .map(([v, n]) => `<option value="${v}" ${pref('vitesse', '1') === v ? 'selected' : ''}>${n}</option>`)
        .join('')}</select>
      <button class="bouton secondaire large" data-action="tester-voix">${I.jouer} Tester la voix</button>
      <details><summary>La voix ne marche pas sans internet ?</summary>
        <p class="aide">Installe la voix française hors ligne de ton téléphone. Sur Android, par exemple : Paramètres › Système (ou Gestion globale) › Langue et saisie › Synthèse vocale › Moteur de synthèse Google › Installer les données vocales › Français.</p></details>`
    : '<p class="aide">La lecture audio n’est pas disponible dans ce navigateur.</p>';
  return `<a class="retour" href="#/accueil">${I.gauche} Accueil</a><h1>Réglages</h1>
    <section class="carte"><h2>Synchronisation</h2>
      ${etatConnexion}
      <p class="aide">${esc(texteSynchro())}</p>
      ${app.synchro.erreur ? `<p class="message-erreur">${esc(app.synchro.erreur)}</p>` : ''}
      ${source() ? `<button class="bouton primaire large" data-action="synchroniser">${I.synchro} Synchroniser maintenant</button>` : ''}
      <label for="nom-appareil">Nom de cet appareil</label>
      <input type="text" id="nom-appareil" data-reglage="appareil" value="${esc(app.config.appareilNom)}" maxlength="40">
      <a class="bouton secondaire large" href="#/bienvenue">${connecte ? "Changer de clé d'accès" : 'Relier à mon espace GitHub'}</a>
      ${connecte ? '<button class="bouton danger large" data-action="deconnecter">Déconnecter cet appareil</button>' : ''}
    </section>
    <section class="carte"><h2>Lecture audio</h2>${sectionAudio}</section>
    <section class="carte"><h2>Affichage</h2>
      <label for="choix-taille">Taille du texte</label>
      <select id="choix-taille" data-reglage="taille"><option value="normal">Normale</option><option value="grand" ${pref('taille') === 'grand' ? 'selected' : ''}>Grande</option></select>
    </section>
    <section class="carte"><h2>À propos</h2>
      <p class="aide">Technicien Vert ${VERSION_APP}. Leçons rédigées par Claude pour ta formation. Pour les doses de produits et les règles officielles, vérifie toujours auprès des services agricoles de Côte d'Ivoire.</p>
      <button class="bouton danger large" data-action="effacer-tout">Effacer les données de cet appareil</button>
    </section>`;
}

// ---------- Connexion (première utilisation) ----------
const LIEN_CREER_CLE =
  'https://github.com/settings/personal-access-tokens/new?name=Technicien+Vert&description=Synchronisation+de+l%27application+Technicien+Vert&expires_in=365&contents=write';

function vueBienvenue() {
  const depot = app.config.depot || DEPOT_PAR_DEFAUT;
  const retour = app.config.jeton || estLocal() ? `<a class="retour" href="#/reglages">${I.gauche} Réglages</a>` : '';
  return `<section class="bienvenue">${retour}
    <img class="logo" src="icones/icone.svg" alt="" width="72" height="72">
    <h1>Bienvenue dans Technicien Vert</h1>
    <p class="sous-titre">Ta formation en agriculture tropicale dans ta poche, même sans internet. Pour commencer, relie l'application à ton espace privé : c'est à faire une seule fois par appareil, avec internet.</p>
    <div class="carte">
      <p class="surtitre">Étape 1</p>
      <h2>Crée ta clé d'accès sur GitHub</h2>
      <a class="bouton primaire large" href="${LIEN_CREER_CLE}" target="_blank" rel="noopener">Créer ma clé sur GitHub</a>
      <p class="aide">La page s'ouvre avec le nom, la durée (365 jours) et la permission déjà remplis. Connecte-toi si GitHub le demande, puis :</p>
      <ol class="etapes">
        <li>Dans <strong>Repository access</strong>, choisis <strong>Only select repositories</strong>, puis ton dépôt <strong>${esc(depot)}</strong>.</li>
        <li>Vérifie que <strong>Contents</strong> est sur <strong>Read and write</strong>.</li>
        <li>Tout en bas, touche <strong>Generate token</strong>, puis copie la clé (elle commence par github_pat_).</li>
        <li>Reviens ici, et colle-la à l'étape 2.</li>
      </ol>
    </div>
    <form id="form-connexion" class="carte" autocomplete="off">
      <p class="surtitre">Étape 2</p>
      <h2>Colle ta clé ici</h2>
      <label for="jeton">Clé d'accès GitHub</label>
      <input type="password" id="jeton" name="jeton" required placeholder="github_pat_…" spellcheck="false" autocapitalize="off">
      <details><summary>Options avancées</summary>
        <label for="depot">Nom du dépôt privé</label>
        <input type="text" id="depot" name="depot" value="${esc(depot)}" spellcheck="false" autocapitalize="off">
        <label for="proprietaire">Nom d'utilisateur GitHub (facultatif)</label>
        <input type="text" id="proprietaire" name="proprietaire" value="${esc(app.config.proprietaire || '')}" spellcheck="false" autocapitalize="off">
      </details>
      <p class="message-erreur" hidden></p>
      <button class="bouton primaire large" type="submit">Connecter</button>
      <p class="aide">Ta clé reste sur cet appareil. Elle sert seulement à lire tes leçons et à envoyer ta progression dans ton dépôt privé.</p>
    </form>
  </section>`;
}

async function connecter(form) {
  const jeton = form.elements.jeton.value.trim();
  const depot = form.elements.depot.value.trim() || DEPOT_PAR_DEFAUT;
  const proprietaire = form.elements.proprietaire.value.trim();
  const bouton = form.querySelector('button[type="submit"]');
  const message = form.querySelector('.message-erreur');
  message.hidden = true;
  bouton.disabled = true;
  bouton.textContent = 'Vérification…';
  try {
    const res = await verifierConnexion({ jeton, depot, proprietaire });
    app.config = { ...app.config, jeton, depot, proprietaire: res.proprietaire };
    sauverConfig();
    await ecrire('dernierEnvoi', null);
    toast('Connexion réussie ! Récupération de tes leçons…');
    location.hash = '#/accueil';
    await lancerSynchro();
  } catch (e) {
    message.textContent = messageErreur(e);
    message.hidden = false;
    bouton.disabled = false;
    bouton.textContent = 'Connecter';
  }
}

// ---------- Actions ----------
async function surClic(e) {
  const cible = e.target.closest('[data-action]');
  if (!cible) return;
  const d = cible.dataset;
  switch (d.action) {
    case 'synchroniser':
      lancerSynchro();
      break;
    case 'terminer-lecon':
      terminerLecon(d.id);
      break;
    case 'audio':
      if (audio.actif && !audio.enPause) audio.pause();
      else if (audio.actif) audio.reprendre();
      else if (app.section) audio.lire(texteSection(app.lecons[app.section.id].sections[app.section.i]));
      break;
    case 'audio-stop':
      audio.arreter();
      break;
    case 'demander-section':
      ouvrirQuestion({ lecon: d.lecon, section: d.section });
      break;
    case 'nouveau-quiz':
      app.quiz = { id: d.id, index: 0, reponses: {} };
      sauverQuiz();
      break;
    case 'choisir':
      if (!app.quiz) return;
      app.quiz.reponses[d.q] = Number(d.k);
      sauverQuiz();
      afficher({ garderDefilement: true });
      break;
    case 'quiz-suivant':
      app.quiz.index += 1;
      sauverQuiz();
      afficher();
      break;
    case 'quiz-precedent':
      app.quiz.index -= 1;
      sauverQuiz();
      afficher();
      break;
    case 'quiz-premiere-vide': {
      const lec = app.lecons[app.quiz.id];
      const i = lec.quiz.findIndex((q) => app.quiz.reponses[q.id] === undefined);
      if (i >= 0) app.quiz.index = i;
      afficher();
      break;
    }
    case 'quiz-terminer':
      terminerQuiz();
      break;
    case 'quitter-quiz':
      if (confirm('Quitter le quiz ? Tes réponses sont gardées : tu pourras reprendre plus tard.')) location.hash = '#/lecons';
      break;
    case 'demander':
      ouvrirQuestion({ lecon: d.lecon, q: d.q, choisi: d.choisi });
      break;
    case 'question-libre':
      ouvrirQuestion({});
      break;
    case 'fiches-commencer':
      demarrerSession('normal');
      break;
    case 'fiches-entrainement':
      demarrerSession('entrainement');
      break;
    case 'fiche-retourner':
      if (app.session && !app.session.retournee) {
        app.session.retournee = true;
        afficher({ garderDefilement: true });
      }
      break;
    case 'noter':
      noterFiche(Number(d.note));
      break;
    case 'fiches-quitter':
      app.session = null;
      afficher();
      break;
    case 'fiches-fin':
      app.session = null;
      location.hash = '#/accueil';
      break;
    case 'installer':
      if (app.installation) {
        app.installation.prompt();
        await app.installation.userChoice.catch(() => null);
        app.installation = null;
        afficher({ garderDefilement: true });
      }
      break;
    case 'tester-voix':
      audio.lire('Bonjour ! Je suis la voix de Technicien Vert. Bonne étude !');
      break;
    case 'deconnecter':
      if (confirm('Déconnecter cet appareil ? Ta progression reste enregistrée ici et dans ton espace privé.')) {
        delete app.config.jeton;
        sauverConfig();
        app.synchro = { statut: 'inactif', derniere: null, erreur: null };
        afficher();
      }
      break;
    case 'effacer-tout':
      if (confirm("Effacer toutes les données de cet appareil ? Ce qui n'a pas encore été synchronisé sera perdu.")) {
        await toutEffacer();
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('tv-'))
            .forEach((k) => localStorage.removeItem(k));
        } catch {
          /* rien */
        }
        location.hash = '';
        location.reload();
      }
      break;
    case 'maj-app':
      if (attenteMaj) attenteMaj.postMessage('maj');
      break;
    default:
      break;
  }
}

function surChangement(e) {
  const r = e.target.dataset ? e.target.dataset.reglage : null;
  if (!r) return;
  if (r === 'voix') definirPref('voix', e.target.value);
  else if (r === 'vitesse') definirPref('vitesse', e.target.value);
  else if (r === 'taille') {
    definirPref('taille', e.target.value);
    document.body.classList.toggle('texte-grand', e.target.value === 'grand');
  } else if (r === 'appareil') {
    app.config.appareilNom = e.target.value.trim() || nomAppareilParDefaut();
    sauverConfig();
    toast('Nom de l’appareil enregistré.');
  }
}

function surSoumission(e) {
  if (e.target.id === 'form-connexion') {
    e.preventDefault();
    connecter(e.target);
  } else if (e.target.id === 'form-question') {
    // La fenêtre se ferme toute seule (method="dialog").
    if (e.submitter && e.submitter.value === 'envoyer') enregistrerQuestion(e.target);
  }
}

// ---------- Mode hors ligne et installation ----------
let attenteMaj = null;

function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const proposer = (travailleur) => {
        attenteMaj = travailleur;
        const b = document.getElementById('bandeau');
        b.querySelector('.texte').textContent = "Une nouvelle version de l'application est prête.";
        b.hidden = false;
      };
      if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const t = reg.installing;
        if (!t) return;
        t.addEventListener('statechange', () => {
          if (t.state === 'installed' && navigator.serviceWorker.controller) proposer(t);
        });
      });
      setInterval(() => reg.update().catch(() => null), 60 * 60 * 1000);
    })
    .catch((err) => console.warn('Mode hors ligne indisponible :', err));
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recharge || !attenteMaj) return;
    recharge = true;
    location.reload();
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  app.installation = e;
  if (route().nom === 'accueil') afficher({ garderDefilement: true });
});
window.addEventListener('appinstalled', () => {
  app.installation = null;
  toast("Technicien Vert est installé sur ton écran d'accueil.");
});

// ---------- Démarrage ----------
async function demarrer() {
  chargerConfig();
  document.body.classList.toggle('texte-grand', pref('taille') === 'grand');
  app.etat = (await lire('etat', null)) || etatVide();
  app.catalogue = await lire('catalogue', null);
  app.reponses = (await lire('reponses', null)) || {};
  app.synchro.derniere = await lire('derniereSynchro', null);
  app.quiz = await lire('quizEnCours', null);
  for (const { lecon } of listeLecons(app.catalogue)) {
    const contenu = await lire('lecon:' + lecon.id, null);
    if (contenu) app.lecons[lecon.id] = contenu;
  }

  window.addEventListener('hashchange', () => afficher());
  window.addEventListener('online', () => {
    majIndicateur();
    lancerSynchro({ silencieux: true });
  });
  window.addEventListener('offline', majIndicateur);
  document.addEventListener('click', surClic);
  document.addEventListener('change', surChangement);
  document.addEventListener('submit', surSoumission);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lancerSynchro({ silencieux: true });
  });
  if (audio.disponible) {
    speechSynthesis.onvoiceschanged = () => {
      if (route().nom === 'reglages') afficher({ garderDefilement: true });
    };
  }

  enregistrerServiceWorker();
  demanderPersistance();
  if (!location.hash) history.replaceState(null, '', '#/accueil');
  afficher();
  lancerSynchro({ silencieux: true });
}

demarrer();
