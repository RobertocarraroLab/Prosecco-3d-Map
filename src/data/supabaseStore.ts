/**
 * Archivio su Supabase, per la versione definitiva (fuori da Claude).
 * Si attiva impostando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env.
 * Tabelle, regole di accesso e storage: supabase/schema.sql.
 *
 * Nota: scritto sullo stesso contratto di ClaudeDbStore ma non ancora provato su un progetto
 * Supabase reale (da verificare alla prima installazione).
 */
import type { Coll, Overrides, Store } from './store';
import { COLLS } from './store';

export class SupabaseStore implements Store {
  readonly name = 'Supabase';
  private constructor(private sb: any) {}

  static async create(url: string, key: string): Promise<SupabaseStore> {
    const { createClient } = await import('@supabase/supabase-js');
    return new SupabaseStore(createClient(url, key));
  }

  /** Accesso della redazione (email e password Supabase Auth). */
  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async canEdit() {
    const { data } = await this.sb.auth.getUser();
    if (!data?.user) return false;
    const { data: p } = await this.sb.from('profili').select('ruolo').eq('id', data.user.id).maybeSingle();
    return p?.ruolo === 'redazione';
  }

  subscribe(cb: (o: Overrides) => void) {
    const load = async () => {
      const o: Overrides = { localita: [], contenuti: [], audio: [], giochi: [], impostazioni: null };
      for (const c of COLLS) {
        const { data } = await this.sb.from(c).select('id, dati, eliminato');
        o[c] = (data ?? []).map((r: any) => ({ ...r.dati, id: r.id, eliminato: r.eliminato }));
      }
      const { data: s } = await this.sb.from('impostazioni').select('dati').eq('id', 'mappa').maybeSingle();
      o.impostazioni = s?.dati ?? null;
      cb(o);
    };
    load();
    // aggiornamenti in tempo reale
    this.sb.channel('redazione')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => load())
      .subscribe();
  }

  async save(coll: Coll, id: string, data: Record<string, any>) {
    const { error } = await this.sb.from(coll).upsert({ id, dati: data, eliminato: false });
    if (error) throw error;
  }
  async remove(coll: Coll, id: string) {
    const { error } = await this.sb.from(coll).upsert({ id, dati: {}, eliminato: true });
    if (error) throw error;
  }
  async saveSettings(data: Record<string, any>) {
    const { error } = await this.sb.from('impostazioni').upsert({ id: 'mappa', dati: data });
    if (error) throw error;
  }
  async upload(blob: Blob, name: string) {
    const path = `${Date.now()}-${name}`;
    const { error } = await this.sb.storage.from('media').upload(path, blob, { contentType: blob.type });
    if (error) throw error;
    return this.sb.storage.from('media').getPublicUrl(path).data.publicUrl as string;
  }
}
