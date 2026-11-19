// Stockage local de l'application : IndexedDB, avec repli en mémoire si indisponible.
const NOM_BASE = 'technicien-vert';
const MAGASIN = 'donnees';
const memoire = new Map();
let promesseBase = null;

function ouvrirBase() {
  if (!promesseBase) {
    promesseBase = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) {
        reject(new Error('IndexedDB indisponible'));
        return;
      }
      const req = indexedDB.open(NOM_BASE, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(MAGASIN);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Base bloquée'));
    }).catch((e) => {
      console.warn('Stockage indisponible, repli en mémoire :', e);
      return null;
    });
  }
  return promesseBase;
}

function transaction(base, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = base.transaction(MAGASIN, mode);
    const req = action(tx.objectStore(MAGASIN));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function lire(cle, defaut = null) {
  try {
    const base = await ouvrirBase();
    if (!base) return memoire.has(cle) ? memoire.get(cle) : defaut;
    const valeur = await transaction(base, 'readonly', (m) => m.get(cle));
    return valeur === undefined ? defaut : valeur;
  } catch (e) {
    console.warn('Lecture impossible :', cle, e);
    return memoire.has(cle) ? memoire.get(cle) : defaut;
  }
}

export async function ecrire(cle, valeur) {
  try {
    const base = await ouvrirBase();
    if (!base) {
      memoire.set(cle, valeur);
      return true;
    }
    await transaction(base, 'readwrite', (m) => m.put(valeur, cle));
    return true;
  } catch (e) {
    console.warn('Écriture impossible :', cle, e);
    memoire.set(cle, valeur);
    return false;
  }
}

export async function toutEffacer() {
  try {
    const base = await ouvrirBase();
    if (base) await transaction(base, 'readwrite', (m) => m.clear());
  } catch (e) {
    console.warn('Effacement impossible :', e);
  }
  memoire.clear();
}

// Demande au navigateur de ne pas supprimer les données hors ligne quand l'espace manque.
export async function demanderPersistance() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* sans importance */
  }
}
