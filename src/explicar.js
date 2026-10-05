// explicar.js — Recalcula con los datos del log lo que hizo una función estándar, siguiendo el código de SAP
// (ver claude/funciones-estandar.md). Sirve para ver de dónde sale cada importe y si algo no cierra.

import { sumaConcepto, tablaAntesDe, numerosFila } from './log.js';

const cerca = (a, b) => Math.abs(a - b) < 0.02;

// IT del paso + CRT anual, como hace lcl_it_crt_accumulator
function acumulador(log, paso) {
  const it = paso.entrada.get('IT') ?? tablaAntesDe(log, paso, 'IT');
  const crt = tablaAntesDe(log, paso, 'CRT');
  return cc => {
    const vIT = sumaConcepto(it, cc), vCRT = sumaConcepto(crt, cc, { ct: 'Y' });
    return { cc, it: vIT, crt: vCRT, total: vIT + vCRT };
  };
}

// Escala art. 94: fila = [más de, hasta, fijo, %, sobre excedente de]
function tramo(escala, neta) {
  const f = escala.find(([d, h]) => neta >= d && (h == null || neta < h)) ?? escala[0];
  return { desde: f[0], hasta: f[1], fijo: f[2], pct: f[3], exc: f[4] };
}
const impuestoEscala = (escala, neta) => (neta <= 0 ? 0 : (t => t.fijo + (neta - t.exc) * t.pct / 100)(tramo(escala, neta)));
const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ARTAX con Ley 27.743 (CL_HRPAYAR_TAX_CALC_PROCESSOR → include C_061).
// Cada resultado se recalcula con el valor REAL del paso anterior (como la calculadora IIGG): así la primera
// diferencia marca dónde nace el error, sin arrastrarlo.
function explicarARTAX(log, paso, { escalas } = {}) {
  const salida = paso.salida.get('IT');
  if (!salida) return null;
  const sale = cc => sumaConcepto(salida, cc);
  const hay = cc => salida.porCC?.has(cc);
  if (hay('/4T3') || hay('/4TT')) return { titulo: 'ARTAX — Ley 27.725 (cedular)', nota: 'Este log usa el método de la Ley 27.725: el recálculo automático todavía no está armado para ese método.', bloques: [] };
  if (!hay('/4T0')) return { titulo: 'ARTAX', nota: 'ARTAX no generó /4T0: no calculó. Revisá ARIMP-IMPUE (empleado sujeto al impuesto) y la categoría de off-cycle (anticipos sin impuesto).', bloques: [] };
  const acc = acumulador(log, paso);
  const suma = (lista, signo = 1) => lista.map(cc => ({ ...acc(cc), signo }));
  const tot = filas => filas.reduce((n, f) => n + f.signo * f.total, 0);

  const ingresos = [...suma(['/156', 'OEGB', '/4S0', '/4S1', '/4S2', '/4S4', '/4S6']), ...suma(['AP01', 'AP12'], -1)];
  const bruto = tot(ingresos);
  const deduc = suma(['D156', 'DP01', 'DG01', 'DP12', 'OEDG']);
  const deducciones = tot(deduc);
  const r4T8 = sale('/4T8'), r4T0 = sale('/4T0'), r4T1 = sale('/4T1'), r4T2 = sale('/4T2');
  const alicuota = sumaConcepto(salida, '/4T1', { campo: 'cantidad' });
  const pagado = acc('/4T2');
  const resultados = [
    { cc: '/4T8', nombre: 'Deducción aplicada = deducciones con tope en la bruta', calculado: Math.min(bruto, deducciones), real: r4T8,
      nota: 'La diferencia nace acá: revisá D156, DG01, OEDG, DP01 y DP12 (un acumulado tomado como del mes, o una deducción que no debía entrar).' },
    { cc: '/4T0', nombre: 'Ganancia neta sujeta = bruta − /4T8', calculado: bruto - r4T8, real: r4T0,
      nota: 'Con el /4T8 de SAP igual no cierra: el problema está en la bruta (/156, SAC /4S*, OEGB) o en los aportes AP01/AP12.' },
  ];

  // /4T1 contra la escala oficial (catalogo/escala-ganancias.json), con el /4T0 real
  const per = log.periodos[0]?.periodo ?? '';           // "09/2026"
  const [mes, anio] = per.split('/');
  const esc = escalas?.[anio];
  let notaEscala = '';
  if (esc?.meses?.[mes]) {
    const t = tramo(esc.meses[mes], r4T0);
    const calc = impuestoEscala(esc.meses[mes], r4T0);
    const r = { cc: '/4T1', nombre: `Impuesto determinado = ${t.pct.toLocaleString('es-AR')} % sobre el excedente de ${fmt(t.exc)} + ${fmt(t.fijo)} (escala acumulada a ${NOMBRE_MES[+mes - 1]} ${anio}; SAP informa alícuota ${alicuota.toLocaleString('es-AR')} %)`, calculado: calc, real: r4T1 };
    if (Math.abs(calc - r4T1) >= 0.02) {
      const otra = [...Object.entries(esc.meses).map(([m, e]) => [`la escala de ${NOMBRE_MES[+m - 1]}`, e]), ['la escala anual (liquidación final)', esc.anual]]
        .find(([, e]) => Math.abs(impuestoEscala(e, r4T0) - r4T1) < 0.02);
      r.nota = otra ? `Con el /4T0 de SAP, ese /4T1 sale exacto con ${otra[0]}: o es una liquidación final, o T7ARTAX_RANGES tiene otra escala cargada para la fecha.`
        : 'No coincide con ninguna escala oficial de ese año sobre el /4T0 de SAP: revisá T7ARTAX_RANGES (grupo 01, o 99 en liquidación final) y la fecha de referencia de la escala (CL_HRPAYAR_TAX_DATE_GETTER).';
    }
    resultados.push(r);
  } else {
    resultados.push({ cc: '/4T1', nombre: `Impuesto determinado (escala T7ARTAX_RANGES, alícuota ${alicuota.toLocaleString('es-AR')} %)`, calculado: null, real: r4T1 });
    notaEscala = ` No tengo la escala oficial de ${anio || 'ese año'} para contrastar /4T1.`;
  }
  resultados.push({ cc: '/4T2', nombre: 'Impuesto del mes = /4T1 − ya retenido en el año (/4T2 del CRT)', calculado: r4T1 - pagado.crt, real: r4T2,
    nota: `Con el /4T1 de SAP no cierra: falta descontar ${fmt(r4T1 - pagado.crt - r4T2)}. Puede ser lo retenido por otros empleadores o el PAC, o un /4T2 del CRT distinto al que se ve en el log.` });

  return {
    titulo: 'Cómo calculó ARTAX (Ley 27.743)',
    nota: 'Todo es acumulado anual: lo del mes (IT) + lo acumulado en el año (CRT anual). Cada resultado se recalcula con el valor de SAP del paso anterior, así la primera diferencia marca dónde nace el error. La ley sale de T5F99K2 a la fecha de pago.' + notaEscala,
    bloques: [
      { titulo: 'Ganancia bruta', filas: ingresos, total: bruto },
      { titulo: 'Deducciones', filas: deduc, total: deducciones },
    ],
    resultados,
  };
}

const fmt = n => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ARTXD: CREA arma las deducciones personales del mes (DMNI mínimo no imponible, DDSP especial, cargas de familia…)
// a partir del IT0390 / F.572 y los topes de T7ARTAX_DEDUC; PROC las suma en DP01 y genera la 12ava (DP12 = DP01 / 12).
function nuevasEnPaso(paso) {
  const a = new Set(paso.entrada.get('IT')?.filas ?? []), t = paso.salida.get('IT');
  return t ? [...new Set(t.filas.filter(f => !a.has(f)).map(f => numerosFila(t, f).cc))] : [];
}
function explicarARTXD(log, paso) {
  const t = paso.salida.get('IT');
  if (!t) return null;
  if (paso.par[0] === 'CREA') {
    const cc = nuevasEnPaso(paso);
    return { titulo: 'ARTXD CREA: deducciones personales del mes', nota: 'Las arma desde el F.572 (IT0390) y los importes de T7ARTAX_DEDUC: mínimo no imponible (DMNI), deducción especial (DDSP), cargas de familia. Si un importe no es el esperado, revisá el IT0390 del empleado y T7ARTAX_DEDUC para la fecha.',
      bloques: [{ titulo: 'Generadas en este paso', filas: cc.map(c => ({ cc: c, it: sumaConcepto(t, c), crt: 0, total: sumaConcepto(t, c), signo: 1 })), total: cc.reduce((n, c) => n + sumaConcepto(t, c), 0) }], resultados: [] };
  }
  if (!t.porCC?.has('DP01')) return null;
  const crea = log.pasos.find(p => p.func === 'ARTXD' && p.par[0] === 'CREA' && p.n < paso.n);
  const comp = crea ? nuevasEnPaso(crea).filter(c => !['DP01', 'DP12'].includes(c)) : [];
  const dp01 = sumaConcepto(t, 'DP01'), dp12 = sumaConcepto(t, 'DP12');
  const filas = comp.map(c => { const v = sumaConcepto(t, c) || sumaConcepto(crea.salida.get('IT'), c); return { cc: c, it: v, crt: 0, total: v, signo: 1 }; });
  const suma = filas.reduce((n, f) => n + f.total, 0);
  const resultados = [{ cc: 'DP01', nombre: 'Deducciones personales del mes = suma de las generadas en ARTXD CREA', calculado: comp.length ? suma : null, real: dp01,
    nota: 'La suma de lo generado en CREA no da DP01: hay otra deducción personal que entra por otro lado (revisá el detalle técnico de ARTXD PROC).' }];
  if (t.porCC.has('DP12')) resultados.push({ cc: 'DP12', nombre: '12ava parte (SAC) = DP01 / 12', calculado: dp01 / 12, real: dp12, nota: 'DP12 no es DP01 / 12: revisá si es el mes del SAC o hay ajuste.' });
  return { titulo: 'ARTXD PROC: total de deducciones personales', nota: 'DP01 y DP12 entran después en ARTAX (deducciones, junto con D156, DG01 y OEDG).', bloques: comp.length ? [{ titulo: 'Componentes', filas, total: suma }] : [], resultados };
}

// ARSES: aportes y contribuciones = % × base. El % y el importe vienen en la fila del log (valor unitario = % × 1000);
// la base se identifica buscando qué concepto da justo ese importe.
function explicarARSES(log, paso) {
  const t = paso.salida.get('IT');
  if (!t) return null;
  const nuevas = new Set(nuevasEnPaso(paso));
  const lista = [];
  for (const f of t.filas) {
    const n = numerosFila(t, f);
    if (!nuevas.has(n.cc) || !/^\/3/.test(n.cc)) continue;
    const fo = formulaFila(t, f);
    if (!fo && !n.valor && !/^\/31[0-9]$/.test(n.cc)) continue;   // topes, bases y acumulados: van en la nota
    lista.push({ cc: n.cc, splits: n.splits, texto: log.conceptos.get(n.cc) ?? '', fo, importe: n.importe });
  }
  lista.sort((a, b) => a.cc.localeCompare(b.cc) || a.splits.localeCompare(b.splits));
  if (!lista.length) return null;
  const tope = t.porCC?.get('/300') ? sumaConcepto(t, '/300') / (t.porCC.get('/300').length || 1) : null;
  const rem = t.porCC?.get('/102') ? numerosFila(t, t.porCC.get('/102')[0]).importe : null;
  return {
    titulo: 'ARSES: aportes y contribuciones del mes',
    nota: `Base de aportes /380 (obra social, INSSJP) y /384 (jubilación) = remuneración /102 con tope MOPRE${tope ? ` (/300 = ${fmt(tope)}${rem != null ? `; la remuneración ${fmt(rem)} ${rem > tope ? 'supera el tope' : 'no llega al tope'}` : ''})` : ''}. Base de contribuciones /BC2 = remuneración menos la detracción de la Ley 27.430 (/CR2). Los % salen de la tabla ARSES del empleado (obra social, contrato, agrupación) y del customizing (T7AR32 aportes, T7AR33 contribuciones).`,
    bloques: [], resultados: [], lista,
  };
}

const EXPLICADORES = { ARTAX: explicarARTAX, ARTXD: explicarARTXD, ARSES: explicarARSES };

export function explicarPaso(log, paso, opts = {}) {
  const f = EXPLICADORES[paso.func];
  try { return f ? f(log, paso, opts) : null; } catch (e) { console.warn('explicar', paso.func, e); return null; }
}

export { cerca };

// ¿De qué cuenta sale el importe de una fila? valor × cantidad, o base × porcentaje (SAP guarda los % de aportes
// y contribuciones ×1000 en el valor unitario: 11.000,00 = 11 %). La base se busca entre las filas de la misma tabla.
export function formulaFila(t, f) {
  const n = numerosFila(t, f);
  if (!n.importe || !n.valor) return null;
  const ok = (a, b) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 1e-6);
  if (n.cantidad && ok(n.valor * n.cantidad, n.importe)) return { tipo: 'vxc', valor: n.valor, cantidad: n.cantidad };
  // Todas las bases que dan el importe (puede haber varias con el mismo monto, ej. /380 y /384)
  const cands = [];
  for (const g of t.filas) {
    if (g === f) continue;
    const b = numerosFila(t, g);
    if (!b.importe || b.cc === n.cc) continue;
    for (const [div, pct] of [[100000, n.valor / 1000], [100, n.valor]])
      if (ok(b.importe * n.valor / div, n.importe)) cands.push({ cc: b.cc, importe: b.importe, pct, mismoSplit: b.splits === n.splits });
  }
  if (!cands.length) return null;
  const mismo = cands.filter(c => c.mismoSplit);
  const elegidos = mismo.length ? mismo : cands;
  return { tipo: 'pct', pct: elegidos[0].pct, importeBase: elegidos[0].importe, bases: [...new Set(elegidos.filter(c => c.importe === elegidos[0].importe).map(c => c.cc))] };
}
