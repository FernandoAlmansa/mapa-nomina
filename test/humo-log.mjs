// Uso: node test/humo-log.mjs log1.txt [log2.txt ...]  — recorre todos los conceptos y páginas sin navegador
import { readFileSync } from 'node:fs';
import { parsearLog, analizarConcepto, rtFinal } from '../src/log.js';
import { htmlInicioLog, htmlConceptoLog, htmlAportes, htmlRetro, htmlErrores } from '../src/vistaLog.js';
import { sintomasDelLog, chequeosConcepto, integridad, diagnosticoRetro, diagnosticoError } from '../src/sintomas.js';
import { explicarPaso } from '../src/explicar.js';
const escalas = JSON.parse(readFileSync(new URL('../catalogo/escala-ganancias.json', import.meta.url)));
const catalogo = JSON.parse(readFileSync(new URL('../catalogo/funciones-29.json', import.meta.url)));
for (const f of process.argv.slice(2)) {
  const t0 = Date.now();
  const log = parsearLog(readFileSync(f, 'utf8'));
  console.log(`\n=== ${f}: ${log.pasos.length} pasos, ${log.conceptos.size} conceptos, ${Date.now() - t0} ms`);
  console.log('síntomas', sintomasDelLog(log).map(s => s.id ?? s.titulo).join(', '), '| integridad', JSON.stringify(integridad(log)));
  htmlInicioLog(log, rtFinal(log), '', { sintomas: sintomasDelLog(log), avisos: integridad(log) });
  const paso = log.pasos.find(p => p.func === 'ARSES');
  htmlAportes(log, paso ? explicarPaso(log, paso) : null, { esg: '*' });
  const r = diagnosticoRetro(log); htmlRetro(r);
  console.log('retro', JSON.stringify(r.periodos.map(p => p.periodo + ' ' + p.texto)), r.diferencias.map(d => `${d.cc} ${d.periodo} ${d.importe} entra ${d.entra}`).join(' ; '));
  const e = diagnosticoError(log); htmlErrores(e);
  console.log('errores', e.mensajes.length, e.mensajes.slice(0, 5).map(m => m.texto.slice(0, 80)));
  const ctx = { modelo: null, t512w: null, fecha: null, esg: '*' };
  let malos = 0;
  const t1 = Date.now();
  for (const cc of log.conceptos.keys()) {
    try {
      const res = analizarConcepto(log, cc);
      const ch = chequeosConcepto(log, res, { escalas, conCliente: false });
      htmlConceptoLog(log, res, { ctx, etiqueta: p => `#${p.n}`, ruta: () => '', nota: '', todos: false, hayModelo: false, textoT512: '', chequeos: ch, catalogo, escalas });
      for (const ev of res.eventos.filter(x => x.relevante)) explicarPaso(log, ev.paso, { escalas });
      for (const i of ch.items) if (i.estado === 'atencion') console.log(`  ATENCIÓN ${cc}: ${i.titulo} — ${i.detalle}`);
    } catch (err) { malos++; console.log('  FALLA', cc, err.stack.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log(`conceptos recorridos en ${Date.now() - t1} ms, fallas ${malos}`);
  // explicadores sobre todos los pasos estándar
  for (const p of log.pasos.filter(p => ['ARTAX', 'ARTXD', 'ARSES'].includes(p.func))) {
    const x = explicarPaso(log, p, { escalas });
    console.log(`  ${p.func} #${p.n}:`, x ? (x.resultados ?? []).map(r => `${r.cc} SAP ${r.real} calc ${r.calculado}`).join(' ; ') || (x.lista ?? []).length + ' filas' : 'sin explicación', x?.nota ?? '');
  }
}
