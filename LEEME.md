# Mapa de nómina

Muestra, para cada concepto de un cliente, por dónde pasa en el esquema de nómina: quién lo crea, qué le hace cada regla, dónde entra en la RT y a qué acumula. Las reglas se ven traducidas y como árbol de decisiones.

Tiene dos pestañas:
- **Log de la calc** (la principal): pegás o soltás el log de la PC00_M29_CALC de un empleado y elegís un concepto (o un tema: neto, bruto, Ganancias, aportes…). La pantalla responde "de dónde sale" el importe: un renglón por paso que lo cambia (qué regla o función, qué hizo, con qué números), marcando el paso que define el importe y dónde entra en RT. Para ARTAX (Ganancias), ARTXD (deducciones) y ARSES (aportes y contribuciones) recalcula con los datos del log y dice si cierra; si no cierra, dice dónde nace la diferencia. El detalle técnico (reglas traducidas, tablas antes/después) queda plegado en cada paso. La flecha atrás del navegador vuelve al concepto anterior. Funciona sin cliente; si elegís el cliente, cada paso se ubica en el esquema, se pueden abrir las reglas y se ve qué conceptos suman en las acumulaciones (/1xx). **El log se lee solo en el navegador: no se guarda ni se sube** (tiene datos personales). "Copiar para IA" no incluye el nombre del empleado.
- **Esquema del cliente**: el recorrido posible según la configuración (todas las ramas). Con un log cargado, los pasos que no corrieron quedan en gris.

## Clientes
Al abrir la página se listan los clientes de tres lugares y se usa la versión más nueva de cada uno:
1. **Publicados con la página**: carpeta `clientes/` (índice en `clientes/clientes.json`). Hoy: Halliburton (2900).
2. **Del equipo**: los que alguien guardó en Supabase con "Guardar para el equipo" (pide ingresar con mail @hmconsulting.com.ar).
3. **De este navegador**: todo lo que cargás con "Ver y guardar en este navegador" queda guardado ahí.

Se abre solo el último cliente que usaste.

## Cargar o actualizar un cliente
"Cargar cliente" → pegar (Ctrl/⌘+V) o soltar los dos insumos, en cualquier orden y con cualquier nombre de archivo:
- **RPDASC00** del esquema productivo, con reglas. En SAP: Lista → Grabar → Archivo local → En el portapapeles (o texto con tabuladores).
- **T512W** desde SE16N (se filtra MOLGA 29 sola). Exportar → Archivo local → En el portapapeles (o texto con tabuladores).

El cliente no hace falta escribirlo exacto: "halli", "HAL" o "Halliburton Arg." van a Halliburton. Si no coincide con ninguno, se crea uno nuevo.

## Probar en tu PC
En esta carpeta: `npx serve .` y abrir http://localhost:3000 (no funciona abriendo index.html con doble clic).

Pruebas del motor: `node test/probar.mjs clientes/HAL/rpdasc00.txt clientes/HAL/t512w.txt`.
Lector del log (con el log en `calc.txt`, que no se commitea): `node test/probar-log.mjs calc.txt 3645 clientes/HAL/rpdasc00.txt`.

## Publicar
1. GitHub → Settings → Pages → Deploy from branch → master / root.
2. Supabase → SQL Editor: correr `supabase.sql` entero (se puede repetir; da los permisos que faltan).
3. Supabase → Authentication → URL Configuration: poner la URL de GitHub Pages en Site URL y Redirect URLs.

## Cómo leer el recorrido
- La línea genérica `****` de una regla solo se aplica si el paso tiene `GEN` o `Pnn` (en ese caso, solo a conceptos con la clase nn informada).
- Las ramas `VWTCL nn` se resuelven con la T512W vigente a la fecha elegida; las demás decisiones (AMT?, VAKEY, OUTWP…) se muestran todas.
- La operación de cliente `&GVPCCnn` se interpreta como decisión por clase de tratamiento nn.
- Si un concepto no aparece en ninguna regla, lo genera una función estándar (ARSES, ARTAX, acumulaciones): revisar el log.
- Las funciones de infotipo (P0014, P0015…) con línea genérica se muestran: ahí nace el concepto si el empleado lo tiene en ese infotipo.
- `VALBSn` cuenta como valorización.

## Funciones estándar
`catalogo/funciones-29.json` tiene, por cada función del driver HARCALC0, metadatos sacados del código (tablas, conceptos, parámetros) y una ficha escrita a mano para las principales. `catalogo/escala-ganancias.json` tiene la escala del art. 94 (acumulada mensual y anual) para contrastar /4T1. `src/explicar.js` recalcula ARTAX, ARTXD y ARSES con los números del log. El código de SAP no está en el repo: solo lo que escribimos nosotros.
