// Logo que se usa cuando un canal no trae el suyo.
const LOGO_RESPALDO = "https://raw.githubusercontent.com/cuentademo051092/kino-plugin-SrRegiotv/main/icon.png";

// Sr. Regio TV (v0.4.2): TV en vivo con la lista TV 1 de Sr. Regio.
// - Busca sola la clave vigente (p. ej. 280926) en Notiregio.
// - Se salta la publicidad del creador (PayPal, Facebook, Telegram...).
// - Reparte los canales por categorías según palabras del nombre; lo que no encaje va a "Otros".

const LISTAS = "http://srregio.net";
const NOTICIAS = "https://srregio.net/notiregio/";
const POR_PAGINA = 500;
const SEIS_HORAS = 6 * 60 * 60 * 1000;
const CINCO_MINUTOS = 5 * 60 * 1000;

// Categorías en el orden en que se revisan: la primera que encaja gana.
// Para agregar palabras, basta con sumarlas dentro del paréntesis separadas por "|".
const CATEGORIAS = [
  {
    id: "infantiles",
    titulo: "Infantiles",
    patron: /\b(baby ?(tv|first)|cartoon|cartoonito|disney|nick(elodeon| jr)?|boomerang|discovery kids|tooncast|toonami|pakapaka|paka paka|clan|zoo ?moo|kids|infantil|junior|peppa|bob esponja|spongebob|pocoyo|dibujos|animax|ben 10)\b/,
  },
  {
    id: "deportes",
    titulo: "Deportes",
    patron: /(deporte|sport|futbol|espn|\bdazn\b|\bnfl\b|\bnba\b|\bmlb\b|\bufc\b|\bwwe\b|\bf1\b|tudn|\bgol\b|win sports|\btyc\b|bein|\bliga\b|golf|racing|motor|boxeo|lucha|olimp)/,
  },
  {
    id: "noticias",
    titulo: "Noticias",
    patron: /(noticia|news|\bcnn\b|jazeera|\bbbc\b|france ?24|\bdw\b|euronews|milenio|foro ?tv|24 ?horas|24h|ntn24|\btn\b|\brt\b|\bnhk\b|cnbc|bloomberg|c5n|telesur|noticiero|informativ)/,
  },
  {
    id: "documentales",
    titulo: "Documentales",
    patron: /(discovery|animal planet|nat(ional)? ?geo|\bhistor|investigation|\bh2\b|\btlc\b|a&e|smithsonian|science|ciencia|docu|\btravel|viajes|food network|cocina|hgtv)/,
  },
  {
    id: "cine-series",
    titulo: "Cine y series",
    patron: /(cine|cinema|hbo|\bmax\b|\btnt\b|universal|warner|\baxn\b|sony|\bamc\b|\bfxx?\b|paramount|golden|lifetime|\bspace\b|\btcm\b|\bstar (channel|series|life|premium)\b|\btbs\b|comedy central|film|movie|pelicula|serie|novela|hallmark)/,
  },
  {
    id: "musica-radio",
    titulo: "Música y radio",
    patron: /(\bmtv\b|vh1|telehit|\bhtv\b|musi[ck]|radio|banda|ranchera|sonora|tropical|reggaeton|salsa|ritmoson|\bexa\b)/,
  },
];
const OTROS = { id: "otros", titulo: "Otros" };

// Orden en que se muestran las categorías en Kino (no tiene que ser el mismo en que se revisan).
const ORDEN = ["deportes", "noticias", "documentales", "cine-series", "musica-radio", "infantiles", "otros"];

// Canales sueltos que se toman de la lista TV 3 (nombre tal como aparece, sin importar mayúsculas ni tildes).
const EXTRAS_TV3 = ["CLARO SPORTS HD", "FOX SPORTS 2", "FOX SPORTS 3 H264"];

// Canales de TV 1 que no funcionan y se ocultan (los reemplazan los de TV 3).
const EXCLUIDOS_TV1 = ["FOX SPORTS 1", "PREUBA FOX SPORT 2"];

// Memoria de corta vida mientras el plugin sigue abierto (evita bajar la lista dos veces seguidas).
let memoria = null;
let memoriaHora = 0;

// ---------- Clave vigente ----------

async function pedirTexto(url) {
  const r = await kino.fetch(url, { headers: { Accept: "text/html" } });
  if (!r.ok) throw kino.error("unavailable", "Notiregio respondió " + r.status);
  return r.text();
}

function claveDelTexto(texto) {
  const m = /srregio\.net\/([A-Za-z0-9]+)\/tv\.m3u/i.exec(texto);
  return m ? m[1] : null;
}

// Mira las entradas de Notiregio sobre listas M3U, de la más nueva a la más vieja,
// y se queda con la primera que trae una clave.
async function buscarClaveNueva() {
  const portada = await pedirTexto(NOTICIAS);
  const entradas = [];
  const re = /href=["'](https:\/\/srregio\.net\/notiregio\/(\d{4})\/(\d{2})\/(\d{2})\/[^"']*listas-m3u[^"']*)["']/gi;
  let m;
  while ((m = re.exec(portada)) !== null) {
    entradas.push({ url: m[1], fecha: m[2] + m[3] + m[4] });
  }
  // Más nueva primero; con la misma fecha gana la dirección más larga (termina en -2, -3...).
  entradas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.url.length - a.url.length));
  const vistas = new Set();
  let intentos = 0;
  for (const e of entradas) {
    if (vistas.has(e.url)) continue;
    vistas.add(e.url);
    if (++intentos > 3) break;
    const clave = claveDelTexto(await pedirTexto(e.url));
    if (clave) return clave;
  }
  throw kino.error("unavailable", "no encontré la clave en Notiregio");
}

async function claveAutomatica() {
  const nueva = await buscarClaveNueva();
  kino.storage.set("clave-auto", nueva, { ttlMs: SEIS_HORAS });
  kino.storage.set("clave-ultima", nueva);
  return nueva;
}

async function obtenerClave() {
  await null; // primero await, después validar
  const manual = String(kino.config.get("clave") || "").trim();
  if (/^[A-Za-z0-9]{3,20}$/.test(manual)) return manual;

  const guardada = kino.storage.get("clave-auto");
  if (guardada) return guardada;

  try {
    return await claveAutomatica();
  } catch (e) {
    const ultima = kino.storage.get("clave-ultima");
    if (ultima) {
      kino.log("No pude buscar la clave nueva, uso la última conocida: " + ultima);
      return ultima;
    }
    throw e;
  }
}

// ---------- Lectura de la lista M3U ----------

// Minúsculas y sin tildes, para comparar nombres.
function plano(texto) {
  return texto
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n");
}

// Entradas que son publicidad del creador y no canales.
function esPublicidad(nombre, url) {
  if (/sr_regio/i.test(url)) return true;
  return /^::|^@|paypal\.me|t\.me\/|facebook\.com|https?:\/\//i.test(nombre);
}

function categoriaDe(nombre) {
  const n = plano(nombre);
  for (const c of CATEGORIAS) {
    if (c.patron.test(n)) return c.id;
  }
  return OTROS.id;
}

function crearId(nombre, usados) {
  let base = plano(nombre)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  if (!base) base = "canal";
  let id = base;
  let n = 1;
  while (usados.has(id)) {
    n += 1;
    id = base + "-" + n;
  }
  usados.add(id);
  return id;
}

// Nombre en minúsculas, sin tildes y con espacios simples, para comparar.
function nombrePlano(nombre) {
  return plano(nombre).replace(/\s+/g, " ").trim();
}

// Orden alfabético "natural": ignora mayúsculas y tildes, y pone ESPN 2 antes que ESPN 10.
function compararNombres(a, b) {
  const ta = nombrePlano(a.title).match(/\d+|\D+/g) || [];
  const tb = nombrePlano(b.title).match(/\d+|\D+/g) || [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const dif = Number(x) - Number(y);
      if (dif !== 0) return dif;
    } else {
      return x < y ? -1 : 1;
    }
  }
  return ta.length - tb.length;
}

// Si "permitidos" viene, solo se toman los canales cuyo nombre está en ese conjunto.
// Si "excluidos" viene, se saltan los canales cuyo nombre está en ese conjunto.
function leerLista(texto, usados, permitidos, excluidos) {
  const canales = [];
  let pendiente = null;
  for (const bruta of texto.split(/\r?\n/)) {
    const linea = bruta.trim();
    if (!linea) continue;
    if (linea.startsWith("#EXTINF")) {
      // Se quitan los textos entre comillas para que una coma dentro de un atributo no confunda el nombre.
      const sinAtributos = linea.replace(/"[^"]*"/g, '""');
      const coma = sinAtributos.indexOf(",");
      const nombre = coma >= 0 ? sinAtributos.slice(coma + 1).trim() : "";
      const logo = /tvg-logo="([^"]*)"/i.exec(linea);
      pendiente = { nombre, logo: logo ? logo[1] : "" };
      continue;
    }
    if (linea.startsWith("#")) continue;
    if (pendiente && /^https?:\/\//i.test(linea) && pendiente.nombre) {
      const np = nombrePlano(pendiente.nombre);
      const permitido = (!permitidos || permitidos.has(np)) && !(excluidos && excluidos.has(np));
      if (permitido && !esPublicidad(pendiente.nombre, linea)) {
        const canal = {
          id: crearId(pendiente.nombre, usados),
          title: pendiente.nombre.slice(0, 200),
          categoryId: categoriaDe(pendiente.nombre),
          stream: { url: linea },
        };
        canal.logo = /^https?:\/\//i.test(pendiente.logo) ? pendiente.logo : LOGO_RESPALDO;
        canales.push(canal);
      }
    }
    pendiente = null;
  }
  return canales;
}

async function descargarLista(clave) {
  return kino.fetch(LISTAS + "/" + clave + "/tv.m3u", { timeoutMs: 25000 });
}

// Suma a la lista los canales sueltos de TV 3. Si esa lista falla, TV 1 sigue funcionando igual.
async function sumarCanalesDeTv3(clave, canales, usados) {
  try {
    const r = await kino.fetch(LISTAS + "/" + clave + "/tv3.m3u", { timeoutMs: 25000 });
    if (!r.ok) {
      kino.log("La lista TV 3 respondió " + r.status);
      return;
    }
    const permitidos = new Set(EXTRAS_TV3.map(nombrePlano));
    const extras = leerLista(r.text(), usados, permitidos, null);
    if (extras.length < permitidos.size) {
      kino.log("De TV 3 encontré " + extras.length + " de " + permitidos.size + " canales");
    }
    for (const e of extras) {
      // Si ya existe un canal con el mismo nombre en TV 1, se distingue con "(TV 3)".
      const repetido = canales.some((c) => nombrePlano(c.title) === nombrePlano(e.title));
      if (repetido) e.title = (e.title + " (TV 3)").slice(0, 200);
      canales.push(e);
    }
  } catch (e) {
    kino.log("No pude leer la lista TV 3: " + e);
  }
}

async function cargarCanales() {
  await null;
  if (memoria && Date.now() - memoriaHora < CINCO_MINUTOS) return memoria;
  let clave = await obtenerClave();
  let r = await descargarLista(clave);
  // Si la clave guardada quedó vieja, se busca la nueva una vez más.
  if (!r.ok && !kino.config.get("clave")) {
    kino.storage.remove("clave-auto");
    clave = await claveAutomatica();
    r = await descargarLista(clave);
  }
  if (!r.ok) throw kino.error("unavailable", "la lista respondió " + r.status);
  const usados = new Set();
  const canales = leerLista(r.text(), usados, null, new Set(EXCLUIDOS_TV1.map(nombrePlano)));
  if (!canales.length) throw kino.error("unavailable", "la lista llegó vacía");
  await sumarCanalesDeTv3(clave, canales, usados);
  canales.sort(compararNombres);
  memoria = canales;
  memoriaHora = Date.now();
  return canales;
}

// ---------- Lo que Kino llama ----------

// Solo se muestran las categorías que tienen canales.
export async function liveCategories() {
  const canales = await cargarCanales();
  const con = new Set(canales.map((c) => c.categoryId));
  const todas = [...CATEGORIAS, OTROS].filter((c) => con.has(c.id));
  todas.sort((a, b) => ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id));
  return todas.map((c) => ({ id: c.id, title: c.titulo }));
}

export async function liveChannels(args) {
  await null;
  const categoryId = args && args.categoryId;
  const desde = Math.max(0, Number(args && args.cursor) || 0);
  const todos = await cargarCanales();
  const deLaCategoria = todos.filter((c) => c.categoryId === categoryId);
  const items = deLaCategoria.slice(desde, desde + POR_PAGINA);
  const resultado = { items };
  if (desde + POR_PAGINA < deLaCategoria.length) resultado.next = String(desde + POR_PAGINA);
  return resultado;
}

// Kino exige home o search; este plugin solo tiene canales en vivo.
export async function home() {
  await null;
  return [];
}

// Los canales traen su dirección directa y no llaman a resolve.
export async function resolve() {
  await null;
  throw kino.error("not_found");
}
