// Sr. Regio TV (v0.2.0): TV en vivo con la lista TV 1 de Sr. Regio.
// - Busca sola la clave vigente (p. ej. 280926) en Notiregio.
// - Descarga la lista y se salta las entradas de publicidad del creador (PayPal, Facebook, Telegram...).

const LISTAS = "http://srregio.net";
const NOTICIAS = "https://srregio.net/notiregio/";
const CATEGORIA = "sr-regio-tv1";
const POR_PAGINA = 500;
const SEIS_HORAS = 6 * 60 * 60 * 1000;

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

// Entradas que son publicidad del creador y no canales.
function esPublicidad(nombre, url) {
  if (/sr_regio/i.test(url)) return true;
  return /^::|^@|paypal\.me|t\.me\/|facebook\.com|https?:\/\//i.test(nombre);
}

function crearId(nombre, usados) {
  let base = nombre
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
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

function leerLista(texto) {
  const canales = [];
  const usados = new Set();
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
      if (!esPublicidad(pendiente.nombre, linea)) {
        const canal = {
          id: crearId(pendiente.nombre, usados),
          title: pendiente.nombre.slice(0, 200),
          categoryId: CATEGORIA,
          stream: { url: linea },
        };
        if (/^https?:\/\//i.test(pendiente.logo)) canal.logo = pendiente.logo;
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

async function cargarCanales() {
  let clave = await obtenerClave();
  let r = await descargarLista(clave);
  // Si la clave guardada quedó vieja, se busca la nueva una vez más.
  if (!r.ok && !kino.config.get("clave")) {
    kino.storage.remove("clave-auto");
    clave = await claveAutomatica();
    r = await descargarLista(clave);
  }
  if (!r.ok) throw kino.error("unavailable", "la lista respondió " + r.status);
  const canales = leerLista(r.text());
  if (!canales.length) throw kino.error("unavailable", "la lista llegó vacía");
  return canales;
}

// ---------- Lo que Kino llama ----------

export async function liveCategories() {
  await null;
  return [{ id: CATEGORIA, title: "Sr. Regio TV" }];
}

export async function liveChannels(args) {
  await null;
  const categoryId = args && args.categoryId;
  if (categoryId !== CATEGORIA) return { items: [] };
  const desde = Math.max(0, Number(args && args.cursor) || 0);
  const todos = await cargarCanales();
  const items = todos.slice(desde, desde + POR_PAGINA);
  const resultado = { items };
  if (desde + POR_PAGINA < todos.length) resultado.next = String(desde + POR_PAGINA);
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
