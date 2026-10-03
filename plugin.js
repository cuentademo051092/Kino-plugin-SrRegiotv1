const PLAYLIST_URL = "http://srregio.net/280926/tv.m3u";

function parseM3U(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXTINF")) continue;

    const comma = line.indexOf(",");
    const title = comma >= 0 ? line.slice(comma + 1).trim() : "Canal";
    const url = lines.slice(i + 1).find((value) => !value.startsWith("#"));
    if (!url) continue;

    const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
    const groupMatch = line.match(/group-title="([^"]+)"/i);

    items.push({
      title: title || "Canal",
      url,
      logo: logoMatch ? logoMatch[1] : undefined,
      group: groupMatch ? groupMatch[1] : "TV 1"
    });
  }

  return items;
}

export async function home() {
  return [];
}

export async function liveCategories() {
  return [{ id: "tv1", title: "TV 1" }];
}

export async function liveChannels({ categoryId }) {
  if (categoryId !== "tv1") return { items: [] };

  const response = await fetch(PLAYLIST_URL);
  if (!response.ok) throw kino.error("network");

  const text = await response.text();
  const channels = parseM3U(text);

  return {
    items: channels.map((channel, index) => ({
      id: `tv1-${index + 1}`,
      title: channel.title,
      number: index + 1,
      categoryId: "tv1",
      ...(channel.logo ? { icon: channel.logo } : {}),
      stream: {
        url: channel.url,
        mime: "application/vnd.apple.mpegurl"
      }
    }))
  };
}

export async function resolve() {
  await null;
  throw kino.error("not_found");
}
