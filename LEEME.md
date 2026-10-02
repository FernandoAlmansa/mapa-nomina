# Mapa de nómina

Muestra, para cada concepto de un cliente, por dónde pasa en el esquema de nómina: quién lo crea, qué le hace cada regla, dónde entra en la RT y a qué acumula. Las reglas se ven traducidas y como árbol de decisiones.

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

## Publicar
1. GitHub → Settings → Pages → Deploy from branch → master / root.
2. Supabase → SQL Editor: correr `supabase.sql` entero (se puede repetir; da los permisos que faltan).
3. Supabase → Authentication → URL Configuration: poner la URL de GitHub Pages en Site URL y Redirect URLs.

## Cómo leer el recorrido
- La línea genérica `****` de una regla solo se aplica si el paso tiene `GEN` o `Pnn` (en ese caso, solo a conceptos con la clase nn informada).
- Las ramas `VWTCL nn` se resuelven con la T512W vigente a la fecha elegida; las demás decisiones (AMT?, VAKEY, OUTWP…) se muestran todas.
- La operación de cliente `&GVPCCnn` se interpreta como decisión por clase de tratamiento nn.
- Si un concepto no aparece en ninguna regla, lo genera una función estándar (ARSES, ARTAX, acumulaciones): revisar el log.
