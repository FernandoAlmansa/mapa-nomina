// indice.js — Cruza el modelo del RPDASC00 con T512W y responde "¿qué le pasa al concepto X en este cliente?".
//
// Dos partes:
//  1) construirIndice(modelo): escaneo estático de todas las reglas -> quién crea / lee cada concepto y variable.
//  2) buscarConcepto(...): recorre el esquema en orden y, en cada función que procesa conceptos (PIT, PRT, P0014...),
//     resuelve la regla para ESE concepto: línea específica o genérica ****, ramas VWTCL según T512W,
//     y subreglas llamadas con PCY/GCY.

import { vigente } from './t512w.js';

const FUNC_POR_CONCEPTO = new Set(['PIT', 'PRT', 'PORT', 'PLRT', 'PDT', 'PAIT', 'PGRT', 'PCRT', 'PALP', 'MCOMP']);
export const esPorConcepto = f => FUNC_POR_CONCEPTO.has(f) || /^P\d{4}$/.test(f);
const TABLA_FUNC = { PIT: 'IT', PRT: 'RT', PORT: 'ORT', PLRT: 'LRT', PDT: 'DT', PAIT: 'AIT', PGRT: 'GRT', PCRT: 'CRT', PALP: 'IT', MCOMP: 'IT' };
const ES_CC = /^[A-Z0-9\/]{4}$/;
const MAX_ALTERNATIVAS = 24;
const MAX_PROFUNDIDAD = 4;

// ---------------------------------------------------------------- 1) índice estático
export function construirIndice(modelo) {
  const ix = { crea: {}, lee: {}, varEscribe: {}, varLee: {}, enFuncion: {}, esgs: new Set() };
  const add = (mapa, clave, ref) => (mapa[clave] ??= []).push(ref);

  for (const r of Object.values(modelo.reglas)) {
    const pasos = [...new Set([...r.usadaEn, ...r.invocadaEn])].sort((a, b) => a - b);
    for (const [esg, porCC] of Object.entries(r.variantes)) {
      if (/\d/.test(esg)) ix.esgs.add(esg);
      for (const [cc, lineas] of Object.entries(porCC)) {
        const finDeCadena = {};          // clave variable -> concepto "actual" al terminar esa cadena
        let actual = cc;
        lineas.forEach((l, i) => {
          if (!l.cont) actual = finDeCadena[l.niveles.slice(0, -1).join(' ')] ?? cc;
          for (const op of l.ops) {
            const ref = { regla: r.nombre, esg, cc, vk: l.vk, linea: i, op: op.raw, pasos };
            if (op.k === 'renombra') actual = op.cc === '*' ? cc : op.cc;
            else if (op.k === 'escribe' || op.k === 'resta') {
              const destino = op.cc === '*' ? actual : op.cc;
              if (destino !== cc && ES_CC.test(destino)) add(ix.crea, destino, { ...ref, tabla: op.tabla });
            } else if (op.k === 'lee' && op.cc !== '*') add(ix.lee, op.cc, { ...ref, tabla: op.tabla });
            else if (op.k === 'escribeVar' || op.k === 'restaVar') add(ix.varEscribe, op.var === '*' ? actual : op.var, ref);
            else if (op.k === 'leeVar') add(ix.varLee, op.var === '*' ? actual : op.var, ref);
          }
          finDeCadena[l.vk] = actual;
        });
      }
    }
  }
  // Conceptos mencionados como parámetro de funciones (ARCUM ZACU 9RET, ADDCU, etc.)
  for (const p of modelo.pasos) {
    if (esPorConcepto(p.func) || ['COPY', 'IF', 'ACTIO', 'MOD', 'DAYPR', 'GRSUP'].includes(p.func)) continue;
    for (const par of p.par) if (ES_CC.test(par) && !(par in modelo.reglas)) add(ix.enFuncion, par, { paso: p.paso });
  }
  ix.esgs = [...ix.esgs].sort();
  return ix;
}

// ---------------------------------------------------------------- 2) búsqueda por concepto
export function buscarConcepto(modelo, ix, t512w, cc, { fecha, esg = '*' } = {}) {
  cc = cc.trim().toUpperCase();
  fecha ??= new Date().toISOString().slice(0, 10);
  const clase = (c, nn) => (t512w ? vigente(t512w, c, fecha)?.vklas[Number(nn) - 1] ?? null : null);
  const ctx = { modelo, clase, esg };
  const eventos = [];

  // a) Procesamiento en funciones por concepto
  for (const p of modelo.pasos) {
    if (!esPorConcepto(p.func)) continue;
    for (const nombre of p.reglas) {
      const r = modelo.reglas[nombre];
      const elegido = elegirLineas(r, esg, cc);
      if (!elegido) continue;
      // La línea genérica **** solo se usa si el paso lo habilita: par2 GEN (todos) o Pnn (los que tienen la clase nn informada).
      // Sin GEN/Pnn, los conceptos sin línea propia pasan sin cambios. Las funciones de infotipo con genérica no se muestran.
      if (elegido.clave === '****') {
        const modo = p.par[1] || '';
        const pnn = /^P(\d\d)$/.exec(modo);
        if (/^P\d{4}$/.test(p.func)) continue;
        if (pnn) { if (!(clase(cc, pnn[1]) ?? ' ').trim()) continue; }
        else if (modo !== 'GEN') continue;
      }
      const alternativas = resolver(elegido.lineas, cc, ctx, 0);
      eventos.push({ paso: p.paso, tipo: 'procesa', regla: nombre, esg: elegido.esg, clave: elegido.clave,
        tabla: TABLA_FUNC[p.func] ?? (/^P\d{4}$/.test(p.func) ? 'infotipo ' + p.func.slice(1) : 'IT'),
        alternativas, efectos: efectos(alternativas, cc, t512w, fecha, p.func) });
    }
  }
  // b) Lo crean otras reglas (incluye ACTIO, IF y reglas genéricas por rama)
  for (const ref of ix.crea[cc] ?? []) for (const paso of ref.pasos)
    eventos.push({ paso, tipo: 'crea', regla: ref.regla, esg: ref.esg, clave: ref.cc, vk: ref.vk, op: ref.op, tabla: ref.tabla });
  // c) Lo leen como operando
  for (const ref of ix.lee[cc] ?? []) for (const paso of ref.pasos)
    eventos.push({ paso, tipo: 'lee', regla: ref.regla, esg: ref.esg, clave: ref.cc, vk: ref.vk, op: ref.op, tabla: ref.tabla });
  // d) Mencionado como parámetro de una función
  for (const ref of ix.enFuncion[cc] ?? []) eventos.push({ paso: ref.paso, tipo: 'funcion' });

  eventos.sort((a, b) => a.paso - b.paso || orden(a.tipo) - orden(b.tipo));
  const dedup = eventos.filter((e, i, arr) => i === 0 || JSON.stringify(e) !== JSON.stringify(arr[i - 1]));

  const t = t512w ? vigente(t512w, cc, fecha) : null;
  const recibeDe = t512w && /^\/1\d\d$/.test(cc)
    ? Object.keys(t512w.conceptos).filter(c => vigente(t512w, c, fecha)?.acumula.includes(cc)).sort()
    : [];
  for (const e of dedup) e.relevante = e.tipo !== 'procesa' || e.efectos.some(x => x !== 'sigue' && x !== 'no lo toma');
  const entradaRT = dedup.find(e => e.efectos?.includes('entra en RT') || (e.tipo === 'crea' && e.tabla === 'RT')) ?? null;
  const entradaRTCondicional = dedup.filter(e => e.efectos?.includes('entra en RT en alguna rama') && (!entradaRT || e.paso < entradaRT.paso));

  return { cc, fecha, esg, t512w: t, recibeDe, eventos: dedup, entradaRT, entradaRTCondicional };
}

const orden = t => ({ crea: 0, procesa: 1, lee: 2, funcion: 3 }[t] ?? 9);

// Orden de búsqueda de SAP: (ESG, concepto) → (ESG, ****) → (*, concepto) → (*, ****)
function elegirLineas(r, esg, cc) {
  for (const [e, c] of [[esg, cc], [esg, '****'], ['*', cc], ['*', '****']]) {
    const lineas = r.variantes[e]?.[c];
    if (lineas) return { esg: e, clave: c, lineas };
  }
  return null;
}

// Recorre el árbol de decisiones para un concepto. Devuelve alternativas [{cond: [...], ops: [...]}].
function resolver(lineas, cc, ctx, prof) {
  const salida = [];
  const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  const caminar = (path, actual, cond, opsPrevias) => {
    if (salida.length >= MAX_ALTERNATIVAS) return;
    const ops = [...opsPrevias];
    for (const l of lineas.filter(x => igual(x.niveles, path))) {
      for (const op of l.ops) {
        const o = { ...op, actual };
        if (op.k === 'renombra') actual = op.cc === '*' ? cc : op.cc;
        if (op.k === 'llama' && prof < MAX_PROFUNDIDAD) {
          const sub = ctx.modelo.reglas[op.regla];
          const elegido = sub && elegirLineas(sub, op.esg ?? ctx.esg, actual);
          if (elegido) o.sub = { regla: op.regla, esg: elegido.esg, clave: elegido.clave, alternativas: resolver(elegido.lineas, actual, ctx, prof + 1) };
        }
        ops.push(o);
      }
      if (l.tipo === 'D') {
        const dec = l.ops[l.ops.length - 1];
        const valores = [...new Set(lineas.filter(x => x.niveles.length === path.length + 1 && igual(x.niveles.slice(0, -1), path)).map(x => x.niveles[path.length]))];
        if (dec?.k === 'decide' && dec.por === 'claseTratamiento') {
          const v = ctx.clase(actual, dec.clase);
          if (v !== null) {
            const rama = valores.includes(v) ? v : valores.includes(v.trim() || '0') ? (v.trim() || '0') : valores.includes('*') ? '*' : null;
            const etiqueta = `PC${dec.clase} de ${actual} = "${v.trim() || ' '}"`;
            if (rama === null) { salida.push({ cond: [...cond, etiqueta + ' (sin rama: no sale)'], ops }); return; }
            return caminar([...path, rama], actual, [...cond, etiqueta], ops);
          }
        }
        for (const v of valores) caminar([...path, v], actual, [...cond, `${dec?.raw ?? 'decisión'} → ${v}`], ops);
        return;
      }
    }
    salida.push({ cond, ops });
  };
  caminar([], cc, [], []);
  return salida;
}

// Resume qué le pasa al concepto en un paso, mirando todas las alternativas (y subreglas).
function efectos(alternativas, cc, t512w, fecha, func) {
  const out = new Set();
  const escribeCC = a => a.ops.some(o => ((o.k === 'escribe') && (o.cc === '*' ? o.actual : o.cc) === cc) || o.k === 'acumula'
    || (o.sub && o.sub.alternativas.some(escribeCC)));
  let altsRT = 0;
  const recorrer = (alts, nivel) => {
    for (const a of alts) {
      const antesRT = out.has('entra en RT');
      out.delete('entra en RT');
      let sigue = false, modifica = false;
      for (const op of a.ops) {
        if (['operando', 'constante', 'lee', 'leeVar', 'campoInfotipo'].includes(op.k) && op.operador && op.operador !== '?') modifica = true;
        if (op.k === 'escribe' || op.k === 'resta') {
          const destino = op.cc === '*' ? op.actual : op.cc;
          if (destino === cc) {
            if (op.tabla === 'RT') out.add('entra en RT');
            else if (op.tabla === 'OT') sigue = true;
            else out.add(`escribe en ${op.tabla}`);
          } else if (ES_CC.test(destino)) out.add(`genera ${destino}${op.tabla !== 'OT' ? ' en ' + op.tabla : ''}`);
        }
        if (op.k === 'escribeVar') out.add(`guarda en &${op.var === '*' ? op.actual : op.var}`);
        if (op.k === 'acumula') {
          const ac = t512w ? vigente(t512w, op.actual, fecha)?.acumula ?? [] : [];
          out.add(ac.length ? `acumula en ${ac.join(' ')}` : 'acumula (ADDCU)');
        }
        if (op.k === 'otra' && op.codigo === 'ERROR') out.add('da ERROR');
        if (op.sub) recorrer(op.sub.alternativas, nivel + 1);
      }
      if (out.has('entra en RT') && nivel === 0) altsRT++;
      if (antesRT) out.add('entra en RT'); else if (nivel === 0) out.delete('entra en RT');
      if (sigue && modifica) out.add('lo modifica');
      else if (sigue) out.add('sigue');
      if (nivel === 0 && !escribeCC(a)) {
        const verbo = ['PORT', 'PLRT', 'PDT', 'PCRT', 'PGRT', 'PAIT'].includes(func) ? 'no lo toma' : 'se elimina';
        out.add(alts.length > 1 ? `${verbo} en alguna rama` : verbo);
      }
    }
  };
  recorrer(alternativas, 0);
  if (altsRT) out.add(altsRT === alternativas.length ? 'entra en RT' : 'entra en RT en alguna rama');
  return [...out];
}

// ---------------------------------------------------------------- utilidades para la pantalla y la IA
export function etiquetaPaso(modelo, id) {
  const p = modelo.pasos[id - 1];
  return `${p.esquema} ${p.linea}`;
}

export function textoRegla(modelo, nombre) {
  const r = modelo.reglas[nombre];
  if (!r) return '';
  const out = [];
  for (const [esg, porCC] of Object.entries(r.variantes))
    for (const [cc, lineas] of Object.entries(porCC))
      for (const l of lineas)
        out.push(`${r.nombre}${esg}${cc}${l.vk.padEnd(8)}${l.cont || ' '}${l.tipo || ' '}${l.ops.map(o => o.raw.padEnd(10)).join('')}${l.com ? '  ' + l.com : ''}`.trimEnd());
  return out.join('\n');
}

export function buscarVariable(modelo, ix, nombre) {
  nombre = nombre.replace(/^&/, '').trim().toUpperCase();
  const ev = [];
  for (const ref of ix.varEscribe[nombre] ?? []) for (const paso of ref.pasos) ev.push({ paso, tipo: 'escribe', ...ref });
  for (const ref of ix.varLee[nombre] ?? []) for (const paso of ref.pasos) ev.push({ paso, tipo: 'lee', ...ref });
  return ev.sort((a, b) => a.paso - b.paso);
}

// Texto compacto para pegar en un chat junto con el ticket.
export function contextoIA(modelo, res, cliente = '') {
  const L = [];
  const t = res.t512w;
  L.push(`# Configuración real del concepto ${res.cc}${cliente ? ' en ' + cliente : ''}`);
  L.push(`Fuente: RPDASC00 del esquema ${modelo.origen.esquemaRaiz} (listado ${modelo.origen.fechaListado}) + T512W vigente al ${res.fecha}. Agrupación de reglas usada: ${res.esg}.`);
  if (t) L.push(`Texto: ${t.texto}. Acumula en: ${t.acumula.join(' ') || 'ninguna'}. Clases de tratamiento informadas: ${clasesInformadas(t.vklas)}.`);
  if (res.recibeDe.length) L.push(`Se forma por acumulación de ${res.recibeDe.length} conceptos: ${res.recibeDe.join(' ')}.`);
  if (res.entradaRTCondicional.length) L.push(`Antes puede entrar en RT según la rama en: ${res.entradaRTCondicional.map(e => etiquetaPaso(modelo, e.paso) + ' (' + e.regla + ')').join(', ')}.`);
  L.push(res.entradaRT ? `Primer paso donde entra en RT: ${etiquetaPaso(modelo, res.entradaRT.paso)} (regla ${res.entradaRT.regla}).` : 'No se encontró en reglas el paso donde entra en RT (puede hacerlo una función estándar).');
  L.push('', '## Recorrido en orden de ejecución (se omiten los pasos donde el concepto solo sigue sin cambios)');
  for (const e of res.eventos.filter(x => x.relevante)) {
    const p = modelo.pasos[e.paso - 1];
    const ruta = p.ruta.map(id => etiquetaPaso(modelo, id)).concat(`${p.esquema} ${p.linea}`).join(' > ');
    const cond = p.cond.filter(c => c.tipo === 'IF').map(c => `${c.rama === 'SI' ? '' : 'NO '}${c.expr}`).join(', ');
    const cab = `- [${ruta}] ${p.func} ${p.par.filter(Boolean).join(' ')}${cond ? ` (si ${cond})` : ''}`;
    if (e.tipo === 'procesa') {
      L.push(`${cab} → regla ${e.regla} ${e.esg}/${e.clave}: ${e.efectos.join('; ')}`);
      for (const a of e.alternativas) L.push(`    ${a.cond.length ? a.cond.join(' / ') + ': ' : ''}${a.ops.map(o => o.raw).join('  ')}`);
    } else if (e.tipo === 'crea') L.push(`${cab} → la regla ${e.regla} (${e.esg}/${e.clave}${e.vk ? ' rama ' + e.vk : ''}) lo genera con ${e.op}`);
    else if (e.tipo === 'lee') L.push(`${cab} → la regla ${e.regla} (${e.esg}/${e.clave}) lo lee con ${e.op}`);
    else L.push(`${cab} → aparece como parámetro de la función`);
  }
  return L.join('\n');
}

export function clasesInformadas(vklas) {
  return [...vklas].map((v, i) => (v.trim() ? `PC${String(i + 1).padStart(2, '0')}=${v}` : null)).filter(Boolean).join(' ');
}
