// app.js — Pantalla del mapa de nómina.
import { parsearRPDASC00 } from './rpdasc00.js';
import { parsearT512W, filtrarT512W } from './t512w.js';
import { construirIndice, buscarConcepto, buscarVariable, textoRegla, contextoIA, etiquetaPaso, clasesInformadas } from './indice.js';
import { htmlArbol, htmlReglaCompleta, conectarFiltros, describirOp } from './vistaRegla.js';
import { MOLGA } from './config.js';
import * as nube from './nube.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaISO = ddmmaaaa => { const m = /^(\d\d)\.(\d\d)\.(\d{2,4})$/.exec(ddmmaaaa || ''); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}` : null; };

const estado = { modelo: null, t512w: null, ix: null, nombre: '', pendiente: null };
const ctxVista = () => ({ modelo: estado.modelo, t512w: estado.t512w, fecha: $('#fecha').value, esg: $('#esg').value });

// ---------------------------------------------------------------- carga de datos
function prepararDatos(rpdTexto, t512Texto) {
  const modelo = parsearRPDASC00(rpdTexto);
  if (!modelo.pasos.length) throw new Error('El primer archivo no tiene líneas de esquema reconocibles. Tiene que ser el listado del RPDASC00 guardado como archivo local.');
  const t512w = parsearT512W(t512Texto, MOLGA);
  if (!t512w.filas) throw new Error(`La T512W no tiene filas de la agrupación de países ${MOLGA}.`);
  return { modelo, t512w };
}

function activar({ modelo, t512w }, nombre, detalle) {
  Object.assign(estado, { modelo, t512w, ix: construirIndice(modelo), nombre });
  const esgs = estado.ix.esgs;
  $('#esg').innerHTML = esgs.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('') + '<option value="*">* (genérica)</option>';
  $('#esg').value = esgs.includes('1') ? '1' : (esgs[0] ?? '*');
  $('#fuente').textContent = `${nombre ? nombre + ': ' : ''}esquema ${modelo.origen.esquemaRaiz}, listado del ${modelo.origen.fechaListado ?? 's/f'}${detalle ? ', ' + detalle : ''}`;
  const q = decodeURIComponent(location.hash.slice(1));
  if (q) { $('#q').value = q; buscar(); }
  else mostrarVacio('Buscá un concepto', `Probá con /110, 1000 o una variable como &ZSAL. También podés escribir el nombre de una regla (por ejemplo X010) para verla completa.`);
}

const decodificar = async archivo => {
  const buf = await archivo.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
};

async function leerArchivos() {
  const [fr, ft] = [$('#f-rpd').files[0], $('#f-t512').files[0]];
  const caja = $('#estado-carga');
  estado.pendiente = null; $('#btn-usar').disabled = true; $('#btn-guardar').disabled = true;
  if (!fr || !ft) { caja.innerHTML = `<div class="estado-carga error">Elegí los dos archivos.</div>`; return; }
  try {
    const rpdTexto = await decodificar(fr);
    const t512Texto = filtrarT512W(await decodificar(ft), MOLGA);
    const datos = prepararDatos(rpdTexto, t512Texto);
    const { modelo, t512w } = datos;
    const av = modelo.avisos;
    caja.innerHTML = `<div class="estado-carga${av.length ? ' error' : ''}">
      Esquema ${esc(modelo.origen.esquemaRaiz)}: ${modelo.pasos.length.toLocaleString('es-AR')} pasos y ${Object.keys(modelo.reglas).length} reglas (listado del ${esc(modelo.origen.fechaListado)}).
      T512W: ${t512w.filas.toLocaleString('es-AR')} filas de ${Object.keys(t512w.conceptos).length.toLocaleString('es-AR')} conceptos.
      ${av.length ? `<br>Hay ${av.length} avisos; revisá el archivo antes de guardarlo para el equipo:<ul>${av.slice(0, 8).map(a => `<li>Línea ${esc(a.linea)}: ${esc(a.msg)}</li>`).join('')}</ul>` : '<br>Sin avisos.'}
    </div>`;
    estado.pendiente = { datos, rpdTexto, t512Texto };
    $('#btn-usar').disabled = false;
    $('#btn-guardar').disabled = av.length > 0 || !(await sesionActiva());
    if (!$('#cli-id').value) $('#cli-id').value = modelo.origen.esquemaRaiz === '2900' ? 'HAL' : '';
  } catch (e) {
    caja.innerHTML = `<div class="estado-carga error">${esc(e.message)}</div>`;
  }
}

async function guardarEnNube() {
  const p = estado.pendiente;
  const id = $('#cli-id').value.trim().toUpperCase();
  const nombre = $('#cli-nombre').value.trim() || id;
  if (!p || !id) { aviso('Completá el código del cliente'); return; }
  const btn = $('#btn-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await nube.guardarVersion({
      clienteId: id, nombre, rpdTexto: p.rpdTexto, t512Texto: p.t512Texto, notas: $('#cli-notas').value.trim(),
      resumen: { fechaISO: fechaISO(p.datos.modelo.origen.fechaListado), pasos: p.datos.modelo.pasos.length, reglas: Object.keys(p.datos.modelo.reglas).length },
    });
    activar(p.datos, nombre, 'versión recién guardada');
    $('#dlg-carga').close();
    aviso(`Versión de ${nombre} guardada`);
    await cargarListaClientes(id);
  } catch (e) {
    $('#estado-carga').insertAdjacentHTML('beforeend', `<div class="estado-carga error">No se pudo guardar: ${esc(e.message)}</div>`);
  } finally { btn.textContent = 'Guardar versión para el equipo'; btn.disabled = false; }
}

// ---------------------------------------------------------------- nube
async function sesionActiva() {
  if (!nube.configurada()) return null;
  try { return await nube.sesion(); } catch { return null; }
}

async function cargarListaClientes(seleccionar) {
  const sel = $('#cliente');
  try {
    const lista = await nube.listarClientes();
    sel.hidden = false;
    sel.innerHTML = '<option value="">Elegí un cliente</option>' + lista.map(c =>
      `<option value="${esc(c.id)}">${esc(c.nombre)} (${esc(c.id)})${c.ultima ? '' : ', sin versiones'}</option>`).join('');
    const guardado = seleccionar || localStorage.getItem('cliente');
    if (guardado && lista.some(c => c.id === guardado)) { sel.value = guardado; if (!seleccionar) await abrirCliente(guardado); }
  } catch (e) { aviso('No se pudo leer la lista de clientes: ' + e.message); }
}

async function abrirCliente(id) {
  if (!id) return;
  $('#fuente').textContent = `Bajando ${id}…`;
  try {
    const { version, rpdTexto, t512Texto } = await nube.descargarUltima(id);
    const nombre = $('#cliente').selectedOptions[0]?.textContent.replace(/ \(.*$/, '') || id;
    activar(prepararDatos(rpdTexto, t512Texto), nombre, `cargado por ${version.subido_por ?? 's/d'} el ${new Date(version.subido_en).toLocaleDateString('es-AR')}`);
    localStorage.setItem('cliente', id);
  } catch (e) { $('#fuente').textContent = 'Sin datos cargados'; aviso(e.message); }
}

async function refrescarUsuario(s) {
  const configurada = nube.configurada();
  $('#btn-ingresar').hidden = !configurada || Boolean(s);
  $('#btn-salir').hidden = !s;
  $('#usuario').textContent = s?.user?.email ?? '';
  $('#guardar-nube').hidden = !s;
  $('#btn-guardar').hidden = !s;
  $('#nota-nube').textContent = !configurada
    ? 'Modo local: los archivos se usan solo en esta pestaña. Para compartirlos con el equipo, completá src/config.js.'
    : s ? '' : 'Para guardar la versión para el equipo, ingresá con tu mail.';
}

// ---------------------------------------------------------------- búsqueda y render
function buscar() {
  if (!estado.modelo) { aviso('Primero cargá un cliente'); return; }
  const q = $('#q').value.trim().toUpperCase();
  if (!q) return;
  history.replaceState(null, '', '#' + encodeURIComponent(q));
  if (q.startsWith('&')) return mostrarVariable(q);
  const esConcepto = Boolean(estado.t512w.conceptos[q]) || (q in estado.ix.crea) || (q in estado.ix.lee);
  if (estado.modelo.reglas[q] && !esConcepto) return mostrarRegla(q);
  mostrarConcepto(q);
}

function mostrarVacio(titulo, texto) {
  $('#principal').innerHTML = `<section class="vacio"><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></section>`;
}

const chipsCC = lista => `<span class="chips">${lista.map(c => `<button type="button" class="cc" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</span>`;

function cabeceraPaso(id) {
  const m = estado.modelo, p = m.pasos[id - 1];
  const ruta = p.ruta.map(r => esc(etiquetaPaso(m, r))).concat(`<b>${esc(p.esquema)} ${esc(p.linea)}</b>`).join(' › ');
  const conds = p.cond.map(c => c.tipo === 'IF'
    ? `<span class="cond${c.rama === 'SINO' ? ' no' : ''}" title="${esc(c.texto)}">${c.rama === 'SINO' ? 'si no ' : 'si '}${esc(c.expr)}</span>`
    : `<span class="cond" title="${esc(c.texto)}">dentro de bucle ${esc(c.expr)}</span>`).join('');
  return `<div class="cab"><span class="num">#${id}</span><span class="ruta">${ruta}</span>
      <span class="func">${esc(p.func)} ${esc(p.par.filter(Boolean).join(' '))}</span>
      <span class="comentario">${esc(p.texto)}</span></div>
    ${conds ? `<div class="conds">${conds}</div>` : ''}`;
}

const claseEfecto = e => /entra en RT/.test(e) ? 'rt' : /^genera|^guarda/.test(e) ? 'crea' : /elimina|no lo toma|ERROR/.test(e) ? 'elim' : /modifica|acumula/.test(e) ? 'mod' : '';

// Líneas crudas de una regla (agrupación + concepto), como figuran en el RPDASC00
const textoLinea = (regla, esg, cc) => textoRegla(estado.modelo, regla).split('\n').filter(l => l.startsWith(regla + esg + cc)).join('\n');
const btnRegla = regla => `<button type="button" class="btn btn-chico" data-q="${esc(regla)}" data-tipo="regla">Abrir regla ${esc(regla)}</button>`;

function htmlEvento(e, esEntradaRT, cc) {
  const ctx = ctxVista();
  let que = '';
  if (e.tipo === 'procesa') {
    que = `<p class="que">Regla <b>${esc(e.regla)}</b>, línea ${esc(e.clave === '****' ? 'genérica ****' : e.clave)} de la agrupación ${esc(e.esg)} (tabla ${esc(e.tabla)})</p>
      <div>${e.efectos.map(x => `<span class="ef ${claseEfecto(x)}">${esc(x)}</span>`).join('')}</div>
      ${htmlArbol(ctx, e.regla, e.esg, e.clave, { concepto: cc, abrirSub: true })}`;
  } else if (e.tipo === 'crea' || e.tipo === 'lee') {
    const op = estado.modelo.reglas[e.regla]?.variantes[e.esg]?.[e.clave]?.flatMap(l => l.ops).find(o => o.raw === e.op);
    const procesando = e.clave === '****' ? 'cualquier concepto (línea genérica)' : e.clave;
    que = `<p class="que"><span class="ef ${e.tipo === 'crea' ? 'crea' : 'lee'}">${e.tipo === 'crea' ? `lo genera${e.tabla && e.tabla !== 'OT' ? ' en ' + esc(e.tabla) : ''}` : 'lo lee'}</span>
      la regla <b>${esc(e.regla)}</b> al procesar ${esc(procesando)}${e.vk ? ` (rama ${esc(e.vk)})` : ''}</p>
      ${op ? `<ol class="ops"><li class="op ${e.tipo === 'crea' ? 'crea' : 'lee'}"><span class="op-txt">${describirOp(ctx, op, e.clave === '****' ? null : e.clave).txt}</span><code class="op-raw">${esc(op.raw)}</code></li></ol>` : `<code>${esc(e.op)}</code>`}
      <details><summary>Ver la línea ${esc(e.clave)} completa</summary>${htmlArbol(ctx, e.regla, e.esg, e.clave)}</details>`;
  } else {
    que = `<p class="que"><span class="ef">parámetro de la función</span></p>`;
  }
  const regla = e.regla ? `<div class="pie-paso">${btnRegla(e.regla)}
      <details class="crudo"><summary>Código SAP</summary><pre class="regla">${esc(textoLinea(e.regla, e.esg, e.clave))}</pre></details></div>` : '';
  return `<li class="paso t-${e.tipo}${esEntradaRT ? ' entrada-rt' : ''}">
    ${esEntradaRT ? '<span class="marca-rt">Acá entra en RT</span>' : ''}${cabeceraPaso(e.paso)}${que}${regla}</li>`;
}

function mostrarConcepto(cc) {
  const { modelo, ix, t512w } = estado;
  const res = buscarConcepto(modelo, ix, t512w, cc, { fecha: $('#fecha').value, esg: $('#esg').value });
  const eventos = $('#todos').checked ? res.eventos : res.eventos.filter(e => e.relevante);
  const t = res.t512w;
  const ocultos = res.eventos.length - eventos.length;

  $('#principal').innerHTML = `
    <aside class="ficha">
      <h2>${esc(cc)}</h2>
      <p class="texto">${esc(t?.texto || `No figura en T512W (MOLGA ${MOLGA}) a esa fecha`)}</p>
      <dl>
        <div><dt>Entra en RT</dt><dd>${res.entradaRT ? `paso #${res.entradaRT.paso}, ${esc(etiquetaPaso(modelo, res.entradaRT.paso))}${res.entradaRT.regla ? ', regla ' + esc(res.entradaRT.regla) : ''}` : 'No se ve en reglas; puede escribirlo una función estándar'}
          ${res.entradaRTCondicional.length ? `<br><span class="nota">Antes, según la rama: ${res.entradaRTCondicional.map(e => esc(etiquetaPaso(modelo, e.paso))).join(', ')}</span>` : ''}</dd></div>
        ${t ? `<div><dt>Acumula en</dt><dd>${t.acumula.length ? chipsCC(t.acumula) : 'ninguna'}</dd></div>` : ''}
        ${res.recibeDe.length ? `<div><dt>Se forma por acumulación de ${res.recibeDe.length} conceptos</dt><dd>${chipsCC(res.recibeDe)}</dd></div>` : ''}
        ${t ? `<div><dt>Clases de tratamiento</dt><dd><code>${esc(clasesInformadas(t.vklas)) || 'ninguna'}</code></dd></div>` : ''}
        ${t ? `<div><dt>Vigencia de la fila usada</dt><dd>${esc(t.desde)} a ${esc(t.hasta)}</dd></div>` : ''}
      </dl>
      <div class="acciones">
        <button class="btn primario" type="button" id="btn-ia">Copiar para IA</button>
      </div>
    </aside>
    <section class="recorrido">
      <p class="resumen">${eventos.length} pasos en orden de ejecución${ocultos ? `, ${ocultos} ocultos donde el concepto solo sigue sin cambios` : ''}. Agrupación ${esc(res.esg)}, clases al ${esc(res.fecha)}.</p>
      ${eventos.length ? `<ol class="traza">${eventos.map(e => htmlEvento(e, e === res.entradaRT, res.cc)).join('')}</ol>`
        : `<p>No hay reglas del esquema que mencionen ${esc(cc)}. Si aparece en la RT, lo genera una función estándar (por ejemplo ARSES, ARTAX o una acumulación): revisá el log de la liquidación.</p>`}
    </section>`;
  $('#btn-ia').onclick = async () => {
    await navigator.clipboard.writeText(contextoIA(modelo, res, estado.nombre));
    aviso('Copiado: pegalo en el chat junto con el ticket');
  };
}

function opVariable(u) {
  const op = estado.modelo.reglas[u.regla]?.variantes[u.esg]?.[u.cc]?.flatMap(l => l.ops).find(o => o.raw === u.op);
  return op ? `${describirOp(ctxVista(), op, u.cc === '****' ? null : u.cc).txt} <code class="op-raw">${esc(u.op)}</code>` : `<code>${esc(u.op)}</code>`;
}

function mostrarVariable(q) {
  const m = estado.modelo;
  const usos = buscarVariable(m, estado.ix, q);
  if (!usos.length) return mostrarVacio(`No encontré la variable ${q}`, 'Revisá el nombre: las variables se escriben con & adelante, por ejemplo &ZSAL.');
  const porPaso = new Map();
  for (const u of usos) { if (!porPaso.has(u.paso)) porPaso.set(u.paso, []); porPaso.get(u.paso).push(u); }
  $('#principal').innerHTML = `<aside class="ficha"><h2>${esc(q)}</h2><p class="texto">Variable de la tabla VAR: ${usos.filter(u => u.tipo === 'escribe').length} escrituras y ${usos.filter(u => u.tipo === 'lee').length} lecturas.</p></aside>
    <section class="recorrido"><ol class="traza">${[...porPaso].map(([paso, us]) => `<li class="paso t-${us.some(u => u.tipo === 'escribe') ? 'crea' : 'lee'}">${cabeceraPaso(paso)}
      <div class="alts">${us.map(u => `<div class="alt"><span class="c"><span class="ef ${u.tipo === 'escribe' ? 'crea' : 'lee'}">${u.tipo === 'escribe' ? 'escribe' : 'lee'}</span> ${esc(u.regla)} ${esc(u.esg)}/${esc(u.cc)}${u.vk ? ' rama ' + esc(u.vk) : ''}</span><span>${opVariable(u)}</span></div>`).join('')}</div></li>`).join('')}</ol></section>`;
}

function mostrarRegla(nombre) {
  const m = estado.modelo, r = m.reglas[nombre];
  const lineas = Object.values(r.variantes).reduce((n, v) => n + Object.keys(v).length, 0);
  const uso = (ids, titulo) => ids.length ? `<div><dt>${titulo}</dt><dd><ul class="usos">${ids.map(id => {
    const p = m.pasos[id - 1];
    return `<li><span class="num">#${id}</span> <b>${esc(p.esquema)} ${esc(p.linea)}</b> <code>${esc(p.func)} ${esc(p.par.filter(Boolean).join(' '))}</code><br><span class="nota">${esc(p.texto)}</span></li>`;
  }).join('')}</ul></dd></div>` : '';
  $('#principal').innerHTML = `<aside class="ficha"><h2>${esc(nombre)}</h2>
      <p class="texto">${lineas} ${lineas === 1 ? 'línea' : 'líneas'} en ${Object.keys(r.variantes).length === 1 ? 'la agrupación ' + esc(Object.keys(r.variantes)[0]) : 'las agrupaciones ' + esc(Object.keys(r.variantes).sort().join(', '))}.</p>
      <dl>${uso(r.usadaEn, 'Se usa en')}${uso([...new Set(r.invocadaEn)], 'Se llama como subregla en')}</dl>
      <p class="nota">Para cada concepto, SAP usa la línea de su agrupación y concepto; si no existe, la genérica <code>****</code> de esa agrupación; después las de la agrupación <code>*</code>.</p>
    </aside>
    <section class="recorrido" id="vista-regla">${htmlReglaCompleta(ctxVista(), nombre)}
      <details class="crudo"><summary>Ver la regla como en el RPDASC00</summary><pre class="regla">${esc(textoRegla(m, nombre))}</pre></details></section>`;
  conectarFiltros($('#vista-regla'));
}

function aviso(texto) {
  const d = document.createElement('div');
  d.className = 'aviso-flotante'; d.setAttribute('role', 'status'); d.textContent = texto;
  document.body.append(d); setTimeout(() => d.remove(), 3500);
}

// ---------------------------------------------------------------- eventos
$('#fecha').value = new Date().toISOString().slice(0, 10);
$('#form-busqueda').addEventListener('submit', e => { e.preventDefault(); buscar(); });
for (const id of ['#fecha', '#esg', '#todos']) $(id).addEventListener('change', () => estado.modelo && $('#q').value && buscar());
$('#principal').addEventListener('click', e => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  $('#q').value = b.dataset.q;
  if (b.dataset.tipo === 'regla' && estado.modelo.reglas[b.dataset.q]) {
    history.replaceState(null, '', '#' + encodeURIComponent(b.dataset.q));
    mostrarRegla(b.dataset.q);
  } else buscar();
  window.scrollTo({ top: 0 });
});
$('#btn-cargar').onclick = async () => { await refrescarUsuario(await sesionActiva()); $('#dlg-carga').showModal(); };
$('#btn-cerrar-carga').onclick = () => $('#dlg-carga').close();
$('#btn-leer').onclick = leerArchivos;
$('#btn-usar').onclick = () => { activar(estado.pendiente.datos, 'Archivos locales', ''); $('#dlg-carga').close(); };
$('#btn-guardar').onclick = guardarEnNube;
$('#btn-ingresar').onclick = () => $('#dlg-ingreso').showModal();
$('#btn-cerrar-ingreso').onclick = () => $('#dlg-ingreso').close();
$('#btn-link').onclick = async () => {
  try { await nube.enviarLink($('#mail').value); $('#estado-ingreso').innerHTML = '<div class="estado-carga">Listo: abrí el link que te llegó por mail desde este navegador.</div>'; }
  catch (e) { $('#estado-ingreso').innerHTML = `<div class="estado-carga error">${esc(e.message)}</div>`; }
};
$('#btn-salir').onclick = async () => { await nube.salir(); refrescarUsuario(null); };
$('#cliente').addEventListener('change', e => abrirCliente(e.target.value));

(async () => {
  await refrescarUsuario(null);
  if (!nube.configurada()) return;
  await nube.alCambiarSesion(refrescarUsuario);
  refrescarUsuario(await sesionActiva());
  await cargarListaClientes();
})();
