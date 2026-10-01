// vistaRegla.js — Muestra una regla de cálculo en forma legible para el consultor:
// cada línea (agrupación + concepto) como árbol de decisiones, y cada operación traducida a texto,
// con el código SAP original al costado para no perder la referencia.

import { vigente } from './t512w.js';
import { elegirLineas, esPorConcepto } from './indice.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const esComodin = v => /^\*+$/.test(v);
const ES_CC = /^[A-Z0-9\/]{4}$/;

const CAMPO = { AMT: 'importe', NUM: 'número', RTE: 'valor unitario' };
const LETRA = { A: 'importe', N: 'número', R: 'valor unitario' };
const letras = s => [...s].map(c => LETRA[c] ?? c).join(', ');
const ACUM_CRT = { M: 'mensual', Q: 'trimestral', Y: 'anual', U: 'U', W: 'semanal' };
const CAMPOS_CONOCIDOS = { PAYTY: 'tipo de nómina', ZEINH: 'unidad de tiempo', ABART: 'regla p/grupo de empleados', BUKRS: 'sociedad', WERKS: 'división de personal', BTRTL: 'subdivisión', PERSG: 'grupo de personal', PERSK: 'área de personal', ABKRS: 'área de nómina', GSBER: 'división (GSBER)' };
const SI_NO = new Set(['RETRO', 'WPALL', 'ARVAC', 'ARINF', 'BTCHK', 'VALBS', 'ARCORS', 'R']);

// ---------------------------------------------------------------- chips
const textoCC = (ctx, cc) => (ctx.t512w ? vigente(ctx.t512w, cc, ctx.fecha)?.texto : '') || '';
export const chipCC = (ctx, cc) => !cc || /\*/.test(cc) ? `<code>${esc(cc)}</code>`
  : `<button type="button" class="cc" data-q="${esc(cc)}" title="${esc(textoCC(ctx, cc))}">${esc(cc)}</button>`;
const chipVar = v => /\*/.test(v) ? `<code>&amp;${esc(v)}</code>` : `<button type="button" class="cc var" data-q="&amp;${esc(v)}">&amp;${esc(v)}</button>`;
const chipRegla = r => `<button type="button" class="cc regla" data-q="${esc(r)}" data-tipo="regla">${esc(r)}</button>`;

// ---------------------------------------------------------------- operaciones
function fuente(ctx, op, actual) {
  switch (op.k) {
    case 'lee': {
      const de = op.tabla === 'CRT' ? ` (acumulado ${ACUM_CRT[op.acum] ?? op.acum} en CRT)` : op.tabla !== 'IT' ? ` en ${op.tabla}` : '';
      return `el ${CAMPO[op.campo]} de ${chipCC(ctx, op.cc)}${de}`;
    }
    case 'leeVar': return `la variable ${chipVar(op.var === '*' ? actual ?? '*' : op.var)}`;
    case 'constante': return `la constante <code>${esc(op.nombre)}</code> (T511K)`;
    case 'campoInfotipo': return `el campo <code>${esc(op.nombre)}</code>`;
    default: return op.valor === 'ZERO' ? '0' : /^-?[\d.]+$/.test(op.valor) ? `<b>${esc(op.valor)}</b>` : `el valor <code>${esc(op.valor)}</code>`;
  }
}

function operando(ctx, op, actual) {
  const c = CAMPO[op.campo], f = fuente(ctx, op, actual);
  switch (op.operador) {
    case '=': return { txt: `Toma como ${c} ${f}`, cls: 'mod' };
    case '+': return { txt: `Suma al ${c} ${f}`, cls: 'mod' };
    case '-': return { txt: `Resta al ${c} ${f}`, cls: 'mod' };
    case '*': return { txt: `Multiplica el ${c} por ${f}`, cls: 'mod' };
    case '/': return { txt: `Divide el ${c} por ${f}`, cls: 'mod' };
    case '%': return { txt: `Aplica al ${c} el porcentaje ${f}`, cls: 'mod' };
    case '<': return { txt: `Se queda con el menor ${c} entre el actual y ${f}`, cls: 'mod' };
    case '>': return { txt: `Se queda con el mayor ${c} entre el actual y ${f}`, cls: 'mod' };
    case '?': return { txt: `Compara el ${c} con ${f}`, cls: '' };
    default: return { txt: `Opera (${esc(op.operador)}) el ${c} con ${f}`, cls: 'mod' };
  }
}

export function describirOp(ctx, op, actual = null) {
  const arg = op.raw.slice(5).trim();
  switch (op.k) {
    case 'escribe': {
      const destino = op.cc === '*' ? actual : op.cc;
      const enTabla = op.tabla === 'OT' ? 'OT' : op.tabla;
      if (op.cc === '*') return {
        txt: `${op.tabla === 'RT' ? 'Lo escribe en <b>RT</b>' : `Lo pasa a ${enTabla}`}${actual && actual !== ctx.original ? ` como ${chipCC(ctx, actual)}` : ''}`,
        cls: op.tabla === 'RT' ? 'rt' : 'sigue' };
      return { txt: `Lo suma en ${chipCC(ctx, destino)}${op.tabla === 'OT' ? '' : ` en <b>${esc(enTabla)}</b>`}`, cls: op.tabla === 'RT' ? 'rt' : 'crea' };
    }
    case 'resta': return { txt: `Lo resta de ${op.cc === '*' ? 'sí mismo' : chipCC(ctx, op.cc)}${op.tabla === 'OT' ? '' : ` en ${esc(op.tabla)}`}`, cls: op.tabla === 'RT' ? 'rt' : 'crea' };
    case 'escribeVar': return { txt: `Lo suma en la variable ${chipVar(op.var === '*' ? actual ?? '*' : op.var)}`, cls: 'crea' };
    case 'restaVar': return { txt: `Lo resta de la variable ${chipVar(op.var === '*' ? actual ?? '*' : op.var)}`, cls: 'crea' };
    case 'renombra': return op.cc === '*'
      ? { txt: 'Vuelve al concepto original', cls: 'mod' }
      : { txt: `Pasa a llamarse ${chipCC(ctx, op.cc)}`, cls: 'mod' };
    case 'acumula': {
      const ac = actual && ctx.t512w ? vigente(ctx.t512w, actual, ctx.fecha)?.acumula ?? [] : [];
      return { txt: `Acumula según T512W${ac.length ? ': ' + ac.map(c => chipCC(ctx, c)).join(' ') : ''}`, cls: 'mod' };
    }
    case 'llama': return {
      txt: `${op.modo === 'GCY' ? 'Salta a' : 'Llama a'} la regla ${chipRegla(op.regla)}${op.esg ? ` (agrupación ${esc(op.esg)})` : ''}`, cls: 'lee' };
    case 'decide': return { txt: describirDecision(op, actual), cls: '' };
    case 'lee': case 'leeVar': case 'constante': case 'campoInfotipo': case 'operando': return operando(ctx, op, actual);
  }
  // Operaciones sin clasificar en ops.js: se traducen por código
  switch (op.codigo) {
    case 'ZERO': return arg.startsWith('&') ? { txt: `Pone en cero la variable ${chipVar(arg.slice(1))}`, cls: 'mod' }
      : { txt: `Pone en cero: ${esc(letras(arg.replace(/^=\s*/, '')))}`, cls: 'mod' };
    case 'MULTI': return { txt: `Multiplica ${esc(LETRA[arg[0]])} × ${esc(LETRA[arg[1]])} → ${esc(LETRA[arg[2]])}`, cls: 'mod' };
    case 'DIVID': return { txt: `Divide ${esc(LETRA[arg[0]])} ÷ ${esc(LETRA[arg[1]])} → ${esc(LETRA[arg[2]])}`, cls: 'mod' };
    case 'ELIMI': return { txt: `Quita indicadores de split: ${arg === '*' ? 'todos' : esc(arg)}`, cls: '' };
    case 'FILLF': return { txt: `Marca como fijos: ${esc(letras(arg))}`, cls: '' };
    case 'RESET': return { txt: `Reinicia: ${arg === '*' ? 'todo' : esc(letras(arg))}`, cls: '' };
    case 'ERROR': return { txt: 'Corta la nómina con <b>error</b>', cls: 'elim' };
    case 'PRINT': return { txt: 'Imprime en el log', cls: 'tenue' };
    case 'ROUND': case 'ROUNDA': return { txt: `Redondea (${esc(op.raw.slice(5).trim())})`, cls: 'mod' };
    case 'MODIF': return { txt: `Fija el modificador ${esc(arg)}`, cls: '' };
    case 'SETIN': return { txt: `Fija el indicador ${esc(arg)}`, cls: '' };
    case 'TABLE': return { txt: `Lee la tabla ${esc(arg)}`, cls: '' };
    case 'OPIND': return { txt: 'Invierte el signo', cls: 'mod' };
    case 'VALBS': return arg.startsWith('?') ? { txt: `¿Tiene base de valoración ${esc(arg.slice(1))}?`, cls: '' }
      : { txt: `Toma la base de valoración ${esc(arg)}`, cls: 'mod' };
    case 'RETRO': return { txt: '¿Es un recálculo (retro)?', cls: '' };
    case 'WPALL': return { txt: arg.includes('FRST') ? '¿Es el primer período parcial?' : arg.includes('LAST') ? '¿Es el último período parcial?' : `Período parcial ${esc(arg)}`, cls: '' };
    case 'SCOND': return { txt: `Deja la condición del IF en <b>${arg.startsWith('=T') ? 'verdadera' : 'falsa'}</b>`, cls: 'mod' };
    case 'WGTYP': return { txt: 'Según el concepto que se está procesando', cls: '' };
  }
  if (/^VARGB/.test(op.raw)) { const c = op.raw.slice(5).trim(); return { txt: `Según el campo ${esc(CAMPOS_CONOCIDOS[c] ? `${CAMPOS_CONOCIDOS[c]} (${c})` : c)}`, cls: '' }; }
  return { txt: 'Operación sin traducir (de cliente o poco usada)', cls: 'otra' };
}

function describirDecision(op, actual) {
  if (op.k === 'decide' && op.por === 'claseTratamiento')
    return `Según la clase de tratamiento <b>${esc(op.clase)}</b>${actual ? ` de <code>${esc(actual)}</code>` : ''}${op.nota ? ' <span class="nota">(&amp;GVP leída como clase de tratamiento)</span>' : ''}`;
  if (op.k === 'decide') { const c = CAMPOS_CONOCIDOS[op.campo]; return `Según ${op.por === 'datoOrganizativo' ? 'el dato organizativo' : 'el campo'} ${esc(c ? `${c} (${op.campo})` : op.campo)}`; }
  return '';
}

function etiquetaRama(dec, v) {
  if (esComodin(v)) return 'cualquier otro';
  if (dec.operador === '?') return { '<': 'menor', '=': 'igual', '>': 'mayor' }[v] ?? '= ' + v;
  if (dec.k === 'otra' && SI_NO.has(dec.codigo)) return { Y: 'sí', X: 'sí', N: 'no' }[v] ?? '= ' + v;
  return '= ' + v;
}

const htmlOp = (ctx, op, actual) => {
  const d = describirOp(ctx, op, actual);
  return `<li class="op ${d.cls}"><span class="op-txt">${d.txt}</span><code class="op-raw">${esc(op.raw)}</code></li>`;
};

// Lista de operaciones ya resueltas (las alternativas del recorrido traen o.actual)
export function htmlOps(ctx, ops) {
  return ops.length ? `<ol class="ops">${ops.map(o => htmlOp(ctx, o, o.actual)).join('')}</ol>` : '';
}

// ---------------------------------------------------------------- árbol de una línea de regla
// concepto: el concepto que se procesa (para resolver clases y ADDWT *). En la línea genérica sin concepto queda null.
export function htmlArbol(ctx, nombre, esg, cc, { concepto = null, prof = 0, abrirSub = false, sigue = false } = {}) {
  const r = ctx.modelo.reglas[nombre];
  const lineas = r?.variantes[esg]?.[cc];
  if (!lineas) return '';
  const original = concepto ?? (cc === '****' ? null : cc);
  const c2 = { ...ctx, original };

  const nodos = new Map();
  for (const l of lineas) {
    const k = l.niveles.join(' ');
    const n = nodos.get(k) ?? { ops: [], tipo: '', com: [] };
    n.ops.push(...l.ops.filter(o => o.codigo !== 'NEXTR'));
    if (l.tipo === 'D') n.tipo = 'D';
    if (l.com) n.com.push(l.com);
    nodos.set(k, n);
  }
  const hijos = path => [...new Set(lineas.filter(x => x.niveles.length === path.length + 1 && igual(x.niveles.slice(0, -1), path)).map(x => x.niveles[path.length]))]
    .sort((a, b) => esComodin(a) - esComodin(b) || a.localeCompare(b));

  const render = (path, est) => {
    const n = nodos.get(path.join(' ')) ?? { ops: [], tipo: '', com: [] };
    const dec = n.tipo === 'D' ? n.ops[n.ops.length - 1] : null;
    const ops = dec ? n.ops.slice(0, -1) : n.ops;
    let html = '';
    const items = [];
    for (const op of ops) {
      items.push(htmlOp(c2, op, est.actual));
      if (op.k === 'renombra') est.actual = op.cc === '*' ? original : op.cc;
      if ((op.k === 'escribe') && op.cc === '*') est.sigue = true;
      if (op.k === 'otra' && op.codigo === 'ERROR') est.error = true;
      if (op.k === 'llama') {
        est.llama = true;
        const sub = ctx.modelo.reglas[op.regla];
        const elegido = sub && est.actual && prof < 3 ? elegirLineas(sub, op.esg ?? ctx.esg ?? '*', est.actual) : null;
        const chica = elegido && elegido.lineas.reduce((n, l) => n + l.ops.length, 0) <= 15;
        if (elegido) items.push(`<li class="sub-regla"><details${abrirSub && prof === 0 && chica ? ' open' : ''}><summary>Qué hace ${esc(op.regla)} con ${esc(est.actual)} (línea ${esc(elegido.esg)}/${esc(elegido.clave)})</summary>
          ${htmlArbol(ctx, op.regla, elegido.esg, elegido.clave, { concepto: est.actual, prof: prof + 1, abrirSub, sigue: est.sigue })}</details></li>`);
      }
    }
    if (items.length) html += `<ol class="ops">${items.join('')}</ol>`;
    if (n.com.length) html += `<p class="com-regla">${esc(n.com.join(' · '))}</p>`;

    if (dec) {
      const valores = hijos(path);
      let aplica;
      if (dec.k === 'decide' && dec.por === 'claseTratamiento' && est.actual && ctx.t512w) {
        const v = vigente(ctx.t512w, est.actual, ctx.fecha)?.vklas[Number(dec.clase) - 1];
        if (v != null) {
          aplica = valores.includes(v) ? v : valores.includes(v.trim() || '0') ? (v.trim() || '0') : valores.find(esComodin) ?? null;
          est.valorClase = v.trim() || 'vacía';
        }
      }
      const d = describirOp(c2, dec, est.actual);
      const desc = d.cls === 'otra' ? `Decide con la operación <code>${esc(dec.raw)}</code>` : d.txt;
      html += `<div class="decision"><span class="rombo" aria-hidden="true"></span><span>${desc}${aplica !== undefined ? ` <span class="valor-clase">= ${esc(est.valorClase)}</span>` : ''}</span><code class="op-raw">${esc(dec.raw)}</code></div>`;
      const rama = v => `<div class="rama${v === aplica ? ' aplica' : ''}"><span class="rama-et">${esc(etiquetaRama(dec, v))}</span>${render([...path, v], { ...est })}</div>`;
      if (aplica === undefined) html += `<div class="ramas">${valores.map(rama).join('')}</div>`;
      else {
        const otras = valores.filter(v => v !== aplica);
        html += `<div class="ramas">${aplica === null ? `<p class="fin elim">Ningún valor coincide: el concepto no sale de la regla</p>` : rama(aplica)}
          ${otras.length ? `<details class="otras"><summary>${otras.length === 1 ? 'Otra rama' : `Otras ${otras.length} ramas`} (no aplican a ${esc(est.actual)})</summary>${otras.map(rama).join('')}</details>` : ''}</div>`;
      }
    } else if (!items.length && (est.sigue || est.llama)) {
      html += `<p class="fin">Sin operaciones adicionales</p>`;
    } else if (!est.sigue && !est.llama && !est.error) {
      html += `<p class="fin elim">Sin <code>ADDWT *</code>: ${original ? esc(est.actual ?? original) : 'el concepto'} no sigue</p>`;
    }
    return html;
  };
  return `<div class="arbol">${render([], { actual: original, sigue, llama: false, error: false })}</div>`;
}

// ---------------------------------------------------------------- regla completa
export function htmlReglaCompleta(ctx, nombre) {
  const r = ctx.modelo.reglas[nombre];
  const esgs = Object.keys(r.variantes).sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)));
  // Líneas idénticas en varias agrupaciones se muestran una sola vez
  const grupos = new Map();
  for (const esg of esgs) for (const cc of Object.keys(r.variantes[esg])) {
    const firma = cc + '|' + JSON.stringify(r.variantes[esg][cc].map(l => [l.vk, l.cont, l.tipo, l.ops.map(o => o.raw)]));
    if (!grupos.has(firma)) grupos.set(firma, { cc, esgs: [] });
    grupos.get(firma).esgs.push(esg);
  }
  const rango = cc => (cc === '****' ? '' : cc);
  const tarjetas = [...grupos.values()].sort((a, b) => rango(a.cc).localeCompare(rango(b.cc)) || esgs.indexOf(a.esgs[0]) - esgs.indexOf(b.esgs[0]));
  const abiertas = tarjetas.length <= 6;
  const genericaNota = notaGenerica(ctx, r);
  const html = tarjetas.map(({ esgs: es, cc }) => {
    const texto = cc === '****' ? 'Línea genérica: conceptos sin línea propia' : textoCC(ctx, cc);
    return `<details class="tarjeta-cc" data-esg=" ${esc(es.join(' '))} " data-cc="${esc(cc)}" data-texto="${esc(texto.toLowerCase())}"${abiertas ? ' open' : ''}>
      <summary><span class="tc-cc">${esc(cc)}</span><span class="tc-texto">${esc(texto)}</span><span class="tc-esg">${es.length === 1 ? 'agrupación' : 'agrupaciones'} ${esc(es.join(', '))}</span></summary>
      ${cc === '****' && genericaNota ? `<p class="nota">${genericaNota}</p>` : ''}
      ${htmlArbol(ctx, nombre, es[0], cc)}
    </details>`;
  }).join('');
  const filtros = esgs.length > 1
    ? `<div class="filtro-esg" role="group" aria-label="Agrupación">${['todas', ...esgs].map(e => `<button type="button" class="chip-esg${e === 'todas' ? ' activo' : ''}" data-esg="${esc(e)}">${e === 'todas' ? 'Todas' : 'Agrupación ' + esc(e)}</button>`).join('')}</div>` : '';
  return `<div class="herr-regla">${filtros}
      ${tarjetas.length > 6 ? `<input type="search" class="filtro-cc" placeholder="Filtrar concepto o texto (${tarjetas.length} líneas)" aria-label="Filtrar líneas de la regla">
      <button type="button" class="btn btn-chico" data-accion="expandir">Abrir todas</button>` : ''}
    </div><div class="tarjetas">${html}</div>`;
}

// Filtro por agrupación y texto dentro de la vista de regla
export function conectarFiltros(raiz) {
  const herr = raiz.querySelector('.herr-regla');
  if (!herr) return;
  let esg = 'todas', txt = '';
  const aplicar = () => raiz.querySelectorAll('.tarjeta-cc').forEach(t => {
    t.hidden = !((esg === 'todas' || t.dataset.esg.includes(` ${esg} `) || t.dataset.esg.includes(' * '))
      && (!txt || t.dataset.cc.toLowerCase().includes(txt) || t.dataset.texto.includes(txt)));
  });
  herr.addEventListener('click', e => {
    const b = e.target.closest('.chip-esg');
    if (b) { esg = b.dataset.esg; herr.querySelectorAll('.chip-esg').forEach(x => x.classList.toggle('activo', x === b)); aplicar(); }
    if (e.target.closest('[data-accion=expandir]')) {
      const abrir = e.target.textContent === 'Abrir todas';
      raiz.querySelectorAll('.tarjeta-cc:not([hidden])').forEach(t => { t.open = abrir; });
      e.target.textContent = abrir ? 'Cerrar todas' : 'Abrir todas';
    }
  });
  herr.querySelector('.filtro-cc')?.addEventListener('input', e => { txt = e.target.value.trim().toLowerCase(); aplicar(); });
}

// Cuándo se aplica la línea **** según cómo se llama la regla en cada paso
function notaGenerica(ctx, r) {
  const partes = [];
  for (const id of r.usadaEn) {
    const p = ctx.modelo.pasos[id - 1];
    if (!esPorConcepto(p.func)) continue;
    const modo = p.par[1] || '';
    const pnn = /^P(\d\d)$/.exec(modo);
    const donde = `${p.esquema} ${p.linea} (${p.func} ${p.par.filter(Boolean).join(' ')})`;
    if (/^P\d{4}$/.test(p.func)) partes.push(`${donde}: función de infotipo`);
    else if (modo === 'GEN') partes.push(`${donde}: se aplica a todos los conceptos sin línea propia`);
    else if (pnn) partes.push(`${donde}: solo a los conceptos con la clase ${pnn[1]} informada`);
    else partes.push(`${donde}: no se aplica (sin GEN ni Pnn, los conceptos sin línea propia pasan sin cambios)`);
  }
  return partes.map(esc).join('<br>');
}

export const esConceptoValido = cc => ES_CC.test(cc);
