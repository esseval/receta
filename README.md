# Mi Libro de Recetas

Aplicación web para **encontrar recetas con los ingredientes que ya tienes en casa**, guardarlas en tu propio libro con **puntuación y notas**, y traducirlas al español. Igual que `comida/` y `portafolio/`: 100% Apache/Laragon con `proxy.php` (PHP + cURL) de backend y JavaScript vanilla de frontend. Sin `npm`/`Node`.

## Características

- **Búsqueda por ingredientes**: escribes "pollo, arroz, ajo" y obtienes un listado de recetas con **% de coincidencia**, qué ingredientes tuyos usa cada una y **cuáles te faltan** para seguirlas.
- **Dos fuentes de datos**
  - **TheMealDB** (https://www.themealdb.com) con la clave de prueba `1` → siempre disponible, sin registro.
  - **Spoonacular** como *fallback* opcional si agregas tu clave en `config.php`.
- **Traducción EN→ES** con un botón (MyMemory sin clave, con respaldo Google). Las traducciones se cachean en el servidor.
- **Mi libro**: favoritos con **estrellas (1-5)** y **nota personal**, filtrables por texto y puntuación.
- **Historial** de búsquedas (un clic para repetir) y **export/import JSON + TXT**, con modo *combinar* o *reemplazar*.
- **Búsqueda por nombre** en la segunda pestaña (TheMealDB `search.php`).
- Autocompletado de 992 ingredientes reales + diccionario español→inglés integrado.
- Tema claro/oscuro, diseño responsive, sin cuenta y sin backend propio de datos.

## Estructura

```
receta/
├── index.html              # Interfaz (buscador, resultados, detalle, mi libro, historial)
├── proxy.php               # Backend: health | recipes | meal | search | list | translate
├── config.php.example      # Plantilla opcional (spoonacular_key, translate_email, TTLs)
├── cache/
│   ├── .htaccess           # Require all denied (no se sirve)
│   └── *.json              # Caché server-side (gitignored)
├── css/
│   ├── styles.css          # Tokens, componentes, tema claro/oscuro
│   └── responsive.css      # Media queries y print
├── js/
│   ├── app.js              # Init, tema, health check
│   ├── api.js              # Cliente de proxy.php (sintaxis PHP ing[]=...)
│   ├── dict.js             # Diccionario ES↔EN + normalización
│   ├── recipes.js          # Chips, búsqueda, orden y tarjetas de resultados
│   ├── detail.js           # <dialog> de receta: ingredientes, pasos, ★, nota, traducir
│   ├── book.js             # Mi libro (favoritos, estrellas, notas)
│   ├── history.js          # Historial de búsquedas
│   ├── translate.js        # Traducción EN→ES de una receta
│   ├── import-export.js    # Exportar/importar/borrar datos locales
│   ├── storage.js          # localStorage con prefijo mi_libro_recetas_
│   ├── state.js            # Estado compartido en memoria (evita imports circulares)
│   └── ui.js               # toasts, tema, diálogos, estrellas, HTML seguro
├── assets/ejemplo-libro.json  # Archivo de ejemplo para probar Importar
└── README.md
```

## Requisitos

- Laragon con **Apache + PHP 8.x + `php_curl`** (ya lo tienes).
- **Sin API keys obligatorias**: TheMealDB funciona con la clave de prueba `1`.

## Cómo usar

1. Inicia Apache en Laragon y abre **http://localhost/receta/** (no `file://` ni `python -m http.server`: `proxy.php` necesita PHP).
2. Comprueba el backend: **http://localhost/receta/proxy.php?action=health&deep=1**
   → `{"ok":true,"sources":["themealdb"],"themaldb":"ok",...}`
3. Escribe ingredientes en español o inglés (Enter o botón *Agregar*) y pulsa **Buscar recetas**.
4. Abre una receta para ver ingredientes, pasos, vídeo/fuente; guárdala con ★, puntuarla y déjale una nota.
5. En **Datos** puedes exportar/importar JSON o TXT, o borrar todo lo local.

### Configuración (opcional)

Copia `config.php.example` a `config.php` y completa lo que necesites:

```php
<?php return [
    'spoonacular_key' => 'TU_CLAVE',   // solo si quieres el fallback de Spoonacular
    'translate_email' => 'tu@mail.com',// sube la cuota diaria de MyMemory
    'cache_ttl'       => 300,          // seg. para búsquedas
];
```

Sin `config.php` todo funciona: recetas 100% TheMealDB y traducción con cuota anónima de MyMemory.

## API (proxy.php)

Todas las llamadas del browser pasan por `proxy.php` (mismo origen, sin CORS):

```
Browser --fetch--> proxy.php?action=recipes&ing[]=chicken&ing[]=garlic   (sin CORS)
Apache/PHP --cURL--> themealdb filter.php (1 petición por ingrediente)
Apache/PHP --cURL--> themealdb lookup.php (scoring de los 30 mejores candidatos)
Browser <--JSON-- {recipes:[{name,image,match:{pct,used,required}}]}
```

| Endpoint | Descripción |
|---|---|
| `?action=health[&deep=1]` | Estado del backend, fuentes activas, caché escribible y si el hosting permite `curl_multi` |
| `?action=recipes&ing[]=pollo&ing[]=ajo` (o `&i=pollo,ajo`) | Listado puntuado de recetas (máx. 12 ingredientes) |
| `?action=meal&id=52772` / `&id=spoon-716429` | Detalle: ingredientes+medidas, pasos, vídeo, fuente |
| `?action=search&q=arrabiata` | Búsqueda por nombre |
| `?action=list&what=ingredients\|areas\|categories` | Listas para autocompletado (caché 7 días) |
| `POST {action:"translate", texts:[...]}` | EN→ES (MyMemory → Google gtx), troceado y cacheado |

### ¿Cómo puntúa las recetas?

TheMealDB **no permite filtro multi-ingrediente con la clave gratuita** (es una función *premium*), así que `proxy.php`:

1. Consulta `filter.php?i=` **una vez por ingrediente** (en paralelo con `curl_multi`).
2. Ordena los candidatos por cuántos de tus ingredientes los devolvieron y se queda con los 30 mejores.
3. Descarga el detalle (`lookup.php`) de esos candidatos y calcula, con la misma normalización que usa el frontend:
   - `pct` = ingredientes tuyos que usa la receta / tus ingredientes (×100)
   - `used` = ingredientes tuyos que la receta necesita
   - `required` = ingredientes que pide la receta y tú no diste (sin contar sal, agua, aceite…)
   - `unused` = tus ingredientes que esta receta no usa
4. Si no hay **ningún** resultado y configuraste clave, prueba Spoonacular (`findByIngredients`) y mapea su respuesta al mismo formato.

Todo se cachea en `cache/*.json` (5 min por defecto).

### Diccionario español → inglés

La base de datos está en inglés, así que `js/dict.js` convierte tu ingrediente a la clave que busca la API (`pollo → chicken`, `salsa de soja → soy sauce`, …) y te muestra la traducción en el chip. En el detalle, cada ingrediente lleva su glosa en español. Si escribes un término que no está en el diccionario, se envía tal cual (útil si prefieres el nombre en inglés).

### Traducción

Botón **🌐 Traducir al español** en el detalle: envía título, ingredientes y pasos a `proxy.php?action=translate`, que trocea el texto en fragmentos ≤450 caracteres, los traduce con **MyMemory** (y si falla, con Google `gtx`) y los cachea 30 días. Con `translate_email` en `config.php` sube la cuota diaria de MyMemory.

## Datos locales

- Favoritos, notas, puntuaciones, historial y ajustes viven en `localStorage` bajo el prefijo `mi_libro_recetas_`.
- **Exportar**: JSON (backup completo) o TXT legible.
- **Importar**: combina (respeta tus notas/puntuaciones existentes) o reemplaza todo.
- Archivo de ejemplo: `assets/ejemplo-libro.json` → *Datos → Importar JSON*.

## Limitaciones

- **TheMealDB clave `1` es de desarrollo/educación**: sin cuota estricta documentada, pero exige atribución y contenido solo en inglés. Si la usas públicamente, conviene apoyar al proyecto (https://www.themealdb.com/documentation).
- El contenido (categorías, recetas) puede ser angloparlante aunque traduzcas los pasos; los **nombres de la receta** también se traducen en la vista, pero no en la tarjeta del listado.
- Spoonacular solo se activa con clave propia (tier gratuito ≈150 consultas/día).
- MyMemory tiene cuota diaria anónima; sin correo configurado pueden agotarse las traducciones (el aviso es visible en la app).
- Las recetas son orientativas: verifica ingredientes y tiempos antes de cocinar.
- En hostings gratuitos (p. ej. InfinityFree) `curl_multi_exec` está deshabilitado. `proxy.php` lo detecta (`health` → `curlMulti`) y descarga los detalles en serie reutilizando la conexión; la primera búsqueda de una combinación puede tardar unos segundos y luego se sirve de `cache/`.

## Verificación

- `php -l proxy.php` → sin errores; `node --check` en los 12 módulos ES.
- Prueba end-to-end (21 comprobaciones) contra Edge headless: carga, health, tema, chips ES→EN, listado con %, detalle, favoritos, estrellas, traducción, historial, búsqueda por nombre, estado vacío, importar `assets/ejemplo-libro.json` y borrado total.

## Licencia

MIT

---

Recetas e imágenes: [TheMealDB](https://www.themealdb.com/) · Datos complementarios: [Spoonacular](https://spoonacular.com/food-api)
