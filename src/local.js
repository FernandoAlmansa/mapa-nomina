// local.js — Clientes guardados en este navegador (IndexedDB). Una versión por cliente: la última que se cargó.
// Si el navegador no deja usar IndexedDB (modo privado, bloqueos), todo sigue funcionando sin guardar.

const BASE = 'mapa-nomina', ALMACEN = 'clientes';

function abrir() {
  return new Promise((ok, mal) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(ALMACEN, { keyPath: 'id' });
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => mal(pedido.error);
  });
}

async function operar(modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, modo);
    const pedido = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => { db.close(); ok(pedido?.result); };
    tx.onerror = () => { db.close(); mal(tx.error); };
  });
}

export async function listar() {
  try { return (await operar('readonly', s => s.getAll())) ?? []; }
  catch { return []; }
}

export async function guardar(registro) {
  await operar('readwrite', s => s.put({ ...registro, guardado: new Date().toISOString() }));
}

export async function quitar(id) {
  await operar('readwrite', s => s.delete(id));
}
