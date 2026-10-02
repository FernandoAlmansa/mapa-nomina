import { readFileSync } from 'node:fs';
import { parsearRPDASC00 } from '../src/rpdasc00.js';
import { parsearT512W } from '../src/t512w.js';
import { construirIndice, buscarConcepto, contextoIA, etiquetaPaso, buscarVariable } from '../src/indice.js';
const leer = f => (b => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); } })(readFileSync(f));
const [, , fR, fT, ...ccs] = process.argv;
const m = parsearRPDASC00(leer(fR)), t = parsearT512W(leer(fT));
let t0 = Date.now(); const ix = construirIndice(m); console.log('índice', Date.now()-t0, 'ms; ESG', ix.esgs.join(','));
for (const cc of ccs) {
  t0 = Date.now();
  if (cc.startsWith('&')) { const ev = buscarVariable(m, ix, cc); console.log(`\n${cc}: ${ev.length} usos`, ev.slice(0,6).map(e=>`${etiquetaPaso(m,e.paso)} ${e.tipo} ${e.regla} ${e.op}`)); continue; }
  const r = buscarConcepto(m, ix, t, cc, { fecha: '2026-09-30', esg: '1' });
  console.log(`\n===== ${cc} (${Date.now()-t0} ms) eventos=${r.eventos.length}`);
  console.log(contextoIA(m, r, 'Halliburton').split('\n').slice(0, 40).join('\n'));
}
