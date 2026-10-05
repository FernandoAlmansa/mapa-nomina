// sintomas.js — Entrada por síntoma ("¿Qué te reclaman?") y chequeos con nivel de confianza.
// Todo sale del log: si algo no se puede verificar con lo que hay, se dice qué falta en vez de concluir.

import { sumaConcepto, numerosFila, rtFinal, analizarConcepto } from './log.js';
import { explicarPaso, formulaFila } from './explicar.js';

const fmt = n => (n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Período del log y nómina en la que corre: "08/2026 … Cálculo de la nómina regular en 09/2026" = recálculo retroactivo.
// El PC00_M29_CALC muestra cada período recalculado como un log aparte: Fer los copia por separado.
export function infoPeriodo(log) {
  const p = log.periodos[0];
  if (!p) return null;
  const en = p.texto.match(/\ben (\d{2}\/\d{4})/)?.[1] ?? p.periodo;
  return { periodo: p.periodo, enNomina: en, esRetro: en !== p.periodo };
}

// Síntomas de la pantalla de inicio. destino: concepto a abrir o página especial (!XXX).
export function sintomasDelLog(log) {
  const rt = rtFinal(log);
  const enRT = new Set(rt ? rt.t.filas.map(f => f.slice(3, 7).trim()) : []);
  const hay = cc => enRT.has(cc) || log.conceptos.has(cc);
  const out = [];
  const gan = ['/4T2', '/4T1', '/4T0', '/4T4'].find(hay);
  if (gan || log.pasos.some(p => p.func === 'ARTAX')) out.push({ id: 'ganancias', titulo: 'Ganancias', sub: 'No retuvo, retuvo de más o devolvió', destino: gan ?? '/4T2' });
  if ([...enRT].some(cc => /^\/3/.test(cc))) out.push({ id: 'aportes', titulo: 'Aporte o contribución', sub: 'No coincide con el F.931 o el LSD', destino: '!APORTES' });
  if (hay('/560')) out.push({ id: 'neto', titulo: 'El neto no da', sub: 'Neto a cobrar /560', destino: '/560' });
  out.push({ id: 'concepto', titulo: 'Un concepto cobró mal', sub: 'Buscalo arriba o elegilo en la RT', destino: '' });
  const ip = infoPeriodo(log);
  const retro = { id: 'retro', titulo: 'Retroactivo', sub: ip?.esRetro ? `Qué cambió al recalcular ${ip.periodo}` : 'Diferencias de meses anteriores', destino: '!RETRO' };
  if (ip?.esRetro) out.unshift(retro); else out.push(retro);
  out.push({ id: 'error', titulo: 'La calc dio error o avisos', sub: 'Mensajes y cortes', destino: '!ERROR' });
  return out;
}

// ---------------------------------------------------------------- integridad del log
export function integridad(log) {
  const avisos = [];
  if (log.pasos.length < 80) avisos.push(`El log tiene solo ${log.pasos.length} pasos: puede estar incompleto o sin expandir (en SAP, "Expandir todo" antes de %pc).`);
  const conTablas = log.pasos.filter(p => p.entrada.size || p.salida.size).length;
  if (log.pasos.length && conTablas / log.pasos.length < 0.3) avisos.push('Muy pocos pasos traen tablas de Entrada/Salida: el log parece copiado sin expandir. Los importes por paso pueden faltar.');
  if (!rtFinal(log)) avisos.push('No encontré una tabla RT de salida: el log puede estar cortado antes del final de la calc.');
  return avisos;
}

// ---------------------------------------------------------------- chequeos de un concepto
const item = (estado, titulo, detalle = '') => ({ estado, titulo, detalle });   // estado: ok | atencion | info | nd

function importeEn(t, cc) { return t?.porCC?.has(cc) ? sumaConcepto(t, cc) : null; }

// Tema del concepto, para elegir los chequeos específicos
export function temaDe(cc) {
  if (/^\/4T|^\/4S|^DP0|^DP12$|^DMNI$|^DDSP$|^AP01$|^AP12$|^\/156$/.test(cc)) return 'ganancias';
  if (/^\/3/.test(cc)) return 'aportes';
  return 'general';
}

function chequeosGenerales(log, res) {
  const out = [];
  const rt = res.final.RT;
  out.push(rt ? item('ok', `Llega a la RT con ${fmt(sumaConcepto(rt.t, res.cc))}`, rt.filas.length > 1 ? `${rt.filas.length} líneas (splits): el total es la suma de todas.` : '')
    : item('info', 'No queda en la RT', 'Es un concepto de cálculo intermedio o una regla lo elimina o lo renombra: el último paso de "De dónde sale" dice cuál.'));
  const eliminado = res.eventos.filter(e => e !== res.entraRT && e.cambios.some(c => ['IT', 'OT'].includes(c.tabla) && c.tipo === 'sale'));
  if (eliminado.length) out.push(item('info', `Se elimina de la IT en ${eliminado.length} paso${eliminado.length > 1 ? 's' : ''}`, eliminado.slice(0, 3).map(e => `${e.paso.func} ${e.paso.par[0] || ''}`).join(', ') + (res.final.RT ? '; después vuelve a aparecer.' : '.')));
  const ip = infoPeriodo(log);
  if (ip?.esRetro && ['/560', '/551'].includes(res.cc)) {
    const r = resumenRetro(log);
    if (r.pagado != null && r.dif != null) out.unshift(item('info', `Período recalculado: en la RT de ${ip.periodo} queda lo ya pagado`,
      `Neto recalculado ${fmt(r.pagado + r.dif)} − ya pagado ${fmt(r.pagado)} (ORT /560) = diferencia /551 ${fmt(r.dif)}, que va a la tabla DT y se paga en la nómina ${ip.enNomina}.`));
  }
  return out;
}

// El importe que dejó una función estándar, ¿lo cambió una regla después? (caso tope de cliente)
function cambioPosterior(log, res, func) {
  const paso = log.pasos.find(p => p.func === func);
  if (!paso) return null;
  const tras = importeEn(paso.salida.get('IT'), res.cc);
  if (tras == null) return null;
  const rt = res.final.RT ? sumaConcepto(res.final.RT.t, res.cc) : null;
  if (rt == null && Math.abs(tras) < 0.01) return null;
  if (rt == null) return item('atencion', `${func} lo generó con ${fmt(tras)} pero no llega a la RT`, 'Una regla posterior lo elimina o lo renombra: mirá los pasos después de ' + func + ' en "De dónde sale".');
  if (Math.abs(rt - tras) < 0.02) return item('ok', `Ninguna regla cambia lo que calculó ${func}`, `Sale de ${func} con ${fmt(tras)} y entra igual a la RT.`);
  const quien = res.eventos.filter(e => e.paso.n > paso.n && e.relevante && e.bloques.length).map(e => e.bloques[0].lineas[0]?.regla).filter(Boolean);
  return item('atencion', `El estándar calculó ${fmt(tras)} y una regla lo dejó en ${fmt(rt)}`, `Regla${quien.length > 1 ? 's' : ''} de cliente posterior${quien.length > 1 ? 'es' : ''}: ${[...new Set(quien)].slice(0, 3).join(', ') || 'ver "De dónde sale"'}. Revisá si ese cambio es el esperado (por ejemplo un tope).`);
}

function chequeosGanancias(log, res, { escalas }) {
  const out = [];
  const paso = log.pasos.find(p => p.func === 'ARTAX');
  if (!paso) return [item('atencion', 'ARTAX no corrió en este log', 'El esquema no llamó a la función de Ganancias en esta nómina: revisá el IF que la rodea o el tipo de nómina.')];
  // Datos del empleado para el impuesto (tabla ARIMP que imprime el log)
  const arimp = log.pasos.map(p => p.entrada.get('ARIMP') ?? p.salida.get('ARIMP')).find(Boolean);
  if (arimp?.filas.length) {
    const cab = arimp.cab.split('|').slice(1, -1).map(s => s.trim()), val = arimp.filas[0].split('|').slice(1, -1).map(s => s.trim());
    out.push(item('info', 'Datos del empleado para Ganancias (tabla ARIMP)', cab.map((h, i) => `${h}: ${val[i] || '—'}`).join(' · ')));
  }
  const x = explicarPaso(log, paso, { escalas });
  if (x?.aviso) out.push(item('atencion', x.aviso.titulo, x.aviso.detalle));
  if (x && !x.resultados?.length) out.push(item('atencion', x.titulo, x.nota));
  for (const r of x?.resultados ?? []) {
    if (r.calculado == null) continue;
    const ok = Math.abs(r.calculado - r.real) < 0.02;
    out.push(item(ok ? 'ok' : 'atencion', `${r.cc} ${ok ? 'cierra' : 'no cierra'}: ${fmt(r.real)}`, ok ? r.nombre : `${r.nombre}. Recalculado ${fmt(r.calculado)}. ${r.nota ?? ''}`));
    if (!ok) break;   // la primera diferencia es la que importa; lo demás arrastra
  }
  if (res.cc === '/4T2' || res.cc === '/4T1') {
    const p = cambioPosterior(log, res, 'ARTAX');
    if (p) out.push(p);
    const v = res.final.RT ? sumaConcepto(res.final.RT.t, res.cc) : null;
    if (res.cc === '/4T2' && v != null && v < 0) out.push(item('info', 'Es una devolución', `El impuesto determinado acumulado es menor que lo retenido en el año: se devuelven ${fmt(-v)}.`));
  }
  return out;
}

function chequeosAportes(log, res) {
  const out = [];
  const paso = log.pasos.find(p => p.func === 'ARSES');
  if (!paso) return [item('atencion', 'ARSES no corrió en este log', 'El esquema no calculó seguridad social en esta nómina.')];
  const t = paso.salida.get('IT');
  const filas = t?.porCC?.get(res.cc) ?? [];
  if (!filas.length) out.push(item('info', `${res.cc} no sale de ARSES`, 'Lo arma una regla: mirá "De dónde sale".'));
  for (const f of filas) {
    const n = numerosFila(t, f), fo = formulaFila(t, f);
    const split = filas.length > 1 && n.splits ? ` (split ${n.splits})` : '';
    const PREF = ['/384', '/380', '/BC2', '/102', '/141'];
    const bases = fo?.bases ? [...fo.bases].sort((a, b) => (PREF.indexOf(a) + 1 || 99) - (PREF.indexOf(b) + 1 || 99)).slice(0, 2) : [];
    if (fo?.tipo === 'pct') out.push(item('ok', `${fmt(n.importe)}${split} = ${fo.pct.toLocaleString('es-AR', { maximumFractionDigits: 4 })} % × ${fmt(fo.importeBase)}`, `Base: ${bases.join(' (igual a ')}${bases.length > 1 ? ')' : ''}. Si el F.931 no coincide, compará primero el % y después la base.`));
    else out.push(item('nd', `${fmt(n.importe)}${split}: no encontré la base`, 'Ninguna base del paso da ese importe con el % de la fila: puede ser un importe fijo, un mínimo o una base que arma una regla de cliente.'));
  }
  const tope = importeEn(t, '/300'), rem = t?.porCC?.get('/102') ? numerosFila(t, t.porCC.get('/102')[0]).importe : null;
  if (tope != null && rem != null) out.push(item('info', rem > tope / (t.porCC.get('/300').length || 1) ? 'La remuneración supera el tope MOPRE' : 'La remuneración no llega al tope MOPRE', `Remuneración /102 ${fmt(rem)} · tope /300 ${fmt(tope / (t.porCC.get('/300').length || 1))}.`));
  const p = cambioPosterior(log, res, 'ARSES');
  if (p) out.push(p);
  return out;
}

// Nivel de confianza: alta si todo lo que se pudo recalcular cierra, media si hay algo sin verificar, baja si algo no cierra sin explicación
function confianza(items, { conCliente }) {
  const falta = [];
  if (!conCliente) falta.push('esquema y T512W del cliente (acumulaciones y clases de tratamiento)');
  if (items.some(i => i.estado === 'atencion')) return { nivel: 'baja', texto: 'hay al menos un punto que no cierra o cambia después de la función estándar', falta };
  if (items.some(i => i.estado === 'nd')) return { nivel: 'media', texto: 'hay importes que no se pudieron reconstruir con lo que trae el log', falta };
  return { nivel: falta.length ? 'media' : 'alta', texto: falta.length ? 'el recorrido cierra, pero falta información auxiliar' : 'el recorrido y los recálculos cierran con los datos del log', falta };
}

export function chequeosConcepto(log, res, { escalas = null, conCliente = false } = {}) {
  const tema = temaDe(res.cc);
  const items = [
    ...(tema === 'ganancias' ? chequeosGanancias(log, res, { escalas }) : tema === 'aportes' ? chequeosAportes(log, res) : []),
    ...chequeosGenerales(log, res),
  ];
  return { tema, items, confianza: confianza(items, { conCliente }) };
}

// ---------------------------------------------------------------- páginas por síntoma (todo el log)
// Retro: lo ya pagado (ORT = resultado original del período) contra lo recalculado (RT final)
// IMPRT L carga en ORT el último período (mes anterior); IMPRT O carga el resultado anterior de ESTE período, que es el que se compara.
function ortOriginal(log) {
  const imprtO = log.pasos.find(p => p.func === 'IMPRT' && p.par[0] === 'O');
  const x042 = log.pasos.find(p => p.func === 'PORT' && p.par[0] === 'X042');
  const desde = imprtO?.n ?? (x042 ? x042.n : null);
  if (desde == null) return null;
  for (const p of log.pasos) {
    if (p.n < desde) continue;
    const t = p.entrada.get('ORT') ?? p.salida.get('ORT');
    if (t?.filas.length) return t;
  }
  return null;
}
function filasDT(log) {
  const out = [], vistos = new Set();
  for (const p of log.pasos) for (const t of [...p.entrada.values(), ...p.salida.values()]) {
    if (t.nombre !== 'DT' || t.formato !== 'pipes') continue;
    for (const f of t.filas) {
      if (vistos.has(f)) continue;
      vistos.add(f);
      const c = f.split('|').slice(1, -1).map(s => s.trim());
      const o = Object.fromEntries(t.cabeceras.map((h, i) => [h, c[i]]));
      out.push({ cc: c[t.iCC], texto: o['Texto CC-nóminas'] ?? '', periodo: [o.PNómF, o.ANómF].filter(Boolean).join('/'), importe: numerosFila(t, f).importe, paso: p });
    }
  }
  return out;
}
function resumenRetro(log) {
  const ort = ortOriginal(log);
  const ip = infoPeriodo(log);
  const dt = filasDT(log).filter(d => d.cc === '/551' && (!d.periodo || d.periodo === ip?.periodo));
  return { pagado: ort?.porCC?.has('/560') ? sumaConcepto(ort, '/560') : null, dif: dt.length ? dt.reduce((n, d) => n + d.importe, 0) : null };
}

export function diagnosticoRetro(log) {
  const ip = infoPeriodo(log);
  const out = { periodos: log.periodos, info: ip, diferencias: filasDT(log), cambios: [], resumen: null };
  if (ip?.esRetro) {
    out.resumen = resumenRetro(log);
    for (const d of out.diferencias) d.entra = `se genera en ${d.paso.func} ${d.paso.par[0] || ''}`.trim() + ` y pasa a ${ip.enNomina}`;
    // Delta por concepto: resultado original (ORT) contra el recalculado (RT final)
    const ort = ortOriginal(log), rt = rtFinal(log)?.t;
    if (ort && rt) {
      const ccs = new Set([...(ort.porCC?.keys() ?? []), ...(rt.porCC?.keys() ?? [])]);
      for (const cc of ccs) {
        if (['/560', '/551', '/552', '/553'].includes(cc)) continue;
        const antes = ort.porCC?.has(cc) ? sumaConcepto(ort, cc) : 0, despues = rt.porCC?.has(cc) ? sumaConcepto(rt, cc) : 0;
        if (Math.abs(despues - antes) >= 0.01) out.cambios.push({ cc, texto: log.conceptos.get(cc) ?? '', antes, despues, dif: despues - antes });
      }
      out.cambios.sort((a, b) => a.cc.localeCompare(b.cc));
    }
  } else {
    for (const d of out.diferencias) {
      const r = analizarConcepto(log, d.cc);
      const entra = r.eventos.find(e => e.cambios.some(c => ['IT', 'OT'].includes(c.tabla) && c.tipo === 'nuevo')) ?? r.eventos.find(e => e.relevante) ?? r.eventos.find(e => e.procesado);
      d.entra = entra ? `${entra.paso.func} ${entra.paso.par[0] || ''}`.trim() : null;
    }
  }
  for (const d of out.diferencias) delete d.paso;
  return out;
}

const RX_MENSAJE = /\berror\b|no se ha encontrado|no se encontr|no existe|falta(n)? |inconsisten|advertencia|warning|no permitid|no v[aá]lid/i;
export function diagnosticoError(log) {
  const mensajes = [];
  for (const p of log.pasos) {
    for (const n of p.notas) if (RX_MENSAJE.test(n) && !/^(Tabla |\||-)/.test(n) && !/No existen entradas en esta tabla|^Variable \S+ no existe en la tabla VAR/i.test(n)) mensajes.push({ paso: p, texto: n });
    if (/error|warning/i.test(p.texto) && !mensajes.some(m => m.paso === p)) mensajes.push({ paso: p, texto: `Paso: ${p.texto}`, soloTitulo: true });
  }
  const ultimo = log.pasos.at(-1);
  return { mensajes, ultimo, integridad: integridad(log) };
}
