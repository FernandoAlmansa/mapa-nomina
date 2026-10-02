// clientes.js — Une los clientes de tres orígenes y elige la versión más nueva de cada uno:
//   repo:  los que vienen publicados con la página (clientes/clientes.json)
//   nube:  los que el equipo guardó en Supabase
//   local: los que cargaste en este navegador
import * as nube from './nube.js';
import * as local from './local.js';

const ORIGEN = { repo: 'publicado con la página', nube: 'del equipo', local: 'guardado en este navegador' };

export const normalizar = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const idDesdeNombre = nombre => normalizar(nombre).slice(0, 12) || 'CLIENTE';
const fechaCorta = iso => (iso ? new Date(iso).toLocaleDateString('es-AR') : 's/f');

async function delRepo() {
  const r = await fetch('clientes/clientes.json', { cache: 'no-cache' });
  if (!r.ok) return [];
  const lista = await r.json();
  return lista.map(c => ({
    id: c.id, nombre: c.nombre,
    version: {
      origen: 'repo', clave: `repo:${c.id}:${c.subido}`, subido: c.subido, esquema: c.esquema, fechaListado: c.fechaListado,
      detalle: ORIGEN.repo,
      bajar: async () => {
        const [a, b] = await Promise.all([fetch(c.rpdasc00), fetch(c.t512w)]);
        if (!a.ok || !b.ok) throw new Error(`No se pudieron bajar los archivos de ${c.nombre}`);
        return { rpdTexto: await a.text(), t512Texto: await b.text() };
      },
    },
  }));
}

async function deLaNube() {
  if (!nube.configurada()) return [];
  return (await nube.listarClientes()).filter(c => c.ultima).map(c => ({
    id: c.id, nombre: c.nombre,
    version: {
      origen: 'nube', clave: `nube:${c.ultima.id}`, subido: c.ultima.subido_en, esquema: c.ultima.esquema ?? null,
      fechaListado: c.ultima.fecha_listado,
      detalle: `${ORIGEN.nube}, cargado por ${c.ultima.subido_por ?? 's/d'} el ${fechaCorta(c.ultima.subido_en)}${c.ultima.notas ? ` (${c.ultima.notas})` : ''}`,
      bajar: () => nube.descargarVersion(c.ultima),
    },
  }));
}

async function delNavegador() {
  return (await local.listar()).map(c => ({
    id: c.id, nombre: c.nombre,
    version: {
      origen: 'local', clave: `local:${c.id}:${c.guardado}`, subido: c.guardado, esquema: c.esquema, fechaListado: c.fechaListado,
      detalle: `${ORIGEN.local} el ${fechaCorta(c.guardado)}`,
      bajar: async () => ({ rpdTexto: c.rpdTexto, t512Texto: c.t512Texto }),
    },
  }));
}

// Devuelve { clientes: [{ id, nombre, versiones: [más nueva primero] }], errores: [texto] }
export async function listar() {
  const errores = [];
  const fuentes = await Promise.all([
    delRepo().catch(e => { errores.push('clientes publicados: ' + e.message); return []; }),
    deLaNube().catch(e => { errores.push('clientes del equipo: ' + e.message); return []; }),
    delNavegador().catch(() => []),
  ]);
  const porId = new Map();
  for (const item of fuentes.flat()) {
    const id = normalizar(item.id);
    if (!porId.has(id)) porId.set(id, { id, nombre: item.nombre, versiones: [] });
    porId.get(id).versiones.push(item.version);
  }
  const clientes = [...porId.values()];
  for (const c of clientes) c.versiones.sort((a, b) => String(b.subido).localeCompare(String(a.subido)));
  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { clientes, errores };
}

// Busca un cliente sin pedir el nombre exacto: ignora mayúsculas, acentos, espacios y puntuación,
// y acepta una parte del nombre o del código si apunta a un solo cliente.
export function buscar(clientes, texto) {
  const n = normalizar(texto);
  if (!n) return null;
  const exacto = clientes.find(c => normalizar(c.id) === n || normalizar(c.nombre) === n);
  if (exacto) return { cliente: exacto, exacto: true };
  const parecidos = clientes.filter(c => normalizar(c.nombre).includes(n) || normalizar(c.id).startsWith(n) || n.includes(normalizar(c.nombre)));
  return parecidos.length === 1 ? { cliente: parecidos[0], exacto: false } : null;
}

// Cliente que ya tiene cargado ese esquema (para sugerirlo al cargar archivos nuevos)
export const porEsquema = (clientes, esquema) => clientes.filter(c => c.versiones.some(v => v.esquema === esquema));
