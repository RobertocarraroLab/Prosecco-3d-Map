/**
 * Livello dati della redazione.
 *
 * I dati di base (localita.json, contenuti.json, audio.json, giochi.json) sono nei file pubblicati.
 * Le modifiche della redazione sono documenti in un archivio condiviso, che si sovrappongono ai dati
 * di base per id: un documento con lo stesso id sostituisce l'elemento di base, uno con
 * `eliminato: true` lo nasconde, uno con un id nuovo si aggiunge.
 *
 * Due implementazioni con la stessa interfaccia:
 *  - ClaudeDbStore: il database della pagina pubblicata su Claude (prototipo; scrive solo chi è Editor).
 *  - SupabaseStore (src/data/supabaseStore.ts): per la versione definitiva; si attiva con VITE_SUPABASE_URL.
 */
export type Coll = 'localita' | 'contenuti' | 'audio' | 'giochi';
export const COLLS: Coll[] = ['localita', 'contenuti', 'audio', 'giochi'];

export interface Overrides {
  localita: Record<string, any>[];
  contenuti: Record<string, any>[];
  audio: Record<string, any>[];
  giochi: Record<string, any>[];
  impostazioni: Record<string, any> | null;
}

export interface Store {
  readonly name: string;
  /** true se chi guarda può modificare (redazione) */
  canEdit(): Promise<boolean>;
  /** Carica tutte le modifiche e le segue in tempo reale. `cb` riceve ogni nuova versione. */
  subscribe(cb: (o: Overrides) => void): void;
  save(coll: Coll, id: string, data: Record<string, any>): Promise<void>;
  remove(coll: Coll, id: string): Promise<void>;
  saveSettings(data: Record<string, any>): Promise<void>;
  /** Carica un file (immagine, video, PDF…) e restituisce l'indirizzo da usare nella mappa. */
  upload(blob: Blob, name: string): Promise<string>;
}

/** Applica le modifiche della redazione a un elenco di base. */
export function mergeById<T extends { id: string }>(base: T[], over: Record<string, any>[]): T[] {
  const map = new Map<string, T>(base.map((b) => [b.id, b]));
  for (const o of over) {
    if (!o || typeof o.id !== 'string') continue;
    if (o.eliminato) { map.delete(o.id); continue; }
    map.set(o.id, { ...(map.get(o.id) ?? {}), ...o } as T);
  }
  return [...map.values()];
}

/** Archivio sul database della pagina pubblicata (capacità `db`, `user`, `assets`). */
export class ClaudeDbStore implements Store {
  readonly name = 'Database della pagina (prototipo)';
  private constructor(private db: any, private user: any, private assets: any) {}

  static async create(): Promise<ClaudeDbStore | null> {
    const c = (window as any).claude;
    if (!c?.use) return null;
    const timeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 10000))]);
    try {
      const [db, user, assets] = await Promise.all([
        timeout(c.use('db')), timeout(c.use('user')), timeout(c.use('assets')),
      ]);
      return db ? new ClaudeDbStore(db, user, assets) : null;
    } catch { return null; }
  }

  async canEdit() {
    try { return !!(this.user && (await this.user.canEdit())); } catch { return false; }
  }

  subscribe(cb: (o: Overrides) => void) {
    const o: Overrides = { localita: [], contenuti: [], audio: [], giochi: [], impostazioni: null };
    let timer = 0;
    const emit = () => { clearTimeout(timer); timer = window.setTimeout(() => cb({ ...o }), 250); };
    for (const coll of COLLS) {
      this.db.collection(coll).onSnapshot(
        (snap: any) => { o[coll] = snap.docs.filter((d: any) => d.exists).map((d: any) => ({ ...d.data(), id: d.id })); emit(); },
        (e: any) => console.warn(`Archivio ${coll}:`, e?.code),
      );
    }
    this.db.doc('impostazioni/mappa').onSnapshot(
      (d: any) => { o.impostazioni = d.exists ? { ...d.data() } : null; emit(); },
      (e: any) => console.warn('Impostazioni:', e?.code),
    );
  }

  async save(coll: Coll, id: string, data: Record<string, any>) {
    await this.db.collection(coll).doc(id).set({ ...data, id, aggiornato: new Date().toISOString() });
  }
  async remove(coll: Coll, id: string) {
    // l'eliminazione è un documento "eliminato": nasconde anche gli elementi dei dati di base
    await this.db.collection(coll).doc(id).set({ id, eliminato: true, aggiornato: new Date().toISOString() });
  }
  async saveSettings(data: Record<string, any>) {
    await this.db.doc('impostazioni/mappa').set({ ...data, aggiornato: new Date().toISOString() });
  }
  async upload(blob: Blob, _name: string) {
    if (!this.assets) throw new Error('Caricamento file non disponibile per questo utente');
    const r = await this.assets.upload(blob);
    return r.url as string;
  }
}
