// log.js — Lector del log de la PC00_M29_CALC exportado como texto (modo log).
// Todo corre en el navegador: el log tiene datos personales y nunca se guarda ni se sube.
//
// Formato (ver claude/analisis-log-calc.md en el proyecto):
//  - Línea de período: "09/2026 ( 01.09.2026 - 30.09.2026 )      Cálculo de la nómina regular en 09/2026"
//  - Cabecera de paso (6 espacios): función [6,11) par1 [12,16) par2 [17,21) par3 [22,26) par4 [27,31) texto [32..)
//    Se reconoce porque la siguiente línea no vacía es Entrada / Proceso / Salida.
//  - Secciones Entrada / Proceso / Salida; dentro, "Tabla XX" + tabla con "|".
//  - En Proceso, por concepto: "       3645 Texto" (7 espacios), "Regla  AgrReg ClvVa    Operación", guiones y
//    las líneas que corrieron: regla [6,10), agrupación [16], clave variable [20,28), operación [29..).

import { clasificarOp } from './ops.js';

const SECCION = { Entrada: 'entrada', Input: 'entrada', Proceso: 'proceso', Processing: 'proceso', Salida: 'salida', Output: 'salida' };
const RX_PERIODO = /^\s*(\d\d\/\d{4})\s*\(\s*(\d\d\.\d\d\.\d{4})\s*-\s*(\d\d\.\d\d\.\d{4})\s*\)\s*(.*?)\s*$/;
const RX_FUNC = /^[A-Z0-9<>=&\/*_%$#]{2,5}$/;
const RX_TABLA = /^\s+(?:Tabla|Table) (\S+)\s*$/;
const RX_BLOQUE_CC = /^ {7}([A-Z0-9\/%]{4}) (.*\S)\s*$/;
const RX_SIN_ENTRADAS = /No existen entradas|No entries/i;
const RX_NO_PROCESADO = /no se ha procesado|not processed/i;
const ES_CC = /^[A-Z0-9\/%]{1,8}$/;

// ¿Parece un log de la calc? Cabeceras de paso con Entrada/Proceso/Salida y tablas.
export function pareceLog(texto) {
  const muestra = texto.slice(0, 300000);
  return /^\s+(Entrada|Proceso|Salida|Input|Processing|Output)\s*$/m.test(muestra)
    && /^\s+(Tabla|Table) \S+\s*$/m.test(muestra);
}

// ---------------------------------------------------------------- números y filas
// "402.800,00" -> 402800 ; "1.584.162,69-" -> -1584162.69 ; "*566000,00" -> desborda (valor no confiable)
export function numero(txt) {
  const s = (txt ?? '').trim();
  if (!s) return null;
  const neg = s.endsWith('-');
  const limpio = s.replace(/^\*/, '').replace(/-$/, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const fmt = n => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Para mostrar: normaliza el formato (las columnas del log mezclan 402800,00 y 402.800,00)
export function mostrarNumero(txt) {
  const s = (txt ?? '').trim();
  if (!s) return '';
  if (s.startsWith('*')) return s; // desbordado: SAP no lo pudo mostrar completo
  const n = numero(s);
  return n == null ? s : fmt(n);
}

// Tabla con formato de IT/RT/ORT/OT: "|3 3645 Asignación 01      402800,00   1,00   402.800,00 |"
const esFormatoRT = cab => /^\|A\s+CC/.test(cab || '');

function leerFilaRT(f) {
  return {
    ind: f[1].trim(), cc: f.slice(3, 7).trim(), texto: f.slice(8, 19).trim(), splits: f.slice(19, 41).trim(),
    unidad: f.slice(41, 44).trim(), valor: f.slice(44, 54).trim(), cantidad: f.slice(54, 61).trim(), importe: f.slice(61, -1).trim(),
  };
}

function leerFilaPipes(cabeceras, f) {
  const celdas = f.split('|').slice(1, -1).map(c => c.trim());
  const out = {};
  cabeceras.forEach((h, i) => { if (h) out[h] = celdas[i] ?? ''; });
  return out;
}

// Índice concepto -> filas de una tabla (se arma al cerrar la tabla)
function indexarTabla(t) {
  t.porCC = new Map();
  if (!t.filas.length) return;
  const add = (cc, f) => { if (!t.porCC.has(cc)) t.porCC.set(cc, []); t.porCC.get(cc).push(f); };
  if (esFormatoRT(t.cab)) {
    t.formato = 'rt';
    for (const f of t.filas) { const cc = f.slice(3, 7).trim(); if (cc) add(cc, f); }
    return;
  }
  const cabs = (t.cab || '').split('|').slice(1, -1).map(c => c.trim());
  const iCC = cabs.findIndex(c => /^CC|CCN|^Concepto|^Wage/i.test(c));
  if (iCC < 0) return;
  t.formato = 'pipes';
  t.cabeceras = cabs;
  t.iCC = iCC;
  for (const f of t.filas) {
    const cc = (f.split('|')[iCC + 1] ?? '').trim();
    if (cc && ES_CC.test(cc)) add(cc, f);
  }
}

// Valores de una fila para mostrar: [{campo, valor}]
export function valoresFila(t, f) {
  if (t.formato === 'rt') {
    const r = leerFilaRT(f);
    return [
      r.splits && { campo: 'splits', valor: r.splits },
      r.valor && { campo: 'valor', valor: mostrarNumero(r.valor) },
      r.cantidad && { campo: 'cantidad', valor: mostrarNumero(r.cantidad) },
      r.importe && { campo: 'importe', valor: mostrarNumero(r.importe) },
    ].filter(Boolean);
  }
  const o = leerFilaPipes(t.cabeceras, f);
  return Object.entries(o).filter(([h, v], i) => i !== t.iCC && v && !/^Texto|^Txt|Moneda/i.test(h))
    .map(([h, v]) => ({ campo: h, valor: /^-?[\d.]+,\d+-?$/.test(v) ? mostrarNumero(v) : v }));
}

// Números de una fila (null si el campo está vacío o desbordado con *)
export function numerosFila(t, f) {
  if (t?.formato === 'rt') {
    const r = leerFilaRT(f);
    const n = x => (x && !x.startsWith('*') ? numero(x) : null);
    return { cc: r.cc, splits: r.splits, valor: n(r.valor), cantidad: n(r.cantidad), importe: n(r.importe) };
  }
  const o = t?.cabeceras ? leerFilaPipes(t.cabeceras, f) : {};
  const k = re => Object.keys(o).find(h => re.test(h));
  return { cc: (o[t?.cabeceras?.[t.iCC]] ?? '').trim(), splits: '', valor: numero(o[k(/Unidad/i)]), cantidad: numero(o[k(/^Cantidad$/i)]), importe: numero(o[k(/^Importe$/i)]) };
}

// Suma de importes (o cantidades) de un concepto en una tabla. En CRT se puede filtrar el tipo de acumulación (Y = anual).
export function sumaConcepto(t, cc, { campo = 'importe', ct = null } = {}) {
  const filas = t?.porCC?.get(cc) ?? [];
  let total = 0;
  for (const f of filas) {
    if (t.formato === 'rt') { total += numero(leerFilaRT(f)[campo === 'importe' ? 'importe' : campo === 'cantidad' ? 'cantidad' : 'valor']) ?? 0; continue; }
    const o = leerFilaPipes(t.cabeceras, f);
    if (ct && (o.CT ?? o.TA ?? '') !== ct) continue;
    const clave = Object.keys(o).find(h => campo === 'importe' ? /^Importe$/i.test(h) : /^Cantidad$/i.test(h));
    total += numero(o[clave]) ?? 0;
  }
  return total;
}

// Última versión de una tabla vista antes de un paso (Salida o Entrada)
export function tablaAntesDe(log, paso, nombre) {
  let t = paso.entrada.get(nombre) ?? null;
  if (t) return t;
  for (const p of log.pasos) {
    if (p === paso) break;
    t = p.salida.get(nombre) ?? p.entrada.get(nombre) ?? t;
  }
  return t;
}

export function textoFila(t, f) {
  if (t.formato === 'rt') return leerFilaRT(f).texto;
  const i = t.cabeceras?.findIndex(h => /^Texto|^Txt/i.test(h));
  return i >= 0 ? (f.split('|')[i + 1] ?? '').trim() : '';
}

// ---------------------------------------------------------------- parser
// Línea de regla ejecutada: regla [6,10), blancos [10,16), agrupación [16] (nunca vacía)
const esLineaRegla = l => l.length >= 17 && l[6] !== ' ' && !l.slice(10, 16).trim() && l[16] !== ' ';

export function parsearLog(texto) {
  const L = texto.split(/\r?\n/);
  const log = { periodos: [], pasos: [], conceptos: new Map(), lineas: L.length, bytes: texto.length };

  const siguienteNoVacia = i => { let j = i + 1; while (j < L.length && !L[j].trim()) j++; return j; };
  const cabecera = i => {
    const l = L[i];
    if (!l.startsWith('      ') || l.length < 8 || l[6] === ' ') return null;
    if (esLineaRegla(l)) return null;
    const func = l.slice(6, 11).trim();
    if (!RX_FUNC.test(func) || (l.length > 11 && l[11] !== ' ')) return null;
    const j = siguienteNoVacia(i);
    if (j >= L.length || !(L[j].trim() in SECCION)) return null;
    return { func, par: [l.slice(12, 16), l.slice(17, 21), l.slice(22, 26), l.slice(27, 31)].map(s => s.trim()), texto: l.slice(32).trim() };
  };
  // Título de subesquema (texto del COPY): línea suelta con 6 espacios, rodeada de vacías, antes de un paso
  const pareceTitulo = i => {
    const l = L[i];
    return l && /^ {6}[A-ZÁÉÍÓÚÑa-z]/.test(l) && !L[i - 1]?.trim() && !L[i + 1]?.trim() && !RX_TABLA.test(l) && !(l.trim() in SECCION);
  };

  let paso = null, seccion = null, tabla = null, bloque = null, titulos = [], periodo = -1;
  const cerrarTabla = () => { if (tabla) { indexarTabla(tabla); tabla = null; } };
  const nombreCC = (cc, txt) => {
    if (!cc || !ES_CC.test(cc)) return;
    const prev = log.conceptos.get(cc);
    if (!prev || (txt && txt.length > prev.length)) log.conceptos.set(cc, txt || prev || '');
  };

  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    const s = l.trim();

    if (i < 50 || !paso) {
      const m = RX_PERIODO.exec(l);
      if (m) { cerrarTabla(); bloque = null; log.periodos.push({ periodo: m[1], desde: m[2], hasta: m[3], texto: m[4] }); periodo = log.periodos.length - 1; continue; }
    }
    if (!s) { cerrarTabla(); bloque = null; continue; }

    const cab = l[6] !== ' ' && l.startsWith('      ') ? cabecera(i) : null;
    if (cab) {
      cerrarTabla(); bloque = null; seccion = null;
      paso = { n: log.pasos.length + 1, linea: i + 1, periodo, ...cab, titulos, entrada: new Map(), salida: new Map(), proceso: [], notas: [] };
      log.pasos.push(paso);
      titulos = [];
      continue;
    }
    if (!paso || seccion === null) {
      if (s in SECCION && paso) { seccion = SECCION[s]; continue; }
      if (pareceTitulo(i)) titulos.push(s);
      continue;
    }
    if (s in SECCION && /^ {6}\S/.test(l)) { cerrarTabla(); bloque = null; seccion = SECCION[s]; continue; }
    if (pareceTitulo(i) && !tabla && !bloque && seccion !== 'proceso') { titulos.push(s); continue; }
    if (pareceTitulo(i) && seccion === 'proceso' && !tabla && !bloque) {
      // En Proceso puede ser texto libre de la función o un título del subesquema siguiente:
      // es título si después viene una cabecera de paso o otro título que precede a una.
      const j = siguienteNoVacia(i);
      if (j < L.length && (cabecera(j) || (pareceTitulo(j) && cabecera(siguienteNoVacia(j))))) { titulos.push(s); continue; }
    }

    const mt = RX_TABLA.exec(l);
    if (mt) {
      cerrarTabla(); bloque = null;
      tabla = { nombre: mt[1], cab: null, filas: [], sep: 0, vacia: false };
      if (seccion === 'entrada' || seccion === 'salida') paso[seccion].set(tabla.nombre, tabla);
      else paso.notas.push(`Tabla ${tabla.nombre}`);
      continue;
    }
    if (tabla) {
      if (/^-+$/.test(s)) { tabla.sep++; continue; }
      if (RX_SIN_ENTRADAS.test(s)) { tabla.vacia = true; continue; }
      if (s.startsWith('|')) {
        if (tabla.sep < 2 && !tabla.cab) tabla.cab = s;
        else if (tabla.sep >= 2) {
          tabla.filas.push(s);
          if (esFormatoRT(tabla.cab)) nombreCC(s.slice(3, 7).trim(), null);
        }
      }
      continue;
    }

    if (seccion !== 'proceso') continue;

    // Bloque de un concepto en Proceso
    const mb = RX_BLOQUE_CC.exec(l);
    if (mb && /^\s+(Regla|Rule)\s/.test(L[i + 1] ?? '')) {
      bloque = { cc: mb[1], texto: mb[2], lineas: [], noProcesado: false };
      paso.proceso.push(bloque);
      nombreCC(mb[1], mb[2]);
      continue;
    }
    if (/^(Regla|Rule)\s+(AgrReg|ESG|PCR)/.test(s)) {
      if (!bloque) { bloque = { cc: null, texto: paso.notas.at(-1) ?? '', lineas: [], noProcesado: false }; paso.proceso.push(bloque); }
      continue;
    }
    if (bloque) {
      if (/^-+$/.test(s)) continue;
      if (RX_NO_PROCESADO.test(s)) { bloque.noProcesado = true; continue; }
      if (l.startsWith('      ') && esLineaRegla(l)) {
        const op = l.slice(29).trimEnd();
        bloque.lineas.push({ regla: l.slice(6, 10).trim(), esg: l[16]?.trim() || '', vk: l.slice(20, 28).trimEnd(), op, linea: i + 1 });
        continue;
      }
    }
    if (paso.notas.length < 40) paso.notas.push(s);
  }
  cerrarTabla();
  return log;
}

// ---------------------------------------------------------------- alineación con el esquema del cliente (opcional)
// Recorre en orden buscando la misma función + par1. Devuelve cuántos pasos quedaron alineados.
export function alinear(log, modelo) {
  let ptr = 0, ok = 0;
  for (const p of log.pasos) {
    p.idEsquema = null;
    if (!modelo) continue;
    for (let j = ptr; j < modelo.pasos.length; j++) {
      const e = modelo.pasos[j];
      if (e.func === p.func && (e.par[0] || '') === (p.par[0] || '')) { p.idEsquema = e.paso; ptr = j + 1; ok++; break; }
    }
  }
  return { alineados: ok, total: log.pasos.length };
}

// ---------------------------------------------------------------- análisis de un concepto
const TABLAS_RESULTADO = new Set(['IT', 'RT', 'OT', 'CRT', 'LRT', 'DT', 'GRT', 'VAR', 'ZL', 'BT', 'C0', 'C1', 'V0', 'ALP', 'AIT']);
const TABLAS_ANTERIORES = new Set(['ORT', 'OCRT', 'OLRT', 'ODT', 'OIT', 'OV0', 'OWPBP', 'OBENTAB']);

// Operación que no cambia nada por sí sola: decisiones, pase sin cambios, llamadas a subregla, lecturas de tabla
export function esTrivial(op) {
  const o = op.trim();
  if (!o) return true;
  if (o === 'ADDWT *' || o === 'ADDWT  *') return true;
  if (/^(VWTCL|VAKEY|OUTWP|VARGB|TABLE|PCY|GCY|NEXTR|PRINT)/.test(o)) return true;
  if (/^&GVP/.test(o)) return true;          // operación de cliente usada como decisión
  if (/^[A-Z0-9&]{2,5}\?/.test(o) || /^(AMT|NUM|RTE|WPALL|R51P1)\?/.test(o)) return true;   // comparaciones
  return false;
}

function cambioTabla(nombre, antes, despues) {
  const a = antes ?? [], d = despues ?? [];
  if (a.join('\n') === d.join('\n')) return null;
  const tipo = !a.length ? 'nuevo' : !d.length ? 'sale' : 'cambia';
  return { tabla: nombre, tipo, antes: a, despues: d };
}

export function analizarConcepto(log, ccIn) {
  const cc = ccIn.trim().toUpperCase().replace(/^&/, '');
  const estado = new Map();        // tabla -> filas del concepto (último estado conocido)
  const tablaRef = new Map();      // tabla -> última tabla vista (para formato de filas)
  const eventos = [];

  for (const p of log.pasos) {
    const cambios = [];
    const aparece = [];
    for (const [nombre, t] of p.entrada) {
      const filas = t.porCC?.get(cc) ?? [];
      if (filas.length) aparece.push({ seccion: 'entrada', tabla: nombre });
      estado.set(nombre, filas); tablaRef.set(nombre, t);
    }
    for (const [nombre, t] of p.salida) {
      const filas = t.porCC?.get(cc) ?? [];
      if (filas.length) aparece.push({ seccion: 'salida', tabla: nombre });
      const antes = p.entrada.has(nombre) ? (p.entrada.get(nombre).porCC?.get(cc) ?? []) : estado.get(nombre);
      const c = cambioTabla(nombre, antes, filas);
      if (c && (c.antes.length || c.despues.length)) cambios.push({ ...c, t, tAntes: p.entrada.get(nombre) ?? tablaRef.get(nombre) ?? t });
      estado.set(nombre, filas); tablaRef.set(nombre, t);
    }
    const bloques = p.proceso.filter(b => b.cc === cc);
    // Otras líneas (de otros conceptos o de la función) que escriben este concepto o su variable
    const genera = [];
    for (const b of p.proceso) {
      if (b.cc === cc) continue;
      let actual = b.cc;
      for (const ln of b.lineas) {
        if (!ln.op) continue;
        const o = clasificarOp(ln.op);
        if (o.k === 'renombra') actual = o.cc === '*' ? b.cc : o.cc;
        const destino = (o.k === 'escribe' || o.k === 'resta') ? (o.cc === '*' ? actual : o.cc)
          : (o.k === 'escribeVar' || o.k === 'restaVar') ? (o.var === '*' ? actual : o.var) : null;
        if (destino === cc && (o.cc !== '*' || actual !== b.cc)) genera.push({ desde: b.cc, regla: ln.regla, esg: ln.esg, op: ln.op, k: o.k, tabla: o.tabla ?? 'VAR' });
      }
    }
    if (!aparece.length && !bloques.length && !genera.length && !cambios.length) continue;

    const ops = bloques.flatMap(b => b.lineas.filter(x => x.op && !esTrivial(x.op)));
    const sinADDWT = bloques.some(b => !b.noProcesado && b.lineas.length && !b.lineas.some(x => /^(ADDWT|ADDNA|ADDNC)/.test(x.op.trim())));
    const tablasCambian = cambios.filter(c => !TABLAS_ANTERIORES.has(c.tabla));
    // PRINT solo muestra tablas: lo que cambia ahí ya cambió antes, en un paso que no lo imprime
    const relevante = (p.func !== 'PRINT' && tablasCambian.length > 0) || ops.length > 0 || genera.length > 0;
    eventos.push({ paso: p, cambios, bloques, genera, aparece, ops, sinADDWT, relevante, procesado: bloques.some(b => !b.noProcesado && b.lineas.length) });
  }

  // Resumen
  // Entra en RT: primera escritura en RT por regla (ADDWTE); si no se ve, la primera vez que aparece en una tabla RT
  const escribeRT = e => e.bloques.some(b => b.lineas.some(x => /^(ADDWTE|ADDNAE|ADDNCE)/.test(x.op.trim()))) || e.genera.some(g => g.tabla === 'RT');
  const rtPorTabla = eventos.find(e => e.cambios.some(c => c.tabla === 'RT' && c.tipo === 'nuevo'));
  const rtPorRegla = eventos.find(escribeRT);
  const entraRT = rtPorRegla && (!rtPorTabla || rtPorRegla.paso.n <= rtPorTabla.paso.n) ? rtPorRegla : rtPorTabla;
  if (entraRT) entraRT.relevante = true;
  const infotipo = eventos.find(e => e.aparece.some(a => /^P\d{4}$/.test(a.tabla)));
  const naceIT = eventos.find(e => e.cambios.some(c => ['IT', 'OT'].includes(c.tabla) && c.tipo === 'nuevo'));
  const generado = eventos.filter(e => e.genera.length);
  const anteriores = eventos.find(e => e.aparece.some(a => TABLAS_ANTERIORES.has(a.tabla)));
  const final = {};
  for (const nombre of ['RT', 'CRT', 'VAR', 'LRT', 'DT', 'BT']) {
    const filas = estado.get(nombre);
    if (filas?.length) final[nombre] = { t: tablaRef.get(nombre), filas };
  }
  const texto = log.conceptos.get(cc) ?? '';
  return { cc, texto, eventos, entraRT, infotipo, naceIT, generado, anteriores, final, periodo: log.periodos[0] ?? null };
}

// Conceptos de la última RT del log (para la pantalla inicial)
export function rtFinal(log) {
  for (let k = log.pasos.length - 1; k >= 0; k--) {
    const t = log.pasos[k].salida.get('RT') ?? log.pasos[k].entrada.get('RT');
    if (t?.filas.length) return { t, paso: log.pasos[k] };
  }
  return null;
}

// ---------------------------------------------------------------- texto para pegar en un chat con IA
export function contextoIALog(log, res, { etiqueta = p => `#${p.n}`, cliente = '' } = {}) {
  const per = res.periodo;
  const L = [];
  L.push(`# Recorrido real del concepto ${res.cc}${res.texto ? ' (' + res.texto + ')' : ''} según el log de la calc${cliente ? ' — ' + cliente : ''}`);
  if (per) L.push(`Período ${per.periodo} (${per.desde} - ${per.hasta}): ${per.texto}`);
  const filasTxt = (t, filas) => filas.map(f => valoresFila(t, f).map(v => `${v.campo} ${v.valor}`).join(', ') || '(sin valores)').join(' | ');
  L.push(res.final.RT ? `RT final: ${filasTxt(res.final.RT.t, res.final.RT.filas)}` : 'No llega a la RT final.');
  if (res.final.VAR) L.push(`Variable &${res.cc} al final: ${filasTxt(res.final.VAR.t, res.final.VAR.filas)}`);
  if (res.entraRT) L.push(`Entra en RT en ${etiqueta(res.entraRT.paso)} ${res.entraRT.paso.func} ${res.entraRT.paso.par.filter(Boolean).join(' ')}.`);
  L.push('', '## Pasos donde cambia (en orden de ejecución)');
  for (const e of res.eventos.filter(x => x.relevante)) {
    const p = e.paso;
    L.push(`- ${etiqueta(p)} ${p.func} ${p.par.filter(Boolean).join(' ')} — ${p.texto}`);
    for (const c of e.cambios) L.push(`    ${c.tabla} ${c.tipo}: ${c.antes.length ? filasTxt(c.tAntes, c.antes) : '—'} → ${c.despues.length ? filasTxt(c.t, c.despues) : '—'}`);
    for (const g of e.genera) L.push(`    lo genera la regla ${g.regla} al procesar ${g.desde ?? 'la función'}: ${g.op}`);
    for (const b of e.bloques) if (b.lineas.length) L.push(`    reglas que corrieron: ${b.lineas.map(x => `${x.regla} ${x.esg}${x.vk.trim() ? '/' + x.vk.trim() : ''} ${x.op}`.trim()).join(' ; ')}`);
  }
  return L.join('\n');
}
