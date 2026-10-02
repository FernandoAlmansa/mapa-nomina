// t512w.js — Lector de T512W exportada desde SE16N como texto con tabuladores.
// Se queda con una agrupación de países (por defecto 29) y conserva todos los períodos de validez,
// porque una retro de febrero se calcula con las clases vigentes en febrero.

const ALIAS = {
  molga: ['lohcm', 'agrupacion de paises', 'country grouping', 'cgrpg', 'molga'],
  lgart: ['cc-n.', 'cc-nomina', 'wage type', 'wt', 'lgart'],
  endda: ['valido a', 'end date', 'endda'],
  begda: ['valido de', 'start date', 'begda'],
  vklas: ['clases de tratamiento', 'processing classes', 'vklas'],
  kumul: ['acumulaciones', 'cumulations', 'kumul'],
  evkla: ['clases de evaluacion', 'evaluation classes', 'evkla'],
  texto: ['texto expl.cc-nomina', 'wage type long text', 'lgtxt'],
  textoCorto: ['txt.brv.', 'wage type short text', 'kztxt'],
};

const normalizar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
// El portapapeles de SAP (lista "sin convertir") separa columnas con | en vez de tabuladores.
// Se pasa todo a tabuladores para que el resto del lector no distinga de dónde vino.
export function normalizarSeparadores(texto) {
  const lineas = texto.replace(/\r/g, '').split('\n');
  if (lineas.some(l => l.includes('\t'))) return lineas.join('\n');
  return lineas
    .filter(l => !/^\s*[|-]?-{5,}[|-]?\s*$/.test(l))
    .map(l => (/^\s*\|.*\|\s*$/.test(l) ? l.trim().slice(1, -1).split('|').join('\t') : l))
    .join('\n');
}

// ¿El texto parece una T512W? (busca la fila de títulos en las primeras líneas)
export const pareceT512W = texto => normalizarSeparadores(texto.slice(0, 20000)).split('\n').slice(0, 40)
  .some(l => l.split('\t').length > 10 && /tratamiento|processing class/i.test(l));

const fechaISO = s => { const m = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(s.trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

export function parsearT512W(texto, molga = '29') {
  const lineas = normalizarSeparadores(texto).split('\n');
  const iCab = lineas.findIndex(l => l.split('\t').length > 10 && /tratamiento|processing class/i.test(l));
  if (iCab < 0) throw new Error('No encontré la fila de títulos de T512W (¿se exportó como texto con tabuladores?)');

  const titulos = lineas[iCab].split('\t').map(normalizar);
  const col = {};
  for (const [campo, nombres] of Object.entries(ALIAS)) {
    const idx = titulos.findIndex(t => nombres.includes(t));
    if (idx >= 0) col[campo] = idx;
  }
  for (const req of ['molga', 'lgart', 'begda', 'endda', 'vklas', 'kumul'])
    if (!(req in col)) throw new Error(`Falta la columna ${req} en la exportación de T512W`);

  const conceptos = {};
  let filas = 0;
  for (const l of lineas.slice(iCab + 1)) {
    const c = l.split('\t');
    if (c.length <= Math.max(col.vklas, col.kumul, col.endda) || c[col.molga]?.trim() !== molga) continue;
    const cc = c[col.lgart].trim();
    (conceptos[cc] ??= []).push({
      desde: fechaISO(c[col.begda]),
      hasta: fechaISO(c[col.endda]),
      vklas: c[col.vklas].padEnd(100).slice(0, 100),
      acumula: decodificarKUMUL(c[col.kumul].trim()),
      evkla: col.evkla != null ? (c[col.evkla] ?? '') : '',
      texto: col.texto != null ? (c[col.texto] ?? '').trim() : '',
      textoCorto: col.textoCorto != null ? (c[col.textoCorto] ?? '').trim() : '',
    });
    filas++;
  }
  for (const periodos of Object.values(conceptos)) periodos.sort((a, b) => a.desde.localeCompare(b.desde));
  return { molga, filas, conceptos };
}

// KUMUL: 24 dígitos hexa = 96 bits; el bit n (desde la izquierda, base 1) es la clase de acumulación n -> /1nn.
export function decodificarKUMUL(hex) {
  const clases = [];
  [...hex].forEach((d, i) => {
    const v = parseInt(d, 16);
    for (let b = 0; b < 4; b++) if (v & (8 >> b)) clases.push(i * 4 + b + 1);
  });
  return clases.map(n => '/1' + String(n).padStart(2, '0'));
}

// Clase de tratamiento nn de un concepto en una fecha (ISO). Devuelve ' ' si no está informada.
export function claseTratamiento(t512w, cc, nn, fecha = new Date().toISOString().slice(0, 10)) {
  const p = vigente(t512w, cc, fecha);
  return p ? p.vklas[Number(nn) - 1] : null;
}

export function vigente(t512w, cc, fecha = new Date().toISOString().slice(0, 10)) {
  return (t512w.conceptos[cc] || []).find(p => p.desde <= fecha && fecha <= p.hasta) || null;
}

// Deja solo la cabecera y las filas de una agrupación de países (para no subir 30 MB de todos los países).
export function filtrarT512W(texto, molga = '29') {
  const lineas = normalizarSeparadores(texto).split('\n');
  const iCab = lineas.findIndex(l => l.split('\t').length > 10 && /tratamiento|processing class/i.test(l));
  if (iCab < 0) throw new Error('No encontré la fila de títulos de T512W (¿se exportó como texto con tabuladores?)');
  const titulos = lineas[iCab].split('\t').map(normalizar);
  const iMolga = titulos.findIndex(t => ALIAS.molga.includes(t));
  return lineas.filter((l, i) => i <= iCab || l.split('\t')[iMolga]?.trim() === molga).join('\n');
}
