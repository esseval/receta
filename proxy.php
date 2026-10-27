<?php
// proxy.php — Backend Apache/Laragon para "Mi Libro de Recetas"
// Mismo patrón que comida/proxy.php y portafolio/proxy.php: el browser consulta proxy.php (mismo origen, sin CORS),
// PHP hace las llamadas upstream con cURL y cachea la respuesta en cache/*.json (TTL configurable en config.php).
//
// Fuentes de recetas:
//   - TheMealDB (https://www.themealdb.com) con la clave de prueba "1"  → SIEMPRE disponible
//   - Spoonacular (https://spoonacular.com) con config.php['spoonacular_key'] → fallback opcional
// Traducción EN→ES: MyMemory (sin clave) con respaldo Google gtx.
//
// Endpoints:
//   ?action=health
//   ?action=recipes&ing[]=chicken&ing[]=garlic            (o &i=chicken,garlic)
//   ?action=meal&id=52772 | &id=spoon-716429
//   ?action=search&q=pasta
//   ?action=list&what=ingredients|areas|categories
//   POST {action:'translate', texts:[...], from:'en', to:'es'}

declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

const TMDB_BASE       = 'https://www.themealdb.com/api/json/v1/1/';
const MAX_INGREDIENTS = 12;
const MAX_CANDIDATES  = 30;   // recetas a "revisar" con lookup para puntuar
const MAX_RESULTS     = 30;   // recetas devueltas
const PER_FILTER_CAP  = 60;   // recetas consideradas por ingrediente
const MAX_TEXTS       = 30;   // fragmentos por llamada de traducción
const MAX_TOTAL_CHARS = 12000;// chars totales por llamada de traducción
const BUDGET_FILTERS  = 10;   // seg. máx. para los filter.php (si curl_multi no está disponible)
const REQUEST_BUDGET  = 24;   // seg. máx. de trabajo upstream por búsqueda (total)
const CANDIDATES_SLOW = 18;   // candidatos a revisar cuando no hay curl_multi (peticiones en serie)

const PANTRY = [
    'salt', 'water', 'black pepper', 'pepper', 'sugar', 'oil', 'olive oil',
    'vegetable oil', 'sunflower oil', 'vinegar', 'ice', 'icing sugar', 'caster sugar',
];

const ACCENTS = [
    'á'=>'a','à'=>'a','ä'=>'a','â'=>'a','ã'=>'a','å'=>'a',
    'é'=>'e','è'=>'e','ë'=>'e','ê'=>'e',
    'í'=>'i','ì'=>'i','ï'=>'i','î'=>'i',
    'ó'=>'o','ò'=>'o','ö'=>'o','ô'=>'o','õ'=>'o',
    'ú'=>'u','ù'=>'u','ü'=>'u','û'=>'u',
    'ñ'=>'n','ç'=>'c','ß'=>'ss',
];

function respond(int $code, array $data): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function loadConfig(): array {
    $defaults = [
        'cache_ttl'         => 300,
        'meal_ttl'          => 86400,
        'list_ttl'          => 604800,
        'translate_ttl'     => 2592000,
        'timeout'           => 15,
        'concurrency'       => 12,
        'user_agent'        => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'spoonacular_key'   => '',
        'translate_email'   => '',
    ];
    $file = __DIR__ . '/config.php';
    if (file_exists($file)) {
        $cfg = require $file;
        if (is_array($cfg)) $defaults = array_merge($defaults, $cfg);
    }
    return $defaults;
}

/* ------------------------------- caché -------------------------------- */

function cacheFile(string $key): string {
    return __DIR__ . '/cache/' . preg_replace('/[^a-zA-Z0-9_.-]/', '', $key) . '.json';
}

function cacheGet(string $key, int $ttl): ?string {
    $f = cacheFile($key);
    if (!file_exists($f)) return null;
    if (time() - filemtime($f) > $ttl) return null;
    return @file_get_contents($f);
}

function cachePut(string $key, string $body): void {
    if (!is_dir(__DIR__ . '/cache')) @mkdir(__DIR__ . '/cache', 0777, true);
    @file_put_contents(cacheFile($key), $body, LOCK_EX);
}

/* ------------------------------- cURL --------------------------------- */

function curlOne(string $url, int $timeout, string $ua): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json', 'User-Agent: ' . $ua],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = (string) curl_error($ch);
    curl_close($ch);
    return [(string)$body, $code, $err];
}

/**
 * curl_multi no está disponible en hostings gratuitos como InfinityFree
 * (curl_multi_exec está en disable_functions). En PHP 8 llamar a una función
 * deshabilitada lanza un Error fatal → HTTP 500. Por eso comprobamos antes.
 */
function hasCurlMulti(): bool {
    static $ok = null;
    if ($ok === null) {
        $ok = true;
        foreach ([
            'curl_multi_init', 'curl_multi_add_handle', 'curl_multi_exec',
            'curl_multi_select', 'curl_multi_getcontent',
            'curl_multi_remove_handle', 'curl_multi_close',
        ] as $fn) {
            if (!function_exists($fn)) { $ok = false; break; }
        }
    }
    return $ok;
}

/**
 * Descarga varias URLs. Usa curl_multi si el hosting lo permite; si no,
 * hace las peticiones en serie reutilizando un solo handle cURL (keep-alive)
 * para no provocar el fatal error de curl_multi_exec ni multiplicar la latencia.
 * $budget = segundos máximos para toda la tanda (0 = sin límite). Al agotarse,
 * las URLs restantes quedan a null y la respuesta se devuelve parcialmente.
 */
function fetchMany(array $urls, int $timeout, string $ua, int $concurrency = 8, int $budget = 0): array {
    $out = array_fill(0, count($urls), null);
    if (!$urls) return $out;
    $deadline = $budget > 0 ? microtime(true) + $budget : 0.0;
    $expired = static function () use ($deadline): bool {
        return $deadline > 0 && microtime(true) >= $deadline;
    };

    if (!hasCurlMulti()) {
        // Un solo handle para reutilizar la conexión TLS (keep-alive): sin
        // curl_multi, abrir una conexión nueva por receta multiplica la latencia.
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => ['Accept: application/json', 'User-Agent: ' . $ua],
        ]);
        foreach ($urls as $i => $url) {
            if ($expired()) break;
            $left = $deadline > 0 ? max(1, (int)ceil($deadline - microtime(true))) : $timeout;
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_TIMEOUT, min($timeout, $left));
            $body = curl_exec($ch);
            $out[$i] = is_string($body) ? $body : '';
        }
        curl_close($ch);
        return $out;
    }

    $chunks = array_chunk(array_keys($urls), max(1, $concurrency), true);
    foreach ($chunks as $chunk) {
        if ($expired()) break;
        $left = $deadline > 0 ? max(1, (int)ceil($deadline - microtime(true))) : $timeout;
        $perTimeout = min($timeout, $left);
        $mh = curl_multi_init();
        $handles = [];
        foreach ($chunk as $i) {
            $ch = curl_init($urls[$i]);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT        => $perTimeout,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_HTTPHEADER     => ['Accept: application/json', 'User-Agent: ' . $ua],
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$i] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $active);
            if ($active) curl_multi_select($mh, 0.05);
        } while ($active && $status === CURLM_OK);
        foreach ($handles as $i => $ch) {
            $out[$i] = (string) curl_multi_getcontent($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
    }
    return $out;
}

/* --------------------------- normalización ---------------------------- */

function normKey(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    $s = strtr($s, ACCENTS);
    $s = preg_replace('/[^a-z0-9]+/u', ' ', $s) ?? '';
    $s = trim(preg_replace('/\s+/', ' ', $s) ?? '');
    if (mb_strlen($s) > 3 && str_ends_with($s, 's')) $s = mb_substr($s, 0, -1);
    return $s;
}

function keysMatch(string $a, string $b): bool {
    if ($a === '' || $b === '') return false;
    if ($a === $b) return true;
    if (mb_strlen($a) < 3 || mb_strlen($b) < 3) return false;
    return str_contains($a, $b) || str_contains($b, $a);
}

function inPantry(string $key): bool {
    foreach (PANTRY as $p) if (keysMatch($key, $p)) return true;
    return false;
}

function parseIngredientsInput(array $raw): array {
    $out = [];
    $seen = [];
    foreach ($raw as $item) {
        if (!is_scalar($item)) continue;
        $item = trim(strip_tags((string)$item));
        if ($item === '') continue;
        if (mb_strlen($item) > 40) $item = mb_substr($item, 0, 40);
        $key = normKey($item);
        if ($key === '' || isset($seen[$key])) continue;
        $seen[$key] = true;
        $out[] = $item;
        if (count($out) >= MAX_INGREDIENTS) break;
    }
    return $out;
}

function mealIngredients(array $m): array {
    $out = [];
    for ($i = 1; $i <= 20; $i++) {
        $name = trim((string)($m['strIngredient' . $i] ?? ''));
        if ($name === '') continue;
        $out[] = [
            'name'    => $name,
            'measure' => trim((string)($m['strMeasure' . $i] ?? '')),
        ];
    }
    return $out;
}

/** Puntuación de una receta contra los ingredientes pedidos por el usuario. */
function scoreMeal(array $mealIng, array $userKeys): array {
    $mealKeys = [];
    foreach ($mealIng as $ing) $mealKeys[] = normKey($ing['name']);
    $mealKeys = array_values(array_filter($mealKeys));

    $used = [];
    $unused = [];
    foreach ($userKeys as $k) {
        $hit = false;
        foreach ($mealKeys as $mk) if (keysMatch($k, $mk)) { $hit = true; break; }
        if ($hit) $used[] = $k; else $unused[] = $k;
    }

    $required = [];
    foreach ($mealKeys as $mk) {
        if (inPantry($mk)) continue;
        $covered = false;
        foreach ($userKeys as $k) if (keysMatch($k, $mk)) { $covered = true; break; }
        if (!$covered) $required[] = $mk;
    }
    $required = array_values(array_unique($required));

    $total = max(1, count($userKeys));
    return [
        'pct'      => (int)round(100 * count($used) / $total),
        'used'     => $used,
        'unused'   => $unused,
        'required' => $required,
        'count'    => count($used),
    ];
}

function splitSteps(string $text): array {
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $text = trim($text);
    if ($text === '') return [];
    $parts = preg_split('/\n+/', $text) ?: [$text];
    $steps = [];
    $pending = '';

    foreach ($parts as $part) {
        $part = trim($part);
        if ($part === '') continue;
        // Etiqueta suelta tipo "step 1" / "method" → se pega a la línea siguiente
        if ($pending !== '') { $part = $pending . ' ' . $part; $pending = ''; }

        if (mb_strlen($part) > 420) {
            $sent = preg_split('/(?<=[.!?;:])\s+(?=[A-Z0-9"*«])/', $part) ?: [$part];
            $buf = '';
            foreach ($sent as $s) {
                $s = trim($s);
                if ($s === '') continue;
                if (mb_strlen($s) > 420) {
                    if ($buf !== '') { $steps[] = $buf; $buf = ''; }
                    $steps[] = mb_substr($s, 0, 420);
                    continue;
                }
                if ($buf === '') { $buf = $s; }
                elseif (mb_strlen($buf) + 1 + mb_strlen($s) <= 420) { $buf .= ' ' . $s; }
                else { $steps[] = $buf; $buf = $s; }
            }
            if ($buf !== '') $steps[] = $buf;
            continue;
        }

        $isLabel = (bool)preg_match('/^(step\s*\d+|method|directions?|instructions?|preparation|to serve|tip)$/i', $part)
            || (mb_strlen($part) <= 12 && !preg_match('/[.!?]$/', $part));
        if ($isLabel) { $pending = $part; continue; }

        $steps[] = $part;
    }
    if ($pending !== '') $steps[] = $pending;
    if (count($steps) > 40) $steps = array_slice($steps, 0, 40);
    return $steps;
}

function htmlToSteps(?string $html): array {
    if (!$html) return [];
    $html = preg_replace('/<br\s*\/?>/i', "\n", $html) ?? $html;
    $html = preg_replace('/<\/p>|<\/li>|<\/div>/i', "\n", $html) ?? $html;
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return splitSteps($text);
}

/* ------------------------------ respuestas ---------------------------- */

function cardFromMeal(array $m, ?array $match): array {
    $id = (string)($m['idMeal'] ?? '');
    $thumb = (string)($m['strMealThumb'] ?? '');
    return [
        'id'       => $id,
        'source'   => 'themealdb',
        'name'     => trim((string)($m['strMeal'] ?? '')),
        'image'    => $thumb !== '' ? $thumb . '/medium' : '',
        'category' => $m['strCategory'] ?? null,
        'area'     => $m['strArea'] ?? null,
        'match'    => $match,
    ];
}

/* ------------------------------- salud -------------------------------- */

$jsonInput = [];
$rawBody = file_get_contents('php://input') ?: '';
$ctype = $_SERVER['CONTENT_TYPE'] ?? '';
if ($rawBody !== '' && stripos($ctype, 'application/json') !== false) {
    $decoded = json_decode($rawBody, true);
    if (is_array($decoded)) $jsonInput = $decoded;
}

$action = $_GET['action'] ?? $_POST['action'] ?? ($jsonInput['action'] ?? '');

if ($action === 'health') {
    $cfg = loadConfig();
    $cacheWritable = is_dir(__DIR__ . '/cache') ? is_writable(__DIR__ . '/cache') : is_writable(__DIR__);
    $deep = isset($_GET['deep']) || isset($_POST['deep']);
    $tmdb = null;
    if ($deep) {
        [$b, $c, $e] = curlOne(TMDB_BASE . 'lookup.php?i=52772', 8, $cfg['user_agent']);
        $tmdb = ($e === '' && $c === 200 && json_decode($b) !== null) ? 'ok' : ('error: ' . ($e ?: 'HTTP ' . $c));
    }
    respond(200, [
        'ok'              => true,
        'backend'         => 'recetas via proxy.php (Laragon Apache)',
        'sources'         => array_values(array_filter(['themealdb', trim($cfg['spoonacular_key']) !== '' ? 'spoonacular' : null])),
        'hasSpoonacular'  => trim($cfg['spoonacular_key']) !== '',
        'hasTranslateMail'=> trim($cfg['translate_email']) !== '',
        'cacheWritable'   => $cacheWritable,
        'curlMulti'       => hasCurlMulti(),
        'themaldb'        => $tmdb,
    ]);
}

$cfg = loadConfig();

/* ------------------------------- recipes ------------------------------ */

if ($action === 'recipes') {
    $raw = $_GET['ing'] ?? $_POST['ing'] ?? null;
    if ($raw === null) {
        $i = $_GET['i'] ?? $_POST['i'] ?? '';
        $raw = $i !== '' ? explode(',', (string)$i) : [];
    }
    if (!is_array($raw)) $raw = [$raw];
    $terms = parseIngredientsInput($raw);
    if (!$terms) respond(400, ['error' => 'Falta la lista de ingredientes', 'hint' => 'Usa ?action=recipes&ing[]=chicken&ing[]=garlic (máx. ' . MAX_INGREDIENTS . ')']);

    $userKeys = array_map('normKey', $terms);
    $cacheKey = 'recipes-' . md5(implode('|', array_map('normKey', $terms)));
    $cached = cacheGet($cacheKey, (int)$cfg['cache_ttl']);
    if ($cached !== null) { echo $cached; exit; }

    $warnings = [];
    $recipes = [];
    $mode = 'union';
    $startedAt = microtime(true);
    $elapsed = static fn(): float => microtime(true) - $startedAt;
    $canMulti = hasCurlMulti();

    // 1) TheMealDB: un filtro por ingrediente (multi-ingrediente nativo es "premium")
    $filterUrls = [];
    foreach ($terms as $t) $filterUrls[] = TMDB_BASE . 'filter.php?i=' . rawurlencode($t);
    $filterBudget = max(1, min(BUDGET_FILTERS, REQUEST_BUDGET - $elapsed()));
    $bodies = fetchMany($filterUrls, (int)$cfg['timeout'], $cfg['user_agent'], (int)$cfg['concurrency'], $filterBudget);

    $hits = [];      // idMeal => nº de filtros que lo devolvieron
    $order = [];     // orden de primera aparición
    $seenUpstream = 0;
    foreach ($bodies as $body) {
        if (!$body) continue;
        $j = json_decode($body, true);
        if (!is_array($j) || !array_key_exists('meals', $j)) continue;
        $seenUpstream++;
        if (!is_array($j['meals'])) continue;
        $slice = array_slice($j['meals'], 0, PER_FILTER_CAP);
        foreach ($slice as $m) {
            $id = (string)($m['idMeal'] ?? '');
            if ($id === '') continue;
            if (!isset($hits[$id])) { $hits[$id] = 0; $order[$id] = count($order); }
            $hits[$id]++;
        }
    }
    if ($seenUpstream === 0) $warnings[] = 'TheMealDB no respondió (reintenta en unos segundos)';

    // 2) Ranking por nº de ingredientes que coinciden + lookup para puntuar en serio
    $candidateIds = array_map('strval', array_keys($hits));
    usort($candidateIds, function ($a, $b) use ($hits, $order) {
        if ($hits[$a] !== $hits[$b]) return $hits[$b] <=> $hits[$a];
        return $order[$a] <=> $order[$b];
    });
    $maxCandidates = $canMulti ? MAX_CANDIDATES : CANDIDATES_SLOW;
    $candidateIds = array_slice($candidateIds, 0, $maxCandidates);

    if ($candidateIds) {
        // Reutiliza el detalle ya descargado (24 h) para no repetir lookup.php
        // entre búsquedas distintas que comparten recetas.
        $lbodies = [];
        $pending = [];
        foreach ($candidateIds as $i => $id) {
            $cachedLookup = cacheGet('lookup-tmdb-' . $id, (int)$cfg['meal_ttl']);
            if ($cachedLookup !== null) { $lbodies[$i] = $cachedLookup; continue; }
            $lbodies[$i] = null;
            $pending[$i] = TMDB_BASE . 'lookup.php?i=' . rawurlencode($id);
        }
        if ($pending) {
            $lookupBudget = (int)ceil(REQUEST_BUDGET - $elapsed());
            if ($lookupBudget > 0) {
                $fetched = fetchMany($pending, (int)$cfg['timeout'], $cfg['user_agent'], (int)$cfg['concurrency'], $lookupBudget);
                foreach ($fetched as $i => $body) {
                    if ($body === null || $body === '') continue;
                    $lbodies[$i] = $body;
                    $decoded = json_decode($body, true);
                    if (is_array($decoded) && !empty($decoded['meals'][0])) {
                        cachePut('lookup-tmdb-' . $candidateIds[$i], $body);
                    }
                }
            }
        }
        ksort($lbodies);

        $skipped = 0;
        foreach ($lbodies as $body) {
            if ($body === null || $body === '') { $skipped++; continue; }
            $j = json_decode($body, true);
            if (!is_array($j) || empty($j['meals'][0]) || !is_array($j['meals'][0])) continue;
            $m = $j['meals'][0];
            $ing = mealIngredients($m);
            $match = scoreMeal($ing, $userKeys);
            if ($match['count'] < 1) continue;
            $recipes[] = cardFromMeal($m, $match);
        }
        usort($recipes, function ($a, $b) {
            if ($a['match']['pct'] !== $b['match']['pct']) return $b['match']['pct'] <=> $a['match']['pct'];
            if ($a['match']['count'] !== $b['match']['count']) return $b['match']['count'] <=> $a['match']['count'];
            return strcmp($a['name'], $b['name']);
        });
        $recipes = array_slice($recipes, 0, MAX_RESULTS);
        $mode = 'scored';
        if ($skipped > 0) $warnings[] = 'No se pudieron revisar ' . $skipped . ' recetas (tiempo de espera del hosting); vuelve a buscar para completar el resultado';
    }

    // 3) Fallback Spoonacular (si no hubo nada y hay clave en config.php)
    $source = 'themealdb';
    if (!$recipes) {
        $key = trim($cfg['spoonacular_key']);
        if ($key === '') {
            if (!$warnings) $warnings[] = 'Sin coincidencias para esos ingredientes';
        } else {
            $url = 'https://api.spoonacular.com/recipes/findByIngredients?apiKey=' . rawurlencode($key)
                 . '&number=' . MAX_RESULTS . '&ignorePantry=true&ingredients=' . rawurlencode(implode(',', $terms));
            [$b, $c, $e] = curlOne($url, (int)$cfg['timeout'], $cfg['user_agent']);
            $j = json_decode($b, true);
            if ($e !== '' || $c >= 400 || !is_array($j)) {
                $warnings[] = 'Spoonacular respondió ' . ($e ?: 'HTTP ' . $c);
            } else {
                $source = 'spoon';
                foreach ($j as $row) {
                    if (!is_array($row)) continue;
                    $used = array_map(fn($x) => normKey((string)($x['name'] ?? '')), $row['usedIngredients'] ?? []);
                    $missed = array_map(fn($x) => normKey((string)($x['name'] ?? '')), $row['missedIngredients'] ?? []);
                    $unused = array_map(fn($x) => normKey((string)($x['name'] ?? '')), $row['unusedIngredients'] ?? []);
                    $used = array_values(array_unique(array_filter($used)));
                    $recipes[] = [
                        'id'       => (string)($row['id'] ?? ''),
                        'source'   => 'spoon',
                        'name'     => (string)($row['title'] ?? ''),
                        'image'    => (string)($row['image'] ?? ''),
                        'category' => null,
                        'area'     => null,
                        'match'    => [
                            'pct'      => (int)round(100 * count($used) / max(1, count($userKeys))),
                            'used'     => $used,
                            'unused'   => array_values(array_unique(array_filter($unused))),
                            'required' => array_values(array_unique($missed)),
                            'count'    => count($used),
                        ],
                    ];
                }
                usort($recipes, fn($a, $b) => $b['match']['pct'] <=> $a['match']['pct']);
            }
        }
    }

    $payload = [
        'ok'          => true,
        'source'      => $source,
        'mode'        => $mode,
        'query'       => $terms,
        'userKeys'    => $userKeys,
        'count'       => count($recipes),
        'recipes'     => $recipes,
        'warnings'    => $warnings,
    ];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    cachePut($cacheKey, $json);
    echo $json;
    exit;
}

/* -------------------------------- meal -------------------------------- */

if ($action === 'meal') {
    $id = trim((string)($_GET['id'] ?? $_POST['id'] ?? ''));
    if (!preg_match('/^(?:spoon-)?\d{1,10}$/', $id)) respond(400, ['error' => 'id inválido', 'hint' => 'Usa ?action=meal&id=52772 o &id=spoon-716429']);
    $isSpoon = str_starts_with($id, 'spoon-');
    $numeric = preg_replace('/^spoon-/', '', $id);

    $cacheKey = 'meal-' . ($isSpoon ? 'spoon-' : 'tmdb-') . $numeric;
    $cached = cacheGet($cacheKey, (int)$cfg['meal_ttl']);
    if ($cached !== null) { echo $cached; exit; }

    if ($isSpoon) {
        $key = trim($cfg['spoonacular_key']);
        if ($key === '') respond(400, ['error' => 'Falta spoonacular_key en config.php', 'hint' => 'Copia config.php.example a config.php y agrega tu clave de spoonacular.com']);
        $url = 'https://api.spoonacular.com/recipes/' . rawurlencode($numeric) . '/information?includeNutrition=false&apiKey=' . rawurlencode($key);
        [$b, $c, $e] = curlOne($url, (int)$cfg['timeout'], $cfg['user_agent']);
        if ($e !== '') respond(502, ['error' => 'cURL spoonacular', 'detail' => $e]);
        if ($c === 401 || $c === 402) respond(401, ['error' => 'Spoonacular rechazó la clave (HTTP ' . $c . ')', 'hint' => 'Revisa spoonacular_key en config.php y tu cuota diaria']);
        if ($c >= 400) respond($c, ['error' => 'Spoonacular respondió HTTP ' . $c]);
        $m = json_decode($b, true);
        if (!is_array($m)) respond(502, ['error' => 'Spoonacular devolvió JSON inválido']);

        $ingredients = [];
        foreach (($m['extendedIngredients'] ?? []) as $ing) {
            $amount = $ing['amount'] ?? '';
            $unit = $ing['unit'] ?? '';
            $measure = trim(preg_replace('/\s+/', ' ', (string)$amount . ' ' . (string)$unit));
            $ingredients[] = [
                'name'    => (string)($ing['originalName'] ?? $ing['name'] ?? ''),
                'measure' => $measure,
            ];
        }
        $steps = htmlToSteps($m['instructions'] ?? null);
        if (!$steps && !empty($m['analyzedInstructions'][0]['steps'])) {
            foreach ($m['analyzedInstructions'][0]['steps'] as $s) $steps[] = trim((string)($s['step'] ?? ''));
        }
        $payload = [
            'ok'           => true,
            'source'       => 'spoon',
            'id'           => (string)$numeric,
            'name'         => (string)($m['title'] ?? ''),
            'category'     => !empty($m['dishTypes'][0]) ? $m['dishTypes'][0] : null,
            'area'         => !empty($m['cuisines'][0]) ? $m['cuisines'][0] : null,
            'image'        => (string)($m['image'] ?? ''),
            'tags'         => array_values(array_unique(array_merge($m['diets'] ?? [], $m['cuisines'] ?? []))),
            'ingredients'  => $ingredients,
            'steps'        => $steps,
            'instructions' => implode("\n\n", $steps),
            'video'        => null,
            'sourceUrl'    => (string)($m['sourceUrl'] ?? ''),
            'siteUrl'      => (string)($m['sourceUrl'] ?? ''),
        ];
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        cachePut($cacheKey, $json);
        echo $json;
        exit;
    }

    [$b, $c, $e] = curlOne(TMDB_BASE . 'lookup.php?i=' . rawurlencode($numeric), (int)$cfg['timeout'], $cfg['user_agent']);
    if ($e !== '') respond(502, ['error' => 'cURL TheMealDB', 'detail' => $e]);
    if ($c >= 400) respond($c, ['error' => 'TheMealDB respondió HTTP ' . $c]);
    $j = json_decode($b, true);
    if (!is_array($j) || empty($j['meals'][0])) respond(404, ['error' => 'Receta no encontrada', 'hint' => 'id=' . $numeric . ' no existe en TheMealDB']);
    $m = $j['meals'][0];
    $instructions = trim((string)($m['strInstructions'] ?? ''));
    $payload = [
        'ok'           => true,
        'source'       => 'themealdb',
        'id'           => (string)$numeric,
        'name'         => trim((string)($m['strMeal'] ?? '')),
        'category'     => $m['strCategory'] ?? null,
        'area'         => $m['strArea'] ?? null,
        'image'        => !empty($m['strMealThumb']) ? $m['strMealThumb'] . '/large' : '',
        'tags'         => array_values(array_filter(array_map('trim', explode(',', (string)($m['strTags'] ?? ''))))),
        'ingredients'  => mealIngredients($m),
        'steps'        => splitSteps($instructions),
        'instructions' => $instructions,
        'video'        => (string)($m['strYoutube'] ?? ''),
        'sourceUrl'    => (string)($m['strSource'] ?? ''),
        'siteUrl'      => 'https://www.themealdb.com/meal/' . rawurlencode($numeric),
    ];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    cachePut($cacheKey, $json);
    echo $json;
    exit;
}

/* -------------------------------- search ------------------------------ */

if ($action === 'search') {
    $q = trim(strip_tags((string)($_GET['q'] ?? $_POST['q'] ?? '')));
    if ($q === '') respond(400, ['error' => 'Falta q (nombre de la receta)']);
    if (mb_strlen($q) > 60) $q = mb_substr($q, 0, 60);

    $cacheKey = 'search-' . md5(mb_strtolower($q));
    $cached = cacheGet($cacheKey, (int)$cfg['cache_ttl']);
    if ($cached !== null) { echo $cached; exit; }

    [$b, $c, $e] = curlOne(TMDB_BASE . 'search.php?s=' . rawurlencode($q), (int)$cfg['timeout'], $cfg['user_agent']);
    if ($e !== '') respond(502, ['error' => 'cURL TheMealDB', 'detail' => $e]);
    $j = json_decode($b, true);
    $meals = (is_array($j) && isset($j['meals']) && is_array($j['meals'])) ? $j['meals'] : [];
    $recipes = [];
    foreach (array_slice($meals, 0, MAX_RESULTS) as $m) $recipes[] = cardFromMeal($m, null);

    $payload = ['ok' => true, 'source' => 'themealdb', 'mode' => 'name', 'query' => [$q], 'count' => count($recipes), 'recipes' => $recipes, 'warnings' => []];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    cachePut($cacheKey, $json);
    echo $json;
    exit;
}

/* --------------------------------- list ------------------------------- */

if ($action === 'list') {
    $what = strtolower(trim((string)($_GET['what'] ?? $_POST['what'] ?? 'ingredients')));
    if (!in_array($what, ['ingredients', 'areas', 'categories'], true)) respond(400, ['error' => 'what inválido', 'hint' => 'Usa what=ingredients|areas|categories']);

    $cacheKey = 'list-' . $what;
    $cached = cacheGet($cacheKey, (int)$cfg['list_ttl']);
    if ($cached !== null) { echo $cached; exit; }

    $letter = $what === 'ingredients' ? 'i' : ($what === 'areas' ? 'a' : 'c');
    [$b, $c, $e] = curlOne(TMDB_BASE . 'list.php?' . $letter . '=list', (int)$cfg['timeout'], $cfg['user_agent']);
    if ($e !== '') respond(502, ['error' => 'cURL TheMealDB', 'detail' => $e]);
    $j = json_decode($b, true);
    $meals = (is_array($j) && isset($j['meals']) && is_array($j['meals'])) ? $j['meals'] : [];

    $items = [];
    foreach ($meals as $row) {
        if ($what === 'ingredients') {
            $n = trim((string)($row['strIngredient'] ?? ''));
            if ($n === '') continue;
            $items[] = ['id' => (int)($row['idIngredient'] ?? 0), 'name' => $n, 'type' => (string)($row['strType'] ?? '')];
        } elseif ($what === 'areas') {
            $n = trim((string)($row['strArea'] ?? ''));
            if ($n !== '') $items[] = ['name' => $n, 'country' => (string)($row['strCountry'] ?? '')];
        } else {
            $n = trim((string)($row['strCategory'] ?? ''));
            if ($n !== '') $items[] = ['name' => $n];
        }
    }
    $json = json_encode(['ok' => true, 'what' => $what, 'count' => count($items), 'items' => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    cachePut($cacheKey, $json);
    echo $json;
    exit;
}

/* ------------------------------ translate ----------------------------- */

function chunkText(string $text, int $max = 450): array {
    $text = trim($text);
    if ($text === '') return [];
    if (mb_strlen($text) <= $max) return [$text];
    $sentences = preg_split('/(?<=[.!?;:])\s+|\n+/', $text) ?: [$text];
    $chunks = [];
    $buf = '';
    foreach ($sentences as $s) {
        $s = trim($s);
        if ($s === '') continue;
        while (mb_strlen($s) > $max) {
            if ($buf !== '') { $chunks[] = $buf; $buf = ''; }
            $chunks[] = mb_substr($s, 0, $max);
            $s = mb_substr($s, $max);
        }
        if ($buf === '') $buf = $s;
        elseif (mb_strlen($buf) + 1 + mb_strlen($s) <= $max) $buf .= ' ' . $s;
        else { $chunks[] = $buf; $buf = $s; }
    }
    if ($buf !== '') $chunks[] = $buf;
    return $chunks;
}

function engineMyMemory(string $text, array $cfg): ?string {
    $url = 'https://api.mymemory.translated.net/get?q=' . rawurlencode($text) . '&langpair=en|es';
    $mail = trim((string)$cfg['translate_email']);
    if ($mail !== '') $url .= '&de=' . rawurlencode($mail);
    [$b, $c, $e] = curlOne($url, 15, $cfg['user_agent']);
    if ($e !== '' || $c !== 200) return null;
    $j = json_decode($b, true);
    if (!is_array($j) || !empty($j['quotaFinished'])) return null;
    $tr = trim((string)($j['responseData']['translatedText'] ?? ''));
    if ($tr === '' || stripos($tr, 'MYMEMORY WARNING') !== false) return null;
    return $tr;
}

function engineGoogle(string $text, array $cfg): ?string {
    $url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=' . rawurlencode($text);
    [$b, $c, $e] = curlOne($url, 15, $cfg['user_agent']);
    if ($e !== '' || $c !== 200) return null;
    $j = json_decode($b, true);
    if (!is_array($j) || !isset($j[0]) || !is_array($j[0])) return null;
    $out = '';
    foreach ($j[0] as $seg) if (isset($seg[0]) && is_string($seg[0])) $out .= $seg[0];
    return trim($out) !== '' ? trim($out) : null;
}

if ($action === 'translate') {
    $input = $jsonInput;
    if (!$input) $input = is_array($_POST) && $_POST ? $_POST : [];
    $texts = $input['texts'] ?? $_POST['texts'] ?? $_GET['text'] ?? null;
    if (is_string($texts)) $texts = [$texts];
    if (!is_array($texts)) respond(400, ['error' => 'Falta texts (array de textos en inglés)']);
    $texts = array_slice(array_map('strval', $texts), 0, MAX_TEXTS);
    $texts = array_map(fn($t) => mb_substr($t, 0, 4000), $texts);

    $totalChars = array_sum(array_map('mb_strlen', $texts));
    if ($totalChars > MAX_TOTAL_CHARS) respond(400, ['error' => 'Texto demasiado largo', 'hint' => 'Máximo ' . MAX_TOTAL_CHARS . ' caracteres por llamada']);

    $ttl = (int)$cfg['translate_ttl'];
    $out = [];
    $engineUsed = [];
    $misses = [];   // fragmentos sin caché: se traducen después

    foreach ($texts as $t) {
        $chunks = chunkText($t);
        $translated = [];
        foreach ($chunks as $ci => $chunk) {
            $key = 'tr-' . md5('en|es|' . $chunk);
            $hit = cacheGet($key, $ttl);
            if ($hit !== null) {
                $decoded = json_decode($hit, true);
                $translated[] = is_array($decoded) && isset($decoded['t']) ? (string)$decoded['t'] : $chunk;
                $engineUsed[] = 'cache';
                continue;
            }
            $translated[] = null;
            $misses[] = ['textIndex' => count($out), 'chunkIndex' => $ci, 'chunk' => $chunk];
        }
        $out[] = $translated;
    }

    foreach ($misses as $m) {
        $chunk = $m['chunk'];
        $tr = engineMyMemory($chunk, $cfg);
        $engine = 'mymemory';
        if ($tr === null) { $tr = engineGoogle($chunk, $cfg); $engine = 'google'; }
        if ($tr !== null) {
            $key = 'tr-' . md5('en|es|' . $chunk);
            cachePut($key, json_encode(['t' => $tr], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $engineUsed[] = $engine;
            $out[$m['textIndex']][$m['chunkIndex']] = $tr;
        } else {
            $engineUsed[] = 'none';
        }
    }

    $result = [];
    $partial = false;
    foreach ($out as $chunks) {
        $joined = [];
        foreach ($chunks as $c) { if ($c === null) $partial = true; $joined[] = $c ?? ''; }
        $result[] = trim(preg_replace('/\s+/', ' ', implode(' ', $joined)) ?? '');
    }

    respond(200, [
        'ok'       => true,
        'from'     => 'en',
        'to'       => 'es',
        'texts'    => $result,
        'engine'   => count($engineUsed) ? implode('+', array_unique($engineUsed)) : 'none',
        'partial'  => $partial,
    ]);
}

respond(400, ['error' => 'Acción no válida', 'hint' => 'Usa ?action=health | ?action=recipes&ing[]=chicken&ing[]=garlic | ?action=meal&id=52772 | ?action=search&q=pasta | ?action=list&what=ingredients | POST action=translate']);
