// vistaLog.js — Pantallas del modo log: carga, RT final y recorrido real de un concepto.
// Las operaciones que corrieron se traducen con las mismas funciones que la vista de reglas.

import { clasificarOp } from './ops.js';
import { describirOp, chipCC } from './vistaRegla.js';
import { valoresFila, textoFila, esTrivial, numerosFila, sumaConcepto } from './log.js';
import { explicarPaso, formulaFila } from './explicar.js';
import { vigente } from './t512w.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOMBRE_TABLA = { IT: 'IT', RT: 'RT', OT: 'OT', VAR: 'Variable', CRT: 'Acumulados (CRT)', LRT: 'LRT', DT: 'DT', ORT: 'RT anterior (ORT)', BT: 'Transferencias (BT)' };
const nombreTabla = (t, cc) => t === 'VAR' ? `Variable &${cc}` : /^P\d{4}$/.test(t) ? `Infotipo ${t.slice(1)}` : NOMBRE_TABLA[t] ?? t;

// ---------------------------------------------------------------- carga
export function htmlCargaLog(error = '') {
  return `<section class="vacio carga-log">
    <h2>Log de la calc</h2>
    <p>Pegá o soltá el log de la <b>PC00_M29_CALC</b> de un empleado y elegí un concepto: ves dónde nace, qué le cambia cada paso, con qué importes y dónde entra en RT, con las líneas de regla que corrieron.</p>
    <div class="zona zona-log" id="zona-log" tabindex="0" aria-label="Pegá acá el log con Ctrl+V o soltá el archivo">
      <p class="zona-titulo">Pegá acá con <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd>+<kbd>V</kbd> en Mac) o soltá el archivo</p>
      <div class="zona-acc">
        <button class="btn" type="button" id="btn-pegar-log">Pegar del portapapeles</button>
        <label class="btn primario">Elegir archivo<input type="file" id="f-log" accept=".txt,text/plain" hidden></label>
      </div>
    </div>
    ${error ? `<div class="estado-carga error">${error}</div>` : ''}
    <h3 class="titulo-sec">Cómo sacar el log de SAP</h3>
    <ol class="pasos-sap">
      <li>Corré la <b>PC00_M29_CALC</b> para el empleado con <b>Mostrar log</b> tildado.</li>
      <li>En la <i>Vista detallada del log</i>, tocá <b>Expandir todo</b> (las flechas dobles hacia abajo, marcadas abajo). Si no, la copia sale sin las tablas.</li>
      <li>En el campo de comandos escribí <kbd>%pc</kbd> y apretá Enter.
        <figure><img src="img/sap-log-1.png" alt="Vista detallada del log en SAP: botón Expandir todo marcado y %pc escrito en el campo de comandos" loading="lazy" width="1041" height="182"></figure></li>
      <li>En <i>Grabar lista fichero</i> elegí <b>Portapapeles</b> y confirmá con el tilde verde.
        <figure><img src="img/sap-log-2.png" alt="Ventana Grabar lista fichero con la opción Portapapeles elegida" loading="lazy" width="271" height="298" class="chica"></figure></li>
      <li>Volvé acá y pegá con <kbd>Ctrl</kbd>+<kbd>V</kbd>. Si preferís un archivo, elegí <b>No convertido</b> en el paso 4 y soltalo arriba.</li>
    </ol>
    <p class="nota">El log tiene datos personales: se lee <b>solo en este navegador</b>, no se guarda ni se sube a ningún lado y se pierde al cerrar la pestaña.</p>
    <p class="nota">Si además elegís el cliente en la barra de arriba, cada paso muestra su ubicación en el esquema y podés abrir las reglas completas.</p>
  </section>`;
}

// ---------------------------------------------------------------- textos comunes
export function describirLog(log, alin, nombreCliente) {
  const per = log.periodos[0];
  const partes = [];
  if (per) partes.push(`<b>${esc(per.periodo)}</b> (${esc(per.desde)} – ${esc(per.hasta)}) · ${esc(per.texto)}`);
  if (log.periodos.length > 1) partes.push(`${log.periodos.length} períodos en el log`);
  partes.push(`${log.pasos.length.toLocaleString('es-AR')} pasos`);
  if (alin && nombreCliente) partes.push(`con el esquema de ${esc(nombreCliente)}`);
  return partes.join(' · ');
}

const valoresTxt = (t, f) => valoresFila(t, f).filter(v => v.campo !== 'splits').map(v => `<span class="val"><span class="val-c">${esc(v.campo)}</span> ${esc(v.valor)}</span>`).join('') || '<span class="nota">sin valores</span>';
const filasHTML = (t, filas) => filas.map(f => {
  const sp = valoresFila(t, f).find(v => v.campo === 'splits');
  return `<div class="fila-val">${valoresTxt(t, f)}${sp ? `<span class="nota"> splits ${esc(sp.valor)}</span>` : ''}</div>`;
}).join('');

// ---------------------------------------------------------------- pantalla inicial con el log cargado
export function htmlInicioLog(log, rt, nota, { sintomas = [], avisos = [], retro = null } = {}) {
  const filas = rt ? rt.t.filas.map(f => {
    const cc = f.slice(3, 7).trim();
    const n = numerosFila(rt.t, f);
    const texto = log.conceptos.get(cc) || textoFila(rt.t, f);
    return `<tr data-q="${esc(cc)}" data-texto="${esc((cc + ' ' + texto).toLowerCase())}" tabindex="0"><td><code>${esc(cc)}</code></td><td>${esc(texto)}${n.splits ? ` <span class="nota">split ${esc(n.splits)}</span>` : ''}</td>
      <td class="n">${n.cantidad != null ? fmtN(n.cantidad) : ''}</td><td class="n">${n.importe != null ? fmtN(n.importe) : ''}</td></tr>`;
  }).join('') : '';
  return `<section class="vista-log inicio-log">
    <p class="nota-log">${nota}</p>
    ${avisos.map(a => `<div class="estado-carga error">${esc(a)}</div>`).join('')}
    ${retro?.esRetro ? `<div class="estado-carga">Este log es el <b>recálculo de ${esc(retro.periodo)}</b> dentro de la nómina ${esc(retro.enNomina)}: en la RT queda lo ya pagado y la diferencia viaja como /551. <button type="button" class="btn btn-chico" data-q="!RETRO">Ver qué cambió</button></div>` : ''}
    <h2 class="pregunta">¿Qué te reclaman?</h2>
    <div class="temas sintomas">${sintomas.map(x => `<button type="button" class="tema" ${x.destino ? `data-q="${esc(x.destino)}"` : 'data-accion="buscar"'}><b>${esc(x.titulo)}</b><span>${esc(x.sub)}</span></button>`).join('')}</div>
    ${rt ? `<div class="cab-rt"><h3 class="titulo-sec">RT final · ${rt.t.filas.length} líneas</h3>
      <input type="search" class="filtro-cc" id="filtro-rt" placeholder="Filtrar por concepto o texto" aria-label="Filtrar la RT"></div>
      <div class="tabla-scroll"><table class="tabla-rt"><thead><tr><th>CC</th><th>Texto</th><th class="n">Cantidad</th><th class="n">Importe</th></tr></thead><tbody>${filas}</tbody></table></div>`
    : '<p>El log no muestra una tabla RT de salida.</p>'}
  </section>`;
}

// ---------------------------------------------------------------- líneas de regla que corrieron, traducidas
function htmlLineas(ctx, cc, lineas) {
  let actual = cc, reglaPrev = null;
  const items = [];
  lineas.forEach((ln, k) => {
    if (ln.regla + ln.esg !== reglaPrev) {
      const sub = reglaPrev?.startsWith(ln.regla);
      items.push(`<li class="op-regla">${sub ? 'sigue en la misma regla,' : 'regla'} <button type="button" class="cc regla" data-q="${esc(ln.regla)}" data-tipo="regla">${esc(ln.regla)}</button> agrupación ${esc(ln.esg || '*')}</li>`);
      reglaPrev = ln.regla + ln.esg;
    }
    const raw = `${ln.vk.padEnd(8)} ${ln.op}`;
    if (!ln.op) {
      const resto = lineas.slice(k + 1).some(x => x.op);
      if (!resto) items.push(`<li class="op tenue"><span class="op-txt">Fin de la rama, sin más operaciones</span><code class="op-raw">${esc(raw)}</code></li>`);
      return;
    }
    const op = clasificarOp(ln.op);
    const d = describirOp({ ...ctx, original: cc }, op, actual);
    if (op.k === 'renombra') actual = op.cc === '*' ? cc : op.cc;
    const sig = lineas[k + 1];
    let rama = '';
    if (sig && sig.regla === ln.regla && sig.vk.trimEnd() !== ln.vk.trimEnd() && sig.vk.trimEnd().length > ln.vk.trimEnd().length) {
      const r = sig.vk.slice(ln.vk.trimEnd().length).trim() || sig.vk.trim();
      rama = ` <span class="valor-clase">→ ${esc(r)}</span>`;
    }
    items.push(`<li class="op ${d.cls}${esTrivial(ln.op) && !rama ? ' tenue' : ''}"><span class="op-txt">${d.txt}${rama}</span><code class="op-raw">${esc(raw)}</code></li>`);
  });
  return `<ol class="ops ops-log">${items.join('')}</ol>`;
}

// ---------------------------------------------------------------- qué hizo un paso con el concepto, en una frase
// Valores de una o varias filas (splits) en texto corto: "cantidad 1,00 · importe 402.800,00"
function corto(t, filas) {
  if (!filas.length) return '';
  const nums = filas.map(f => numerosFila(t, f));
  const campos = [['valor', 'valor'], ['cantidad', 'cantidad'], ['importe', 'importe']];
  if (nums.length === 1) return campos.filter(([k]) => nums[0][k] != null).map(([k, et]) => `${et} <b class="val">${fmtN(nums[0][k])}</b>`).join(' · ') || 'sin valores';
  const tot = nums.reduce((a, x) => a + (x.importe ?? 0), 0);
  return `${nums.length} líneas (splits) · importe total <b class="val">${fmtN(tot)}</b>`;
}

function difCampos(c) {
  if (c.antes.length !== 1 || c.despues.length !== 1) {
    const tot = (t, fs) => fs.reduce((a, f) => a + (numerosFila(t, f).importe ?? 0), 0);
    const ta = tot(c.tAntes, c.antes), td = tot(c.t, c.despues);
    if (Math.abs(ta - td) < 0.005) return `se reparte distinto entre splits (mismo importe total ${fmtN(td)})`;
    return `importe total ${fmtN(ta)} → <b class="val">${fmtN(td)}</b>${c.antes.length !== c.despues.length ? ` <span class="nota">(${c.antes.length} → ${c.despues.length} líneas)</span>` : ''}`;
  }
  const a = numerosFila(c.tAntes, c.antes[0]), d = numerosFila(c.t, c.despues[0]);
  const cambios = ['valor', 'cantidad', 'importe'].filter(k => a[k] !== d[k]).map(k =>
    a[k] == null ? `${k} <b class="val">${fmtN(d[k])}</b>` : d[k] == null ? `${k} ${fmtN(a[k])} → <i>vacío</i>` : `${k} ${fmtN(a[k])} → <b class="val">${fmtN(d[k])}</b>`);
  if (a.splits !== d.splits) cambios.push(`splits ${esc(a.splits || '—')} → ${esc(d.splits || '—')}`);
  return cambios.join(' · ') || 'cambia';
}

// Quién actuó en el paso: reglas que corrieron, regla que lo generó o la función estándar
function quien(e, catalogo, acum) {
  if (acum?.length) return `acumulación (ADDCU) en ${[...new Set(acum.map(a => a.regla))].slice(0, 2).map(r => `<button type="button" class="cc regla" data-q="${esc(r)}" data-tipo="regla">${esc(r)}</button>`).join(', ')}`;
  const reglas = [...new Set([...e.bloques.flatMap(b => b.lineas.map(x => x.regla)), ...e.genera.map(g => g.regla)])];
  if (reglas.length) return reglas.slice(0, 2).map(r => `regla <button type="button" class="cc regla" data-q="${esc(r)}" data-tipo="regla">${esc(r)}</button>`).join(', ');
  return `${esFuncionEstandar(catalogo, e.paso.func) ? 'función estándar' : 'función'} <b>${esc(e.paso.func)}</b>`;
}

// Conceptos que en este paso acumulan en cc (ADDCU + KUMUL de la T512W del cliente)
function acumuladores(e, res, ctx) {
  if (!ctx.t512w || !/^\/1\d\d$/.test(res.cc)) return [];
  const it = e.paso.entrada.get('IT');
  const out = [];
  for (const b of e.paso.proceso) {
    if (!b.cc || b.cc === res.cc) continue;
    const ln = b.lineas.find(x => x.op.trim() === 'ADDCU');
    if (!ln) continue;
    const acumula = vigente(ctx.t512w, b.cc, ctx.fecha)?.acumula ?? [];
    if (!acumula.includes(res.cc)) continue;
    out.push({ cc: b.cc, regla: ln.regla, importe: it ? sumaConcepto(it, b.cc) : 0 });
  }
  return out;
}

// Operaciones que explican el cambio (sin decisiones ni pases), traducidas
function como(e, res, ctx) {
  const ops = e.ops.filter(o => !/^(ADD(WT|NA|NC)[ ELIGCD]?\*$|ADDCU|ELIMI|RESET|FILLF)/.test(o.op.trim().replace(/\s+/g, ' ').replace(/^(ADD\w\w) ([ELIGCD]?)\*$/, '$1$2*'))).slice(0, 3);
  return ops.map(o => describirOp({ ...ctx, original: res.cc }, clasificarOp(o.op), res.cc).txt).join(' · ');
}

function queHizo(e, res, ctx, acum = []) {
  const partes = [];
  if (acum.length) {
    const orden = [...acum].sort((a, b) => Math.abs(b.importe) - Math.abs(a.importe));
    partes.push(`suma ${acum.length} concepto${acum.length > 1 ? 's' : ''}: ${orden.slice(0, 5).map(a => `${chipCC(ctx, a.cc)} <span class="val">${fmtN(a.importe)}</span>`).join(', ')}${acum.length > 5 ? ` y ${acum.length - 5} más` : ''}`);
  }
  const esRT = e === res.entraRT;
  for (const c of e.cambios) {
    if (/^O/.test(c.tabla) && c.tabla !== 'OT') continue;
    if (c.tabla === 'IT' || c.tabla === 'OT') {
      if (c.tipo === 'nuevo') partes.push(`${/^P\d{4}$/.test(e.paso.func) ? `lo lee del infotipo ${e.paso.func.slice(1)}` : 'aparece'} con ${corto(c.t, c.despues)}`);
      else if (c.tipo === 'cambia') partes.push(difCampos(c));
      else if (esRT) partes.push(`pasa a la RT con ${corto(c.tAntes, c.antes)}`);
      else partes.push('<b class="t-elim">se elimina</b> (no vuelve a la tabla)');
    } else if (c.tabla === 'RT') {
      partes.push(c.tipo === 'nuevo' ? `entra en RT con ${corto(c.t, c.despues)}` : c.tipo === 'sale' ? '<b class="t-elim">sale de la RT</b>' : `cambia en RT: ${difCampos(c)}`);
    } else if (c.tabla === 'VAR') partes.push(`guarda la variable &amp;${esc(res.cc)}: ${corto(c.t, c.despues) || 'en cero'}`);
    else partes.push(`${esc(nombreTabla(c.tabla, res.cc))}: ${c.tipo === 'nuevo' ? corto(c.t, c.despues) : c.tipo === 'sale' ? 'sale' : difCampos(c)}`);
  }
  if (esRT && !e.cambios.some(c => ['RT', 'IT'].includes(c.tabla))) partes.push('entra en RT');
  if (e.genera.length) {
    const it = e.paso.entrada.get('IT');
    const fuentes = [...new Set(e.genera.map(g => g.desde).filter(Boolean))];
    if (fuentes.length) partes.push(`lo arma desde ${fuentes.slice(0, 6).map(cc => `${chipCC(ctx, cc)}${it?.porCC?.has(cc) ? ` <span class="val">${fmtN(sumaConcepto(it, cc))}</span>` : ''}`).join(', ')}${fuentes.length > 6 ? ` y ${fuentes.length - 6} más` : ''}`);
    else partes.push(`lo genera la función con ${esc(e.genera[0].op)}`);
  }
  const c = como(e, res, ctx);
  if (!partes.length && c) {
    const renombra = e.ops.find(o => /^WGTYP=/.test(o.op.trim()) && !/\*$/.test(o.op.trim()));
    partes.push(renombra ? `lo usa para armar ${chipCC(ctx, renombra.op.trim().slice(6).trim())}: ${c}` : c);
  } else if (c) partes.push(`<span class="como">con: ${c}</span>`);
  return partes.join('; ') || 'pasa sin cambios';
}

// Fórmula de la fila resultante (valor × cantidad, base × %), si se puede deducir de los números
function htmlFormula(e, res, ctx) {
  const c = e.cambios.find(x => ['IT', 'OT', 'RT'].includes(x.tabla) && x.despues.length);
  if (!c) return '';
  const out = c.despues.map(f => {
    const fo = formulaFila(c.t, f);
    const n = numerosFila(c.t, f);
    if (!fo) return '';
    if (fo.tipo === 'vxc') return fo.cantidad === 1 ? '' : `= valor ${fmtN(fo.valor)} × cantidad ${fmtN(fo.cantidad)}`;
    const PREF = ['/384', '/380', '/BC2', '/102', '/103', '/104', '/105', '/115', '/124', '/141'];
    const bases = [...fo.bases].sort((a, b) => (PREF.indexOf(a) + 1 || 99) - (PREF.indexOf(b) + 1 || 99));
    return `= ${fo.pct.toLocaleString('es-AR', { maximumFractionDigits: 4 })} % sobre ${fmtN(fo.importeBase)} (${bases.slice(0, 2).map(b => chipCC(ctx, b)).join(' ')}${bases.length > 2 ? `<span class="nota" title="${esc(bases.slice(2).join(', '))} tienen el mismo importe"> +${bases.length - 2}</span>` : ''})${c.despues.length > 1 && n.splits ? ` <span class="nota">split ${esc(n.splits)}</span>` : ''}`;
  }).filter(Boolean);
  return out.length ? `<div class="formula">${out.join('<br>')}</div>` : '';
}

// ---------------------------------------------------------------- recálculo de una función estándar con los datos del log
const fmtN = n => (n == null ? '' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
function htmlExplicacion(log, paso, ctx, escalas, ccActual = '') {
  const x = explicarPaso(log, paso, { escalas });
  if (!x) return '';
  const bloque = b => `<tr class="exp-sub"><th colspan="4">${esc(b.titulo)}</th></tr>
    ${b.filas.filter(f => f.total).map(f => `<tr><td>${f.signo < 0 ? '−' : '+'} ${chipCC(ctx, f.cc)}</td><td class="n">${f.crt ? fmtN(f.it) : ''}</td><td class="n">${f.crt ? fmtN(f.crt) : ''}</td><td class="n">${fmtN(f.signo * f.total)}</td></tr>`).join('')}
    ${b.filas.some(f => !f.total) ? `<tr><td colspan="4" class="nota">En cero: ${b.filas.filter(f => !f.total).map(f => esc(f.cc)).join(', ')}</td></tr>` : ''}
    <tr class="exp-total"><td>Total</td><td></td><td></td><td class="n">${fmtN(b.total)}</td></tr>`;
  const res = x.resultados?.map(r => {
    const ok = r.calculado == null ? null : Math.abs(r.calculado - r.real) < 0.02;
    return `<li class="${ok === false ? 'no-cierra' : ''}">${chipCC(ctx, r.cc)} ${esc(r.nombre)}: <b class="val">${fmtN(r.real)}</b>
      ${ok === true ? '<span class="ef crea">cierra</span>' : ok === false ? `<span class="ef elim">no cierra: recalculado ${fmtN(r.calculado)} (dif. ${fmtN(r.real - r.calculado)})</span>${r.nota ? `<span class="culpable">${esc(r.nota)}</span>` : ''}` : ''}</li>`;
  }).join('') ?? '';
  const PREF = ['/384', '/380', '/BC2', '/102'];
  const lista = x.lista?.length ? `<div class="tabla-scroll"><table class="tabla-rt tabla-exp"><thead><tr><th>Concepto</th><th>Cálculo</th><th class="n">Importe</th></tr></thead><tbody>
    ${x.lista.map(r => {
      const bases = r.fo?.bases ? [...r.fo.bases].sort((a, b) => (PREF.indexOf(a) + 1 || 99) - (PREF.indexOf(b) + 1 || 99)) : [];
      const calc = !r.fo ? '<span class="nota">importe fijo</span>' : r.fo.tipo === 'vxc' ? `${fmtN(r.fo.valor)} × ${fmtN(r.fo.cantidad)}` : `${r.fo.pct.toLocaleString('es-AR', { maximumFractionDigits: 4 })} % × ${fmtN(r.fo.importeBase)} ${bases.slice(0, 2).map(b => chipCC(ctx, b)).join(' ')}`;
      return `<tr class="${r.cc === ccActual ? 'fila-actual' : ''}"><td>${chipCC(ctx, r.cc)} ${esc(r.texto)}${r.splits ? ` <span class="nota">split ${esc(r.splits)}</span>` : ''}</td><td>${calc}</td><td class="n">${fmtN(r.importe)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '';
  const noCierra = x.resultados?.some(r => r.calculado != null && Math.abs(r.calculado - r.real) >= 0.02);
  const anual = x.bloques.some(b => b.filas.some(f => f.crt));
  const tabla = x.bloques.length ? `<div class="tabla-scroll"><table class="tabla-rt tabla-exp"><thead><tr><th>Concepto</th>${anual ? '<th class="n">Este mes (IT)</th><th class="n">Año (CRT)</th>' : '<th></th><th></th>'}<th class="n">${anual ? 'Suma' : 'Importe'}</th></tr></thead><tbody>${x.bloques.map(bloque).join('')}</tbody></table></div>` : '';
  return `<details class="explicacion"${noCierra || !x.resultados?.length ? ' open' : ''}><summary>${esc(x.titulo)}${x.resultados?.length ? (noCierra ? ' <span class="ef elim">algo no cierra</span>' : ' <span class="ef crea">todo cierra</span>') : ''}</summary>
    ${res ? `<ul class="exp-res">${res}</ul>` : ''}${lista ? `<details class="exp-tabla"><summary>Ver todos (${x.lista.length}) con su % y base</summary>${lista}</details>` : ''}
    ${tabla ? (x.resultados?.length ? `<details class="exp-tabla"${noCierra ? ' open' : ''}><summary>De dónde salen los importes</summary>${tabla}</details>` : tabla) : ''}
    ${x.nota ? `<p class="nota">${esc(x.nota)}</p>` : ''}</details>`;
}

// ---------------------------------------------------------------- funciones estándar (catálogo extraído del driver HARCALC0)
const FUNC_DE_REGLAS = new Set(['PIT', 'PRT', 'PORT', 'PLRT', 'PDT', 'PAIT', 'PGRT', 'PCRT', 'PALP', 'MCOMP', 'ACTIO', 'PRINT', 'COPY', 'IF', 'ELSE', 'ENDIF']);
export const esFuncionEstandar = (catalogo, func) => Boolean(catalogo?.[func]) && !FUNC_DE_REGLAS.has(func) && !/^P\d{4}$/.test(func);

function htmlFuncion(catalogo, func, cc, ctx) {
  const f = catalogo[func];
  const lista = (titulo, items, fmt = x => `<code>${esc(x)}</code>`) => items?.length ? `<div><dt>${titulo}</dt><dd class="chips">${items.map(fmt).join(' ')}</dd></div>` : '';
  const nombra = f.conceptos.includes(cc);
  return `<details class="funcion-std"${nombra ? ' open' : ''}><summary>Función estándar <b>${esc(func)}</b> · <code>FORM ${esc(f.form)}</code> en ${esc(f.include)} (${f.lineas.toLocaleString('es-AR')} líneas)</summary>
    ${f.ficha ? `<div class="ficha-func">${f.ficha.map(p => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    ${nombra ? `<p class="nota">El código de ${esc(func)} nombra a ${esc(cc)} explícitamente.</p>` : ''}
    ${f.externo.length ? `<p class="nota pendiente">Parte de la lógica no está en el driver: ${esc(f.externo.join(' y '))}. Falta cargarla para explicar el cálculo completo.</p>` : ''}
    <dl class="dl-funcion">
      ${lista('Lee las tablas', f.tablas)}
      ${lista('Conceptos que nombra en el código', f.conceptos, c => chipCC(ctx, c))}
      ${lista('Clases de tratamiento', f.clases, c => `<code>PC${esc(c)}</code>`)}
      ${lista('Constantes T511K', f.constantes)}
      ${lista('Usa los parámetros del paso', f.parametros)}
      ${lista('Llama a', [...f.modulos, ...f.clases_globales])}
    </dl></details>`;
}

// ---------------------------------------------------------------- vista de un concepto: la respuesta primero, el detalle a pedido
function htmlTecnico(e, res, { ctx, hayModelo, catalogo }) {
  const p = e.paso;
  const cambios = e.cambios.length ? `<table class="cambios"><thead><tr><th>Tabla</th><th>Antes</th><th>Después</th></tr></thead><tbody>
      ${e.cambios.map(c => `<tr class="c-${c.tipo}"><th>${esc(nombreTabla(c.tabla, res.cc))}</th>
        <td>${c.antes.length ? filasHTML(c.tAntes, c.antes) : '<span class="nota">—</span>'}</td>
        <td>${c.despues.length ? filasHTML(c.t, c.despues) : `<span class="nota">${c.tabla === 'IT' && e === res.entraRT ? 'pasó a RT' : 'ya no está'}</span>`}</td></tr>`).join('')}
    </tbody></table>` : '';
  const genera = e.genera.map(g => `<p class="que">La regla <button type="button" class="cc regla" data-q="${esc(g.regla)}" data-tipo="regla">${esc(g.regla)}</button>
      ${g.desde ? `al procesar ${chipCC(ctx, g.desde)}` : 'en la función'}: ${describirOp({ ...ctx, original: g.desde }, clasificarOp(g.op), g.desde).txt} <code class="op-raw">${esc(g.op)}</code></p>`).join('');
  const bloques = e.bloques.map(b => b.noProcesado
    ? '<p class="nota">El paso recorre el concepto pero la regla no lo procesa (sin línea propia y sin GEN/Pnn).</p>'
    : htmlLineas(ctx, res.cc, b.lineas)).join('');
  const reglas = [...new Set([...e.bloques.flatMap(b => b.lineas.map(x => x.regla)), ...e.genera.map(g => g.regla)])];
  const crudas = e.bloques.flatMap(b => b.lineas.map(x => `${x.regla.padEnd(4)}      ${(x.esg || ' ')}   ${x.vk.padEnd(8)} ${x.op}`));
  const func = esFuncionEstandar(catalogo, p.func) ? htmlFuncion(catalogo, p.func, res.cc, ctx) : '';
  return `${cambios}${genera}${bloques}${func}
    <div class="pie-paso">${hayModelo ? reglas.map(r => `<button type="button" class="btn btn-chico" data-q="${esc(r)}" data-tipo="regla">Abrir regla ${esc(r)}</button>`).join('') : ''}
      <span class="nota">${esc(p.func)} ${esc(p.par.filter(Boolean).join(' '))} · ${esc(p.texto)} · línea ${p.linea.toLocaleString('es-AR')} del log</span>
      ${crudas.length ? `<details class="crudo"><summary>Líneas crudas</summary><pre class="regla">${esc(crudas.join('\n'))}</pre></details>` : ''}</div>`;
}

const ICONO = { ok: '✓', atencion: '!', info: 'i', nd: '?' };
function htmlChequeos(ch) {
  if (!ch?.items.length || (ch.items.length <= 1 && ch.items.every(i => i.estado === 'ok'))) return '';
  const c = ch.confianza;
  return `<section class="chequeos">
    <div class="ch-cab"><h3 class="titulo-sec">Chequeos</h3>
      <span class="confianza c-${c.nivel}" title="${esc(c.falta.length ? 'Falta: ' + c.falta.join('; ') : '')}">Confianza ${c.nivel}</span>
      <span class="nota">${esc(c.texto)}${c.falta.length ? `. Falta: ${esc(c.falta.join('; '))}` : ''}.</span></div>
    <ul>${ch.items.map(i => `<li class="ch-${i.estado}"><span class="ch-ic" aria-hidden="true">${ICONO[i.estado]}</span><div><b>${esc(i.titulo)}</b>${i.detalle ? `<p>${esc(i.detalle)}</p>` : ''}</div></li>`).join('')}</ul>
  </section>`;
}

export function htmlConceptoLog(log, res, { ctx, etiqueta, ruta, nota, todos, hayModelo, textoT512, catalogo = null, escalas = null, chequeos = null }) {
  const texto = res.texto || textoT512 || '';
  const relevantes = res.eventos.filter(e => e.relevante);
  const visibles = todos ? res.eventos : relevantes;

  // El paso que define el importe final: el último cambio de importe antes de entrar en RT
  const hasta = res.entraRT ? res.eventos.indexOf(res.entraRT) : res.eventos.length - 1;
  let clave = null;
  for (let k = hasta; k >= 0 && !clave; k--) {
    const e = res.eventos[k];
    if (!e.relevante) continue;
    const c = e.cambios.find(x => ['IT', 'OT', 'RT'].includes(x.tabla) && x.despues.length);
    if (!c) continue;
    const imp = f => numerosFila(c.t, f).importe;
    const antes = c.antes.map(f => numerosFila(c.tAntes, f).importe ?? 0).reduce((a, b) => a + b, 0);
    const despues = c.despues.map(f => imp(f) ?? 0).reduce((a, b) => a + b, 0);
    if (c.tipo === 'nuevo' ? despues !== 0 : antes !== despues) clave = e;
  }

  // Cabecera con la respuesta corta
  const rt = res.final.RT;
  const rtNums = rt ? rt.filas.map(f => numerosFila(rt.t, f)) : [];
  const rtTotal = rtNums.reduce((a, n) => a + (n.importe ?? 0), 0);
  const rtCant = rtNums.reduce((a, n) => a + (n.cantidad ?? 0), 0);
  const extra = [
    res.final.CRT ? `acumulado anual (CRT): ${res.final.CRT.filas.map(f => fmtN(numerosFila(res.final.CRT.t, f).importe ?? 0)).join(' / ')}` : '',
    res.final.VAR ? `variable &amp;${esc(res.cc)}: ${fmtN(sumaConcepto(res.final.VAR.t, res.cc))}` : '',
  ].filter(Boolean);
  const cabecera = `<header class="cc-cab">
      <a href="#" class="volver" id="volver-rt">← RT final</a>
      <div class="cc-tit"><h2>${esc(res.cc)}</h2><p>${esc(texto || 'Sin texto en el log')}</p></div>
      <div class="cc-rt">${rt
        ? `<span class="dato-et">RT final</span><b class="monto">${fmtN(rtTotal)}</b>${rtCant ? `<span class="nota">cantidad ${fmtN(rtCant)}${rtNums.length > 1 ? ` · ${rtNums.length} splits` : ''}</span>` : ''}`
        : '<span class="dato-et">RT final</span><span class="nota">no llega a la RT</span>'}</div>
      <div class="cc-acc"><button class="btn primario" type="button" id="btn-ia-log">Copiar para IA</button>
        ${hayModelo ? `<button class="btn" type="button" id="btn-ver-esquema" data-cc="${esc(res.cc)}">Ver todas las ramas en el esquema</button>` : ''}</div>
      ${extra.length ? `<p class="nota cc-extra">${extra.join(' · ')}</p>` : ''}
    </header>`;

  // De dónde sale: una línea por paso que cambia algo, con el paso que define el importe marcado
  const fila = e => {
    const p = e.paso;
    const rutaTxt = ruta(p);
    const esClave = e === clave, esRT = e === res.entraRT;
    const exp = e.relevante || e.cambios.length ? htmlExplicacion(log, p, ctx, escalas, res.cc) : '';
    const acum = e.relevante ? acumuladores(e, res, ctx) : [];
    const secundario = e.relevante && !e.cambios.length && !e.genera.length && !acum.length && e !== res.entraRT;
    const ficha = esFuncionEstandar(catalogo, p.func) && catalogo[p.func].ficha && (esClave || exp) && !e.bloques.length
      ? `<details class="ficha-corta"><summary>Qué hace ${esc(p.func)}</summary>${catalogo[p.func].ficha.map(x => `<p>${esc(x)}</p>`).join('')}</details>` : '';
    return `<li class="paso-log${esClave ? ' clave' : ''}${esRT ? ' es-rt' : ''}${e.relevante ? '' : ' solo-pasa'}${secundario ? ' secundario' : ''}" id="paso-l${p.n}">
      <div class="pl-linea">
        <span class="pl-donde" title="${esc(rutaTxt.replace(/<[^>]+>/g, ''))}">${esc(etiqueta(p))}</span>
        <span class="pl-quien">${quien(e, catalogo, acum)}</span>
        <span class="pl-que">${e.relevante ? queHizo(e, res, ctx, acum) : 'pasa sin cambios'}</span>
        ${esClave ? '<span class="marca">acá se define el importe</span>' : ''}${esRT ? '<span class="marca rt">entra en RT</span>' : ''}
      </div>
      ${esClave || e.cambios.some(c => c.tipo === 'nuevo' && ['IT', 'OT'].includes(c.tabla)) ? htmlFormula(e, res, ctx) : ''}
      ${exp}${ficha}
      <details class="tecnico"><summary>Detalle técnico</summary>${htmlTecnico(e, res, { ctx, hayModelo, catalogo })}</details>
    </li>`;
  };

  const sinCambios = res.eventos.length - relevantes.length;
  return `<section class="vista-log vista-cc">
    <p class="nota-log">${nota}</p>
    ${cabecera}
    ${htmlChequeos(chequeos)}
    <h3 class="titulo-sec">De dónde sale</h3>
    ${visibles.length ? `<ol class="camino">${visibles.map(fila).join('')}</ol>` : `<p>En este log ${esc(res.cc)} no cambia en ningún paso.</p>`}
    <p class="nota pie-camino">${sinCambios ? `${todos ? 'Se muestran' : 'Hay'} ${sinCambios} pasos más donde ${esc(res.cc)} solo pasa sin cambios${todos ? '' : ' (tildá "Mostrar pasos donde solo pasa" para verlos)'}.` : ''}</p>
  </section>`;
}

// ---------------------------------------------------------------- páginas por síntoma
const volver = '<a href="#" class="volver" id="volver-rt">← Inicio de la calc</a>';

export function htmlAportes(log, x, ctx) {
  if (!x?.lista?.length) return `<section class="vista-log">${volver}<h2 class="pregunta">Aportes y contribuciones</h2><p>No encontré la función ARSES en este log.</p></section>`;
  const PREF = ['/384', '/380', '/BC2', '/102'];
  const filas = x.lista.map(r => {
    const bases = r.fo?.bases ? [...r.fo.bases].sort((a, b) => (PREF.indexOf(a) + 1 || 99) - (PREF.indexOf(b) + 1 || 99)) : [];
    return `<tr data-q="${esc(r.cc)}" tabindex="0"><td><code>${esc(r.cc)}</code></td><td>${esc(r.texto)}${r.splits ? ` <span class="nota">split ${esc(r.splits)}</span>` : ''}</td>
      <td>${r.fo?.tipo === 'pct' ? `${r.fo.pct.toLocaleString('es-AR', { maximumFractionDigits: 4 })} % × ${fmtN(r.fo.importeBase)} <span class="nota">${esc(bases.slice(0, 2).join(' / '))}</span>` : '<span class="nota">importe fijo o sin base visible</span>'}</td>
      <td class="n">${fmtN(r.importe)}</td></tr>`;
  }).join('');
  return `<section class="vista-log">${volver}
    <h2 class="pregunta">Aportes y contribuciones</h2>
    <p class="nota">${esc(x.nota)}</p>
    <p class="nota">Tocá uno para ver de dónde sale y si una regla lo cambia después de ARSES.</p>
    <div class="tabla-scroll"><table class="tabla-rt"><thead><tr><th>CC</th><th>Texto</th><th>% × base</th><th class="n">Importe</th></tr></thead><tbody>${filas}</tbody></table></div>
  </section>`;
}

const filaCambio = c => `<tr data-q="${esc(c.cc)}" data-texto="${esc((c.cc + ' ' + c.texto).toLowerCase())}" tabindex="0"><td><code>${esc(c.cc)}</code></td><td>${esc(c.texto)}</td>
  <td class="n">${fmtN(c.antes)}</td><td class="n">${fmtN(c.despues)}</td><td class="n ${c.dif < 0 ? 'neg' : ''}">${c.dif > 0 ? '+' : ''}${fmtN(c.dif)}</td></tr>`;
const tablaCambios = filas => `<div class="tabla-scroll"><table class="tabla-rt"><thead><tr><th>CC</th><th>Texto</th><th class="n">Ya liquidado</th><th class="n">Recalculado</th><th class="n">Diferencia</th></tr></thead><tbody>${filas.map(filaCambio).join('')}</tbody></table></div>`;
const TOTALES_RETRO = ['/101', '/102', '/156', '/4T0', '/4T2', '/321', '/351', '/361', '/399'];

export function htmlRetro(d) {
  const ip = d.info;
  const dt = d.diferencias.length ? `<div class="tabla-scroll"><table class="tabla-rt"><thead><tr><th>CC</th><th>Texto</th><th>Período</th><th>${ip?.esRetro ? 'Dónde' : 'Entra al cálculo en'}</th><th class="n">Importe</th></tr></thead><tbody>
      ${d.diferencias.map(x => `<tr data-q="${esc(x.cc)}" tabindex="0"><td><code>${esc(x.cc)}</code></td><td>${esc(x.texto)}</td><td>${esc(x.periodo)}</td><td>${esc(x.entra ?? '—')}</td><td class="n">${fmtN(x.importe)}</td></tr>`).join('')}
      </tbody></table></div>` : '';
  if (ip?.esRetro) {
    const r = d.resumen ?? {};
    const totales = TOTALES_RETRO.map(cc => d.cambios.find(c => c.cc === cc)).filter(Boolean);
    const pagos = d.cambios.filter(c => !c.cc.startsWith('/'));
    return `<section class="vista-log">${volver}
    <h2 class="pregunta">Recálculo de ${esc(ip.periodo)} <span class="nota">dentro de la nómina ${esc(ip.enNomina)}</span></h2>
    ${r.pagado != null && r.dif != null ? `<div class="resumen-retro">
      <div><span class="nota">Neto recalculado</span><b>${fmtN(r.pagado + r.dif)}</b></div><div class="op-retro">−</div>
      <div><span class="nota">Ya pagado (ORT /560)</span><b>${fmtN(r.pagado)}</b></div><div class="op-retro">=</div>
      <div><span class="nota">Diferencia /551</span><b>${fmtN(r.dif)}</b></div></div>
      <p class="nota">La diferencia va a la tabla DT y se ${r.dif < 0 ? 'descuenta' : 'paga'} en la nómina ${esc(ip.enNomina)} (en el log de ${esc(ip.enNomina)} aparece como /551 ${esc(ip.periodo)}). En la RT de ${esc(ip.periodo)} el /560 queda con lo ya pagado.</p>` : ''}
    ${d.cambios.length ? `${totales.length ? `<h3 class="titulo-sec">Totales que cambiaron</h3>${tablaCambios(totales)}` : ''}
      ${pagos.length ? `<h3 class="titulo-sec">Conceptos que cambiaron · ${pagos.length}</h3>
        <p class="nota">Ya liquidado (ORT, el resultado original de ${esc(ip.periodo)}) contra lo que da ahora (RT final). Acá suele estar el dato que disparó el retroactivo. Tocá uno para ver de dónde sale.</p>
        <input type="search" class="filtro-cc" id="filtro-retro" placeholder="Filtrar por concepto o texto" aria-label="Filtrar conceptos que cambiaron">
        ${tablaCambios(pagos)}` : ''}
      <details class="mas-retro"><summary>Ver también los conceptos técnicos (/xxx) que cambiaron · ${d.cambios.length - pagos.length}</summary>${tablaCambios(d.cambios.filter(c => c.cc.startsWith('/')))}</details>`
      : '<p class="nota">No encontré la tabla ORT (resultado original) en el log: no puedo comparar concepto por concepto.</p>'}
    ${dt ? `<h3 class="titulo-sec">Diferencias que genera (tabla DT)</h3>${dt}` : ''}
  </section>`;
  }
  const per = ip ? `${esc(ip.periodo)} de la nómina ${esc(ip.enNomina)}` : 'sin período';
  const recalc = [...new Set(d.diferencias.map(x => x.periodo).filter(Boolean))];
  return `<section class="vista-log">${volver}
    <h2 class="pregunta">Retroactivo</h2>
    <p>Este log es el período <b>${per}</b>.${recalc.length ? ` La corrida recalculó <b>${recalc.map(esc).join(', ')}</b>: las diferencias llegan por la tabla DT.` : ''}</p>
    ${dt ? `<h3 class="titulo-sec">Diferencias de meses anteriores (tabla DT)</h3>${dt}
      <p class="nota">Tocá una para ver por dónde entra al neto. Para ver qué cambió dentro de ${recalc.length ? recalc.map(esc).join(', ') : 'ese mes'}: en el PC00_M29_CALC cada período recalculado es un log aparte; copialo y cargalo acá.</p>`
      : '<p class="nota">No trae diferencias de meses anteriores (tabla DT vacía): en esta corrida no hubo retroactivo que se pague o descuente en este período.</p>'}
  </section>`;
}

export function htmlErrores(d) {
  return `<section class="vista-log">${volver}
    <h2 class="pregunta">Errores y avisos de la calc</h2>
    ${d.integridad.map(a => `<div class="estado-carga error">${esc(a)}</div>`).join('')}
    ${d.mensajes.length ? `<ul class="lista-msg">${d.mensajes.map(m => `<li><code>${esc(m.paso.func)} ${esc(m.paso.par[0] || '')}</code> <span class="nota">línea ${m.paso.linea.toLocaleString('es-AR')}</span><br>${esc(m.texto)}</li>`).join('')}</ul>`
      : '<p>No encontré mensajes de error ni avisos en el log.</p>'}
    <p class="nota">La calc llegó hasta <code>${esc(d.ultimo?.func ?? '')} ${esc(d.ultimo?.par.filter(Boolean).join(' ') ?? '')}</code>${d.ultimo?.texto ? ` (${esc(d.ultimo.texto)})` : ''}, el último paso del log.</p>
  </section>`;
}
