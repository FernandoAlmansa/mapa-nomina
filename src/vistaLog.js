// vistaLog.js — Pantallas del modo log: carga, RT final y recorrido real de un concepto.
// Las operaciones que corrieron se traducen con las mismas funciones que la vista de reglas.

import { clasificarOp } from './ops.js';
import { describirOp, chipCC } from './vistaRegla.js';
import { valoresFila, textoFila, esTrivial } from './log.js';

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
    <p class="nota">En SAP: corré la calc con log, expandí todo y guardá la lista como archivo local (texto).
      El log tiene datos personales: se lee <b>solo en este navegador</b>, no se guarda ni se sube a ningún lado y se pierde al cerrar la pestaña.</p>
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
  if (alin && nombreCliente) {
    const pct = alin.total ? alin.alineados / alin.total : 0;
    partes.push(pct > 0.9 ? `esquema de ${esc(nombreCliente)}: ${alin.alineados} de ${alin.total} pasos ubicados`
      : `<span class="cond duda">el esquema de ${esc(nombreCliente)} no coincide con el log (${alin.alineados} de ${alin.total} pasos)</span>`);
  } else partes.push('sin esquema del cliente');
  return partes.join(' · ');
}

const valoresTxt = (t, f) => valoresFila(t, f).filter(v => v.campo !== 'splits').map(v => `<span class="val"><span class="val-c">${esc(v.campo)}</span> ${esc(v.valor)}</span>`).join('') || '<span class="nota">sin valores</span>';
const filasHTML = (t, filas) => filas.map(f => {
  const sp = valoresFila(t, f).find(v => v.campo === 'splits');
  return `<div class="fila-val">${valoresTxt(t, f)}${sp ? `<span class="nota"> splits ${esc(sp.valor)}</span>` : ''}</div>`;
}).join('');

// ---------------------------------------------------------------- pantalla inicial con el log cargado
export function htmlInicioLog(log, rt, nota) {
  const filas = rt ? rt.t.filas.map(f => {
    const cc = f.slice(3, 7).trim();
    const v = Object.fromEntries(valoresFila(rt.t, f).map(x => [x.campo, x.valor]));
    const texto = log.conceptos.get(cc) || textoFila(rt.t, f);
    return `<tr data-q="${esc(cc)}" data-texto="${esc((cc + ' ' + texto).toLowerCase())}" tabindex="0"><td><code>${esc(cc)}</code></td><td>${esc(texto)}</td>
      <td class="n">${esc(v.cantidad ?? '')}</td><td class="n">${esc(v.importe ?? '')}</td></tr>`;
  }).join('') : '';
  return `<section class="recorrido inicio-log">
    <div class="escenario-nota">Log: ${nota}</div>
    <h3 class="titulo-sec">RT final del log</h3>
    ${rt ? `<p class="resumen">${rt.t.filas.length} líneas. Tocá un concepto para ver su recorrido, o escribí cualquier concepto o variable arriba (${log.conceptos.size} conceptos aparecen en el log).</p>
      <input type="search" class="filtro-cc" id="filtro-rt" placeholder="Filtrar por concepto o texto" aria-label="Filtrar la RT">
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

// ---------------------------------------------------------------- efectos de un paso (para el resumen)
function diferencias(c) {
  if (c.tipo !== 'cambia' || c.antes.length !== 1 || c.despues.length !== 1) return '';
  const a = Object.fromEntries(valoresFila(c.tAntes, c.antes[0]).map(v => [v.campo, v.valor]));
  const d = Object.fromEntries(valoresFila(c.t, c.despues[0]).map(v => [v.campo, v.valor]));
  return [...new Set([...Object.keys(a), ...Object.keys(d)])].filter(k => a[k] !== d[k])
    .map(k => `${k} ${a[k] ?? '—'} → ${d[k] ?? '—'}`).join(', ');
}

function chipsEfectos(e, res, ctx) {
  const out = [];
  const esRT = e === res.entraRT;
  for (const c of e.cambios) {
    if (/^O/.test(c.tabla) && c.tabla !== 'OT') continue;
    const valor = c.despues.length === 1 ? valoresFila(c.t, c.despues[0]).find(v => v.campo === 'importe' || /^Importe$/.test(v.campo))?.valor : null;
    if (c.tabla === 'IT' || c.tabla === 'OT') {
      if (c.tipo === 'nuevo') out.push(`<span class="ef crea">aparece en IT${valor ? ' · ' + esc(valor) : ''}</span>`);
      else if (c.tipo === 'cambia') out.push(`<span class="ef mod">cambia en IT: ${esc(diferencias(c) || 'splits')}</span>`);
      else if (!esRT) out.push(`<span class="ef elim">sale de IT</span>`);
    } else if (c.tabla === 'RT') {
      out.push(`<span class="ef ${c.tipo === 'sale' ? 'elim' : 'rt'}">${c.tipo === 'nuevo' ? 'entra en RT' : c.tipo === 'sale' ? 'sale de RT' : 'cambia en RT'}${valor ? ' · ' + esc(valor) : ''}</span>`);
    } else if (c.tabla === 'VAR') out.push(`<span class="ef crea">variable &amp;${esc(res.cc)}${valor ? ' · ' + esc(valor) : ''}</span>`);
    else out.push(`<span class="ef mod">${esc(nombreTabla(c.tabla, res.cc))}: ${c.tipo}</span>`);
  }
  if (esRT && !e.cambios.some(c => c.tabla === 'RT')) out.push('<span class="ef rt">entra en RT</span>');
  for (const g of e.genera.slice(0, 2)) out.push(`<span class="ef crea">lo genera ${esc(g.regla)}${g.desde ? ' desde ' + esc(g.desde) : ''}</span>`);
  if (!e.cambios.length && !e.genera.length) {
    const textos = e.ops.slice(0, 3).map(o => {
      const op = clasificarOp(o.op);
      return describirOp({ ...ctx, original: res.cc }, op, res.cc).txt;
    });
    out.push(...textos.map(t => `<span class="ef mod">${t}</span>`));
  }
  return out.join(' ');
}

// ---------------------------------------------------------------- ficha + recorrido
export function htmlConceptoLog(log, res, { ctx, etiqueta, ruta, nota, todos, hayModelo, textoT512 }) {
  const link = p => `<a href="#paso-l${p.n}" class="link-paso" data-paso="l${p.n}">${esc(etiqueta(p))}</a>`;
  const texto = res.texto || textoT512 || '';
  const relevantes = res.eventos.filter(e => e.relevante);
  const visibles = todos ? res.eventos : relevantes;

  // Ficha
  const origen = [];
  if (res.infotipo) origen.push(`<li>Del infotipo ${esc(res.infotipo.aparece.find(a => /^P\d{4}$/.test(a.tabla)).tabla.slice(1))} (se ve en ${link(res.infotipo.paso)})</li>`);
  if (res.naceIT) origen.push(`<li>Aparece en IT en ${link(res.naceIT.paso)}${res.naceIT.bloques[0]?.lineas[0] ? ` · regla <b>${esc(res.naceIT.bloques[0].lineas[0].regla)}</b>` : res.naceIT.genera[0] ? ` · regla <b>${esc(res.naceIT.genera[0].regla)}</b>` : ''}</li>`);
  for (const e of res.generado.slice(0, 3)) for (const g of e.genera.slice(0, 1))
    origen.push(`<li>Lo genera <b>${esc(g.regla)}</b>${g.desde ? ` desde ${chipCC(ctx, g.desde)}` : ''} en ${link(e.paso)}</li>`);
  if (res.anteriores && !origen.length) origen.push(`<li>Está en resultados anteriores (${esc(res.anteriores.aparece.find(a => /^O/.test(a.tabla)).tabla)}) en ${link(res.anteriores.paso)}</li>`);

  const rt = res.final.RT;
  const ficha = `<aside class="ficha">
      <h2>${esc(res.cc)}</h2>
      <p class="texto">${esc(texto || 'Sin texto en el log')}</p>
      <div class="dato-rt"><span class="dato-et">RT final</span>
        ${rt ? filasHTML(rt.t, rt.filas) : '<span class="nota">No llega a la RT de este log</span>'}
        ${res.entraRT ? `<p class="nota">Entra en RT en ${link(res.entraRT.paso)}</p>` : ''}</div>
      <dl>
        <div><dt>Nace en</dt><dd>${origen.length ? `<ul class="lista-ficha">${[...new Set(origen)].join('')}</ul>` : '<span class="nota">No se ve dónde nace: puede venir de una función estándar que no imprime tablas.</span>'}</dd></div>
        ${res.final.VAR ? `<div><dt>Variable &amp;${esc(res.cc)} al final</dt><dd>${filasHTML(res.final.VAR.t, res.final.VAR.filas)}</dd></div>` : ''}
        ${res.final.CRT ? `<div><dt>Acumulados (CRT)</dt><dd>${res.final.CRT.filas.map(f => `<div class="fila-val">${valoresTxt(res.final.CRT.t, f)}</div>`).join('')}</dd></div>` : ''}
        <div><dt>En el log</dt><dd>Aparece en ${res.eventos.length} pasos; cambia en ${relevantes.length}.</dd></div>
      </dl>
      <div class="acciones">
        <button class="btn primario" type="button" id="btn-ia-log">Copiar para IA</button>
        ${hayModelo ? `<button class="btn" type="button" id="btn-ver-esquema" data-cc="${esc(res.cc)}">Ver en el esquema (todas las ramas)</button>` : ''}
      </div>
    </aside>`;

  // Resumen
  const resumen = relevantes.map(e => `<li class="${e === res.entraRT ? 'es-rt' : ''}">${link(e.paso)}
      <span class="r-func">${esc(e.paso.func)} ${esc(e.paso.par.filter(Boolean).join(' '))}</span>
      ${[...new Set(e.bloques.flatMap(b => b.lineas.map(x => x.regla)))].slice(0, 2).map(r => `<b>${esc(r)}</b>`).join(' ')}
      ${chipsEfectos(e, res, ctx)}</li>`).join('');

  // Detalle
  const detalle = visibles.map(e => {
    const p = e.paso;
    const cab = `<div class="cab"><span class="num">#${p.n}</span><span class="ruta">${ruta(p)}</span>
        <span class="func">${esc(p.func)} ${esc(p.par.filter(Boolean).join(' '))}</span>
        <span class="comentario">${esc(p.texto)}</span></div>`;
    const cambios = e.cambios.length ? `<table class="cambios"><thead><tr><th>Tabla</th><th>Antes</th><th>Después</th></tr></thead><tbody>
        ${e.cambios.map(c => `<tr class="c-${c.tipo}"><th>${esc(nombreTabla(c.tabla, res.cc))}</th>
          <td>${c.antes.length ? filasHTML(c.tAntes, c.antes) : '<span class="nota">—</span>'}</td>
          <td>${c.despues.length ? filasHTML(c.t, c.despues) : `<span class="nota">${c.tabla === 'IT' && e === res.entraRT ? 'pasó a RT' : 'ya no está'}</span>`}</td></tr>`).join('')}
      </tbody></table>` : '';
    const genera = e.genera.map(g => `<p class="que"><span class="ef crea">lo genera</span> la regla <button type="button" class="cc regla" data-q="${esc(g.regla)}" data-tipo="regla">${esc(g.regla)}</button>
        ${g.desde ? `al procesar ${chipCC(ctx, g.desde)}` : 'en la función'}: ${describirOp({ ...ctx, original: g.desde }, clasificarOp(g.op), g.desde).txt} <code class="op-raw">${esc(g.op)}</code></p>`).join('');
    const bloques = e.bloques.map(b => b.noProcesado
      ? '<p class="nota">El paso recorre el concepto pero la regla no lo procesa (sin línea propia y sin GEN/Pnn).</p>'
      : htmlLineas(ctx, res.cc, b.lineas)
        + (e.sinADDWT && /^P(IT|RT|OT)$/.test(p.func) ? '<p class="fin elim">La rama que corrió no tiene ADDWT: el concepto no sigue en la tabla</p>' : '')).join('');
    const sinTablas = !e.cambios.length && !e.bloques.length && !e.genera.length
      ? `<p class="nota">Se ve en ${esc(e.aparece.map(a => `${a.seccion} ${nombreTabla(a.tabla, res.cc)}`).join(', '))} sin cambios.</p>` : '';
    const reglas = [...new Set([...e.bloques.flatMap(b => b.lineas.map(x => x.regla)), ...e.genera.map(g => g.regla)])];
    const crudas = [...e.bloques.flatMap(b => b.lineas.map(x => `${x.regla.padEnd(4)}      ${(x.esg || ' ')}   ${x.vk.padEnd(8)} ${x.op}`))];
    const pie = reglas.length ? `<div class="pie-paso">${hayModelo ? reglas.map(r => `<button type="button" class="btn btn-chico" data-q="${esc(r)}" data-tipo="regla">Abrir regla ${esc(r)}</button>`).join('') : ''}
        ${crudas.length ? `<details class="crudo"><summary>Líneas del log (línea ${p.linea.toLocaleString('es-AR')})</summary><pre class="regla">${esc(crudas.join('\n'))}</pre></details>` : ''}</div>` : '';
    return `<li class="paso ${e.relevante ? 't-crea' : ''}${e === res.entraRT ? ' entrada-rt' : ''}" id="paso-l${p.n}">
      ${e === res.entraRT ? '<span class="marca-rt">Acá entra en RT</span>' : ''}${cab}${cambios}${genera}${bloques}${sinTablas}${pie}</li>`;
  }).join('');

  return `${ficha}
    <section class="recorrido">
      <div class="escenario-nota">Log: ${nota}</div>
      ${resumen ? `<h3 class="titulo-sec">Qué le pasa, en orden</h3><ol class="resumen-pasos">${resumen}</ol>` : '<p>En este log el concepto no cambia en ningún paso.</p>'}
      <h3 class="titulo-sec">Detalle paso por paso</h3>
      <p class="resumen">${visibles.length} pasos${todos ? '' : `, ${res.eventos.length - visibles.length} ocultos donde solo pasa sin cambios`}.</p>
      ${visibles.length ? `<ol class="traza">${detalle}</ol>` : `<p>${esc(res.cc)} no aparece en el log.</p>`}
    </section>`;
}

