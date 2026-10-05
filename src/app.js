// app.js — Pantalla del mapa de nómina.
import { parsearRPDASC00, pareceRPDASC00 } from './rpdasc00.js';
import { parsearT512W, filtrarT512W, pareceT512W } from './t512w.js';
import { construirIndice, buscarConcepto, buscarVariable, textoRegla, contextoIA, etiquetaPaso, clasesInformadas, esPorConcepto } from './indice.js';
import { htmlArbol, htmlReglaCompleta, conectarFiltros, describirOp } from './vistaRegla.js';
import { MOLGA } from './config.js';
import * as nube from './nube.js';
import * as local from './local.js';
import * as catalogo from './clientes.js';
import { opcionesNomina, crearEscenario, estadoPaso, textoCondicion } from './escenario.js';
import { pareceLog, parsearLog, alinear, analizarConcepto, rtFinal, contextoIALog } from './log.js';
import { htmlCargaLog, htmlInicioLog, htmlConceptoLog, describirLog, htmlAportes, htmlRetro, htmlErrores } from './vistaLog.js';
import { sintomasDelLog, chequeosConcepto, integridad, diagnosticoRetro, diagnosticoError, infoPeriodo } from './sintomas.js';
import { explicarPaso } from './explicar.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaISO = ddmmaaaa => { const m = /^(\d\d)\.(\d\d)\.(\d{2,4})$/.exec(ddmmaaaa || ''); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}` : null; };
const leerLS = k => { try { return localStorage.getItem(k); } catch { return null; } };
const grabarLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const estado = {
  modelo: null, t512w: null, ix: null, nombre: '', clienteId: null,
  clientes: [], cache: new Map(),
  piezas: { rpd: null, t512: null }, pendiente: null,
  // Modo log: el log vive solo en memoria de esta pestaña (datos personales: nunca se guarda)
  modo: 'log', log: null, alin: null, logCC: '',
  escalas: null,    // escala art. 94 de Ganancias (catalogo/escala-ganancias.json)
  catalogo: null,   // funciones estándar de nómina AR (catalogo/funciones-29.json, solo metadatos)
};
const escenario = () => crearEscenario($('#nomina').value || 'regular', $('#periodo').value);
const ctxVista = () => ({ modelo: estado.modelo, t512w: estado.t512w, fecha: $('#fecha').value, esg: $('#esg').value });

// ---------------------------------------------------------------- datos de un cliente
function prepararDatos(rpdTexto, t512Texto) {
  const modelo = parsearRPDASC00(rpdTexto);
  if (!modelo.pasos.length) throw new Error('El RPDASC00 no tiene líneas de esquema reconocibles.');
  const t512w = parsearT512W(t512Texto, MOLGA);
  if (!t512w.filas) throw new Error(`La T512W no tiene filas de la agrupación de países ${MOLGA}.`);
  return { modelo, t512w };
}

function activar({ modelo, t512w }, nombre, detalle) {
  Object.assign(estado, { modelo, t512w, ix: construirIndice(modelo), nombre });
  const esgs = estado.ix.esgs;
  $('#esg').innerHTML = esgs.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('') + '<option value="*">* (genérica)</option>';
  $('#esg').value = esgs.includes('1') ? '1' : (esgs[0] ?? '*');
  const previo = $('#nomina').value;
  const opciones = opcionesNomina(modelo);
  $('#nomina').innerHTML = opciones.map(o => `<option value="${esc(o.valor)}">${esc(o.texto)}</option>`).join('');
  $('#nomina').value = opciones.some(o => o.valor === previo) ? previo : 'regular';
  $('#periodo').disabled = $('#nomina').value === 'todos';
  $('#fuente').textContent = `Esquema ${modelo.origen.esquemaRaiz}, listado del ${modelo.origen.fechaListado ?? 's/f'}${detalle ? ' · ' + detalle : ''}`;
  if (estado.log) estado.alin = alinear(estado.log, modelo);
  if (estado.modo === 'log') { renderLog(); return; }
  const q = location.hash.startsWith('#log') ? '' : decodeURIComponent(location.hash.slice(1));
  if (q) { $('#q').value = q; buscar(); }
  else mostrarVacio('Buscá un concepto', `Probá con /110, 1000 o una variable como &ZSAL. También podés escribir el nombre de una regla (por ejemplo X010) para verla completa.`);
}

// ---------------------------------------------------------------- lista de clientes (repo + equipo + este navegador)
async function cargarListaClientes(abrir) {
  const { clientes, errores } = await catalogo.listar();
  estado.clientes = clientes;
  const sel = $('#cliente');
  sel.hidden = !clientes.length;
  sel.innerHTML = '<option value="">Elegí un cliente…</option>' + clientes.map(c => {
    const v = c.versiones[0];
    return `<option value="${esc(c.id)}">${esc(c.nombre)}${v.esquema ? ' · esquema ' + esc(v.esquema) : ''}</option>`;
  }).join('');
  $('#dl-clientes').innerHTML = clientes.map(c => `<option value="${esc(c.nombre)}"></option>`).join('');
  if (errores.length) console.warn('Lista de clientes:', errores);
  if (estado.clienteId) sel.value = estado.clienteId;
  if (abrir === false) return errores;
  // Al entrar no se abre ningún cliente: se elige en la barra de arriba
  const id = abrir;
  if (id && clientes.some(c => c.id === id)) await abrirCliente(id);
  else if (!estado.modelo) mostrarVacio(clientes.length ? 'Elegí un cliente' : 'Cargá un cliente para empezar',
    clientes.length ? 'Elegí un cliente en la barra de arriba. Si el tuyo no está, cargalo con "Cargar cliente".'
      : 'Tocá "Cargar cliente" y pegá el listado del RPDASC00 y la T512W.');
  return errores;
}

async function abrirCliente(id) {
  const c = estado.clientes.find(x => x.id === id);
  if (!c) return;
  const v = c.versiones[0];
  $('#cliente').value = id;
  $('#fuente').textContent = `Abriendo ${c.nombre}…`;
  try {
    if (!estado.cache.has(v.clave)) {
      const { rpdTexto, t512Texto } = await v.bajar();
      estado.cache.set(v.clave, prepararDatos(rpdTexto, t512Texto));
    }
    estado.clienteId = id;
    activar(estado.cache.get(v.clave), c.nombre, v.detalle);
    grabarLS('cliente', id);
  } catch (e) {
    $('#fuente').textContent = 'Sin datos cargados';
    aviso(`No se pudo abrir ${c.nombre}: ${e.message}`);
  }
}

// ---------------------------------------------------------------- carga: pegar, soltar o elegir archivos
const decodificar = async archivo => {
  const buf = await archivo.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
};

// Recibe un texto (pegado o de un archivo) y lo ubica solo: no importa el orden ni el nombre del archivo.
function recibirTexto(texto, origen) {
  if (!texto?.trim()) return;
  if (pareceT512W(texto)) estado.piezas.t512 = { texto: filtrarT512W(texto, MOLGA), origen };
  else if (pareceRPDASC00(texto)) estado.piezas.rpd = { texto, origen };
  else { mostrarEstadoCarga(`No reconozco ${origen}: no parece un listado del RPDASC00 ni una T512W.`, true); return; }
  procesarPiezas();
}

async function recibirArchivos(archivos) {
  for (const f of archivos) recibirTexto(await decodificar(f), `el archivo ${f.name}`);
}

function mostrarEstadoCarga(html, error) {
  $('#estado-carga').innerHTML = html ? `<div class="estado-carga${error ? ' error' : ''}">${html}</div>` : '';
}

function pintarPiezas() {
  const { rpd, t512 } = estado.piezas;
  const fila = (pieza, nombre, detalle) => `<li class="${pieza ? 'ok' : ''}"><span class="tilde" aria-hidden="true">${pieza ? '✓' : '○'}</span>
    <b>${nombre}</b> <span class="nota">${pieza ? esc(detalle) : 'falta'}</span></li>`;
  const m = estado.pendiente?.datos.modelo, t = estado.pendiente?.datos.t512w;
  $('#piezas').innerHTML =
    fila(rpd, 'RPDASC00', m ? `esquema ${m.origen.esquemaRaiz}, ${m.pasos.length.toLocaleString('es-AR')} pasos, ${Object.keys(m.reglas).length} reglas (${rpd.origen})` : rpd?.origen) +
    fila(t512, 'T512W', t ? `${Object.keys(t.conceptos).length.toLocaleString('es-AR')} conceptos de MOLGA ${MOLGA} (${t512.origen})` : t512?.origen);
}

async function procesarPiezas() {
  const { rpd, t512 } = estado.piezas;
  estado.pendiente = null;
  $('#btn-usar').disabled = true; $('#btn-guardar').disabled = true;
  mostrarEstadoCarga('');
  try {
    if (rpd && t512) {
      const datos = prepararDatos(rpd.texto, t512.texto);
      estado.pendiente = { datos, rpdTexto: rpd.texto, t512Texto: t512.texto };
      const av = datos.modelo.avisos;
      if (av.length) mostrarEstadoCarga(`Hay ${av.length} avisos; revisá el listado antes de guardarlo para el equipo:<ul>${av.slice(0, 8).map(a => `<li>Línea ${esc(a.linea)}: ${esc(a.msg)}</li>`).join('')}</ul>`, true);
      sugerirCliente(datos.modelo.origen.esquemaRaiz);
      $('#btn-usar').disabled = false;
      $('#btn-guardar').disabled = av.length > 0 || !(await sesionActiva());
    }
  } catch (e) { mostrarEstadoCarga(esc(e.message), true); }
  pintarPiezas();
  interpretarCliente();
}

// Si ya hay un cliente con el mismo esquema, se propone ese
function sugerirCliente(esquema) {
  const campo = $('#cli-nombre');
  if (campo.value.trim()) return;
  const candidatos = catalogo.porEsquema(estado.clientes, esquema);
  if (candidatos.length === 1) campo.value = candidatos[0].nombre;
}

// Cliente al que va la carga: no hace falta escribirlo exacto
function resolverCliente() {
  const texto = $('#cli-nombre').value.trim();
  const esquema = estado.pendiente?.datos.modelo.origen.esquemaRaiz;
  if (!texto) return esquema ? { id: catalogo.idDesdeNombre('ESQ' + esquema), nombre: `Esquema ${esquema}`, nuevo: true, sinNombre: true } : null;
  const hallado = catalogo.buscar(estado.clientes, texto);
  if (hallado) return { id: hallado.cliente.id, nombre: hallado.cliente.nombre, nuevo: false, exacto: hallado.exacto };
  return { id: catalogo.idDesdeNombre(texto), nombre: texto, nuevo: true };
}

function interpretarCliente() {
  const r = resolverCliente();
  $('#cli-match').textContent = !r ? ''
    : r.sinNombre ? `Sin nombre: se guarda como "${r.nombre}". Podés escribir el cliente como te salga (halli, HAL, halliburton…).`
    : r.nuevo ? `Cliente nuevo: ${r.nombre} (código ${r.id}).`
    : `Se actualiza ${r.nombre}${r.exacto ? '' : ' (lo reconocí por lo que escribiste)'}.`;
}

async function usarYGuardarLocal() {
  const p = estado.pendiente, r = resolverCliente();
  if (!p || !r) return;
  const m = p.datos.modelo;
  try {
    await local.guardar({ id: r.id, nombre: r.nombre, esquema: m.origen.esquemaRaiz, fechaListado: m.origen.fechaListado, rpdTexto: p.rpdTexto, t512Texto: p.t512Texto });
    estado.clienteId = r.id;
    await cargarListaClientes(false);
    const c = estado.clientes.find(x => x.id === r.id);
    if (c) estado.cache.set(c.versiones[0].clave, p.datos);
    grabarLS('cliente', r.id);
    activar(p.datos, r.nombre, c?.versiones[0].detalle ?? 'guardado en este navegador');
    $('#cliente').value = r.id;
  } catch {
    activar(p.datos, r.nombre, 'solo en esta pestaña (el navegador no permitió guardarlo)');
  }
  cerrarCarga();
}

async function guardarEnNube() {
  const p = estado.pendiente, r = resolverCliente();
  if (!p || !r) return;
  const btn = $('#btn-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const m = p.datos.modelo;
    await nube.guardarVersion({
      clienteId: r.id, nombre: r.nombre, rpdTexto: p.rpdTexto, t512Texto: p.t512Texto, notas: $('#cli-notas').value.trim(),
      resumen: { fechaISO: fechaISO(m.origen.fechaListado), pasos: m.pasos.length, reglas: Object.keys(m.reglas).length, esquema: m.origen.esquemaRaiz },
    });
    estado.clienteId = r.id;
    await cargarListaClientes(false);
    const c = estado.clientes.find(x => x.id === r.id);
    if (c) estado.cache.set(c.versiones[0].clave, p.datos);
    grabarLS('cliente', r.id);
    activar(p.datos, r.nombre, c?.versiones[0].detalle ?? 'versión recién guardada');
    aviso(`Versión de ${r.nombre} guardada para el equipo`);
    cerrarCarga();
  } catch (e) {
    mostrarEstadoCarga(`No se pudo guardar para el equipo: ${esc(e.message)}`, true);
  } finally { btn.textContent = 'Guardar para el equipo'; btn.disabled = !estado.pendiente; }
}

function abrirCarga() {
  estado.piezas = { rpd: null, t512: null }; estado.pendiente = null;
  $('#cli-nombre').value = ''; $('#cli-notas').value = '';
  mostrarEstadoCarga(''); pintarPiezas(); interpretarCliente();
  $('#btn-usar').disabled = true; $('#btn-guardar').disabled = true;
  $('#dlg-carga').showModal();
  $('#zona').focus();
}
const cerrarCarga = () => $('#dlg-carga').close();

// ---------------------------------------------------------------- sesión del equipo
async function sesionActiva() {
  if (!nube.configurada()) return null;
  try { return await nube.sesion(); } catch { return null; }
}

async function refrescarUsuario(s) {
  const configurada = nube.configurada();
  $('#btn-ingresar').hidden = !configurada || Boolean(s);
  $('#btn-salir').hidden = !s;
  $('#usuario').textContent = s?.user?.email ?? '';
  $('#btn-guardar').hidden = !s;
  $('#btn-usar').classList.toggle('primario', !s);
  $('#nota-nube').textContent = !configurada ? ''
    : s ? 'Con "Guardar para el equipo" lo ven todos los que abran la página.'
    : 'Se guarda en este navegador. Para que lo vea todo el equipo, ingresá con tu mail de HM.';
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
  if (estado.modo === 'log') return;
  $('#principal').innerHTML = `<section class="vacio"><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></section>`;
}

const chipsCC = lista => `<span class="chips">${lista.map(c => `<button type="button" class="cc" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</span>`;

function cabeceraPaso(id, esc_ = escenario()) {
  const m = estado.modelo, p = m.pasos[id - 1];
  const ruta = p.ruta.map(r => esc(etiquetaPaso(m, r))).concat(`<b>${esc(p.esquema)} ${esc(p.linea)}</b>`).join(' › ');
  const { dudas } = estadoPaso(esc_, p, m);
  // En un escenario concreto, las condiciones que ya se cumplen no se muestran: solo las que dependen
  const conds = p.cond.filter(c => esc_.todos || c.tipo !== 'IF' || dudas.includes(c)).map(c => c.tipo === 'IF'
    ? `<span class="cond${dudas.includes(c) ? ' duda' : esc_.todos ? (c.rama === 'SINO' ? ' no' : '') : ' cumple'}" title="${esc(`${m.pasos[c.paso - 1].esquema} ${m.pasos[c.paso - 1].linea} IF ${c.expr}`)}">${dudas.includes(c) ? 'depende · ' : ''}${esc(textoCondicion(c, m))}</span>`
    : `<span class="cond" title="${esc(c.texto)}">dentro de bucle ${esc(c.expr)}</span>`).join('');
  return `<div class="cab"><span class="num">#${id}</span><span class="ruta">${ruta}</span>
      <span class="func">${esc(p.func)} ${esc(p.par.filter(Boolean).join(' '))}</span>
      <span class="comentario">${esc(p.texto)}</span></div>
    ${conds ? `<div class="conds">${conds}</div>` : ''}`;
}

const claseEfecto = e => /entra en RT/.test(e) ? 'rt' : /^genera|^guarda|^entra en IT/.test(e) ? 'crea' : /elimina|no lo toma|ERROR/.test(e) ? 'elim' : /modifica|acumula|valoriza/.test(e) ? 'mod' : '';

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
  const enLog = estadoEnLog(e.paso, cc);
  return `<li class="paso t-${e.tipo}${esEntradaRT ? ' entrada-rt' : ''}${enLog === 'no corrió' ? ' no-corrio' : ''}" id="paso-${e.paso}">
    ${esEntradaRT ? '<span class="marca-rt">Acá entra en RT</span>' : ''}${enLog ? `<span class="cond log-${enLog === 'no corrió' ? 'no' : 'si'}">en el log: ${esc(enLog)}</span>` : ''}${cabeceraPaso(e.paso)}${que}${regla}</li>`;
}

const fechaAR = iso => (iso ? iso.split('-').reverse().join('.') : '');
const linkPaso = id => `<a href="#paso-${id}" class="link-paso" data-paso="${id}">${esc(etiquetaPaso(estado.modelo, id))}</a>`;
const textoT512 = cc => (estado.t512w ? (estado.t512w.conceptos[cc] ?? []).at(-1)?.texto : '') || '';

function describirEscenario(esc_) {
  if (esc_.todos) return 'todos los caminos';
  const nomina = $('#nomina').selectedOptions[0]?.textContent ?? 'Nómina regular';
  return `${nomina}, período ${esc_.retro ? 'retroactivo' : 'actual'}`;
}

// Clases de tratamiento que efectivamente deciden el camino del concepto en las reglas que lo procesan
function clasesQueDeciden(res) {
  const out = new Map();
  for (const e of res.eventos) {
    if (e.tipo !== 'procesa' || !e.relevante) continue;
    const lineas = estado.modelo.reglas[e.regla]?.variantes[e.esg]?.[e.clave] ?? [];
    for (const l of lineas) for (const o of l.ops)
      if (o.k === 'decide' && o.por === 'claseTratamiento') {
        if (!out.has(o.clase)) out.set(o.clase, new Set());
        out.get(o.clase).add(e.regla);
      }
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0]));
}

// Una línea por paso relevante: dónde, qué regla y qué le hace
function htmlResumen(res) {
  const m = estado.modelo, esc_ = escenario();
  const items = res.eventos.filter(e => e.relevante).map(e => {
    const duda = estadoPaso(esc_, m.pasos[e.paso - 1], m).estado === 'depende';
    let que;
    if (e.tipo === 'procesa') que = e.efectos.filter(x => x !== 'sigue').map(x => `<span class="ef ${claseEfecto(x)}">${esc(x)}</span>`).join('');
    else if (e.tipo === 'crea') que = `<span class="ef crea">lo genera${e.tabla && e.tabla !== 'OT' ? ' en ' + esc(e.tabla) : ''}</span> <span class="nota">desde ${esc(e.clave === '****' ? 'cualquier concepto' : e.clave)}</span>`;
    else if (e.tipo === 'lee') que = `<span class="ef lee">lo lee</span>`;
    else que = `<span class="ef">parámetro de la función</span>`;
    const enLog = estadoEnLog(e.paso, res.cc);
    return `<li class="${e === res.entradaRT ? 'es-rt' : ''}${enLog === 'no corrió' ? ' no-corrio' : ''}">${linkPaso(e.paso)}${enLog === 'no corrió' ? ' <span class="cond log-no">no corrió en el log</span>' : ''}
      <span class="r-func">${esc(m.pasos[e.paso - 1].func)}</span> ${e.regla ? `<b>${esc(e.regla)}</b>` : ''} ${que}
      ${duda ? '<span class="cond duda">depende</span>' : ''}</li>`;
  });
  return items.length ? `<ol class="resumen-pasos">${items.join('')}</ol>` : '';
}

function htmlFicha(cc, res) {
  const m = estado.modelo, t = res.t512w;
  const crea = res.eventos.filter(e => e.tipo === 'crea');
  const infotipo = res.eventos.find(e => e.tipo === 'procesa' && /^infotipo/.test(e.tabla));
  const nace = crea.length
    ? `<ul class="lista-ficha">${[...new Map(crea.map(e => [e.paso + e.regla, e])).values()].slice(0, 4).map(e => `<li>${linkPaso(e.paso)} · regla <b>${esc(e.regla)}</b>${e.clave !== '****' ? ` desde ${esc(e.clave)}` : ''}</li>`).join('')}${crea.length > 4 ? `<li class="nota">y ${crea.length - 4} más</li>` : ''}</ul>`
    : infotipo ? `Del ${esc(infotipo.tabla)} (${linkPaso(infotipo.paso)})`
    : '<span class="nota">Ninguna regla lo crea: viene de un infotipo, de resultados anteriores o de una función estándar.</span>';
  const clases = clasesQueDeciden(res);
  const valorClase = nn => (t?.vklas[Number(nn) - 1] ?? ' ').trim() || 'vacía';
  const informadas = t ? [...t.vklas].map((v, i) => (v.trim() ? [String(i + 1).padStart(2, '0'), v] : null)).filter(Boolean) : [];
  return `<aside class="ficha">
      <h2>${esc(cc)}</h2>
      <p class="texto">${esc(t?.texto || `No figura en T512W (MOLGA ${MOLGA}) a esa fecha`)}</p>
      <div class="dato-rt">${res.entradaRT
        ? `<span class="dato-et">Entra en RT</span> ${linkPaso(res.entradaRT.paso)}${res.entradaRT.regla ? ` · regla <b>${esc(res.entradaRT.regla)}</b>` : ''}`
        : '<span class="dato-et">Entra en RT</span> <span class="nota">no se ve en reglas: puede escribirlo una función estándar</span>'}
        ${res.entradaRTCondicional.length ? `<p class="nota">Antes, según la rama: ${res.entradaRTCondicional.map(e => linkPaso(e.paso)).join(', ')}</p>` : ''}</div>
      <dl>
        <div><dt>Nace en</dt><dd>${nace}</dd></div>
        ${res.recibeDe.length ? `<div><dt>Se forma sumando ${res.recibeDe.length} conceptos</dt><dd>${chipsCC(res.recibeDe)}</dd></div>` : ''}
        ${t ? `<div><dt>Acumula en</dt><dd>${t.acumula.length ? `<ul class="lista-ficha">${t.acumula.map(c => `<li><button type="button" class="cc" data-q="${esc(c)}">${esc(c)}</button> ${esc(textoT512(c))}</li>`).join('')}</ul>` : 'ninguna'}</dd></div>` : ''}
        ${clases.length ? `<div><dt>Clases que deciden su camino</dt><dd><ul class="lista-ficha">${clases.map(([nn, reglas]) => `<li><code>PC${esc(nn)} = ${esc(valorClase(nn))}</code> <span class="nota">en ${esc([...reglas].join(', '))}</span></li>`).join('')}</ul></dd></div>` : ''}
        ${informadas.length ? `<div><dt>Clases informadas</dt><dd><details><summary>${informadas.length} clases</summary><div class="grilla-clases">${informadas.map(([nn, v]) => `<span><code>PC${nn}</code> ${esc(v)}</span>`).join('')}</div></details></dd></div>` : ''}
        ${t ? `<div><dt>Vigencia de la fila de T512W</dt><dd>desde ${esc(fechaAR(t.desde))}${t.hasta >= '9999' ? ', sin fecha de fin' : ` hasta ${esc(fechaAR(t.hasta))}`}</dd></div>` : ''}
      </dl>
      <div class="acciones"><button class="btn primario" type="button" id="btn-ia">Copiar para IA</button></div>
    </aside>`;
}

function mostrarConcepto(cc) {
  const { modelo, ix, t512w } = estado;
  const esc_ = escenario();
  const res = buscarConcepto(modelo, ix, t512w, cc, {
    fecha: $('#fecha').value, esg: $('#esg').value,
    pasoPosible: id => estadoPaso(esc_, modelo.pasos[id - 1], modelo).estado !== 'no corre',
  });
  const eventos = $('#todos').checked ? res.eventos : res.eventos.filter(e => e.relevante);
  const ocultos = res.eventos.length - eventos.length;
  const resumen = htmlResumen(res);

  $('#principal').innerHTML = `${htmlFicha(cc, res)}
    <section class="recorrido">
      <div class="escenario-nota">Mirando: <b>${esc(describirEscenario(esc_))}</b>${res.fueraDeEscenario ? ` · ${res.fueraDeEscenario} pasos ocultos porque no corren en esta nómina` : ''}${esquemaDelLog() ? ` · con el log cargado (${esc(estado.log.periodos[0]?.periodo ?? '')}): los pasos que no corrieron quedan en gris` : ''}</div>
      ${resumen ? `<h3 class="titulo-sec">Qué le pasa, en orden</h3>${resumen}` : ''}
      <h3 class="titulo-sec">Detalle paso por paso</h3>
      <p class="resumen">${eventos.length} pasos${ocultos ? ` (no se muestran ${ocultos} donde solo sigue sin cambios)` : ''}.</p>
      ${eventos.length ? `<ol class="traza">${eventos.map(e => htmlEvento(e, e === res.entradaRT, res.cc)).join('')}</ol>`
        : `<p>No hay reglas del esquema que mencionen ${esc(cc)} en esta nómina. Si aparece en la RT, lo genera una función estándar (por ejemplo ARSES, ARTAX o una acumulación): revisá el log de la liquidación.</p>`}
    </section>`;
  $('#btn-ia').onclick = async () => {
    await navigator.clipboard.writeText(contextoIA(modelo, res, estado.nombre, describirEscenario(esc_)));
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
    const est = estadoPaso(escenario(), p, m).estado;
    return `<li class="${est === 'no corre' ? 'no-corre' : ''}"><span class="num">#${id}</span> <b>${esc(p.esquema)} ${esc(p.linea)}</b>${est === 'no corre' ? ' <span class="cond">no corre en esta nómina</span>' : est === 'depende' ? ' <span class="cond duda">depende</span>' : ''} <code>${esc(p.func)} ${esc(p.par.filter(Boolean).join(' '))}</code><br><span class="nota">${esc(p.texto)}</span></li>`;
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


// ---------------------------------------------------------------- modo log (pantalla principal)
function setModo(modo, render = true) {
  estado.modo = modo;
  grabarLS('modo', modo);
  $('#tab-log').setAttribute('aria-selected', String(modo === 'log'));
  $('#tab-esq').setAttribute('aria-selected', String(modo === 'esquema'));
  $('#form-log').hidden = modo !== 'log';
  $('#form-busqueda').hidden = modo !== 'esquema';
  if (!render) return;
  if (modo === 'log') renderLog();
  else if (!estado.modelo) { mostrarVacio(estado.clientes.length ? 'Elegí un cliente' : 'Cargá un cliente para empezar', 'Elegí un cliente en la barra de arriba o cargalo con "Cargar cliente".'); }
  else if ($('#q').value.trim()) buscar();
  else mostrarVacio('Buscá un concepto', 'Probá con /110, 1000 o una variable como &ZSAL. También podés escribir el nombre de una regla (por ejemplo X010) para verla completa.');
}

// El cliente abierto solo se usa con el log si su esquema es el del log (≥ 90 % de los pasos ubicados).
// Si no coincide (log de otro cliente), el log se muestra solo, sin avisos.
const esquemaDelLog = () => Boolean(estado.log && estado.modelo && estado.alin?.total && estado.alin.alineados / estado.alin.total >= 0.9);
const pasoEsquema = p => (esquemaDelLog() && p.idEsquema ? estado.modelo.pasos[p.idEsquema - 1] : null);
const etiquetaLog = p => { const e = pasoEsquema(p); return e ? `${e.esquema} ${e.linea}` : `${p.func} ${p.par[0] || ''}`.trim(); };
function rutaLog(p) {
  const e = pasoEsquema(p);
  if (e) return e.ruta.map(id => esc(etiquetaPaso(estado.modelo, id))).concat(`<b>${esc(e.esquema)} ${esc(e.linea)}</b>`).join(' › ');
  return p.titulos.length ? esc(p.titulos.join(' › ')) : '';
}
const notaLog = () => describirLog(estado.log, esquemaDelLog() ? estado.alin : null, esquemaDelLog() ? estado.nombre : '');

function pintarInfoLog() {
  const log = estado.log;
  $('#q-log').disabled = !log; $('#btn-buscar-log').disabled = !log;
  $('#info-log').innerHTML = log
    ? `<span>Log ${esc(log.periodos[0]?.periodo ?? '')} · ${(log.bytes / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB · solo en esta pestaña</span>
       <button class="btn btn-chico" type="button" id="btn-inicio-log">Inicio de la calc</button>
       <button class="btn btn-chico" type="button" id="btn-cambiar-log">Cambiar log</button>`
    : '';
  $('#dl-log').innerHTML = log ? [...log.conceptos].sort((a, b) => a[0].localeCompare(b[0])).map(([cc, t]) => `<option value="${esc(cc)}">${esc(t)}</option>`).join('') : '';
}

function renderLog(error = '') {
  const log = estado.log;
  if (!log) { $('#principal').innerHTML = htmlCargaLog(error); conectarZonaLog(); return; }
  if (!estado.logCC) {
    $('#principal').innerHTML = htmlInicioLog(log, rtFinal(log), notaLog(), { sintomas: sintomasDelLog(log), avisos: integridad(log), retro: infoPeriodo(log) });
    conectarFiltro('#filtro-rt');
    return;
  }
  if (estado.logCC.startsWith('!')) { mostrarPaginaLog(estado.logCC); return; }
  mostrarConceptoLog(estado.logCC);
}

// Filtro de texto: oculta las filas de la primera tabla que sigue al campo
function conectarFiltro(sel) {
  const filtro = $(sel);
  if (!filtro) return;
  let el = filtro.nextElementSibling;
  while (el && !el.querySelector?.('tbody') && !el.matches('.tabla-scroll')) el = el.nextElementSibling;
  const tabla = el ?? filtro.closest('section');
  filtro.addEventListener('input', () => {
    const t = filtro.value.trim().toLowerCase();
    tabla.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = Boolean(t) && !tr.dataset.texto?.includes(t); });
  });
}

// Páginas por síntoma que miran todo el log
function mostrarPaginaLog(id) {
  const log = estado.log;
  const ctx = { modelo: null, t512w: null, fecha: fechaFinLog(), esg: '*' };
  if (id === '!APORTES') {
    const paso = log.pasos.find(p => p.func === 'ARSES');
    $('#principal').innerHTML = htmlAportes(log, paso ? explicarPaso(log, paso) : null, ctx);
  } else if (id === '!RETRO') { $('#principal').innerHTML = htmlRetro(diagnosticoRetro(log)); conectarFiltro('#filtro-retro'); }
  else if (id === '!ERROR') $('#principal').innerHTML = htmlErrores(diagnosticoError(log));
  else { irALog('', { reemplazar: true }); return; }
  $('#volver-rt').onclick = ev => { ev.preventDefault(); irALog(''); };
}

// Estado de un paso del esquema según el log cargado (para la vista estática)
function estadoEnLog(id, cc) {
  if (!esquemaDelLog()) return null;
  const p = estado.modelo.pasos[id - 1];
  if (!esPorConcepto(p.func) && p.func !== 'ACTIO') return null;
  const lp = estado.log.pasos.find(x => x.idEsquema === id);
  if (!lp) return 'no corrió';
  const b = lp.proceso.find(x => x.cc === cc);
  return !b ? 'corrió' : b.noProcesado ? 'corrió, no lo procesa' : 'lo procesó';
}

function mostrarConceptoLog(cc) {
  const log = estado.log;
  const res = analizarConcepto(log, cc);
  estado.logCC = res.cc;
  if (!res.eventos.length) {
    // Parecidos: mismo comienzo de código o el texto contiene lo buscado
    const q = res.cc.toLowerCase();
    const parecidos = [...log.conceptos].filter(([cc, t]) => cc.toLowerCase().startsWith(q.slice(0, 2)) || (q.length >= 3 && t.toLowerCase().includes(q))).slice(0, 12);
    $('#principal').innerHTML = `<section class="vista-log"><a href="#" class="volver" id="volver-rt">← Inicio de la calc</a>
      <h2 class="pregunta">${esc(res.cc)} no aparece en este log</h2>
      <p class="nota">No está en ninguna tabla ni lo procesa ninguna regla. Revisá el código (los conceptos y las variables van sin &, por ejemplo ZSAL).
      ${esquemaDelLog() ? ' Para ver dónde podría aparecer según la configuración, abrilo en la pestaña "Esquema del cliente".' : ''}</p>
      ${parecidos.length ? `<h3 class="titulo-sec">Quizás buscabas</h3><div class="temas">${parecidos.map(([cc, t]) => `<button type="button" class="tema" data-q="${esc(cc)}"><b>${esc(t || cc)}</b><code>${esc(cc)}</code></button>`).join('')}</div>` : ''}
    </section>`;
    $('#volver-rt').onclick = ev => { ev.preventDefault(); irALog(''); };
    return;
  }
  const conCliente = esquemaDelLog();
  const ctx = { modelo: conCliente ? estado.modelo : null, t512w: conCliente ? estado.t512w : null, fecha: fechaFinLog(), esg: '*' };
  $('#principal').innerHTML = htmlConceptoLog(log, res, {
    ctx, etiqueta: etiquetaLog, ruta: rutaLog, nota: notaLog(), todos: $('#todos-log').checked,
    hayModelo: conCliente, textoT512: conCliente ? textoT512(res.cc) : '',
    chequeos: chequeosConcepto(log, res, { escalas: estado.escalas, conCliente }), catalogo: estado.catalogo, escalas: estado.escalas,
  });
  $('#btn-ia-log').onclick = async () => {
    const f2 = n => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const extra = [];
    const ch = chequeosConcepto(log, res, { escalas: estado.escalas, conCliente });
    if (ch.items.length) {
      extra.push('', `## Chequeos (confianza ${ch.confianza.nivel}: ${ch.confianza.texto})`);
      for (const i of ch.items) extra.push(`[${{ ok: 'OK', atencion: 'ATENCIÓN', info: 'INFO', nd: 'SIN DATO' }[i.estado]}] ${i.titulo}${i.detalle ? ' — ' + i.detalle : ''}`);
    }
    for (const e of res.eventos.filter(x => x.relevante)) {
      const x = explicarPaso(log, e.paso, { escalas: estado.escalas });
      if (!x) continue;
      extra.push('', `## ${x.titulo} (${etiquetaLog(e.paso)})`);
      for (const b of x.bloques) extra.push(`${b.titulo}: ${b.filas.filter(f => f.total).map(f => `${f.signo < 0 ? '−' : '+'}${f.cc} ${f2(f.total)}`).join(' ')} = ${f2(b.total)}`);
      for (const r of x.resultados ?? []) extra.push(`${r.cc} ${r.nombre}: SAP ${f2(r.real)}${r.calculado == null ? '' : Math.abs(r.calculado - r.real) < 0.02 ? ' (cierra)' : ` (recalculado ${f2(r.calculado)}: NO CIERRA)`}`);
      for (const r of x.lista ?? []) if (r.cc === res.cc || x.lista.length <= 12) extra.push(`${r.cc}${r.splits ? ' split ' + r.splits : ''} ${f2(r.importe)}${r.fo?.tipo === 'pct' ? ` = ${r.fo.pct} % × ${f2(r.fo.importeBase)} (${r.fo.bases.join('/')})` : ''}`);
      if (x.nota) extra.push(x.nota);
    }
    await navigator.clipboard.writeText(contextoIALog(log, res, { etiqueta: etiquetaLog, cliente: conCliente ? estado.nombre : '' }) + (extra.length ? '\n' + extra.join('\n') : ''));
    aviso('Copiado (sin nombre del empleado): pegalo en el chat junto con el ticket');
  };
  $('#volver-rt').onclick = ev => { ev.preventDefault(); irALog(''); };
  const ver = $('#btn-ver-esquema');
  if (ver) ver.onclick = () => { setModo('esquema', false); $('#q').value = res.cc; buscar(); window.scrollTo({ top: 0 }); };
}

const fechaFinLog = () => fechaISO(estado.log?.periodos[0]?.hasta) ?? $('#fecha').value;

// Navegación con historial: la flecha atrás del navegador vuelve al concepto anterior o a la RT
function irALog(cc, { reemplazar = false } = {}) {
  estado.logCC = cc;
  const url = cc ? '#log=' + encodeURIComponent(cc) : '#log';
  try { (reemplazar ? history.replaceState : history.pushState).call(history, { logCC: cc }, '', url); } catch { /* sin historial */ }
  $('#q-log').value = cc.startsWith('!') ? '' : cc;
  renderLog();
  window.scrollTo({ top: 0 });
}

function buscarLog() {
  if (!estado.log) return;
  irALog($('#q-log').value.trim().toUpperCase().replace(/^&/, ''));
}

function recibirLog(texto, origen) {
  if (!texto?.trim()) return;
  if (!pareceLog(texto)) {
    const otro = pareceRPDASC00(texto) || pareceT512W(texto);
    renderLog(otro ? `Eso parece ${pareceT512W(texto) ? 'una T512W' : 'un RPDASC00'}: los listados del cliente se cargan con "Cargar cliente".`
      : `No reconozco ${esc(origen)} como un log de la calc: faltan las secciones Entrada / Proceso / Salida y las tablas.`);
    return;
  }
  $('#principal').innerHTML = '<section class="vacio"><h2>Leyendo el log…</h2></section>';
  setTimeout(() => {
    try {
      const log = parsearLog(texto);
      if (!log.pasos.length) throw new Error('no encontré pasos del esquema');
      estado.log = log; estado.logCC = '';
      estado.alin = estado.modelo ? alinear(log, estado.modelo) : null;
      $('#q-log').value = '';
      pintarInfoLog();
      renderLog();
      $('#q-log').focus();
    } catch (e) { renderLog(`No se pudo leer el log: ${esc(e.message)}`); }
  }, 30);
}

function conectarZonaLog() {
  const z = $('#zona-log');
  if (!z) return;
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('encima'); });
  z.addEventListener('dragleave', () => z.classList.remove('encima'));
  z.addEventListener('drop', async e => {
    e.preventDefault(); z.classList.remove('encima');
    const f = e.dataTransfer.files[0];
    if (f) recibirLog(await decodificar(f), `el archivo ${f.name}`);
    else recibirLog(e.dataTransfer.getData('text/plain'), 'el texto soltado');
  });
  $('#btn-pegar-log').onclick = async () => {
    try { recibirLog(await navigator.clipboard.readText(), 'lo pegado'); }
    catch { renderLog('El navegador no dejó leer el portapapeles con el botón. Hacé clic en el recuadro y apretá Ctrl+V (⌘+V en Mac).'); }
  };
  $('#f-log').addEventListener('change', async e => { const f = e.target.files[0]; if (f) recibirLog(await decodificar(f), `el archivo ${f.name}`); e.target.value = ''; });
  z.focus();
}

// ---------------------------------------------------------------- eventos
{ const h = new Date(); $('#fecha').value = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`; }
$('#form-busqueda').addEventListener('submit', e => { e.preventDefault(); buscar(); });
$('#form-log').addEventListener('submit', e => { e.preventDefault(); buscarLog(); });
window.addEventListener('popstate', ev => {
  if (estado.modo !== 'log' || !estado.log) return;
  estado.logCC = ev.state?.logCC ?? '';
  $('#q-log').value = estado.logCC;
  renderLog();
});
$('#todos-log').addEventListener('change', () => estado.log && estado.logCC && renderLog());
$('#tab-log').onclick = () => setModo('log');
$('#tab-esq').onclick = () => setModo('esquema');
$('#form-log').addEventListener('click', e => {
  if (e.target.id === 'btn-inicio-log') { irALog(''); return; }
  if (e.target.id === 'btn-cambiar-log') { estado.log = null; estado.logCC = ''; estado.alin = null; pintarInfoLog(); renderLog(); }
});
// Pegar el log en cualquier parte de la pantalla (menos en campos de texto y con un diálogo abierto)
document.addEventListener('paste', e => {
  if (estado.modo !== 'log' || estado.log || e.target.closest('input, textarea, dialog')) return;
  e.preventDefault();
  recibirLog(e.clipboardData.getData('text/plain'), 'lo pegado');
});
// Teclado en la tabla de la RT final
$('#principal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-q]')) e.target.click(); });
$('#nomina').addEventListener('change', () => { $('#periodo').disabled = $('#nomina').value === 'todos'; });
for (const id of ['#fecha', '#esg', '#todos', '#nomina', '#periodo']) $(id).addEventListener('change', () => estado.modelo && $('#q').value && buscar());
$('#principal').addEventListener('click', e => {
  const l = e.target.closest('.link-paso');
  if (l) {
    e.preventDefault();
    const destino = document.getElementById('paso-' + l.dataset.paso);
    if (destino) { destino.scrollIntoView({ behavior: 'smooth', block: 'start' }); destino.classList.add('resaltado'); setTimeout(() => destino.classList.remove('resaltado'), 1600); }
    else aviso('Ese paso no cambia el concepto: no se muestra en el detalle');
    return;
  }
  if (e.target.closest('[data-accion=buscar]')) { $('#q-log').focus(); return; }
  const b = e.target.closest('[data-q]');
  if (!b) return;
  if (estado.modo === 'log') {
    if (b.dataset.tipo === 'regla') {
      if (!esquemaDelLog() || !estado.modelo.reglas[b.dataset.q]) { aviso(esquemaDelLog() ? `La regla ${b.dataset.q} no está en el esquema cargado` : 'Para abrir la regla completa, elegí arriba el cliente de este log'); return; }
      setModo('esquema', false);
      $('#q').value = b.dataset.q;
      history.replaceState(null, '', '#' + encodeURIComponent(b.dataset.q));
      mostrarRegla(b.dataset.q);
    } else irALog(b.dataset.q.startsWith('!') ? b.dataset.q : b.dataset.q.replace(/^&/, '').toUpperCase());
    window.scrollTo({ top: 0 });
    return;
  }
  $('#q').value = b.dataset.q;
  if (b.dataset.tipo === 'regla' && estado.modelo.reglas[b.dataset.q]) {
    history.replaceState(null, '', '#' + encodeURIComponent(b.dataset.q));
    mostrarRegla(b.dataset.q);
  } else buscar();
  window.scrollTo({ top: 0 });
});
$('#btn-cargar').onclick = async () => { await refrescarUsuario(await sesionActiva()); abrirCarga(); };
$('#btn-cerrar-carga').onclick = cerrarCarga;
$('#btn-usar').onclick = usarYGuardarLocal;
$('#btn-guardar').onclick = guardarEnNube;
$('#cli-nombre').addEventListener('input', interpretarCliente);

// Pegar: con Ctrl/⌘+V en cualquier parte del cuadro (menos en los campos de texto) o con el botón
$('#dlg-carga').addEventListener('paste', e => {
  if (e.target.closest('input')) return;
  e.preventDefault();
  recibirTexto(e.clipboardData.getData('text/plain'), 'lo pegado');
});
$('#btn-pegar').onclick = async () => {
  try { recibirTexto(await navigator.clipboard.readText(), 'lo pegado'); }
  catch { mostrarEstadoCarga('El navegador no dejó leer el portapapeles con el botón. Hacé clic en el recuadro y apretá Ctrl+V (⌘+V en Mac).', true); }
};
$('#f-archivos').addEventListener('change', e => { recibirArchivos([...e.target.files]); e.target.value = ''; });
const zona = $('#zona');
zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('encima'); });
zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
zona.addEventListener('drop', e => {
  e.preventDefault(); zona.classList.remove('encima');
  if (e.dataTransfer.files.length) recibirArchivos([...e.dataTransfer.files]);
  else recibirTexto(e.dataTransfer.getData('text/plain'), 'el texto soltado');
});

$('#btn-ingresar').onclick = () => $('#dlg-ingreso').showModal();
$('#btn-cerrar-ingreso').onclick = () => $('#dlg-ingreso').close();
$('#btn-link').onclick = async () => {
  try { await nube.enviarLink($('#mail').value); $('#estado-ingreso').innerHTML = '<div class="estado-carga">Listo: abrí el link que te llegó por mail desde este navegador.</div>'; }
  catch (e) { $('#estado-ingreso').innerHTML = `<div class="estado-carga error">${esc(e.message)}</div>`; }
};
$('#btn-salir').onclick = async () => { await nube.salir(); refrescarUsuario(null); };
$('#cliente').addEventListener('change', e => abrirCliente(e.target.value));

(async () => {
  fetch('catalogo/escala-ganancias.json').then(r => (r.ok ? r.json() : null)).then(d => { estado.escalas = d; }).catch(() => {});
  fetch('catalogo/funciones-29.json').then(r => (r.ok ? r.json() : null)).then(d => { estado.catalogo = d?.funciones ?? null; }).catch(() => {});
  setModo(location.hash.length > 1 && !location.hash.startsWith('#log') ? 'esquema' : (leerLS('modo') || 'log'));
  await refrescarUsuario(null);
  if (nube.configurada()) {
    try { await nube.alCambiarSesion(refrescarUsuario); refrescarUsuario(await sesionActiva()); }
    catch (e) { console.warn('Supabase:', e.message); }
  }
  await cargarListaClientes();
})();
