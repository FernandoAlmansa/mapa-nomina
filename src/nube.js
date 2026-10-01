// nube.js — Todo lo que habla con Supabase. Si config.js está vacío, configurada() da false y la página usa modo local.
import { SUPABASE_URL, SUPABASE_ANON_KEY, DOMINIO_PERMITIDO } from './config.js';

const BUCKET = 'listados';
let sb = null;

export const configurada = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

async function cliente() {
  if (!configurada()) throw new Error('Supabase no está configurado (src/config.js)');
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return sb;
}

export async function sesion() {
  const { data } = await (await cliente()).auth.getSession();
  return data.session;
}

export async function alCambiarSesion(cb) {
  (await cliente()).auth.onAuthStateChange((_evento, s) => cb(s));
}

export async function enviarLink(email) {
  email = email.trim().toLowerCase();
  if (DOMINIO_PERMITIDO && !email.endsWith(DOMINIO_PERMITIDO)) throw new Error(`Usá tu mail ${DOMINIO_PERMITIDO}`);
  const { error } = await (await cliente()).auth.signInWithOtp({
    email, options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function salir() {
  await (await cliente()).auth.signOut();
}

// Clientes con su última versión
export async function listarClientes() {
  const c = await cliente();
  const [{ data: clientes, error: e1 }, { data: versiones, error: e2 }] = await Promise.all([
    c.from('clientes').select('id, nombre').order('nombre'),
    c.from('versiones').select('id, cliente_id, fecha_listado, subido_en, subido_por, pasos, reglas').order('subido_en', { ascending: false }),
  ]);
  if (e1 || e2) throw e1 || e2;
  return clientes.map(cl => ({ ...cl, ultima: versiones.find(v => v.cliente_id === cl.id) ?? null }));
}

export async function descargarUltima(clienteId) {
  const c = await cliente();
  const { data, error } = await c.from('versiones').select('*').eq('cliente_id', clienteId)
    .order('subido_en', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data.length) throw new Error(`El cliente ${clienteId} todavía no tiene versiones cargadas`);
  const v = data[0];
  const bajar = async path => {
    const url = c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo bajar ${path} (${r.status})`);
    return r.text();
  };
  const [rpdTexto, t512Texto] = await Promise.all([bajar(v.rpdasc00_path), bajar(v.t512w_path)]);
  return { version: v, rpdTexto, t512Texto };
}

// Cada carga es una versión nueva: no se pisa ni se borra nada de lo anterior.
export async function guardarVersion({ clienteId, nombre, rpdTexto, t512Texto, resumen, notas }) {
  const c = await cliente();
  const { error: eCli } = await c.from('clientes').insert({ id: clienteId, nombre });
  if (eCli && eCli.code !== '23505') throw eCli; // 23505 = el cliente ya existía

  const carpeta = `${clienteId}/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const subir = async (nombreArchivo, texto) => {
    const path = `${carpeta}/${nombreArchivo}`;
    const { error } = await c.storage.from(BUCKET)
      .upload(path, new Blob([texto], { type: 'text/plain;charset=utf-8' }), { upsert: false });
    if (error) throw error;
    return path;
  };
  const rpdasc00_path = await subir('rpdasc00.txt', rpdTexto);
  const t512w_path = await subir('t512w.txt', t512Texto);

  const { error } = await c.from('versiones').insert({
    cliente_id: clienteId, rpdasc00_path, t512w_path,
    fecha_listado: resumen.fechaISO, pasos: resumen.pasos, reglas: resumen.reglas, notas: notas || null,
  });
  if (error) throw error;
}
