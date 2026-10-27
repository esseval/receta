// dict.js — Diccionario ES ↔ EN de ingredientes + utilidades de normalización.
// TheMealDB está en inglés: aquí convertimos lo que escribe el usuario en español
// a la clave que se le envía a proxy.php, y devolvemos glosas en español para mostrar.

const PAIRS = [
  // carnes y pescados
  ['pollo', 'chicken'], ['pechuga de pollo', 'chicken breast'], ['muslo de pollo', 'chicken thigh'],
  ['pavo', 'turkey'], ['ternera', 'beef'], ['carne molida', 'ground beef'], ['carne de res', 'minced beef'],
  ['carne', 'meat'], ['cerdo', 'pork'], ['cordero', 'lamb'], ['conejo', 'rabbit'],
  ['tocino', 'bacon'], ['panceta', 'bacon'], ['jamón', 'ham'], ['salchicha', 'sausage'],
  ['chorizo', 'chorizo'], ['atún', 'tuna'], ['salmón', 'salmon'], ['bacalao', 'cod'],
  ['merluza', 'hake'], ['trucha', 'trout'], ['sardina', 'sardine'], ['pescado', 'fish'],
  ['camarón', 'shrimp'], ['gamba', 'prawn'], ['langostino', 'prawn'], ['cangrejo', 'crab'],
  ['mejillones', 'mussels'], ['calamar', 'squid'], ['pulpo', 'octopus'],
  // lácteos y huevos
  ['huevo', 'egg'], ['leche', 'milk'], ['queso', 'cheese'], ['mantequilla', 'butter'],
  ['yogur', 'yogurt'], ['crema', 'cream'], ['nata', 'double cream'], ['suero de leche', 'buttermilk'],
  ['queso crema', 'cream cheese'], ['parmesano', 'parmesan'], ['mozzarella', 'mozzarella'],
  // cereales y masas
  ['pan', 'bread'], ['harina', 'flour'], ['arroz', 'rice'], ['pasta', 'pasta'],
  ['espagueti', 'spaghetti'], ['fideos', 'noodles'], ['lazagna', 'lasagna'], ['lasaña', 'lasagna'],
  ['pan rallado', 'breadcrumbs'], ['avena', 'oats'], ['cereal', 'cereal'], ['maicena', 'cornstarch'],
  ['tortilla', 'tortilla'], ['pita', 'pita'], ['focaccia', 'focaccia'], ['croissant', 'croissant'],
  // verduras
  ['papa', 'potato'], ['patata', 'potato'], ['papas', 'potatoes'], ['zanahoria', 'carrot'],
  ['cebolla', 'onion'], ['cebollín', 'green onion'], ['cebolleta', 'spring onion'], ['ajo', 'garlic'],
  ['tomate', 'tomato'], ['pepino', 'cucumber'], ['lechuga', 'lettuce'], ['espinaca', 'spinach'],
  ['brócoli', 'broccoli'], ['coliflor', 'cauliflower'], ['calabacín', 'zucchini'], ['zapallito', 'zucchini'],
  ['berenjena', 'eggplant'], ['pimiento', 'bell pepper'], ['champiñón', 'mushroom'], ['hongo', 'mushroom'],
  ['maíz', 'corn'], ['elote', 'corn'], ['guisante', 'peas'], ['chícharo', 'peas'],
  ['poroto', 'beans'], ['frijol', 'beans'], ['judía verde', 'green beans'], ['apio', 'celery'],
  ['batata', 'sweet potato'], ['camote', 'sweet potato'], ['calabaza', 'pumpkin'], ['zapallo', 'pumpkin'],
  ['rábano', 'radish'], ['repollo', 'cabbage'], ['col', 'cabbage'], ['bruselas', 'brussels sprouts'],
  ['alcachofa', 'artichoke'], ['espárrago', 'asparagus'], ['acelga', 'chard'], ['nabo', 'turnip'],
  ['palta', 'avocado'], ['aguacate', 'avocado'], ['jícama', 'jicama'], ['repollo morado', 'red cabbage'],
  // frutas
  ['manzana', 'apple'], ['plátano', 'banana'], ['banana', 'banana'], ['naranja', 'orange'],
  ['limón', 'lemon'], ['lima', 'lime'], ['fresa', 'strawberry'], ['frutilla', 'strawberry'],
  ['frambuesa', 'raspberry'], ['arándano', 'blueberry'], ['mango', 'mango'], ['piña', 'pineapple'],
  ['ananá', 'pineapple'], ['sandía', 'watermelon'], ['melón', 'melon'], ['uva', 'grape'],
  ['pera', 'pear'], ['durazno', 'peach'], ['melocotón', 'peach'], ['cereza', 'cherry'],
  ['kiwi', 'kiwi'], ['coco', 'coconut'], ['granada', 'pomegranate'], ['papaya', 'papaya'],
  ['higo', 'fig'], ['dátil', 'dates'], ['ciruela', 'plum'],
  // especias y condimentos
  ['sal', 'salt'], ['pimienta', 'black pepper'], ['azúcar', 'sugar'], ['canela', 'cinnamon'],
  ['comino', 'cumin'], ['paprika', 'paprika'], ['pimentón', 'paprika'], ['orégano', 'oregano'],
  ['albahaca', 'basil'], ['perejil', 'parsley'], ['cilantro', 'coriander'], ['culantro', 'coriander'],
  ['tomillo', 'thyme'], ['romero', 'rosemary'], ['laurel', 'bay leaf'], ['nuez moscada', 'nutmeg'],
  ['clavo', 'cloves'], ['jengibre', 'ginger'], ['azafrán', 'saffron'], ['curry', 'curry powder'],
  ['chile', 'chili'], ['aji', 'chili'], ['ají', 'chili'], ['cayena', 'cayenne'], ['pimienta cayena', 'cayenne'],
  ['pimienta negra', 'black pepper'], ['pimienta blanca', 'white pepper'], ['azafrán en hebras', 'saffron'],
  ['anís', 'anise'], ['cardamomo', 'cardamom'], ['cúrcuma', 'turmeric'], ['pimienta de cinco especias', 'five spice'],
  ['salsa de soja', 'soy sauce'], ['salsa inglesa', 'worcestershire sauce'], ['salsa de ostras', 'oyster sauce'],
  ['vinagre', 'vinegar'], ['aceite', 'oil'], ['aceite de oliva', 'olive oil'], ['aceite vegetal', 'vegetable oil'],
  ['mantequilla clarificada', 'ghee'], ['miel', 'honey'], ['mostaza', 'mustard'], ['mayonesa', 'mayonnaise'],
  ['ketchup', 'ketchup'], ['salsa de tomate', 'tomato sauce'], ['puré de tomate', 'tomato puree'],
  ['caldo', 'stock'], ['caldo de pollo', 'chicken stock'], ['caldo de carne', 'beef stock'], ['caldo de verduras', 'vegetable stock'],
  ['vino', 'wine'], ['cerveza', 'beer'], ['agua', 'water'], ['pan de molde', 'white bread'],
  ['levadura', 'yeast'], ['polvo de hornear', 'baking powder'], ['bicarbonato', 'baking soda'],
  ['vainilla', 'vanilla extract'], ['chocolate', 'chocolate'], ['cacao', 'cocoa'], ['cacao en polvo', 'cocoa powder'],
  ['chocolate negro', 'dark chocolate'], ['chocolate chips', 'chocolate chips'], ['sésamo', 'sesame seeds'],
  ['nueces', 'walnuts'], ['almendras', 'almonds'], ['maní', 'peanuts'], ['cacahuate', 'peanuts'],
  ['avellanas', 'hazelnuts'], ['pistachos', 'pistachio'], ['pasas', 'raisins'], ['lentejas', 'lentils'],
  ['garbanzos', 'chickpeas'], ['quinoa', 'quinoa'], ['tofu', 'tofu'], ['hummus', 'hummus'],
  ['especias', 'spices'], ['hierbas', 'herbs'], ['hojas de laurel', 'bay leaves'], ['agua con gas', 'sparkling water'],
];

const BY_ES = Object.create(null);
const BY_EN = Object.create(null);

for (const [es, en] of PAIRS) {
  const kEs = normalizeText(es);
  const kEn = normalizeText(en);
  if (!BY_ES[kEs]) BY_ES[kEs] = en;
  if (!BY_EN[kEn]) BY_EN[kEn] = es;
}

function normalizeText(s) {
  let out = String(s || '').toLowerCase().trim();
  out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  out = out.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (out.length > 3 && out.endsWith('s')) out = out.slice(0, -1);
  return out;
}

/** Normaliza un término para compararlo (igual que normKey() en proxy.php). */
export function normalize(s) {
  return normalizeText(s);
}

/** ¿Dos términos se refieren al mismo ingrediente? (coincidencia por contención) */
export function termsMatch(a, b) {
  a = normalizeText(a); b = normalizeText(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Clave a enviar a la API: si el usuario escribió español, se traduce a inglés.
 * Devuelve { term (lo que se busca), label (lo que se muestra), alt (glosa) }.
 */
export function toQueryTerm(raw) {
  const label = String(raw || '').trim();
  const key = normalizeText(label);
  const en = BY_ES[key];
  if (en) return { term: en, label, alt: en.toLowerCase() === key ? '' : en };
  return { term: label, label, alt: '' };
}

/** Glosa en español de un ingrediente en inglés (null si no hay traducción). */
export function glossEn(name) {
  const key = normalizeText(name);
  if (!key) return null;
  if (BY_EN[key]) return BY_EN[key];
  for (const k in BY_EN) {
    if (k.length >= 4 && (key.includes(k) || k.includes(key))) return BY_EN[k];
  }
  return null;
}

/** Autocompletado: términos del diccionario que empiezan por lo que escribe el usuario. */
export function suggestFromDict(input, limit = 12) {
  const key = normalizeText(input);
  if (!key) return [];
  const out = [];
  for (const [es, en] of PAIRS) {
    if (normalizeText(es).startsWith(key) || normalizeText(en).startsWith(key)) {
      out.push({ es, en });
      if (out.length >= limit) break;
    }
  }
  return out;
}
