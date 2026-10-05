// Uso: node test/probar-log.mjs calc.txt 3645 [rpdasc00.txt]
import { readFileSync } from 'node:fs';
import { parsearLog, analizarConcepto, alinear, valoresFila, rtFinal, contextoIALog } from '../src/log.js';
import { parsearRPDASC00 } from '../src/rpdasc00.js';
const [, , fLog, cc = '3645', fR] = process.argv;
let t0 = Date.now();
const log = parsearLog(readFileSync(fLog, 'utf8'));
console.log(`pasos ${log.pasos.length}, conceptos ${log.conceptos.size}, ${Date.now() - t0} ms`, log.periodos);
let modelo = null;
if (fR) { modelo = parsearRPDASC00(readFileSync(fR, 'utf8')); console.log('alineación', alinear(log, modelo)); }
const et = p => p.idEsquema ? `${modelo.pasos[p.idEsquema - 1].esquema} ${modelo.pasos[p.idEsquema - 1].linea}` : `#${p.n}`;
t0 = Date.now();
const r = analizarConcepto(log, cc);
console.log(`\n${cc} ${r.texto}: aparece en ${r.eventos.length} pasos, relevantes ${r.eventos.filter(e => e.relevante).length} (${Date.now() - t0} ms)`);
for (const e of r.eventos.filter(e => e.relevante)) {
  console.log(`${et(e.paso)} ${e.paso.func} ${e.paso.par.filter(Boolean).join(' ')} — ${e.paso.texto}`);
  for (const c of e.cambios) console.log(`    ${c.tabla} ${c.tipo}: ${c.antes.map(f => valoresFila(c.tAntes, f).map(v => v.valor).join('/')).join(' | ') || '—'} → ${c.despues.map(f => valoresFila(c.t, f).map(v => v.valor).join('/')).join(' | ') || '—'}`);
  for (const o of e.ops) console.log('    op', o.regla, o.esg, o.vk, o.op);
  for (const g of e.genera) console.log('    genera', g.desde, g.regla, g.op);
}
console.log('entra RT', r.entraRT && et(r.entraRT.paso), 'infotipo', r.infotipo && et(r.infotipo.paso), 'nace IT', r.naceIT && et(r.naceIT.paso));
console.log('final', Object.keys(r.final));
const rt = rtFinal(log); console.log('RT final filas', rt?.t.filas.length);
if (process.env.IA) console.log(contextoIALog(log, r, { etiqueta: et }));
