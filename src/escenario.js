// escenario.js — Qué tipo de nómina se está mirando (regular, off-cycle, retro) y qué IF del esquema
// se cumplen en ese caso. Así el recorrido no muestra pasos que en esa nómina nunca corren.
//
// Condiciones estándar que se resuelven:
//   OCAT nn    off-cycle de la categoría nn
//   OCRN xxxx  off-cycle con el motivo xxxx
//   SPRN       liquidación especial (off-cycle)
//   R          período retroactivo (recálculo)
//   O          período original (no retro)
// Las demás (LPRC, CORR…, IF con regla de cliente) dependen del empleado: se muestran como "depende".

export const TODOS = 'todos';

// Opciones de tipo de nómina según los IF OCAT / OCRN que tenga el esquema del cliente
export function opcionesNomina(modelo) {
  const opciones = [{ valor: 'regular', texto: 'Nómina regular' }];
  const vistos = new Set();
  for (const p of modelo.pasos) {
    if (p.func !== 'IF') continue;
    const [clave, valor] = p.par.filter(Boolean);
    if (!['OCAT', 'OCRN'].includes(clave) || !valor) continue;
    const id = `${clave}:${valor}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const detalle = p.texto && !/^verifica$/i.test(p.texto) ? ` (${p.texto})` : '';
    opciones.push({ valor: id, texto: `Off-cycle ${clave === 'OCAT' ? 'categoría' : 'motivo'} ${valor}${detalle}` });
  }
  opciones.push({ valor: TODOS, texto: 'Todos los caminos (sin filtrar)' });
  return opciones;
}

export function crearEscenario(nomina, periodo) {
  if (nomina === TODOS) return { todos: true };
  const [clave, valor] = nomina === 'regular' ? [] : nomina.split(':');
  return { todos: false, offcycle: nomina !== 'regular', ocat: clave === 'OCAT' ? valor : null, ocrn: clave === 'OCRN' ? valor : null, retro: periodo === 'retro' };
}

// true / false si se sabe, null si depende del empleado o de una regla
export function evaluarIF(esc, par, modelo) {
  if (esc.todos) return null;
  const [p1, p2, p3] = par;
  if (p1 && modelo.reglas[p1]) return null;           // IF con regla de cliente
  const [clave, valor] = [p2, p3];
  switch (clave) {
    case 'OCAT': return esc.offcycle ? (esc.ocat ? esc.ocat === valor : null) : false;
    case 'OCRN': return esc.offcycle ? (esc.ocrn ? esc.ocrn === valor : null) : false;
    case 'SPRN': return esc.offcycle;
    case 'R': return esc.retro;
    case 'O': return !esc.retro;
    default: return null;
  }
}

// Estado de un paso en el escenario: 'corre', 'depende' (hay algún IF que no se puede saber) o 'no corre'
export function estadoPaso(esc, paso, modelo) {
  if (esc.todos) return { estado: 'corre', dudas: [] };
  const dudas = [];
  for (const c of paso.cond) {
    if (c.tipo !== 'IF') continue;
    const v = evaluarIF(esc, modelo.pasos[c.paso - 1].par, modelo);
    if (v === null) { dudas.push(c); continue; }
    if ((c.rama === 'SI') !== v) return { estado: 'no corre', motivo: c, dudas };
  }
  return { estado: dudas.length ? 'depende' : 'corre', dudas };
}

// Texto legible de una condición IF ("si es retroactivo", "si no: off-cycle categoría 07"…)
export function textoCondicion(c, modelo) {
  const p = modelo.pasos[c.paso - 1];
  const [p1, p2, p3] = p.par;
  const no = c.rama === 'SINO';
  let base;
  if (p1 && modelo.reglas[p1]) base = `${p.texto || 'condición de la regla'} (regla ${p1})`;
  else switch (p2) {
    case 'OCAT': base = `off-cycle categoría ${p3}`; break;
    case 'OCRN': base = `off-cycle motivo ${p3}`; break;
    case 'SPRN': base = 'liquidación especial'; break;
    case 'R': base = 'período retroactivo'; break;
    case 'O': base = 'período original'; break;
    case 'LPRC': base = 'hay resultados anteriores'; break;
    default: base = p.texto ? `${p.texto} (${c.expr})` : c.expr;
  }
  return (no ? 'si NO: ' : 'si: ') + base;
}
