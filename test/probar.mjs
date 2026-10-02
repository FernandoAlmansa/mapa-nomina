// Uso: node test/probar.mjs <rpdasc00.txt> [t512w.txt]
import { readFileSync } from 'node:fs';
import { parsearRPDASC00 } from '../src/rpdasc00.js';
import { parsearT512W, vigente, claseTratamiento } from '../src/t512w.js';

const leer = f => (b => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); } })(readFileSync(f)); // así se lee también en el navegador
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) process.exitCode = 1; };

const [, , fRpd, fT512w] = process.argv;
const m = parsearRPDASC00(leer(fRpd));
const paso = (esq, lin) => m.pasos.find(p => p.esquema === esq && p.linea === lin);
const etiqueta = id => { const p = m.pasos[id - 1]; return `${p.esquema} ${p.linea}`; };

console.log(`\nRPDASC00: ${m.pasos.length} pasos, ${Object.keys(m.reglas).length} reglas, raíz ${m.origen.esquemaRaiz}, listado del ${m.origen.fechaListado}`);
console.log(`Avisos: ${m.avisos.length}`); m.avisos.forEach(a => console.log('  ', a));

// 1) Subesquemas anidados
const tc00 = paso('TC00', '024');
ok(tc00?.ruta.map(etiqueta).join(' > ') === '2900 014 > 29T0 028 > XCOM 008', `TC00 024 cuelga de ${tc00?.ruta.map(etiqueta).join(' > ')}`);
const a78 = paso('2937', '023');
ok(a78?.ruta.map(etiqueta).join(' > ') === '2900 022 > 29GU 037 > 29GS 002', `2937 023 cuelga de ${a78?.ruta.map(etiqueta).join(' > ')}`);
ok(paso('2900', '066').ruta.length === 0, 'Al final se vuelve al esquema raíz');

// 2) Condiciones heredadas a través de los COPY
const ar97 = paso('29GS', '012');
const c = ar97.cond.map(x => `${etiqueta(x.paso)} ${x.tipo} ${x.expr} [${x.rama}]`);
console.log('   condiciones de 29GS 012:', c);
ok(c.length === 3 && c[0].includes('OCAT 07 [SINO]') && c[2].includes('IF R [SINO]'), '29GS 012 corre en ELSE de OCAT 07 / IF AR22 / ELSE de IF R');

// 3) Reglas y agrupaciones
ok(paso('29AN', '003').reglas.join() === 'AR13', 'PIT AR13 queda asociada a su regla');
ok(['*','1'].every(k => k in m.reglas.AR13.variantes), 'AR13 tiene variantes por agrupación * y 1');
ok(paso('2920', '011').subreglas.join() === '>ABH' || paso('2920', '011').reglas.includes('>ABH'), '>ABH asociada a 2920 011');
const llamada = m.reglas['>ABH'].variantes['*']['3006'].find(l => l.vk === '* < ****').ops[0];
ok(llamada.k === 'llama' && llamada.regla === '>ABH' && llamada.esg === 'A', `PPCYG>ABHA = llamada a >ABH agrupación A (${JSON.stringify(llamada)})`);

// 4) Operaciones: escrituras, variables, renombres, continuaciones
const x0101 = m.reglas.X010.variantes['1']['****'].find(l => l.vk === '3');
ok(x0101.ops.filter(o => o.k === 'escribe').map(o => o.cc).join() === '*,/001,/002', 'X010 ESG 1 rama 3: ADDWT * /001 /002');
const ar9 = m.reglas['<AR9'].variantes['*']['1000'].find(l => l.vk === 'Y');
ok(ar9.ops.some(o => o.k === 'escribeVar' && o.var === 'ZSAL'), '<AR9 1000 rama Y escribe la variable ZSAL');
const c127 = m.reglas.AR97.variantes['*']['/127'].find(l => l.cont === 'C');
ok(c127.tipo === 'D' && c127.decision === 'VAKEYGESES', 'AR97 /127 línea de continuación C con decisión VAKEY GESES');
ok(m.reglas.AR97.variantes['*']['/127'].some(l => l.ops.some(o => o.k === 'renombra' && o.cc === '/3AH')), 'AR97 renombra a /3AH');
const x011 = m.reglas.X011.variantes['*']['****'].find(l => l.vk === '*** Q');
ok(x011.com === 'FORCE BANK TRANSFER' && x011.ops.length === 3, 'Comentarios separados de las operaciones');
ok(paso('29ND', '004').log === true, 'Columna Log (*) leída en 29ND 004');

if (fT512w) {
  const t = parsearT512W(leer(fT512w));
  console.log(`\nT512W MOLGA ${t.molga}: ${t.filas} filas, ${Object.keys(t.conceptos).length} conceptos`);
  const v = vigente(t, '1000', '2026-09-30');
  console.log(`   1000 "${v.texto}": PC01=${v.vklas[0]} PC10=${v.vklas[9]} PC20=${v.vklas[19]} acumula en ${v.acumula.join(' ')}`);
  ok(claseTratamiento(t, '1000', '20', '2026-09-30') === '3', '1000 tiene clase de tratamiento 20 = 3 (AR75: ADDWT * ADDCU)');
  const en110 = Object.keys(t.conceptos).filter(cc => vigente(t, cc, '2026-09-30')?.acumula.includes('/110'));
  console.log(`   Conceptos vigentes que acumulan en /110: ${en110.length} (ej. ${en110.slice(0, 12).join(' ')})`);
  const p42 = t.conceptos['42AV'];
  console.log(`   42AV tiene ${p42.length} períodos: ${p42.map(p => p.desde + '→' + p.hasta).join(' | ')}`);
}
