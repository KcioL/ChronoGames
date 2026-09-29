/* ===================== Configuration ===================== */
const NETLIFY_URL = "https://sorties-jeux.netlify.app/";

// Sur Netlify, on appelle la fonction directement ; ailleurs (GitHub Pages…), on passe par NETLIFY_URL.
const ENDPOINT = location.hostname.endsWith("netlify.app") || location.hostname === "localhost"
  ? "/.netlify/functions/getGames"
  : `${NETLIFY_URL.replace(/\/$/, "")}/.netlify/functions/getGames`;
const PAGE_SIZE = 40;
const IMG = (id, size) => `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;
const LIST_FIELDS = "fields name,slug,first_release_date,cover.image_id,platforms.name,platforms.abbreviation,genres.name,total_rating,hypes;";
const DETAIL_FIELDS = "fields name,slug,url,first_release_date,summary,storyline,cover.image_id,artworks.image_id,screenshots.image_id,"
  + "platforms.name,platforms.abbreviation,genres.name,themes.name,total_rating,aggregated_rating,hypes,"
  + "involved_companies.developer,involved_companies.publisher,involved_companies.company.name,websites.url,videos.video_id;";
const PLATFORM_SHORT = {
  "PC": "PC", "Win": "PC", "PS5": "PS5", "PS4": "PS4", "Series X|S": "Xbox Series", "Series X": "Xbox Series",
  "XONE": "Xbox One", "Switch": "Switch", "NSW": "Switch", "Switch 2": "Switch 2", "Mac": "Mac", "Linux": "Linux",
  "iOS": "iOS", "Android": "Android", "Stadia": "Stadia"
};
const STORES = [
  [/store\.steampowered\.com/, "Steam"],
  [/store\.playstation\.com/, "PlayStation Store"],
  [/xbox\.com|microsoft\.com\/.*store/, "Xbox Store"],
  [/nintendo\.(com|co\.|fr|de)/, "Nintendo eShop"],
  [/epicgames\.com/, "Epic Games"],
  [/gog\.com/, "GOG"],
  [/itch\.io/, "itch.io"],
  [/apps\.apple\.com/, "App Store"],
  [/play\.google\.com/, "Google Play"]
];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/* ===================== État ===================== */
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const state = {
  mode: "upcoming",
  year: today.getFullYear(),
  quarter: "all",
  platform: "",
  genre: "",
  theme: "",
  sort: "popular",
  query: "",
  hideNoCover: true,
  page: 1,
  hasNext: false,
  games: []
};
let requestId = 0;
let dialogGame = null;

/* ===================== Ma liste (stockée dans le navigateur) ===================== */
function readStore(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeStore(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
let wishlist = readStore("chronogames-wishlist") || {};
function saveWishlist() { writeStore("chronogames-wishlist", wishlist); updateWishCount(); }
function updateWishCount() { document.getElementById("wish-count").textContent = Object.keys(wishlist).length; }

/* ===================== Utilitaires ===================== */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
// IGDB donne des timestamps UTC : on garde le jour tel quel, sans décalage horaire.
function tsToIso(ts) { if (!ts) return null; const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function parseDate(s) { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function utcTs(y, m, d, end = false) { return Math.floor(Date.UTC(y, m, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0) / 1000); }
function daysUntil(d) { return Math.round((d - today) / 86400000); }
function countdownText(d) {
  const n = daysUntil(d);
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return "Demain";
  if (n > 1) return `Dans ${n} j`;
  return null;
}
function initials(name) { return name.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase(); }
function shortPlatforms(names) {
  const s = [...new Set(names.map(n => PLATFORM_SHORT[n] || n))];
  return s.slice(0, 5).join(", ") + (s.length > 5 ? "…" : "");
}

// Transforme un jeu IGDB en objet simple utilisé partout dans le site
function normalize(g) {
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    released: tsToIso(g.first_release_date),
    cover: g.cover?.image_id || null,
    platforms: (g.platforms || []).map(p => p.abbreviation || p.name),
    genres: (g.genres || []).map(x => x.name),
    rating: g.total_rating ? Math.round(g.total_rating) : null
  };
}

/* ===================== Appels à IGDB (via Netlify) ===================== */
async function igdb(query, endpoint = "games") {
  let res;
  try {
    res = await fetch(`${ENDPOINT}?endpoint=${endpoint}`, { method: "POST", body: query });
  } catch {
    throw new Error(NETLIFY_URL.includes("TON-SITE")
      ? "Il manque l'adresse de ton site Netlify : remplace « https://TON-SITE.netlify.app » en haut du script dans index.html."
      : "Le site n'arrive pas à joindre la fonction Netlify. Vérifie l'adresse NETLIFY_URL dans index.html, que le site Netlify est bien redéployé, et ta connexion internet.");
  }
  if (res.status === 404) throw new Error("La fonction Netlify est introuvable. Vérifie l'adresse NETLIFY_URL en haut du script dans index.html, et que ton site Netlify est bien déployé.");
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

function dateRange() {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  if (state.mode === "upcoming") return [utcTs(y, m, d), utcTs(y, m + 6, d, true)];
  if (state.mode === "anticipated") return [utcTs(y, m, d), utcTs(y + 2, 11, 31, true)];
  const yr = state.year;
  if (state.quarter === "all") return [utcTs(yr, 0, 1), utcTs(yr, 11, 31, true)];
  const q = Number(state.quarter);
  return [utcTs(yr, (q - 1) * 3, 1), utcTs(yr, q * 3, 0, true)];
}

function buildQuery() {
  const where = ["version_parent = null"];
  if (state.platform) where.push(`platforms = (${state.platform})`);
  if (state.genre) where.push(`genres = (${state.genre})`);
  if (state.theme) where.push(`themes = (${state.theme})`);
  if (state.hideNoCover) where.push("cover != null");

  const offset = (state.page - 1) * PAGE_SIZE;

  if (state.mode === "search") {
    const q = state.query.replace(/["\\]/g, "");
    return `search "${q}"; ${LIST_FIELDS} where ${where.join(" & ")}; limit ${PAGE_SIZE}; offset ${offset};`;
  }

  const [start, end] = dateRange();
  where.push(`first_release_date >= ${start}`, `first_release_date <= ${end}`);

  let sort;
  const sortKey = state.mode === "anticipated" ? "popular" : state.sort;
  switch (sortKey) {
    case "popular": {
      // Période passée : jeux les plus notés par les joueurs. Sinon : jeux les plus suivis (« hypes »).
      const past = end * 1000 < Date.now();
      const field = past ? "total_rating_count" : "hypes";
      where.push(`${field} != null`);
      sort = `${field} desc`;
      break;
    }
    case "date_desc": sort = "first_release_date desc"; break;
    case "rating": where.push("total_rating != null"); sort = "total_rating desc"; break;
    default: sort = "first_release_date asc";
  }
  return `${LIST_FIELDS} where ${where.join(" & ")}; sort ${sort}; limit ${PAGE_SIZE}; offset ${offset};`;
}

async function load(append = false) {
  if (state.mode === "wishlist") return renderWishlist();
  const myId = ++requestId;

  if (!append) {
    state.page = 1;
    state.games = [];
    results.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(10)}</div>`;
    moreBtn.hidden = true;
    setStatus("Chargement…");
  } else {
    moreBtn.disabled = true;
    moreBtn.textContent = "Chargement…";
  }

  try {
    const data = await igdb(buildQuery());
    if (myId !== requestId) return; // une requête plus récente a été lancée entre-temps
    const known = new Set(state.games.map(g => g.id));
    state.games.push(...data.map(normalize).filter(g => !known.has(g.id)));
    state.hasNext = data.length === PAGE_SIZE;
    render();
  } catch (err) {
    if (myId === requestId) renderError(err);
  } finally {
    moreBtn.disabled = false;
    moreBtn.textContent = "Afficher plus de jeux";
  }
}

/* ===================== Rendu ===================== */
const results = document.getElementById("results");
const moreBtn = document.getElementById("more-btn");
function setStatus(t) { document.getElementById("status").textContent = t; }

function shouldGroup() {
  if (state.mode === "search") return false;
  if (state.mode === "wishlist" || state.mode === "anticipated") return true;
  return state.sort !== "rating";
}

function render() {
  const list = state.games;
  moreBtn.hidden = !state.hasNext;

  if (!list.length) {
    setStatus("");
    results.innerHTML = `<div class="empty"><h2>Aucun jeu ne correspond</h2><p>Essaie d'enlever un filtre (plateforme, genre ou univers), de décocher « Masquer les jeux sans jaquette » ou de changer de période.</p></div>`;
    return;
  }

  const labels = {
    upcoming: "Sorties des 6 prochains mois",
    anticipated: "Les jeux à venir que le plus de joueurs suivent",
    period: `Sorties ${state.quarter === "all" ? "de l'année" : `du trimestre ${state.quarter}`} ${state.year}`,
    search: `Résultats pour « ${state.query} »`
  };
  setStatus(`${labels[state.mode]} · ${list.length} jeux affichés`);
  results.innerHTML = shouldGroup() ? groupedHTML(list) : `<div class="grid">${list.map(cardHTML).join("")}</div>`;
}

function groupedHTML(list) {
  const desc = state.mode === "period" || state.mode === "upcoming" ? state.sort === "date_desc" : false;
  const sorted = [...list].sort((a, b) => {
    const da = a.released || "9999", db = b.released || "9999";
    return desc ? db.localeCompare(da) : da.localeCompare(db);
  });
  const groups = new Map();
  for (const g of sorted) {
    const d = parseDate(g.released);
    const key = d ? d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "Date à confirmer";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  return [...groups].map(([month, games]) => `
    <section class="month">
      <div class="month-head"><h2>${esc(month)}</h2><span>${games.length} jeu${games.length > 1 ? "x" : ""}</span></div>
      <div class="grid">${games.map(cardHTML).join("")}</div>
    </section>`).join("");
}

function cardHTML(g) {
  const d = parseDate(g.released);
  const img = g.cover
    ? `<img src="${IMG(g.cover, "t_cover_big")}" alt="" loading="lazy">`
    : `<div class="placeholder" aria-hidden="true">${esc(initials(g.name))}</div>`;
  const tab = d
    ? `<div class="datetab"><b>${d.getDate()}</b><small>${MONTHS_SHORT[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? " " + String(d.getFullYear()).slice(2) : ""}</small></div>`
    : `<div class="datetab unknown"><b>?</b><small>date</small></div>`;
  const cd = d ? countdownText(d) : null;
  const score = g.rating ? `<span class="score" title="Note moyenne sur 100">${g.rating}</span>` : "";
  const wished = Boolean(wishlist[g.id]);
  return `
    <article class="card">
      <button class="open" data-open="${g.id}" aria-label="Voir la fiche de ${esc(g.name)}">
        ${img}${tab}
        ${cd ? `<span class="countdown ${daysUntil(d) === 0 ? "today" : ""}">${cd}</span>` : ""}
        ${score}
      </button>
      <div class="card-body">
        <div class="card-text">
          <h3>${esc(g.name)}</h3>
          <p class="plats">${esc(shortPlatforms(g.platforms)) || "Plateformes à venir"}</p>
        </div>
        <button class="star" data-star="${g.id}" aria-pressed="${wished}" aria-label="${wished ? "Retirer de ma liste" : "Ajouter à ma liste"}" title="${wished ? "Retirer de ma liste" : "Ajouter à ma liste"}">${wished ? "★" : "☆"}</button>
      </div>
    </article>`;
}

function renderWishlist() {
  moreBtn.hidden = true;
  const list = Object.values(wishlist);
  if (!list.length) {
    setStatus("");
    results.innerHTML = `<div class="empty"><h2>Ta liste est vide</h2><p>Clique sur l'étoile ☆ d'un jeu pour le garder ici. Ta liste reste enregistrée dans ce navigateur.</p></div>`;
    return;
  }
  const upcoming = list.filter(g => { const d = parseDate(g.released); return !d || d >= today; }).length;
  setStatus(`${list.length} jeu${list.length > 1 ? "x" : ""} dans ta liste · ${upcoming} pas encore sorti${upcoming > 1 ? "s" : ""}`);
  results.innerHTML = groupedHTML(list);
}

function renderError(err) {
  setStatus("");
  moreBtn.hidden = true;
  results.innerHTML = `<div class="error"><h2>Impossible de charger les jeux</h2>
    <p>${esc(err.message)}</p>
    <button class="btn" id="retry">Réessayer</button></div>`;
  document.getElementById("retry").onclick = () => load();
}

/* ===================== Fiche détaillée ===================== */
const dialog = document.getElementById("detail");

async function openDetail(id) {
  const base = state.games.find(g => g.id == id) || wishlist[id];
  if (!base) return;
  dialogGame = base;
  dialog.innerHTML = detailHTML(base, null);
  dialog.showModal();
  try {
    const [info] = await igdb(`${DETAIL_FIELDS} where id = ${Number(id)};`);
    if (!dialog.open || !info) return;
    dialogGame = { ...base, ...normalize(info) };
    dialog.innerHTML = detailHTML(dialogGame, info);
  } catch (err) {
    const p = dialog.querySelector(".d-desc");
    if (p) p.textContent = "Impossible de charger la fiche complète : " + err.message;
  }
}

function detailHTML(g, info) {
  const d = parseDate(g.released);
  const dateStr = d ? d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Date de sortie à confirmer";
  const cd = d ? countdownText(d) : null;
  const wished = Boolean(wishlist[g.id]);

  const heroId = info?.artworks?.[0]?.image_id || info?.screenshots?.[0]?.image_id;
  const companies = info?.involved_companies || [];
  const devs = companies.filter(c => c.developer).map(c => c.company?.name).filter(Boolean).join(", ");
  const pubs = companies.filter(c => c.publisher).map(c => c.company?.name).filter(Boolean).join(", ");
  const themes = (info?.themes || []).map(t => t.name).join(", ");

  const seen = new Set();
  const storeLinks = (info?.websites || []).map(w => {
    const match = STORES.find(([re]) => re.test(w.url || ""));
    if (!match || seen.has(match[1])) return "";
    seen.add(match[1]);
    return `<a href="${esc(w.url)}" target="_blank" rel="noopener">${match[1]}</a>`;
  }).join("");

  const video = info?.videos?.[0]?.video_id;
  const text = info ? (info.summary || info.storyline || "") : null;

  return `
    <div class="d-hero">
      ${heroId ? `<img src="${IMG(heroId, "t_1080p")}" alt="">` : ""}
      <button class="d-close" data-close aria-label="Fermer">✕</button>
    </div>
    <div class="d-main">
      <div class="d-cover">${g.cover ? `<img src="${IMG(g.cover, "t_cover_big")}" alt="Jaquette de ${esc(g.name)}">` : ""}</div>
      <div class="d-body">
        <h2 id="d-title">${esc(g.name)}</h2>
        <p class="d-date">${dateStr}${cd ? ` <span>· ${cd.toLowerCase()}</span>` : ""}</p>
        <div class="d-actions">
          <button class="btn" data-star="${g.id}" aria-pressed="${wished}">${wished ? "★ Dans ma liste" : "☆ Ajouter à ma liste"}</button>
          ${d && daysUntil(d) >= 0 ? `<button class="btn ghost" data-ics>Ajouter à mon agenda</button>` : ""}
          ${video ? `<a class="btn ghost" href="https://www.youtube.com/watch?v=${esc(video)}" target="_blank" rel="noopener">Voir la bande-annonce</a>` : ""}
        </div>
        <dl class="d-facts">
          <div><dt>Plateformes</dt><dd>${esc(shortPlatforms(g.platforms)) || "—"}</dd></div>
          <div><dt>Genres</dt><dd>${esc(g.genres.join(", ")) || "—"}</dd></div>
          ${info ? `
          <div><dt>Univers</dt><dd>${esc(themes) || "—"}</dd></div>
          <div><dt>Développeur</dt><dd>${esc(devs) || "—"}</dd></div>
          <div><dt>Éditeur</dt><dd>${esc(pubs) || "—"}</dd></div>` : ""}
          ${g.rating ? `<div><dt>Note moyenne</dt><dd>${g.rating} / 100</dd></div>` : ""}
          ${info?.hypes ? `<div><dt>Joueurs qui le suivent</dt><dd>${info.hypes.toLocaleString("fr-FR")}</dd></div>` : ""}
        </dl>
        ${storeLinks ? `<h3>Où l'acheter</h3><div class="stores">${storeLinks}</div>` : ""}
        <h3>Présentation</h3>
        <p class="d-desc clamped">${text === null ? "Chargement…" : (esc(text) || "Pas encore de description.")}</p>
        ${text && text.length > 450 ? `<button class="linkish" data-expand>Lire la suite</button>` : ""}
        ${info?.screenshots?.length ? `<h3>Captures d'écran</h3><div class="d-shots">${info.screenshots.slice(0, 8).map(s =>
          `<a href="${IMG(s.image_id, "t_1080p")}" target="_blank" rel="noopener"><img src="${IMG(s.image_id, "t_screenshot_med")}" alt="Capture d'écran de ${esc(g.name)}" loading="lazy"></a>`).join("")}</div>` : ""}
        ${info?.url ? `<p><a href="${esc(info.url)}" target="_blank" rel="noopener">Voir la fiche sur IGDB</a></p>` : ""}
      </div>
    </div>`;
}

function downloadIcs(g) {
  const d = parseDate(g.released);
  const next = new Date(d); next.setDate(next.getDate() + 1);
  const f = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ChronoGames//FR",
    "BEGIN:VEVENT",
    `UID:chronogames-${g.id}@chronogames`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;VALUE=DATE:${f(d)}`, `DTEND;VALUE=DATE:${f(next)}`,
    `SUMMARY:Sortie : ${g.name.replace(/[,;\\]/g, " ")}`,
    `URL:https://www.igdb.com/games/${g.slug}`,
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `${g.slug || g.id}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toggleWish(id) {
  if (wishlist[id]) {
    delete wishlist[id];
  } else {
    const g = state.games.find(x => x.id == id) || (dialogGame?.id == id ? dialogGame : null);
    if (!g) return;
    const { name, slug, released, cover, platforms, genres, rating } = g;
    wishlist[id] = { id: g.id, name, slug, released, cover, platforms, genres, rating };
  }
  saveWishlist();
  const on = Boolean(wishlist[id]);
  document.querySelectorAll(`[data-star="${id}"]`).forEach(btn => {
    btn.setAttribute("aria-pressed", on);
    if (btn.classList.contains("star")) {
      btn.textContent = on ? "★" : "☆";
      btn.title = on ? "Retirer de ma liste" : "Ajouter à ma liste";
      btn.setAttribute("aria-label", btn.title);
    } else {
      btn.textContent = on ? "★ Dans ma liste" : "☆ Ajouter à ma liste";
    }
  });
  if (state.mode === "wishlist" && !dialog.open) renderWishlist();
}

/* ===================== Événements ===================== */
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.mode === mode));
  document.getElementById("period-line").hidden = mode !== "period";
  document.getElementById("filters").hidden = mode === "wishlist";
  document.getElementById("sort-field").hidden = mode === "anticipated" || mode === "search";
  load();
}

document.querySelector(".tabs").addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (tab) setMode(tab.dataset.mode);
});

function chipGroup(id, attr, key) {
  document.getElementById(id).addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll(`#${id} .chip`).forEach(c => c.setAttribute("aria-pressed", c === chip));
    state[key] = chip.dataset[attr];
    load();
  });
}
chipGroup("quarter-chips", "quarter", "quarter");
chipGroup("platform-chips", "platform", "platform");

const yearSelect = document.getElementById("year-select");
for (let y = today.getFullYear() + 2; y >= today.getFullYear() - 6; y--) yearSelect.add(new Option(y, y, false, y === state.year));
yearSelect.onchange = e => { state.year = Number(e.target.value); load(); };
document.getElementById("genre-select").onchange = e => { state.genre = e.target.value; load(); };
document.getElementById("theme-select").onchange = e => { state.theme = e.target.value; load(); };
document.getElementById("sort-select").onchange = e => { state.sort = e.target.value; load(); };
document.getElementById("hide-nocover").onchange = e => { state.hideNoCover = e.target.checked; load(); };

document.getElementById("search-form").addEventListener("submit", e => {
  e.preventDefault();
  const q = document.getElementById("search-input").value.trim();
  if (!q) return;
  state.query = q;
  document.getElementById("search-tab").hidden = false;
  setMode("search");
});

moreBtn.onclick = () => { state.page++; load(true); };

document.addEventListener("click", e => {
  const open = e.target.closest("[data-open]");
  if (open) return openDetail(open.dataset.open);
  const star = e.target.closest("[data-star]");
  if (star) return toggleWish(star.dataset.star);
  if (e.target.closest("[data-close]")) return dialog.close();
  if (e.target.closest("[data-expand]")) {
    dialog.querySelector(".d-desc").classList.remove("clamped");
    e.target.remove();
    return;
  }
  if (e.target.closest("[data-ics]") && dialogGame) downloadIcs(dialogGame);
});
dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => { if (state.mode === "wishlist") renderWishlist(); });

/* Ajoute la puce Switch 2 si IGDB la connaît */
igdb('fields id,name; where name = "Nintendo Switch 2";', "platforms").then(list => {
  if (!list?.length) return;
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.platform = list[0].id;
  b.setAttribute("aria-pressed", "false");
  b.textContent = "Switch 2";
  document.getElementById("platform-chips").append(b);
}).catch(() => {});

updateWishCount();
load();
