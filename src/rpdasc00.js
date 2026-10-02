// rpdasc00.js — Parser del listado RPDASC00 (esquema con subesquemas y reglas expandidos).
// Entrada: el texto del listado guardado como archivo local (sin convertir).
// Salida: { pasos: [...], reglas: {...}, avisos: [...] } en orden de ejecución.
//
// Columnas fijas del listado:
//   esquema  -> [0,4) ESQ  [5,8) línea  [9,14) función  [15,19) [20,24) [25,29) [30,34) par1-4  [35] log  [36..] texto
//   regla    -> [0,4) regla  [4] agrupación (ESG)  [5,9) concepto  [9,17) clave variable  [17] línea de continuación
//               [18] tipo (D decisión / P,Z llamada)  [19..) operaciones de 10 caracteres + comentario
// Las líneas desactivadas del esquema NO aparecen en el RPDASC00 (verificado contra T52C1).

import { clasificarOp } from './ops.js';

const RX_ESQUEMA = /^(.{4})[ \t](\d{3})(?=\s|$)/;
const RX_SEPARADOR = /^-{10,}\s*$/;
const RX_CABECERA = /^(\d{2}\.\d{2}\.\d{2,4})\s+.*\S/;
const LLAMAN_ESQUEMA = new Set(['COPY', 'DAYPR', 'GRSUP']);

// ¿El texto parece un listado del RPDASC00? (al menos 3 líneas de esquema al principio)
export const pareceRPDASC00 = texto => texto.slice(0, 50000).replace(/\r/g, '').split('\n').filter(l => RX_ESQUEMA.test(l)).length >= 3;

export function parsearRPDASC00(texto) {
  const lineas = texto.replace(/\r/g, '').split('\n');
  const modelo = {
    formato: 'mapa-nomina/rpdasc00@1',
    origen: { tipo: 'RPDASC00', fechaListado: null, esquemaRaiz: null },
    pasos: [],
    reglas: {},
    avisos: [],
  };
  const pila = [];      // esquemas abiertos: { esquema, llamador }
  const conds = [];     // IF / LPBEG abiertos
  const bloques = [];   // BLOCK BEG abiertos
  let bloqueReglas = null; // { paso, porRegla: Map(nombre -> [{n, texto}]) }

  const aviso = (n, msg) => modelo.avisos.push({ linea: n, msg });

  const cerrarBloqueReglas = () => {
    if (!bloqueReglas) return;
    const paso = modelo.pasos[bloqueReglas.paso - 1];
    for (const [nombre, crudas] of bloqueReglas.porRegla) {
      const directa = paso.par.includes(nombre);
      (directa ? paso.reglas : paso.subreglas).push(nombre);
      const firma = crudas.map(c => c.texto.trimEnd()).join('\n');
      const existente = modelo.reglas[nombre];
      if (!existente) {
        modelo.reglas[nombre] = { nombre, firma, usadaEn: [], invocadaEn: [], variantes: construirVariantes(crudas, aviso) };
      } else if (existente.firma !== firma) {
        aviso(crudas[0].n, `La regla ${nombre} aparece con contenido distinto en el paso ${paso.paso}; se conserva la primera versión`);
      }
      modelo.reglas[nombre][directa ? 'usadaEn' : 'invocadaEn'].push(paso.paso);
    }
    bloqueReglas = null;
  };

  lineas.forEach((l, i) => {
    const n = i + 1;
    if (!l.trim() || RX_SEPARADOR.test(l)) return;
    const cab = RX_CABECERA.exec(l);
    if (cab && !RX_ESQUEMA.test(l)) { modelo.origen.fechaListado ??= cab[1]; return; }

    if (RX_ESQUEMA.test(l)) {
      cerrarBloqueReglas();
      let esquema, linea, func, par, log, texto;
      if (l[4] === '\t') {
        // Descarga "archivo local - texto con tabuladores": ESQ, línea, función, par1-4, log, texto
        const c = l.split('\t').map(s => s.trim());
        [esquema, linea, func] = [l.slice(0, 4), c[1], c[2] || ''];
        par = [c[3], c[4], c[5], c[6]].map(s => s || '');
        log = c[7] === '*';
        texto = c.slice(8).join(' ').trim();
      } else {
        // Listado en pantalla / sin convertir: columnas fijas
        const p = l.padEnd(40);
        esquema = p.slice(0, 4); linea = p.slice(5, 8);
        func = p.slice(9, 14).trim();
        par = [p.slice(15, 19), p.slice(20, 24), p.slice(25, 29), p.slice(30, 34)].map(s => s.trim());
        log = p[35] === '*';
        texto = p.slice(36).trim();
      }

      // Árbol de subesquemas: si cambia el prefijo, o volvemos a un ancestro o entramos a uno nuevo.
      if (!pila.length) {
        pila.push({ esquema, llamador: null });
        modelo.origen.esquemaRaiz = esquema;
      } else {
        const idx = pila.map(x => x.esquema).lastIndexOf(esquema);
        if (idx >= 0) pila.length = idx + 1;
        else {
          const llamador = modelo.pasos[modelo.pasos.length - 1];
          if (!LLAMAN_ESQUEMA.has(llamador.func) || !llamador.par.includes(esquema))
            aviso(n, `Subesquema ${esquema} sin un COPY/DAYPR/GRSUP que lo llame (paso anterior: ${llamador.esquema} ${llamador.linea} ${llamador.func})`);
          pila.push({ esquema, llamador: llamador.paso });
        }
      }

      const paso = {
        paso: modelo.pasos.length + 1,
        esquema, linea, func, par, log, texto,
        ruta: pila.slice(1).map(x => x.llamador),
        cond: conds.map(c => ({ ...c })),
        bloque: bloques.length ? bloques[bloques.length - 1].texto : null,
        reglas: [], subreglas: [],
        lineaListado: n,
      };
      modelo.pasos.push(paso);

      // Contexto de ejecución para los pasos siguientes
      const expr = par.filter(Boolean).join(' ');
      if (func === 'IF') conds.push({ paso: paso.paso, tipo: 'IF', expr, texto, rama: 'SI' });
      else if (func === 'ELSE') {
        const top = conds[conds.length - 1];
        if (top?.tipo === 'IF') top.rama = 'SINO'; else aviso(n, 'ELSE sin IF abierto');
      } else if (func === 'ENDIF') {
        if (conds[conds.length - 1]?.tipo === 'IF') conds.pop(); else aviso(n, 'ENDIF sin IF abierto');
      } else if (func === 'LPBEG') conds.push({ paso: paso.paso, tipo: 'LOOP', expr, texto, rama: null });
      else if (func === 'LPEND') {
        if (conds[conds.length - 1]?.tipo === 'LOOP') conds.pop(); else aviso(n, 'LPEND sin LPBEG abierto');
      } else if (func === 'BLOCK' && par[0] === 'BEG') bloques.push({ paso: paso.paso, texto });
      else if (func === 'BLOCK' && par[0] === 'END') {
        if (bloques.length) bloques.pop(); else aviso(n, 'BLOCK END sin BLOCK BEG');
      }
      return;
    }

    // Línea de regla: pertenece al último paso del esquema
    const ultimo = modelo.pasos[modelo.pasos.length - 1];
    if (!ultimo) { aviso(n, 'Línea de regla antes de la primera línea de esquema'); return; }
    if (l.length < 9) { aviso(n, `Línea no reconocida: "${l}"`); return; }
    bloqueReglas ??= { paso: ultimo.paso, porRegla: new Map() };
    const nombre = l.slice(0, 4);
    if (!bloqueReglas.porRegla.has(nombre)) bloqueReglas.porRegla.set(nombre, []);
    bloqueReglas.porRegla.get(nombre).push({ n, texto: l });
  });
  cerrarBloqueReglas();

  for (const c of conds) aviso(null, `${c.tipo} del paso ${c.paso} (${c.expr}) quedó sin cerrar`);
  if (bloques.length) aviso(null, `${bloques.length} BLOCK BEG sin cerrar`);
  for (const r of Object.values(modelo.reglas)) delete r.firma;
  return modelo;
}

// Agrupa las líneas de una regla por agrupación (ESG) y concepto, y parsea cada línea.
function construirVariantes(crudas, aviso) {
  const variantes = {};
  for (const { n, texto } of crudas) {
    const p = texto.padEnd(19);
    const esg = p[4], cc = p.slice(5, 9);
    const vk = p.slice(9, 17).trimEnd();
    const linea = {
      vk,
      niveles: vk ? vk.split(' ').filter(Boolean) : [],
      cont: p[17].trim(),
      tipo: p[18].trim(),
      ops: [],
      com: '',
    };
    const resto = p.slice(19);
    for (let i = 0; i < resto.length; i += 10) {
      const slot = resto.slice(i, i + 10);
      if (!slot.trim()) continue;
      if (slot[0] === ' ' || slot[0] === '"') { linea.com = resto.slice(i).trim(); break; }
      linea.ops.push(clasificarOp(slot));
    }
    if (linea.tipo === 'D' && linea.ops.length) linea.decision = linea.ops[linea.ops.length - 1].raw;
    if (!/^[*\d A-Z]$/.test(esg)) aviso(n, `Agrupación de regla inesperada "${esg}"`);
    variantes[esg] ??= {};
    (variantes[esg][cc] ??= []).push(linea);
  }
  return variantes;
}
