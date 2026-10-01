# Mapa de nómina

Muestra, para cada concepto de un cliente, por dónde pasa en el esquema de nómina: quién lo crea, qué le hace cada regla, dónde entra en la RT y a qué acumula.

## Qué archivos necesita cada cliente
1. **RPDASC00** del esquema productivo (ej. 2900), con reglas. Guardar como archivo local, texto con tabuladores.
2. **T512W** desde SE16N, filtrada por MOLGA 29 (si no se filtra, la página la filtra sola antes de subir).

## Probar en tu PC
En esta carpeta: `npx serve .` y abrir http://localhost:3000 → "Cargar archivos".
(No funciona abriendo index.html con doble clic.)

Pruebas del motor: `node test/probar.mjs 2900.txt T512w.txt` y `node test/probar-indice.mjs 2900.txt T512w.txt /110 1000 &ZSAL`.

## Publicar
1. Subir esta carpeta a un repo de GitHub → Settings → Pages → Deploy from branch → main / root.
2. Supabase: crear proyecto, crear bucket público `listados`, correr `supabase.sql`.
3. Supabase → Authentication → URL Configuration: poner la URL de GitHub Pages en Site URL y Redirect URLs.
4. Completar `src/config.js` con la URL y la anon key del proyecto y subir el cambio.

Sin el paso 4 la página funciona igual en modo local.

## Cómo leer el recorrido
- La línea genérica `****` de una regla solo se aplica si el paso tiene `GEN` o `Pnn` (en ese caso, solo a conceptos con la clase nn informada).
- Las ramas `VWTCL nn` se resuelven con la T512W vigente a la fecha elegida; las demás decisiones (AMT?, VAKEY, OUTWP…) se muestran todas.
- La operación de cliente `&GVPCCnn` se interpreta como decisión por clase de tratamiento nn.
- Si un concepto no aparece en ninguna regla, lo genera una función estándar (ARSES, ARTAX, acumulaciones): revisar el log.
