// Sr. Regio TV: TV en vivo con las listas M3U de Sr. Regio.
// Busca sola la clave vigente (p. ej. 280926) en Notiregio, así no hay que cambiarla a mano.

const LISTAS = "http://srregio.net";
const NOTICIAS = "https://srregio.net/notiregio/";
const SEIS_HORAS = 6 * 60 * 60 * 1000;

async function pedirTexto(url) {
  const r = await kino.fetch(url, { headers: { Accept: "text/html" } });
  if (!r.ok) throw kino.error("unavailable", "Notiregio respondió " + r.status);
  return r.text();
}

// Saca la clave de una dirección como http://srregio.net/280926/tv.m3u
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
  // Más nueva primero; si tienen la misma fecha, gana la dirección más larga (termina en -2, -3...).
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

async function obtenerClave() {
  await null; // primero await, después validar
  const manual = String(kino.config.get("clave") || "").trim();
  if (/^[A-Za-z0-9]{3,20}$/.test(manual)) return manual;

  const guardada = kino.storage.get("clave-auto");
  if (guardada) return guardada;

  try {
    const nueva = await buscarClaveNueva();
    kino.storage.set("clave-auto", nueva, { ttlMs: SEIS_HORAS });
    kino.storage.set("clave-ultima", nueva);
    return nueva;
  } catch (e) {
    const ultima = kino.storage.get("clave-ultima");
    if (ultima) {
      kino.log("No pude buscar la clave nueva, uso la última conocida: " + ultima);
      return ultima;
    }
    throw e;
  }
}

// Kino descarga cada lista M3U, la agrupa en categorías y reproduce cada canal.
export async function liveCategories() {
  const clave = await obtenerClave();
  return [{
    playlist: {
      url: LISTAS + "/" + clave + "/tv.m3u",
      format: "m3u",
      refreshHours: 6,
    },
  }];
}

// Todos los canales vienen de las listas: no hay categorías propias que paginar.
export async function liveChannels() {
  await null;
  return { items: [] };
}

// Kino exige home o search; este plugin solo tiene canales en vivo.
export async function home() {
  await null;
  return [];
}

// Las listas se reproducen solas y no llaman a resolve.
export async function resolve() {
  await null;
  throw kino.error("not_found");
}
