// ops.js — Clasifica una operación de regla de cálculo (slot de 10 caracteres del RPDASC00).
// No interpreta la lógica de nómina: solo dice qué tipo de operación es y qué concepto,
// variable o regla toca, para que el índice (paso siguiente) pueda armar crea/modifica/lee.

// Tabla destino de ADDWT/SUBWT/ADDNA según el carácter en la posición 6.
const TABLA_DESTINO = { ' ': 'OT', E: 'RT', I: 'IT', '&': 'VAR', G: 'GRT', C: 'CRT', D: 'DT', L: 'LRT' };

// Tabla origen de los operandos AMT=/NUM=/RTE= (primer carácter del operando).
const TABLA_ORIGEN = { ' ': 'IT', L: 'LRT', O: 'ORT', E: 'RT', C: 'CRT' };

const ES_CONCEPTO = /^[A-Z0-9\/#*]{1,4}$/;

export function clasificarOp(raw) {
  const op = raw.replace(/\s+$/, '');
  const base = { raw: op };

  // Escritura en una tabla: ADDWT, SUBWT, ADDNA, ADDNC (+ tabla + concepto)
  let m = /^(ADDWT|SUBWT|ADDNA|ADDNC)(.?)(.*)$/.exec(op);
  if (m) {
    const t = m[2] || ' ';
    const destino = (m[3] || '').trim() || '*';
    const tabla = TABLA_DESTINO[t] ?? t;
    if (tabla === 'VAR') return { ...base, k: m[1] === 'SUBWT' ? 'restaVar' : 'escribeVar', var: destino };
    return { ...base, k: m[1] === 'SUBWT' ? 'resta' : 'escribe', op: m[1], tabla, cc: destino };
  }

  // Cambio del nombre del concepto que se está procesando
  m = /^WGTYP=(.{1,4})$/.exec(op);
  if (m) return { ...base, k: 'renombra', cc: m[1].trim() };

  // Acumulación según T512W-KUMUL
  if (op === 'ADDCU') return { ...base, k: 'acumula' };

  // Llamada a subregla: PCY/GCY + flag + regla(4) + agrupación(1)
  m = /^([PG]CY)(.)(.{4})(.?)/.exec(op.padEnd(9));
  if (m) {
    const esg = m[4].trim();
    return { ...base, k: 'llama', modo: m[1], regla: m[3], esg: esg && esg !== '*' ? esg : null };
  }

  // Operandos: AMT/NUM/RTE + operador + origen(1-2) + clave
  m = /^(AMT|NUM|RTE)([=+\-*\/%?<>$])(.*)$/.exec(op);
  if (m) {
    const operando = m[3].padEnd(6);
    const s1 = operando[0], s2 = operando[1];
    const clave = operando.slice(2, 6).trim();
    const lado = { campo: m[1], operador: m[2] };
    if (s1 === '&') return { ...base, k: 'leeVar', ...lado, var: operando.slice(1).trim() };
    if (s1 === 'C' && ES_CONCEPTO.test(clave)) return { ...base, k: 'lee', ...lado, tabla: 'CRT', acum: s2, cc: clave };
    if ((s1 in TABLA_ORIGEN || 'VZR'.includes(s1)) && s2 === ' ' && clave && ES_CONCEPTO.test(clave))
      return { ...base, k: 'lee', ...lado, tabla: TABLA_ORIGEN[s1] ?? s1, cc: clave };
    if (s1 === 'K') return { ...base, k: 'constante', ...lado, nombre: operando.slice(1).trim() };
    if (s1 === ' ' && s2 !== ' ') return { ...base, k: 'campoInfotipo', ...lado, nombre: operando.slice(1).trim() };
    return { ...base, k: 'operando', ...lado, valor: operando.trim() };
  }

  // Decisiones más usadas (el resto queda como 'otra' con su código)
  m = /^VWTCL (\d\d)/.exec(op);
  if (m) return { ...base, k: 'decide', por: 'claseTratamiento', clase: m[1] };
  // Operación de cliente &GVP + CCnn (Halliburton): se interpreta como decisión por clase de tratamiento nn
  m = /^&GVPCC(\d\d)/.exec(op);
  if (m) return { ...base, k: 'decide', por: 'claseTratamiento', clase: m[1], nota: 'operación de cliente &GVP interpretada como clase de tratamiento' };
  if (op.startsWith('VAKEY')) return { ...base, k: 'decide', por: 'campo', campo: op.slice(5).trim() };
  if (op.startsWith('OUTWP')) return { ...base, k: 'decide', por: 'datoOrganizativo', campo: op.slice(5).trim() };

  return { ...base, k: 'otra', codigo: (/^[A-Z_]+/.exec(op) || [op])[0] };
}
