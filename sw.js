import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, set, get, push, update, remove, onValue } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCh_fJv3mMlQQ2teHyryAxtd0x_mCmMzTU",
  authDomain: "commander-life-tracker-6938f.firebaseapp.com",
  databaseURL: "https://commander-life-tracker-6938f-default-rtdb.firebaseio.com",
  projectId: "commander-life-tracker-6938f",
  storageBucket: "commander-life-tracker-6938f.firebasestorage.app",
  messagingSenderId: "989326008841",
  appId: "1:989326008841:web:13b9a36110891cebcf0ed8"
};

const DECK_PROXY_WORKER = "https://commandsync-deck-proxy.skitheryx.workers.dev";

const SESSION_KEY = "mtg_active_pod_session";
const SAVED_NAME_KEY = "mtg_saved_player_name";
const THEME_PREF_KEY = "mtg_preferred_theme";
const ACTIVE_DECK_KEY = "mtg_active_deck_id";
const LOCAL_DECKS_KEY = "mtg_local_deck_locker";
const LOCAL_MATCHES_KEY = "mtg_local_match_history";
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const VALID_THEMES = ["blue", "red", "green", "gold", "purple", "slate"];

const EXTRA_COUNTER_META = {
  energy: { label: "⚡ Energy", icon: "⚡" },
  experience: { label: "🎓 Experience", icon: "🎓" },
  storm: { label: "🌪️ Storm", icon: "🌪️" },
  rad: { label: "☢️ Rad", icon: "☢️" }
};

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const topStatusLabel = document.getElementById("topStatusLabel");
const lobbyTopBar = document.getElementById("lobbyTopBar");
const lobbyView = document.getElementById("lobbyView");
const decksView = document.getElementById("decksView");
const statsView = document.getElementById("statsView");
const lobbyForm = document.getElementById("lobbyForm");
const podView = document.getElementById("podView");
const roomCodeInput = document.getElementById("roomCodeInput");
const playerNameInput = document.getElementById("playerNameInput");
const dropdownMenu = document.getElementById("podDropdownMenu");
const lobbyDropdownMenu = document.getElementById("lobbyDropdownMenu");
const howItWorksModal = document.getElementById("howItWorksModal");
const historyModal = document.getElementById("historyModal");
const diceModal = document.getElementById("diceModal");
const extraCountersModal = document.getElementById("extraCountersModal");
const newGameModal = document.getElementById("newGameModal");
const addDeckModal = document.getElementById("addDeckModal");
const deckViewerModal = document.getElementById("deckViewerModal");
const offlineBanner = document.getElementById("offlineBanner");

let currentUser = null;
let currentPodCode = null;
let latestPodData = null;
let inspectedOpponentUid = null;

let selectedLobbyStartingLife = 40;
let selectedNewGameLife = 40;

let myCurrentLife = 40;
let myPoison = 0;
let myTax = 0;
let myHasPartner = false;
let myEliminated = false;
let myTheme = localStorage.getItem(THEME_PREF_KEY) || "blue";
let myCommanderDamage = {};
let myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0 };
let myPinnedCounters = [];

let userDecks = {};
let userMatches = [];
let activeDeckId = localStorage.getItem(ACTIVE_DECK_KEY) || "";
let viewedDeckId = null;
let lastRecordedPodMatchKey = "";

let deltaAccumulator = 0;
let deltaClearTimer = null;
let wakeLock = null;

let pendingHistoryStartLife = null;
let pendingHistoryNote = "";
let historyFlushTimer = null;

const recentDiceRolls = [];

const savedPlayerName = localStorage.getItem(SAVED_NAME_KEY);
if (savedPlayerName) {
  playerNameInput.value = savedPlayerName;
}

function triggerHaptic(pattern) {
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

// =========================================================
// LOBBY HAMBURGER MENU & VIEW SWITCHING (LOBBY / DECKS / STATS)
// =========================================================
function switchMainScreen(targetId) {
  [lobbyView, decksView, statsView].forEach((view) => {
    if (view) view.classList.toggle("hidden", view.id !== targetId);
  });

  document.querySelectorAll(".nav-view-btn").forEach((btn) => {
    btn.classList.toggle("active-opt", btn.dataset.target === targetId);
  });

  lobbyDropdownMenu.classList.add("hidden");

  if (targetId === "decksView") renderDeckLocker();
  if (targetId === "statsView") renderStatsView();
}

document.getElementById("lobbyMenuBtn").onclick = (e) => {
  e.stopPropagation();
  lobbyDropdownMenu.classList.toggle("hidden");
};

document.addEventListener("click", (e) => {
  if (!lobbyDropdownMenu.classList.contains("hidden") && !lobbyDropdownMenu.contains(e.target)) {
    lobbyDropdownMenu.classList.add("hidden");
  }
});

document.querySelectorAll(".nav-view-btn").forEach((btn) => {
  btn.onclick = () => switchMainScreen(btn.dataset.target);
});

document.getElementById("quickOpenLockerBtn").onclick = () => switchMainScreen("decksView");
document.querySelectorAll(".back-to-lobby-btn").forEach((btn) => {
  btn.onclick = () => switchMainScreen("lobbyView");
});
document.getElementById("backFromStatsBtn").onclick = () => switchMainScreen("lobbyView");

document.getElementById("navHowItWorksBtn").onclick = () => {
  lobbyDropdownMenu.classList.add("hidden");
  howItWorksModal.classList.remove("hidden");
};

// =========================================================
// DECK LOCKER, SCRYFALL ART & FULL 100-CARD DECK VIEWER
// =========================================================
function loadLocalUserProfile() {
  try {
    userDecks = JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}");
    userMatches = JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) || "[]");
  } catch {
    userDecks = {};
    userMatches = [];
  }
  syncActiveDeckDropdown();
}

function saveLocalUserProfile() {
  localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(userDecks));
  localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(userMatches));
}

function syncActiveDeckDropdown() {
  const select = document.getElementById("activeDeckSelect");
  if (!select) return;

  select.innerHTML = `<option value="">No Deck Selected (Casual / Unranked)</option>`;
  Object.entries(userDecks).forEach(([id, deck]) => {
    const opt = document.createElement("option");
    opt.value = id;
    const wins = deck.wins || 0;
    const losses = deck.losses || 0;
    opt.textContent = `${deck.name} (${wins}W - ${losses}L)`;
    if (id === activeDeckId) opt.selected = true;
    select.appendChild(opt);
  });

  if (activeDeckId && !userDecks[activeDeckId]) {
    activeDeckId = "";
    localStorage.removeItem(ACTIVE_DECK_KEY);
  }
}

document.getElementById("activeDeckSelect").onchange = (e) => {
  activeDeckId = e.target.value;
  localStorage.setItem(ACTIVE_DECK_KEY, activeDeckId);
};

async function fetchScryfallCommanderData(commanderName) {
  if (!commanderName) return null;
  try {
    // Try exact/flavor/reskin name search first so Secret Lair names (e.g. "Miku, Font of Song") match directly
    const searchRes = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${commanderName}" include:extras`)}&unique:prints`
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.data && searchData.data.length > 0) {
        const card = searchData.data[0];
        const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
        return {
          exactName: card.flavor_name ? `${card.flavor_name} (${card.name})` : card.name,
          oracleName: card.name,
          artCrop: imgUris.art_crop || imgUris.normal || "",
          normalImg: imgUris.normal || "",
          colors: card.color_identity || []
        };
      }
    }

    // Fallback to fuzzy card name lookup
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(commanderName)}`);
    if (!res.ok) return null;
    const card = await res.json();
    const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
    return {
      exactName: card.name,
      oracleName: card.name,
      artCrop: imgUris.art_crop || imgUris.normal || "",
      normalImg: imgUris.normal || "",
      colors: card.color_identity || []
    };
  } catch {
    return null;
  }
}

async function fetchScryfallAllPrintings(cardName) {
  if (!cardName) return [];
  // Strip any "(Original Name)" suffix if a reskin label was saved
  const cleanName = cardName.replace(/\s*\([^)]+\)\s*$/, "").trim();
  try {
    // First look up the canonical oracle_id so we get ALL prints including Secret Lair reskins
    const lookupRes = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${cleanName}" include:extras`)}`
    );
    let oracleId = null;
    if (lookupRes.ok) {
      const lookupData = await lookupRes.json();
      oracleId = lookupData.data?.[0]?.oracle_id || null;
    }

    const query = oracleId ? `oracleid:${oracleId} include:extras` : `!"${cleanName}" include:extras`;
    const printsRes = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique:prints&order=released&dir=desc`
    );
    if (!printsRes.ok) return [];
    const printsData = await printsRes.json();

    return (printsData.data || []).map((card) => {
      const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
      const displayLabel = card.flavor_name
        ? `${card.flavor_name} (${card.set.toUpperCase()})`
        : `${card.set_name} (${card.set.toUpperCase()})`;
      return {
        id: card.id,
        label: displayLabel,
        flavorName: card.flavor_name || "",
        oracleName: card.name,
        artCrop: imgUris.art_crop || imgUris.normal || "",
        normalImg: imgUris.normal || ""
      };
    }).filter((item) => item.artCrop);
  } catch {
    return [];
  }
}

function parseDecklistText(rawText) {
  const lines = (rawText || "").split(/\r?\n/);
  const cards = [];
  let currentSection = "Mainboard";

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (/^(commander|creatures|instants|sorceries|artifacts|enchantments|planeswalkers|lands|sideboard|maybeboard):?$/i.test(trimmed)) {
      currentSection = trimmed.replace(":", "");
      return;
    }

    const match = trimmed.match(/^(\d+)x?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s*\d*.*)?$/i);
    if (match) {
      cards.push({
        qty: parseInt(match[1], 10),
        name: match[2].trim(),
        category: currentSection
      });
    } else if (trimmed.length > 1 && !trimmed.startsWith("//")) {
      cards.push({
        qty: 1,
        name: trimmed,
        category: currentSection
      });
    }
  });

  return cards;
}

async function fetchViaWorkerOrFallback(targetUrl) {
  const endpoints = [
    async () => {
      const res = await fetch(`${DECK_PROXY_WORKER}/?url=${encodeURIComponent(targetUrl)}`);
      if (!res.ok) throw new Error("Worker failed");
      return await res.json();
    },
    async () => {
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`);
      if (!res.ok) throw new Error("AllOrigins failed");
      const wrapped = await res.json();
      return JSON.parse(wrapped.contents);
    }
  ];

  for (const attempt of endpoints) {
    try {
      const data = await attempt();
      if (data && !data.error) return data;
    } catch {}
  }
  return null;
}

// Fetch Archidekt or Moxfield via Personal Cloudflare Worker
document.getElementById("fetchDeckUrlBtn").onclick = async () => {
  const urlVal = document.getElementById("deckUrlInput").value.trim();
  const statusEl = document.getElementById("deckFetchStatus");
  if (!urlVal) {
    statusEl.textContent = "Paste a Moxfield or Archidekt deck link first.";
    return;
  }

  const archidektMatch = urlVal.match(/archidekt\.com\/decks\/(\d+)/i);
  const moxfieldMatch = urlVal.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/i);

  if (archidektMatch) {
    const deckId = archidektMatch[1];
    const targetUrl = `https://archidekt.com/api/decks/${deckId}/`;
    statusEl.textContent = "⏳ Importing deck from Archidekt...";

    const data = await fetchViaWorkerOrFallback(targetUrl);

    if (data && Array.isArray(data.cards)) {
      if (data.name) document.getElementById("deckNameInput").value = data.name;

      const commanders = [];
      const textLines = [];

      data.cards.forEach((entry) => {
        const cardName = entry.card?.oracleCard?.name || entry.card?.name;
        const qty = entry.quantity || 1;
        const cats = entry.categories || [];
        if (!cardName) return;

        if (cats.some((c) => c.toLowerCase() === "commander")) {
          commanders.push(cardName);
        }
        textLines.push(`${qty} ${cardName}`);
      });

      if (commanders[0]) document.getElementById("deckCommanderInput").value = commanders[0];
      if (commanders[1]) document.getElementById("deckPartnerInput").value = commanders[1];
      document.getElementById("deckListTextarea").value = textLines.join("\n");
      statusEl.textContent = `✅ Imported "${data.name || "Deck"}" (${textLines.length} unique cards)!`;
    } else {
      statusEl.textContent = "⚠️ Could not auto-fetch (make sure the Archidekt deck is Public), or paste the exported text list below.";
    }
  } else if (moxfieldMatch) {
    const publicId = moxfieldMatch[1];
    const targetUrl = `https://api2.moxfield.com/v2/decks/all/${publicId}`;
    statusEl.textContent = "⏳ Importing deck from Moxfield...";

    const data = await fetchViaWorkerOrFallback(targetUrl);
    if (data && data.mainboard) {
      if (data.name) document.getElementById("deckNameInput").value = data.name;
      const cmdrNames = Object.keys(data.commanders || {});
      if (cmdrNames[0]) document.getElementById("deckCommanderInput").value = cmdrNames[0];
      if (cmdrNames[1]) document.getElementById("deckPartnerInput").value = cmdrNames[1];

      const textLines = [];
      cmdrNames.forEach((cName) => {
        const qty = data.commanders[cName]?.quantity || 1;
        textLines.push(`${qty} ${cName}`);
      });
      Object.entries(data.mainboard).forEach(([cName, info]) => {
        textLines.push(`${info.quantity || 1} ${cName}`);
      });

      document.getElementById("deckListTextarea").value = textLines.join("\n");
      statusEl.textContent = `✅ Imported "${data.name || "Moxfield Deck"}" (${textLines.length} unique cards)!`;
    } else {
      const slug = publicId.replace(/[-_]+/g, " ");
      if (!document.getElementById("deckNameInput").value) {
        document.getElementById("deckNameInput").value = slug;
      }
      statusEl.textContent = "🔗 Moxfield link attached! In Moxfield, tap Export → Copy for MTGO and paste below if blocked.";
    }
  } else {
    statusEl.textContent = "Link saved! Fill in your Deck Name, Commander, and optional 100-card list below.";
  }
};

document.getElementById("openAddDeckModalBtn").onclick = () => {
  document.getElementById("deckUrlInput").value = "";
  document.getElementById("deckNameInput").value = "";
  document.getElementById("deckCommanderInput").value = "";
  document.getElementById("deckPartnerInput").value = "";
  document.getElementById("deckListTextarea").value = "";
  document.getElementById("deckFetchStatus").textContent = "Paste a public Archidekt or Moxfield URL and tap Fetch to auto-import.";
  addDeckModal.classList.remove("hidden");
};
document.getElementById("closeAddDeckModalBtn").onclick = () => addDeckModal.classList.add("hidden");
addDeckModal.onclick = (e) => {
  if (e.target === addDeckModal) addDeckModal.classList.add("hidden");
};

document.getElementById("saveDeckBtn").onclick = async () => {
  const saveBtn = document.getElementById("saveDeckBtn");
  const deckName = document.getElementById("deckNameInput").value.trim() || "Untitled Commander";
  const commanderInput = document.getElementById("deckCommanderInput").value.trim();
  const partnerInput = document.getElementById("deckPartnerInput").value.trim();
  const deckUrl = document.getElementById("deckUrlInput").value.trim();
  const rawList = document.getElementById("deckListTextarea").value.trim();

  saveBtn.disabled = true;
  saveBtn.textContent = "⏳ Fetching Commander Art...";

  const scryfallData = await fetchScryfallCommanderData(commanderInput);
  const parsedCards = parseDecklistText(rawList);

  const deckId = `deck_${Date.now()}`;
  const newDeck = {
    id: deckId,
    name: deckName,
    commander: scryfallData?.exactName || commanderInput || "Unknown Commander",
    oracleCommander: scryfallData?.oracleName || commanderInput || "",
    partner: partnerInput,
    url: deckUrl,
    artCrop: scryfallData?.artCrop || "",
    normalImg: scryfallData?.normalImg || "",
    cards: parsedCards,
    wins: 0,
    losses: 0,
    createdAt: Date.now()
  };

  userDecks[deckId] = newDeck;
  if (!activeDeckId) {
    activeDeckId = deckId;
    localStorage.setItem(ACTIVE_DECK_KEY, deckId);
  }

  saveLocalUserProfile();
  if (currentUser) {
    await set(ref(db, `users/${currentUser.uid}/decks/${deckId}`), newDeck).catch(() => {});
  }

  saveBtn.disabled = false;
  saveBtn.textContent = "💾 Save to Deck Locker";
  addDeckModal.classList.add("hidden");
  syncActiveDeckDropdown();
  renderDeckLocker();
};

function renderDeckLocker() {
  const list = document.getElementById("deckLockerList");
  const deckEntries = Object.values(userDecks).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (deckEntries.length === 0) {
    list.innerHTML = `
      <div class="empty-card-box">
        <div style="font-size:1.8rem;margin-bottom:6px;">📚</div>
        <strong>No Decks Saved Yet</strong>
        <p>Tap <strong>+ Add Deck</strong> to link an Archidekt or Moxfield decklist or import by Commander name.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = "";
  deckEntries.forEach((deck) => {
    const isPiloting = deck.id === activeDeckId;
    const totalCards = (deck.cards || []).reduce((acc, c) => acc + (c.qty || 1), 0);
    const cardEl = document.createElement("div");
    cardEl.className = `deck-card-item ${isPiloting ? "is-piloting" : ""}`;

    const thumbHtml = deck.artCrop
      ? `<img src="${deck.artCrop}" alt="${deck.commander}" class="deck-thumb" />`
      : `<div class="deck-thumb-placeholder">⚔️</div>`;

    const cmdrLine = deck.partner ? `${deck.commander} + ${deck.partner}` : deck.commander;

    cardEl.innerHTML = `
      ${thumbHtml}
      <div class="deck-card-info">
        <div class="deck-card-title-row">
          <div class="deck-card-title">${deck.name}</div>
          ${isPiloting ? `<span class="piloting-badge">PILOTING</span>` : ""}
        </div>
        <div class="deck-card-cmdr">${cmdrLine}</div>
        <div class="deck-card-meta">
          <span>🏆 ${deck.wins || 0}W - ${deck.losses || 0}L</span>
          ${totalCards > 0 ? `<span>• ${totalCards} Cards</span>` : ""}
          ${deck.url ? `<span>• 🔗 Linked</span>` : ""}
        </div>
      </div>
    `;

    cardEl.onclick = () => openDeckViewerModal(deck.id);
    list.appendChild(cardEl);
  });
}

function openDeckViewerModal(deckId) {
  const deck = userDecks[deckId];
  if (!deck) return;
  viewedDeckId = deckId;

  document.getElementById("viewerDeckTitle").textContent = deck.name;
  document.getElementById("viewerCmdrName").textContent = deck.partner
    ? `${deck.commander} & ${deck.partner}`
    : deck.commander;

  const totalCards = (deck.cards || []).reduce((acc, c) => acc + (c.qty || 1), 0);
  document.getElementById("viewerCardCount").textContent = totalCards > 0
    ? `${totalCards} Cards • ${deck.wins || 0}W - ${deck.losses || 0}L`
    : `${deck.wins || 0}W - ${deck.losses || 0}L (No full list pasted)`;

  const imgEl = document.getElementById("viewerCmdrImg");
  if (deck.artCrop) {
    imgEl.src = deck.artCrop;
    imgEl.classList.remove("hidden");
  } else {
    imgEl.classList.add("hidden");
  }

  const extLink = document.getElementById("viewerExternalLink");
  if (deck.url) {
    extLink.href = deck.url;
    extLink.classList.remove("hidden");
  } else {
    extLink.classList.add("hidden");
  }

  const pilotBtn = document.getElementById("viewerSelectActiveBtn");
  pilotBtn.textContent = activeDeckId === deckId ? "✓ Active Deck" : "⚔️ Pilot Deck";
  pilotBtn.onclick = () => {
    activeDeckId = deckId;
    localStorage.setItem(ACTIVE_DECK_KEY, deckId);
    syncActiveDeckDropdown();
    renderDeckLocker();
    pilotBtn.textContent = "✓ Active Deck";
  };

  // Wire up Change Art / Reskin Printing Picker
  const artPickerDrawer = document.getElementById("artPickerDrawer");
  artPickerDrawer.classList.add("hidden");

  document.getElementById("viewerChangeArtBtn").onclick = async () => {
    const grid = document.getElementById("artPickerGrid");
    const title = document.getElementById("artPickerTitle");
    artPickerDrawer.classList.remove("hidden");
    document.getElementById("cardHoverPreview").classList.add("hidden");
    title.textContent = "Loading Printings & Secret Lairs...";
    grid.innerHTML = `<div class="empty-hint" style="grid-column:1 / span 3;">Searching Scryfall...</div>`;

    const queryName = deck.oracleCommander || deck.commander;
    const prints = await fetchScryfallAllPrintings(queryName);

    if (prints.length === 0) {
      title.textContent = "No Alternate Art Found";
      grid.innerHTML = `<div class="empty-hint" style="grid-column:1 / span 3;">Could not load alternate printings for ${queryName}.</div>`;
      return;
    }

    title.textContent = `Choose Art (${prints.length} Printings)`;
    grid.innerHTML = "";

    prints.forEach((print) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `art-option-card ${deck.artCrop === print.artCrop ? "selected" : ""}`;
      btn.innerHTML = `
        <img src="${print.artCrop}" alt="${print.label}" loading="lazy" />
        <div class="art-option-label">${print.label}</div>
      `;
      btn.onclick = async () => {
        triggerHaptic(15);
        deck.artCrop = print.artCrop;
        deck.normalImg = print.normalImg;
        if (print.flavorName) {
          deck.commander = `${print.flavorName} (${print.oracleName})`;
          deck.oracleCommander = print.oracleName;
        }
        saveLocalUserProfile();
        if (currentUser) {
          await update(ref(db, `users/${currentUser.uid}/decks/${deck.id}`), {
            artCrop: deck.artCrop,
            normalImg: deck.normalImg,
            commander: deck.commander,
            oracleCommander: deck.oracleCommander || print.oracleName
          }).catch(() => {});
        }
        renderDeckLocker();
        openDeckViewerModal(deck.id);
      };
      grid.appendChild(btn);
    });
  };

  document.getElementById("cardHoverPreview").classList.add("hidden");
  const listEl = document.getElementById("viewerDeckCardsList");
  listEl.innerHTML = "";

  if (!deck.cards || deck.cards.length === 0) {
    listEl.innerHTML = `<div class="empty-hint" style="padding:18px 8px;">No full card list imported for this deck yet.<br/>Tap <strong>↗ Site</strong> above to view it externally.</div>`;
  } else {
    const grouped = {};
    deck.cards.forEach((c) => {
      const cat = c.category || "Mainboard";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(c);
    });

    Object.entries(grouped).forEach(([cat, cardsArr]) => {
      const header = document.createElement("div");
      header.className = "deck-group-header";
      const catCount = cardsArr.reduce((s, c) => s + (c.qty || 1), 0);
      header.textContent = `${cat} (${catCount})`;
      listEl.appendChild(header);

      cardsArr.forEach((c) => {
        const line = document.createElement("div");
        line.className = "deck-card-line";
        line.innerHTML = `
          <span class="deck-card-qty">${c.qty}x</span>
          <span class="deck-card-name-btn">${c.name}</span>
          <span class="deck-card-eye">👁</span>
        `;
        line.onclick = async () => {
          artPickerDrawer.classList.add("hidden");
          const previewBox = document.getElementById("cardHoverPreview");
          const titleEl = document.getElementById("previewCardTitle");
          const previewImg = document.getElementById("previewCardImg");
          titleEl.textContent = `Loading ${c.name}...`;
          previewImg.src = "";
          previewBox.classList.remove("hidden");

          const cardInfo = await fetchScryfallCommanderData(c.name);
          if (cardInfo?.normalImg) {
            titleEl.textContent = cardInfo.exactName;
            previewImg.src = cardInfo.normalImg;
          } else {
            titleEl.textContent = `${c.name} (Art unavailable)`;
          }
        };
        listEl.appendChild(line);
      });
    });
  }

  deckViewerModal.classList.remove("hidden");
}

document.getElementById("closeArtPickerBtn").onclick = () => {
  document.getElementById("artPickerDrawer").classList.add("hidden");
};
document.getElementById("closeCardPreviewBtn").onclick = () => {
  document.getElementById("cardHoverPreview").classList.add("hidden");
};
document.getElementById("closeDeckViewerBtn").onclick = () => deckViewerModal.classList.add("hidden");
deckViewerModal.onclick = (e) => {
  if (e.target === deckViewerModal) deckViewerModal.classList.add("hidden");
};

document.getElementById("viewerLogWinBtn").onclick = () => {
  if (!viewedDeckId) return;
  recordDeckMatchOutcome(viewedDeckId, "win", "Manual Log");
  openDeckViewerModal(viewedDeckId);
};
document.getElementById("viewerLogLossBtn").onclick = () => {
  if (!viewedDeckId) return;
  recordDeckMatchOutcome(viewedDeckId, "loss", "Manual Log");
  openDeckViewerModal(viewedDeckId);
};
document.getElementById("viewerDeleteDeckBtn").onclick = async () => {
  if (!viewedDeckId || !userDecks[viewedDeckId]) return;
  if (!confirm(`Delete "${userDecks[viewedDeckId].name}" from your Deck Locker?`)) return;

  const delId = viewedDeckId;
  delete userDecks[delId];
  if (activeDeckId === delId) {
    activeDeckId = "";
    localStorage.removeItem(ACTIVE_DECK_KEY);
  }
  saveLocalUserProfile();
  if (currentUser) {
    await remove(ref(db, `users/${currentUser.uid}/decks/${delId}`)).catch(() => {});
  }
  deckViewerModal.classList.add("hidden");
  syncActiveDeckDropdown();
  renderDeckLocker();
};

// =========================================================
// WIN / LOSS RECORDING & STATS VIEW
// =========================================================
function recordDeckMatchOutcome(deckId, outcome, podLabel = "") {
  const deck = userDecks[deckId];
  if (!deck) return;

  if (outcome === "win") {
    deck.wins = (deck.wins || 0) + 1;
  } else {
    deck.losses = (deck.losses || 0) + 1;
  }

  const matchEntry = {
    deckId,
    deckName: deck.name,
    commander: deck.commander,
    outcome,
    podLabel,
    at: Date.now()
  };
  userMatches.unshift(matchEntry);
  if (userMatches.length > 50) userMatches.pop();

  saveLocalUserProfile();
  syncActiveDeckDropdown();
  renderDeckLocker();

  if (currentUser) {
    update(ref(db, `users/${currentUser.uid}/decks/${deckId}`), {
      wins: deck.wins,
      losses: deck.losses
    }).catch(() => {});
    push(ref(db, `users/${currentUser.uid}/matches`), matchEntry).catch(() => {});
  }
}

function renderStatsView() {
  let totalWins = 0;
  let totalLosses = 0;

  const breakdownEl = document.getElementById("deckStatsBreakdown");
  breakdownEl.innerHTML = "";

  const decksArr = Object.values(userDecks);
  if (decksArr.length === 0) {
    breakdownEl.innerHTML = `<div class="empty-hint">Add a deck in My Deck Locker to track per-deck win rates!</div>`;
  } else {
    decksArr.forEach((d) => {
      const w = d.wins || 0;
      const l = d.losses || 0;
      totalWins += w;
      totalLosses += l;
      const games = w + l;
      const rate = games > 0 ? Math.round((w / games) * 100) : 0;

      const row = document.createElement("div");
      row.className = "deck-stat-row";
      row.innerHTML = `
        <div class="history-main">
          <div class="history-player">${d.name}</div>
          <div class="history-sub">${d.commander}</div>
        </div>
        <div class="history-delta ${rate >= 25 ? "gain" : ""}" style="color:var(--gold-foil);">
          ${w}W - ${l}L (${rate}%)
        </div>
      `;
      breakdownEl.appendChild(row);
    });
  }

  const totalGames = totalWins + totalLosses;
  const overallRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;

  document.getElementById("statTotalGames").textContent = totalGames;
  document.getElementById("statTotalWins").textContent = totalWins;
  document.getElementById("statTotalLosses").textContent = totalLosses;
  document.getElementById("statWinRate").textContent = `${overallRate}%`;

  const matchList = document.getElementById("matchHistoryList");
  matchList.innerHTML = "";
  if (userMatches.length === 0) {
    matchList.innerHTML = `<div class="empty-hint">No completed matches logged yet.</div>`;
  } else {
    userMatches.slice(0, 20).forEach((m) => {
      const isWin = m.outcome === "win";
      const dateStr = m.at ? new Date(m.at).toLocaleDateString() : "";
      const row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML = `
        <div class="history-main">
          <div class="history-player">${m.deckName}</div>
          <div class="history-sub">${m.commander}${m.podLabel ? ` • ${m.podLabel}` : ""}${dateStr ? ` • ${dateStr}` : ""}</div>
        </div>
        <div class="history-delta ${isWin ? "gain" : "loss"}">
          ${isWin ? "WIN" : "LOSS"}
        </div>
      `;
      matchList.appendChild(row);
    });
  }
}

// --- LETHAL / ELIMINATED CHECK HELPER ---
function hasLethalStats(life, poison, cmdrDamageObj) {
  if (life <= 0) return true;
  if ((poison || 0) >= 10) return true;
  const vals = Object.values(cmdrDamageObj || {});
  if (vals.some((v) => v >= 21)) return true;
  return false;
}

// --- STARTING LIFE PRESET SELECTORS (Lobby & New Game Modal) ---
document.querySelectorAll("#lobbyLifeSelector .preset-btn").forEach((btn) => {
  btn.onclick = () => {
    selectedLobbyStartingLife = parseInt(btn.dataset.life, 10);
    document.querySelectorAll("#lobbyLifeSelector .preset-btn").forEach((b) => {
      b.classList.toggle("selected", b === btn);
    });
  };
});

document.querySelectorAll("#newGameLifeSelector .preset-btn").forEach((btn) => {
  btn.onclick = () => {
    selectedNewGameLife = parseInt(btn.dataset.life, 10);
    document.querySelectorAll("#newGameLifeSelector .preset-btn").forEach((b) => {
      b.classList.toggle("selected", b === btn);
    });
  };
});

// --- HOW IT WORKS MODAL ---
document.getElementById("openHowItWorksBtn").onclick = () => {
  howItWorksModal.classList.remove("hidden");
};
document.getElementById("closeHowItWorksBtn").onclick = () => {
  howItWorksModal.classList.add("hidden");
};
document.getElementById("gotItBtn").onclick = () => {
  howItWorksModal.classList.add("hidden");
};
howItWorksModal.onclick = (e) => {
  if (e.target === howItWorksModal) howItWorksModal.classList.add("hidden");
};

// --- EXTRA COUNTERS PICKER & RENDERER ---
function renderPinnedExtraCounters() {
  const grid = document.getElementById("extraCountersGrid");
  grid.innerHTML = "";

  Object.keys(EXTRA_COUNTER_META).forEach((key) => {
    const isPinned = myPinnedCounters.includes(key);
    const rowBtn = document.querySelector(`.toggle-counter-row[data-counter="${key}"]`);
    const badge = document.getElementById(`badge-${key}`);
    if (rowBtn) rowBtn.classList.toggle("pinned", isPinned);
    if (badge) badge.textContent = isPinned ? "ON" : "OFF";
  });

  if (myPinnedCounters.length === 0) {
    grid.classList.add("hidden");
    return;
  }

  grid.classList.remove("hidden");
  myPinnedCounters.forEach((key) => {
    const meta = EXTRA_COUNTER_META[key];
    if (!meta) return;
    const val = myExtraCounters[key] || 0;

    const pill = document.createElement("div");
    pill.className = "counter-pill";
    pill.innerHTML = `
      <div class="counter-title">${meta.label}</div>
      <div class="counter-controls">
        <button type="button" class="mini-btn extra-btn" data-key="${key}" data-delta="-1">−</button>
        <span class="counter-val">${val}</span>
        <button type="button" class="mini-btn extra-btn" data-key="${key}" data-delta="1">+</button>
      </div>
    `;
    grid.appendChild(pill);
  });

  grid.querySelectorAll(".extra-btn").forEach((btn) => {
    btn.onclick = () => {
      if (!currentPodCode || !currentUser) return;
      triggerHaptic(12);
      const key = btn.dataset.key;
      const delta = parseInt(btn.dataset.delta, 10);
      const nextVal = Math.max(0, (myExtraCounters[key] || 0) + delta);
      myExtraCounters[key] = nextVal;
      update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}/extraCounters`), {
        [key]: nextVal
      });
    };
  });
}

document.querySelectorAll(".toggle-counter-row").forEach((btn) => {
  btn.onclick = () => {
    const key = btn.dataset.counter;
    if (myPinnedCounters.includes(key)) {
      myPinnedCounters = myPinnedCounters.filter((k) => k !== key);
    } else {
      myPinnedCounters.push(key);
    }
    renderPinnedExtraCounters();
    if (currentPodCode && currentUser) {
      update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
        pinnedCounters: myPinnedCounters
      });
    }
  };
});

function openCountersModal() {
  dropdownMenu.classList.add("hidden");
  renderPinnedExtraCounters();
  extraCountersModal.classList.remove("hidden");
}

document.getElementById("openCountersBtn").onclick = openCountersModal;
document.getElementById("quickCountersBtn").onclick = openCountersModal;
document.getElementById("closeCountersModalBtn").onclick = () => extraCountersModal.classList.add("hidden");
document.getElementById("doneCountersBtn").onclick = () => extraCountersModal.classList.add("hidden");
extraCountersModal.onclick = (e) => {
  if (e.target === extraCountersModal) extraCountersModal.classList.add("hidden");
};

// --- PARTNER COMMANDER TOGGLE ---
document.getElementById("togglePartnerBtn").onclick = () => {
  dropdownMenu.classList.add("hidden");
  if (!currentPodCode || !currentUser) return;
  myHasPartner = !myHasPartner;
  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
    hasPartner: myHasPartner
  });
};

// --- SCOOP / KNOCKED OUT TOGGLE & REVIVE ---
async function setPlayerEliminatedState(targetUid, nextState) {
  if (!currentPodCode || !latestPodData) return;
  triggerHaptic(nextState ? [20, 40, 20] : 15);

  const updates = {
    [`players/${targetUid}/eliminated`]: nextState
  };

  if (nextState && latestPodData.monarchUid === targetUid) {
    updates.monarchUid = null;
  }

  await update(ref(db, `pods/${currentPodCode}`), updates);

  if (nextState && latestPodData.activeTurnUid === targetUid) {
    await advancePodTurn();
  }
}

document.getElementById("toggleEliminatedBtn").onclick = () => {
  dropdownMenu.classList.add("hidden");
  if (!currentUser) return;
  setPlayerEliminatedState(currentUser.uid, !myEliminated);
};

document.getElementById("reviveSelfBtn").onclick = (e) => {
  e.stopPropagation();
  if (!currentUser) return;
  const updates = { eliminated: false };
  if (myCurrentLife <= 0) {
    myCurrentLife = 1;
    updates.life = 1;
  }
  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), updates);
};

// --- LIFE HISTORY LOG MODAL ---
function renderHistoryModal() {
  const list = document.getElementById("historyList");
  const historyObj = latestPodData?.history || {};
  const entries = Object.values(historyObj).sort((a, b) => (b.at || 0) - (a.at || 0));

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-hint">No life changes recorded yet.</div>`;
    return;
  }

  list.innerHTML = "";
  entries.slice(0, 25).forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const isGain = item.delta >= 0;
    const timeStr = item.at
      ? new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
    const subText = `${item.fromLife} → ${item.toLife}${item.note ? ` • ${item.note}` : ""}${timeStr ? ` • ${timeStr}` : ""}`;

    row.innerHTML = `
      <div class="history-main">
        <div class="history-player">${item.playerName}</div>
        <div class="history-sub">${subText}</div>
      </div>
      <div class="history-delta ${isGain ? "gain" : "loss"}">
        ${isGain ? `+${item.delta}` : item.delta}
      </div>
    `;
    list.appendChild(row);
  });
}

document.getElementById("openHistoryBtn").onclick = () => {
  dropdownMenu.classList.add("hidden");
  renderHistoryModal();
  historyModal.classList.remove("hidden");
};
document.getElementById("closeHistoryBtn").onclick = () => {
  historyModal.classList.add("hidden");
};
historyModal.onclick = (e) => {
  if (e.target === historyModal) historyModal.classList.add("hidden");
};

// --- BUILT-IN DICE & COIN ROLLER MODAL ---
function rollDie(type) {
  triggerHaptic(15);
  const labelEl = document.getElementById("diceTypeLabel");
  const resultEl = document.getElementById("diceBigResult");
  let label = "";
  let result = "";

  if (type === "coin") {
    label = "Coin Flip";
    result = Math.random() < 0.5 ? "🪙 Heads" : "🪙 Tails";
  } else if (type === "planar") {
    label = "Planar Die (d6)";
    const roll = Math.floor(Math.random() * 6) + 1;
    if (roll === 1) result = "⬡ Planeswalk";
    else if (roll === 6) result = "⚡ Chaos";
    else result = "Blank";
  } else {
    const sides = parseInt(type, 10);
    label = `Rolling d${sides}`;
    result = `${Math.floor(Math.random() * sides) + 1}`;
  }

  labelEl.textContent = label;
  resultEl.textContent = result;

  resultEl.classList.remove("dice-pop");
  void resultEl.offsetWidth;
  resultEl.classList.add("dice-pop");

  const shortTag = type === "coin" ? result.replace("🪙 ", "") : type === "planar" ? result : `d${type}: ${result}`;
  recentDiceRolls.unshift(shortTag);
  if (recentDiceRolls.length > 5) recentDiceRolls.pop();
  document.getElementById("recentRollsBar").textContent = `Recent: ${recentDiceRolls.join("  •  ")}`;
}

document.querySelectorAll(".die-btn").forEach((btn) => {
  btn.onclick = () => rollDie(btn.dataset.die);
});

document.getElementById("openDiceRollerBtn").onclick = () => {
  dropdownMenu.classList.add("hidden");
  diceModal.classList.remove("hidden");
};
document.getElementById("closeDiceBtn").onclick = () => {
  diceModal.classList.add("hidden");
};
diceModal.onclick = (e) => {
  if (e.target === diceModal) diceModal.classList.add("hidden");
};

// --- HAMBURGER MENU TOGGLE & OUTSIDE CLICK CLOSE ---
document.getElementById("menuToggleBtn").onclick = (e) => {
  e.stopPropagation();
  dropdownMenu.classList.toggle("hidden");
};

document.addEventListener("click", (e) => {
  if (!dropdownMenu.classList.contains("hidden") && !dropdownMenu.contains(e.target)) {
    dropdownMenu.classList.add("hidden");
  }
});

// --- TILE THEME PICKER ---
function applyMyThemeUI(themeName) {
  const safeTheme = VALID_THEMES.includes(themeName) ? themeName : "blue";
  myTheme = safeTheme;
  localStorage.setItem(THEME_PREF_KEY, safeTheme);

  const hero = document.getElementById("heroTracker");
  VALID_THEMES.forEach((t) => hero.classList.remove(`theme-${t}`));
  hero.classList.add(`theme-${safeTheme}`);

  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.theme === safeTheme);
  });
}

document.querySelectorAll(".swatch-btn").forEach((btn) => {
  btn.onclick = () => {
    const chosen = btn.dataset.theme;
    applyMyThemeUI(chosen);
    if (currentPodCode && currentUser) {
      update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
        theme: chosen
      });
    }
  };
});

applyMyThemeUI(myTheme);

// --- SESSION STORAGE HELPERS ---
function saveSession(code, name) {
  localStorage.setItem(SAVED_NAME_KEY, name);
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    code,
    name,
    savedAt: Date.now()
  }));
}

function getValidSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() - session.savedAt > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// --- SCREEN WAKE LOCK ---
async function enableWakeLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Active";
      wakeLock.addEventListener("release", () => {
        document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Paused";
      });
    } catch (err) {
      document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Unavailable";
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (currentPodCode || !document.getElementById("tableView").classList.contains("hidden"))) {
    enableWakeLock();
  }
});

// --- CHECK URL FOR ?pod=XXXX INVITE ---
const urlParams = new URLSearchParams(window.location.search);
const invitedPodCode = urlParams.get("pod");
if (invitedPodCode) {
  roomCodeInput.value = invitedPodCode.toUpperCase().slice(0, 4);
  document.getElementById("joinPodBtn").className = "btn-primary join-submit-btn";
  document.getElementById("standardCreateSection").classList.add("hidden");
}

// Load saved decks immediately on startup
loadLocalUserProfile();

// --- INITIALIZE FIREBASE ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

signInAnonymously(auth)
  .then(async (cred) => {
    currentUser = cred.user;

    // Sync cloud decks & match history if present
    try {
      const userSnap = await get(ref(db, `users/${currentUser.uid}`));
      if (userSnap.exists()) {
        const cloudData = userSnap.val();
        if (cloudData.decks) {
          userDecks = { ...userDecks, ...cloudData.decks };
        }
        if (cloudData.matches) {
          userMatches = Object.values(cloudData.matches).sort((a, b) => (b.at || 0) - (a.at || 0));
        }
        saveLocalUserProfile();
        syncActiveDeckDropdown();
      }
    } catch {}

    const savedSession = getValidSession();
    if (savedSession && !invitedPodCode) {
      statusText.textContent = `Reconnecting to Pod ${savedSession.code}...`;
      topStatusLabel.textContent = "Reconnecting...";
      playerNameInput.value = savedSession.name;
      const rejoined = await enterPod(savedSession.code, false, true);
      if (rejoined) return;
    }

    statusText.textContent = invitedPodCode
      ? `Invited to Pod ${roomCodeInput.value}`
      : "Pod Network Ready";
    topStatusLabel.textContent = "Online";
    document.getElementById("topConnDot").style.background = "#22c55e";
    statusBox.className = "conn-pill ok";
    lobbyForm.classList.remove("hidden");
  })
  .catch(() => {
    statusText.textContent = "Offline — Table Mode Ready";
    topStatusLabel.textContent = "Offline";
    statusBox.className = "conn-pill err";
    lobbyForm.classList.remove("hidden");
  });

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function renderInviteQR(code) {
  const baseUrl = window.location.origin + window.location.pathname;
  const inviteUrl = `${baseUrl}?pod=${code}`;

  const qrBox = document.getElementById("qrBox");
  qrBox.innerHTML = "";
  new QRCode(qrBox, {
    text: inviteUrl,
    width: 140,
    height: 140,
    colorDark: "#070606",
    colorLight: "#ffffff"
  });

  const copyBtn = document.getElementById("copyLinkBtn");
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(inviteUrl);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy Link"), 2000);
  };
}

function toggleQrDrawer() {
  const drawer = document.getElementById("qrDrawer");
  const menuBtn = document.getElementById("toggleQrBtn");
  drawer.classList.toggle("hidden");
  menuBtn.textContent = drawer.classList.contains("hidden") ? "📱 Show QR Invite" : "📱 Hide QR Invite";
  dropdownMenu.classList.add("hidden");
}

document.getElementById("toggleQrBtn").onclick = toggleQrDrawer;
document.getElementById("inlineHideQrBtn").onclick = toggleQrDrawer;

// --- LEAVE POD (Auto-transfers host ownership if owner leaves) ---
document.getElementById("leavePodBtn").onclick = async () => {
  if (currentPodCode && currentUser && latestPodData) {
    const remainingUids = getOrderedPlayerUids(latestPodData).filter((uid) => uid !== currentUser.uid);

    if (latestPodData.hostUid === currentUser.uid && remainingUids.length > 0) {
      await update(ref(db, `pods/${currentPodCode}`), {
        hostUid: remainingUids[0]
      });
    }
    await remove(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`));
  }

  clearSession();
  window.location.href = window.location.origin + window.location.pathname;
};

// --- TURN ORDER & AUTO-SKIP ELIMINATED PLAYERS ---
function getOrderedPlayerUids(podData) {
  const playersObj = podData?.players || {};
  const existingIds = Object.keys(playersObj);
  const savedOrder = Array.isArray(podData?.seatOrder) ? podData.seatOrder : [];

  const ordered = savedOrder.filter((uid) => existingIds.includes(uid));
  const remaining = existingIds
    .filter((uid) => !ordered.includes(uid))
    .sort((a, b) => (playersObj[a].joinedAt || 0) - (playersObj[b].joinedAt || 0));

  return [...ordered, ...remaining];
}

function getNextAlivePlayerUid(podData, fromUid) {
  const orderedUids = getOrderedPlayerUids(podData);
  const players = podData?.players || {};
  if (orderedUids.length === 0) return null;

  const startIdx = orderedUids.indexOf(fromUid);
  for (let offset = 1; offset <= orderedUids.length; offset++) {
    const candidateIdx = (startIdx + offset) % orderedUids.length;
    const candidateUid = orderedUids[candidateIdx];
    if (!players[candidateUid]?.eliminated) {
      return candidateUid;
    }
  }
  return null;
}

async function setFirstPlayer(targetUid) {
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return;
  const orderedUids = getOrderedPlayerUids(latestPodData);
  await update(ref(db, `pods/${currentPodCode}`), {
    seatOrder: orderedUids,
    firstPlayerUid: targetUid,
    activeTurnUid: targetUid,
    turnNumber: 1
  });
}

async function rollRandomFirstPlayer() {
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return null;
  const players = latestPodData.players || {};
  const aliveUids = getOrderedPlayerUids(latestPodData).filter((uid) => !players[uid]?.eliminated);
  if (aliveUids.length === 0) return null;

  triggerHaptic([15, 25, 15]);
  const winnerUid = aliveUids[Math.floor(Math.random() * aliveUids.length)];
  await setFirstPlayer(winnerUid);
  return players[winnerUid]?.name || "Player";
}

async function advancePodTurn() {
  if (!currentPodCode || !latestPodData) return;
  triggerHaptic(15);
  const orderedUids = getOrderedPlayerUids(latestPodData);
  const players = latestPodData.players || {};
  if (orderedUids.length === 0) return;

  const currentIdx = orderedUids.indexOf(latestPodData.activeTurnUid);
  const firstIdx = orderedUids.indexOf(latestPodData.firstPlayerUid);

  let nextUid = null;
  let wrappedAround = false;

  for (let step = 1; step <= orderedUids.length; step++) {
    const candidateIdx = (currentIdx + step) % orderedUids.length;
    if (candidateIdx === (firstIdx !== -1 ? firstIdx : 0)) {
      wrappedAround = true;
    }
    const candidateUid = orderedUids[candidateIdx];
    if (!players[candidateUid]?.eliminated) {
      nextUid = candidateUid;
      break;
    }
  }

  if (!nextUid) return;

  const nextTurnNumber = (latestPodData.turnNumber || 1) + (wrappedAround ? 1 : 0);
  await update(ref(db, `pods/${currentPodCode}`), {
    activeTurnUid: nextUid,
    turnNumber: nextTurnNumber
  });
}

document.getElementById("quickRollStartBtn").onclick = async () => {
  await rollRandomFirstPlayer();
};
document.getElementById("quickSeatOrderBtn").onclick = () => {
  openFirstPlayerModal();
};

document.getElementById("passTurnBtn").onclick = advancePodTurn;

// --- HOST-ONLY: TURN ORDER & FIRST PLAYER MODAL ---
function renderFirstPlayerModal() {
  if (!latestPodData || latestPodData.hostUid !== currentUser.uid) return;
  const players = latestPodData.players || {};
  const orderedUids = getOrderedPlayerUids(latestPodData);

  const list = document.getElementById("manualFirstPlayerList");
  list.innerHTML = "";

  orderedUids.forEach((uid, index) => {
    const row = document.createElement("div");
    row.className = "seat-row";

    const label = document.createElement("div");
    label.className = "seat-label";
    label.textContent = `${index + 1}. ${players[uid].name}${uid === currentUser.uid ? " (You)" : ""}${players[uid].eliminated ? " 💀" : ""}`;

    const actions = document.createElement("div");
    actions.className = "seat-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "seat-move-btn";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.onclick = async () => {
      const nextOrder = [...orderedUids];
      [nextOrder[index - 1], nextOrder[index]] = [nextOrder[index], nextOrder[index - 1]];
      await update(ref(db, `pods/${currentPodCode}`), { seatOrder: nextOrder });
    };

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "seat-move-btn";
    downBtn.textContent = "↓";
    downBtn.disabled = index === orderedUids.length - 1;
    downBtn.onclick = async () => {
      const nextOrder = [...orderedUids];
      [nextOrder[index + 1], nextOrder[index]] = [nextOrder[index], nextOrder[index + 1]];
      await update(ref(db, `pods/${currentPodCode}`), { seatOrder: nextOrder });
    };

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "btn-primary btn-small";
    startBtn.textContent = "Starts";
    startBtn.onclick = async () => {
      await setFirstPlayer(uid);
      document.getElementById("firstPlayerModal").classList.add("hidden");
    };

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(startBtn);
    row.appendChild(label);
    row.appendChild(actions);
    list.appendChild(row);
  });

  document.getElementById("rollDiceBtn").onclick = async () => {
    const winnerName = await rollRandomFirstPlayer();
    if (!winnerName) return;
    const resultBox = document.getElementById("diceResultBox");
    resultBox.textContent = `🎲 ${winnerName} goes first!`;
    resultBox.classList.remove("hidden");
    setTimeout(() => {
      document.getElementById("firstPlayerModal").classList.add("hidden");
    }, 950);
  };
}

function openFirstPlayerModal() {
  dropdownMenu.classList.add("hidden");
  document.getElementById("diceResultBox").classList.add("hidden");
  renderFirstPlayerModal();
  document.getElementById("firstPlayerModal").classList.remove("hidden");
}

document.getElementById("openFirstPlayerBtn").onclick = openFirstPlayerModal;
document.getElementById("closeFirstPlayerBtn").onclick = () => {
  document.getElementById("firstPlayerModal").classList.add("hidden");
};
document.getElementById("firstPlayerModal").onclick = (e) => {
  if (e.target.id === "firstPlayerModal") {
    document.getElementById("firstPlayerModal").classList.add("hidden");
  }
};

// --- HOST-ONLY: NEW GAME MODAL WITH STARTING LIFE SELECTOR ---
document.getElementById("newGameBtn").onclick = () => {
  dropdownMenu.classList.add("hidden");
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return;

  selectedNewGameLife = latestPodData.startingLife || 40;
  document.querySelectorAll("#newGameLifeSelector .preset-btn").forEach((btn) => {
    btn.classList.toggle("selected", parseInt(btn.dataset.life, 10) === selectedNewGameLife);
  });
  newGameModal.classList.remove("hidden");
};

document.getElementById("closeNewGameModalBtn").onclick = () => newGameModal.classList.add("hidden");
newGameModal.onclick = (e) => {
  if (e.target === newGameModal) newGameModal.classList.add("hidden");
};

document.getElementById("confirmNewGameBtn").onclick = async () => {
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return;

  lastRecordedPodMatchKey = "";
  const players = latestPodData.players || {};
  const resetUpdates = {
    startingLife: selectedNewGameLife,
    gameNumber: (latestPodData.gameNumber || 1) + 1,
    monarchUid: null,
    firstPlayerUid: null,
    activeTurnUid: null,
    turnNumber: null,
    history: null
  };

  Object.entries(players).forEach(([uid, p]) => {
    resetUpdates[`players/${uid}`] = {
      name: p.name,
      deckName: p.deckName || "",
      theme: p.theme || "blue",
      hasPartner: Boolean(p.hasPartner),
      eliminated: false,
      pinnedCounters: Array.isArray(p.pinnedCounters) ? p.pinnedCounters : [],
      joinedAt: p.joinedAt || Date.now(),
      life: selectedNewGameLife,
      poison: 0,
      tax: 0,
      extraCounters: { energy: 0, experience: 0, storm: 0, rad: 0 },
      commanderDamage: null
    };
  });

  await update(ref(db, `pods/${currentPodCode}`), resetUpdates);
  newGameModal.classList.add("hidden");
};

// --- MONARCH CONTROL ---
function setMonarch(targetUid) {
  if (!currentPodCode) return;
  update(ref(db, `pods/${currentPodCode}`), {
    monarchUid: targetUid
  });
}

document.getElementById("becomeMonarchBtn").onclick = () => {
  dropdownMenu.classList.add("hidden");
  if (!currentUser) return;
  const isAlreadyMonarch = latestPodData?.monarchUid === currentUser.uid;
  setMonarch(isAlreadyMonarch ? null : currentUser.uid);
};

// --- OPPONENT INSPECTOR MODAL ---
function openOpponentModal(uid) {
  inspectedOpponentUid = uid;
  renderOpponentModal();
  document.getElementById("inspectModal").classList.remove("hidden");
}

function renderOpponentModal() {
  if (!inspectedOpponentUid || !latestPodData?.players?.[inspectedOpponentUid]) return;

  const players = latestPodData.players;
  const target = players[inspectedOpponentUid];
  const isMonarch = latestPodData.monarchUid === inspectedOpponentUid;
  const isHost = latestPodData.hostUid === currentUser.uid;
  const isEliminated = Boolean(target.eliminated);

  document.getElementById("modalPlayerName").textContent = `${isMonarch ? "👑 " : ""}${target.name}${isEliminated ? " (Knocked Out)" : ""}`;
  document.getElementById("modalLifeVal").textContent = target.life ?? (latestPodData.startingLife || 40);
  document.getElementById("modalPoisonVal").textContent = target.poison ?? 0;
  document.getElementById("modalTaxVal").textContent = `+${target.tax ?? 0}`;

  const extraStrip = document.getElementById("modalExtraCounters");
  extraStrip.innerHTML = "";
  const oppExtras = target.extraCounters || {};
  let hasExtraVals = false;

  Object.entries(EXTRA_COUNTER_META).forEach(([key, meta]) => {
    const val = oppExtras[key] || 0;
    if (val > 0) {
      hasExtraVals = true;
      const chip = document.createElement("span");
      chip.className = "modal-extra-chip";
      chip.textContent = `${meta.icon} ${val}`;
      extraStrip.appendChild(chip);
    }
  });
  extraStrip.classList.toggle("hidden", !hasExtraVals);

  const cmdrList = document.getElementById("modalCmdrList");
  cmdrList.innerHTML = "";
  const takenMap = target.commanderDamage || {};
  let hasEntries = false;

  Object.entries(players).forEach(([otherUid, otherPlayer]) => {
    if (otherUid === inspectedOpponentUid) return;
    hasEntries = true;

    const dmgA = takenMap[otherUid] || 0;
    const dmgB = takenMap[`${otherUid}_partner`] || 0;

    if (otherPlayer.hasPartner) {
      const row = document.createElement("div");
      row.className = "cmdr-dmg-row";
      row.innerHTML = `
        <div class="cmdr-source-name">From ${otherPlayer.name}</div>
        <div class="cmdr-dmg-val">
          <span class="${dmgA >= 21 ? "lethal" : ""}">A:${dmgA}</span> /
          <span class="${dmgB >= 21 ? "lethal" : ""}">B:${dmgB}</span>
        </div>
      `;
      cmdrList.appendChild(row);
    } else {
      const row = document.createElement("div");
      row.className = "cmdr-dmg-row";
      row.innerHTML = `
        <div class="cmdr-source-name">From ${otherPlayer.name}</div>
        <div class="cmdr-dmg-val ${dmgA >= 21 ? "lethal" : ""}">${dmgA}</div>
      `;
      cmdrList.appendChild(row);
    }
  });

  if (!hasEntries) {
    cmdrList.innerHTML = `<div class="empty-hint">No other players in pod</div>`;
  }

  document.getElementById("modalMakeMonarchBtn").onclick = () => {
    setMonarch(inspectedOpponentUid);
  };

  const koBtn = document.getElementById("modalToggleEliminateBtn");
  koBtn.textContent = isEliminated ? "↺ Revive Player" : "💀 Mark Knocked Out";
  koBtn.onclick = async () => {
    await setPlayerEliminatedState(inspectedOpponentUid, !isEliminated);
    renderOpponentModal();
  };

  const transferBtn = document.getElementById("modalTransferHostBtn");
  transferBtn.classList.toggle("hidden", !isHost);
  transferBtn.onclick = async () => {
    if (!confirm(`Transfer Pod Ownership to ${target.name}?`)) return;
    await update(ref(db, `pods/${currentPodCode}`), {
      hostUid: inspectedOpponentUid
    });
    inspectedOpponentUid = null;
    document.getElementById("inspectModal").classList.add("hidden");
  };
}

document.getElementById("closeModalBtn").onclick = () => {
  inspectedOpponentUid = null;
  document.getElementById("inspectModal").classList.add("hidden");
};

document.getElementById("inspectModal").onclick = (e) => {
  if (e.target.id === "inspectModal") {
    inspectedOpponentUid = null;
    document.getElementById("inspectModal").classList.add("hidden");
  }
};

// --- DEBOUNCED HISTORY LOG FLUSHER ---
function recordHistoryChange(previousLife, newLife, note = "") {
  if (pendingHistoryStartLife === null) {
    pendingHistoryStartLife = previousLife;
  }
  if (note) {
    pendingHistoryNote = note;
  }

  clearTimeout(historyFlushTimer);
  historyFlushTimer = setTimeout(() => {
    if (!currentPodCode || !currentUser || pendingHistoryStartLife === null) return;
    const netDelta = newLife - pendingHistoryStartLife;
    const startVal = pendingHistoryStartLife;
    const finalNote = pendingHistoryNote;

    pendingHistoryStartLife = null;
    pendingHistoryNote = "";

    if (netDelta === 0) return;

    const myName = latestPodData?.players?.[currentUser.uid]?.name || playerNameInput.value.trim() || "Player";
    push(ref(db, `pods/${currentPodCode}/history`), {
      playerName: myName,
      fromLife: startVal,
      toLife: newLife,
      delta: netDelta,
      note: finalNote,
      at: Date.now()
    });
  }, 1500);
}

// --- LIFE, POISON, TAX & COMMANDER DAMAGE UPDATERS ---
async function syncMyLethalCheck(extraUpdates = {}) {
  if (!currentPodCode || !currentUser) return;
  const shouldBeKo = hasLethalStats(myCurrentLife, myPoison, myCommanderDamage);
  const wasEliminated = myEliminated;

  if (shouldBeKo !== myEliminated) {
    myEliminated = shouldBeKo;
    extraUpdates.eliminated = shouldBeKo;
  }

  await update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), extraUpdates);

  if (!wasEliminated && shouldBeKo && latestPodData?.activeTurnUid === currentUser.uid) {
    await advancePodTurn();
  }
}

function changeMyLife(amount, note = "") {
  if (!currentPodCode || !currentUser) return;

  const previousLife = myCurrentLife;
  myCurrentLife += amount;
  document.getElementById("heroLifeDisplay").textContent = myCurrentLife;

  recordHistoryChange(previousLife, myCurrentLife, note);

  deltaAccumulator += amount;
  const badge = document.getElementById("deltaBadge");
  badge.textContent = deltaAccumulator > 0 ? `+${deltaAccumulator}` : `${deltaAccumulator}`;
  badge.className = `delta-badge ${deltaAccumulator >= 0 ? "delta-plus" : "delta-minus"}`;

  clearTimeout(deltaClearTimer);
  deltaClearTimer = setTimeout(() => {
    deltaAccumulator = 0;
    badge.textContent = "";
  }, 2000);

  saveSession(currentPodCode, playerNameInput.value.trim() || "Player");
  syncMyLethalCheck({ life: myCurrentLife });
}

function changePoison(delta) {
  if (!currentPodCode || !currentUser) return;
  triggerHaptic(12);
  myPoison = Math.max(0, myPoison + delta);
  syncMyLethalCheck({ poison: myPoison });
}

function changeTax(delta) {
  if (!currentPodCode || !currentUser) return;
  triggerHaptic(12);
  myTax = Math.max(0, myTax + delta);
  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
    tax: myTax
  });
}

function changeCommanderDamage(dmgKey, sourceUid, slotLabel, delta) {
  if (!currentPodCode || !currentUser) return;
  const currentDmg = myCommanderDamage[dmgKey] || 0;
  const nextDmg = Math.max(0, currentDmg + delta);
  const actualChange = nextDmg - currentDmg;

  if (actualChange === 0) return;

  triggerHaptic(nextDmg >= 21 ? [30, 40, 30] : 15);
  myCommanderDamage[dmgKey] = nextDmg;
  const attackerName = latestPodData?.players?.[sourceUid]?.name || "Commander";
  const labelSuffix = slotLabel ? ` (${slotLabel})` : "";

  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}/commanderDamage`), {
    [dmgKey]: nextDmg
  });

  changeMyLife(-actualChange, `Cmdr from ${attackerName}${labelSuffix}`);
}

document.getElementById("poisonMinusBtn").onclick = () => changePoison(-1);
document.getElementById("poisonPlusBtn").onclick = () => changePoison(1);
document.getElementById("taxMinusBtn").onclick = () => changeTax(-2);
document.getElementById("taxPlusBtn").onclick = () => changeTax(2);

// --- TAP FOR 1, HOLD FOR 5 HELPER ---
function bindLifeTapZone(element, step, customCallback = null) {
  let holdTimer = null;
  let didHold = false;

  const invokeChange = customCallback || changeMyLife;

  const startPress = (e) => {
    e.preventDefault();
    didHold = false;
    holdTimer = setTimeout(() => {
      didHold = true;
      triggerHaptic([20, 30, 20]);
      invokeChange(step * 5);
    }, 450);
  };

  const endPress = (e) => {
    e.preventDefault();
    clearTimeout(holdTimer);
    if (!didHold) {
      triggerHaptic(12);
      invokeChange(step);
    }
  };

  const cancelPress = () => clearTimeout(holdTimer);

  element.addEventListener("pointerdown", startPress);
  element.addEventListener("pointerup", endPress);
  element.addEventListener("pointerleave", cancelPress);
  element.addEventListener("pointercancel", cancelPress);
}

bindLifeTapZone(document.getElementById("minusZone"), -1);
bindLifeTapZone(document.getElementById("plusZone"), 1);

// --- ENTER POD & LISTEN FOR REAL-TIME SYNC ---
async function enterPod(code, isNew, isAutoRejoin = false) {
  const name = playerNameInput.value.trim() || "Player";
  const podRef = ref(db, `pods/${code}`);
  const selectedDeckObj = activeDeckId ? userDecks[activeDeckId] : null;
  const selectedDeckLabel = selectedDeckObj ? selectedDeckObj.name : "";

  let podStartingLife = selectedLobbyStartingLife;

  if (!isNew) {
    const snap = await get(podRef);
    if (!snap.exists()) {
      clearSession();
      if (!isAutoRejoin) alert("Pod not found! Check the 4-letter code.");
      return false;
    }
    podStartingLife = snap.val().startingLife || 40;
  } else {
    await set(podRef, {
      createdAt: Date.now(),
      hostUid: currentUser.uid,
      startingLife: selectedLobbyStartingLife,
      gameNumber: 1
    });
  }

  currentPodCode = code;
  const playerRef = ref(db, `pods/${code}/players/${currentUser.uid}`);

  const existingPlayerSnap = await get(playerRef);
  if (!existingPlayerSnap.exists()) {
    await set(playerRef, {
      name: name,
      deckName: selectedDeckLabel,
      theme: myTheme,
      hasPartner: false,
      eliminated: false,
      pinnedCounters: [],
      joinedAt: Date.now(),
      life: podStartingLife,
      poison: 0,
      tax: 0,
      extraCounters: { energy: 0, experience: 0, storm: 0, rad: 0 }
    });
  } else {
    const existing = existingPlayerSnap.val();
    myCurrentLife = existing.life ?? podStartingLife;
    myPoison = existing.poison ?? 0;
    myTax = existing.tax ?? 0;
    myHasPartner = Boolean(existing.hasPartner);
    myEliminated = Boolean(existing.eliminated);
    myCommanderDamage = existing.commanderDamage || {};
    myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0, ...(existing.extraCounters || {}) };
    myPinnedCounters = Array.isArray(existing.pinnedCounters) ? existing.pinnedCounters : [];
    if (existing.theme) applyMyThemeUI(existing.theme);
    if (selectedDeckLabel && existing.deckName !== selectedDeckLabel) {
      update(playerRef, { deckName: selectedDeckLabel });
    }
  }

  saveSession(code, name);

  lobbyTopBar.classList.add("hidden");
  lobbyView.classList.add("hidden");
  decksView.classList.add("hidden");
  statsView.classList.add("hidden");
  podView.classList.remove("hidden");

  document.getElementById("displayRoomCode").textContent = code;
  renderInviteQR(code);
  enableWakeLock();

  if (!isNew) {
    document.getElementById("qrDrawer").classList.add("hidden");
    document.getElementById("toggleQrBtn").textContent = "📱 Show QR Invite";
  }

  onValue(podRef, (snapshot) => {
    const podData = snapshot.val();
    if (!podData) return;

    latestPodData = podData;
    const players = podData.players || {};
    const orderedUids = getOrderedPlayerUids(podData);
    const monarchUid = podData.monarchUid || null;
    const activeTurnUid = podData.activeTurnUid || null;
    const turnNumber = podData.turnNumber || 1;
    const isHost = podData.hostUid === currentUser.uid;
    const activeStartLife = podData.startingLife || 40;
    const gameNum = podData.gameNumber || 1;

    document.getElementById("hostCrownTag").classList.toggle("hidden", !isHost);
    document.getElementById("openFirstPlayerBtn").classList.toggle("hidden", !isHost);
    document.getElementById("newGameBtn").classList.toggle("hidden", !isHost);

    // Check for Pod Winner & Auto-Log Win/Loss to Active Deck
    const aliveUids = orderedUids.filter((uid) => !players[uid]?.eliminated);
    const winnerBanner = document.getElementById("podWinnerBanner");
    const winnerDeckNote = document.getElementById("podWinnerDeckNote");

    if (orderedUids.length >= 2 && aliveUids.length === 1) {
      const winnerUid = aliveUids[0];
      const winnerName = players[winnerUid]?.name || "Player";
      document.getElementById("podWinnerText").textContent = `🏆 ${winnerName} Wins the Pod!`;
      winnerBanner.classList.remove("hidden");

      const matchUniqueKey = `${code}_g${gameNum}`;
      if (activeDeckId && userDecks[activeDeckId] && lastRecordedPodMatchKey !== matchUniqueKey) {
        lastRecordedPodMatchKey = matchUniqueKey;
        const iWon = winnerUid === currentUser.uid;
        recordDeckMatchOutcome(activeDeckId, iWon ? "win" : "loss", `Pod ${code}`);
        winnerDeckNote.textContent = `📊 Logged ${iWon ? "+1 Win" : "+1 Loss"} to ${userDecks[activeDeckId].name}`;
        winnerDeckNote.classList.remove("hidden");
      }
    } else {
      winnerBanner.classList.add("hidden");
      winnerDeckNote.classList.add("hidden");
    }

    const gameHasStarted = Boolean(activeTurnUid && players[activeTurnUid]);
    document.getElementById("hostStartBanner").classList.toggle("hidden", !(isHost && !gameHasStarted));

    const turnBanner = document.getElementById("turnBanner");
    if (gameHasStarted) {
      turnBanner.classList.remove("hidden");
      const isMyTurn = activeTurnUid === currentUser.uid;
      turnBanner.classList.toggle("my-turn", isMyTurn);
      document.getElementById("turnNumberLabel").textContent = `TURN ${turnNumber}`;
      document.getElementById("activePlayerLabel").textContent = isMyTurn
        ? "Your Turn!"
        : `${players[activeTurnUid].name}'s Turn`;

      document.getElementById("passTurnBtn").classList.toggle("hidden", !(isMyTurn || isHost));

      const strip = document.getElementById("turnOrderStrip");
      strip.innerHTML = "";
      const nextAliveUid = getNextAlivePlayerUid(podData, activeTurnUid);

      orderedUids.forEach((uid, idx) => {
        const p = players[uid];
        const chip = document.createElement("span");
        const isCurrent = uid === activeTurnUid;
        const isNext = uid === nextAliveUid && aliveUids.length > 1;
        chip.className = `order-chip ${isCurrent ? "active" : ""} ${isNext ? "next-up" : ""} ${p.eliminated ? "eliminated-chip" : ""}`;
        chip.textContent = `${idx + 1}. ${p.name}${p.eliminated ? " 💀" : ""}`;
        strip.appendChild(chip);

        if (idx < orderedUids.length - 1) {
          const arrow = document.createElement("span");
          arrow.className = "order-arrow";
          arrow.textContent = "→";
          strip.appendChild(arrow);
        }
      });
    } else {
      turnBanner.classList.add("hidden");
    }

    const opponentsGrid = document.getElementById("opponentsGrid");
    const cmdrDamageList = document.getElementById("cmdrDamageList");
    opponentsGrid.innerHTML = "";
    cmdrDamageList.innerHTML = "";

    const me = players[currentUser.uid];
    if (me) {
      myCurrentLife = me.life ?? activeStartLife;
      myPoison = me.poison ?? 0;
      myTax = me.tax ?? 0;
      myHasPartner = Boolean(me.hasPartner);
      myEliminated = Boolean(me.eliminated);
      myCommanderDamage = me.commanderDamage || {};
      myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0, ...(me.extraCounters || {}) };
      myPinnedCounters = Array.isArray(me.pinnedCounters) ? me.pinnedCounters : [];

      if (me.theme && me.theme !== myTheme) applyMyThemeUI(me.theme);

      const partnerBtn = document.getElementById("togglePartnerBtn");
      partnerBtn.textContent = myHasPartner ? "🤝 Partner Commander: ON" : "🤝 Partner Commander: OFF";
      partnerBtn.classList.toggle("active-opt", myHasPartner);

      const koMenuBtn = document.getElementById("toggleEliminatedBtn");
      koMenuBtn.textContent = myEliminated ? "↺ Revive / Rejoin Game" : "🏳️ Scoop / Knocked Out";
      koMenuBtn.classList.toggle("warning", myEliminated);

      const iAmMonarch = monarchUid === currentUser.uid;
      document.getElementById("heroPlayerName").textContent = `${iAmMonarch ? "👑 " : ""}${me.name} (You)${myHasPartner ? " • Partners" : ""}`;

      const heroDeckTag = document.getElementById("heroDeckTag");
      if (me.deckName) {
        heroDeckTag.textContent = `⚔️ ${me.deckName}`;
        heroDeckTag.classList.remove("hidden");
      } else {
        heroDeckTag.classList.add("hidden");
      }

      const heroEl = document.getElementById("heroTracker");
      heroEl.classList.toggle("is-monarch", iAmMonarch);
      heroEl.classList.toggle("is-eliminated", myEliminated);
      document.getElementById("heroEliminatedOverlay").classList.toggle("hidden", !myEliminated);

      const monarchBtn = document.getElementById("becomeMonarchBtn");
      monarchBtn.classList.toggle("warning", iAmMonarch);
      monarchBtn.textContent = iAmMonarch ? "👑 Give Up Monarch" : "👑 Claim the Monarch";

      document.getElementById("heroLifeDisplay").textContent = myCurrentLife;
      document.getElementById("poisonDisplay").textContent = myPoison;
      document.getElementById("taxDisplay").textContent = `+${myTax}`;
      document.getElementById("poisonBox").classList.toggle("lethal-poison", myPoison >= 10);

      renderPinnedExtraCounters();
    }

    let opponentCount = 0;

    orderedUids.forEach((uid) => {
      if (uid === currentUser.uid) return;
      const p = players[uid];
      opponentCount++;

      const oppIsMonarch = monarchUid === uid;
      const oppIsActiveTurn = activeTurnUid === uid;
      const oppIsHost = podData.hostUid === uid;
      const oppIsEliminated = Boolean(p.eliminated);
      const oppTheme = VALID_THEMES.includes(p.theme) ? p.theme : "blue";

      const badges = [];
      if (oppIsEliminated) badges.push("💀 OUT");
      else if (p.deckName) badges.push(p.deckName);
      else if (oppIsHost) badges.push("Host");
      if (p.poison > 0) badges.push(`☠${p.poison}`);
      const cmdrValues = Object.values(p.commanderDamage || {});
      const maxCmdr = cmdrValues.length > 0 ? Math.max(...cmdrValues) : 0;
      if (maxCmdr > 0) badges.push(`⚔${maxCmdr}`);

      const card = document.createElement("button");
      card.type = "button";
      card.className = `opponent-card theme-${oppTheme} ${oppIsMonarch ? "is-monarch" : ""} ${oppIsActiveTurn ? "is-active-turn" : ""} ${oppIsEliminated ? "is-eliminated" : ""}`;
      card.innerHTML = `
        <div class="opponent-name">${oppIsMonarch ? "👑 " : ""}${p.name}</div>
        <div class="opponent-life ${oppIsEliminated || p.life <= 0 ? "dead" : ""}">${p.life}</div>
        <div class="opponent-badges">${badges.join(" • ")}</div>
      `;
      card.addEventListener("click", () => openOpponentModal(uid));
      opponentsGrid.appendChild(card);

      if (p.hasPartner) {
        const dmgA = myCommanderDamage[uid] || 0;
        const dmgB = myCommanderDamage[`${uid}_partner`] || 0;
        const block = document.createElement("div");
        block.className = "cmdr-partner-block";
        block.innerHTML = `
          <div class="cmdr-partner-header">From ${p.name} (Partners)</div>
          <div class="cmdr-partner-subgrid">
            <div class="cmdr-sub-pill">
              <span class="cmdr-sub-tag">Cmdr A</span>
              <div class="counter-controls" style="gap:5px;">
                <button class="mini-btn cmdr-btn" style="width:30px;height:30px;" data-key="${uid}" data-uid="${uid}" data-slot="Cmdr A" data-delta="-1">−</button>
                <span class="cmdr-dmg-val ${dmgA >= 21 ? "lethal" : ""}" style="min-width:24px;font-size:1.05rem;">${dmgA}</span>
                <button class="mini-btn cmdr-btn" style="width:30px;height:30px;" data-key="${uid}" data-uid="${uid}" data-slot="Cmdr A" data-delta="1">+</button>
              </div>
            </div>
            <div class="cmdr-sub-pill">
              <span class="cmdr-sub-tag">Cmdr B</span>
              <div class="counter-controls" style="gap:5px;">
                <button class="mini-btn cmdr-btn" style="width:30px;height:30px;" data-key="${uid}_partner" data-uid="${uid}" data-slot="Cmdr B" data-delta="-1">−</button>
                <span class="cmdr-dmg-val ${dmgB >= 21 ? "lethal" : ""}" style="min-width:24px;font-size:1.05rem;">${dmgB}</span>
                <button class="mini-btn cmdr-btn" style="width:30px;height:30px;" data-key="${uid}_partner" data-uid="${uid}" data-slot="Cmdr B" data-delta="1">+</button>
              </div>
            </div>
          </div>
        `;
        cmdrDamageList.appendChild(block);
      } else {
        const dmgTaken = myCommanderDamage[uid] || 0;
        const dmgRow = document.createElement("div");
        dmgRow.className = "cmdr-dmg-row";
        dmgRow.innerHTML = `
          <div class="cmdr-source-name">From ${p.name}</div>
          <div class="counter-controls">
            <button class="mini-btn cmdr-btn" data-key="${uid}" data-uid="${uid}" data-slot="" data-delta="-1">−</button>
            <span class="cmdr-dmg-val ${dmgTaken >= 21 ? "lethal" : ""}">${dmgTaken}</span>
            <button class="mini-btn cmdr-btn" data-key="${uid}" data-uid="${uid}" data-slot="" data-delta="1">+</button>
          </div>
        `;
        cmdrDamageList.appendChild(dmgRow);
      }
    });

    if (opponentCount === 0) {
      cmdrDamageList.innerHTML = `<div class="empty-hint">Waiting for opponents to join...</div>`;
    } else {
      cmdrDamageList.querySelectorAll(".cmdr-btn").forEach((btn) => {
        btn.onclick = () => {
          changeCommanderDamage(
            btn.dataset.key,
            btn.dataset.uid,
            btn.dataset.slot,
            parseInt(btn.dataset.delta, 10)
          );
        };
      });
    }

    if (inspectedOpponentUid) {
      renderOpponentModal();
    }
    if (!document.getElementById("firstPlayerModal").classList.contains("hidden")) {
      renderFirstPlayerModal();
    }
    if (!historyModal.classList.contains("hidden")) {
      renderHistoryModal();
    }
  });

  return true;
}

document.getElementById("createPodBtn").onclick = () => enterPod(generateCode(), true);
document.getElementById("joinPodBtn").onclick = () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length === 4) enterPod(code, false);
};

// =========================================================
// TABLE MODE (SINGLE-DEVICE SPLIT-SCREEN + SIDEWAYS ORIENTATION)
// =========================================================
const tableSetupModal = document.getElementById("tableSetupModal");
const tableView = document.getElementById("tableView");
const tableGrid = document.getElementById("tableGrid");
const tableHubMenu = document.getElementById("tableHubMenu");
const tablePlayerModal = document.getElementById("tablePlayerModal");
const tableTrayCard = tablePlayerModal.querySelector(".table-tray-card");

let tablePlayerCount = 4;
let tableStartingLife = 40;
let tablePlayers = [];
let tableMonarchIdx = null;
let activeTraySeatIdx = null;
const tableDeltaTimers = {};
const tableDeltaTotals = {};

document.querySelectorAll("#tablePlayersSelector .preset-btn").forEach((btn) => {
  btn.onclick = () => {
    tablePlayerCount = parseInt(btn.dataset.players, 10);
    document.querySelectorAll("#tablePlayersSelector .preset-btn").forEach((b) => {
      b.classList.toggle("selected", b === btn);
    });
  };
});

document.querySelectorAll("#tableLifeSelector .preset-btn").forEach((btn) => {
  btn.onclick = () => {
    tableStartingLife = parseInt(btn.dataset.life, 10);
    document.querySelectorAll("#tableLifeSelector .preset-btn").forEach((b) => {
      b.classList.toggle("selected", b === btn);
    });
  };
});

document.getElementById("openTableSetupBtn").onclick = () => {
  tableSetupModal.classList.remove("hidden");
};
document.getElementById("closeTableSetupBtn").onclick = () => {
  tableSetupModal.classList.add("hidden");
};
tableSetupModal.onclick = (e) => {
  if (e.target === tableSetupModal) tableSetupModal.classList.add("hidden");
};

function initTableMode() {
  const defaultThemes = ["blue", "red", "green", "gold"];
  tableMonarchIdx = null;
  tablePlayers = Array.from({ length: tablePlayerCount }, (_, idx) => ({
    id: idx,
    name: `Player ${idx + 1}`,
    life: tableStartingLife,
    theme: defaultThemes[idx % defaultThemes.length],
    isFirst: false,
    hasPartner: false,
    eliminated: false,
    poison: 0,
    tax: 0,
    energy: 0,
    rad: 0,
    cmdrDamage: {}
  }));

  renderTableGrid();
  tableSetupModal.classList.add("hidden");
  tableHubMenu.classList.add("hidden");
  lobbyTopBar.classList.add("hidden");
  lobbyView.classList.add("hidden");
  tableView.classList.remove("hidden");
  enableWakeLock();
}

function getSeatMaxCmdrFrom(targetPlayer, sourceIdx) {
  const dmgA = targetPlayer.cmdrDamage[sourceIdx] || 0;
  const dmgB = targetPlayer.cmdrDamage[`${sourceIdx}_partner`] || 0;
  return Math.max(dmgA, dmgB);
}

function getSeatOrientationClass(idx) {
  if (tablePlayerCount === 2) {
    return idx === 0 ? "face-top" : "face-bottom";
  }
  if (tablePlayerCount === 3) {
    if (idx === 0) return "face-left";
    if (idx === 1) return "face-right";
    return "face-bottom";
  }
  return idx % 2 === 0 ? "face-left" : "face-right";
}

function renderTableGrid() {
  tableGrid.className = `table-grid players-${tablePlayerCount}`;
  tableGrid.innerHTML = "";

  const aliveSeats = tablePlayers.filter((p) => !p.eliminated);
  const winnerSeatId = tablePlayers.length >= 2 && aliveSeats.length === 1 ? aliveSeats[0].id : null;

  tablePlayers.forEach((p, idx) => {
    const faceClass = getSeatOrientationClass(idx);
    const isMonarch = tableMonarchIdx === idx;
    const isWinner = winnerSeatId === idx;

    const firstZoneIsPlus = faceClass === "face-right" || faceClass === "face-top";
    const firstStep = firstZoneIsPlus ? 1 : -1;
    const secondStep = firstZoneIsPlus ? -1 : 1;
    const firstSymbol = firstZoneIsPlus ? "+" : "−";
    const secondSymbol = firstZoneIsPlus ? "−" : "+";

    const seat = document.createElement("div");
    seat.id = `table-seat-${idx}`;
    seat.className = `table-seat theme-${p.theme} ${faceClass} ${p.isFirst ? "first-player-glow" : ""} ${isMonarch ? "is-monarch" : ""} ${p.eliminated ? "is-eliminated" : ""} ${isWinner ? "is-winner" : ""}`;

    const statusPills = [];
    if (p.poison > 0) statusPills.push(`<span class="seat-mini-badge poison">☠${p.poison}</span>`);
    if (p.tax > 0) statusPills.push(`<span class="seat-mini-badge">+${p.tax}</span>`);
    if (p.energy > 0) statusPills.push(`<span class="seat-mini-badge">⚡${p.energy}</span>`);
    if (p.rad > 0) statusPills.push(`<span class="seat-mini-badge">☢️${p.rad}</span>`);

    const radarCellsHtml = tablePlayers
      .map((other, otherIdx) => {
        const spanClass = tablePlayerCount === 3 && otherIdx === 2 ? "span-2" : "";
        if (otherIdx === idx) {
          return `<div class="radar-cell self-cell ${spanClass}">YOU</div>`;
        }
        const maxDmg = getSeatMaxCmdrFrom(p, otherIdx);
        return `<div class="radar-cell theme-${other.theme} ${maxDmg >= 21 ? "lethal" : ""} ${spanClass}">${maxDmg}</div>`;
      })
      .join("");

    seat.innerHTML = `
      <div class="hero-inner-frame"></div>

      <div class="seat-tap-zones">
        <div class="seat-tap-zone" id="table-zoneA-${idx}">${firstSymbol}</div>
        <div class="seat-tap-zone" id="table-zoneB-${idx}">${secondSymbol}</div>
      </div>

      <div class="seat-hud">
        <div class="seat-top-bar">
          <span class="seat-name-tag" id="table-name-${idx}" title="Open Command Tray">
            ${isMonarch ? "👑 " : ""}${p.isFirst ? "🎲 " : ""}${p.name}
          </span>
          <button type="button" class="seat-color-btn" data-idx="${idx}" title="Cycle Color">🎨</button>
        </div>

        <div class="seat-center-stack">
          <div id="table-life-${idx}" class="seat-life-num ${p.eliminated || p.life <= 0 ? "dead" : ""}">${p.life}</div>
          ${p.eliminated ? `<div class="seat-ko-tag">💀 DEFEATED</div>` : isWinner ? `<div class="seat-winner-tag">🏆 WINNER</div>` : ""}
          <div id="table-delta-${idx}" class="seat-delta"></div>
        </div>

        <div class="seat-bottom-dock">
          <div class="seat-status-pills">${statusPills.join("")}</div>
          <button type="button" class="cmdr-radar-btn" id="table-radar-${idx}" aria-label="Open Command Tray">
            ${radarCellsHtml}
          </button>
        </div>
      </div>
    `;

    tableGrid.appendChild(seat);

    bindLifeTapZone(seat.querySelector(`#table-zoneA-${idx}`), firstStep, (amt) => changeTableLife(idx, amt));
    bindLifeTapZone(seat.querySelector(`#table-zoneB-${idx}`), secondStep, (amt) => changeTableLife(idx, amt));

    const nameTag = seat.querySelector(`#table-name-${idx}`);
    nameTag.addEventListener("pointerdown", (e) => e.stopPropagation());
    nameTag.onclick = (e) => {
      e.stopPropagation();
      triggerHaptic(12);
      openTablePlayerTray(idx);
    };

    const colorBtn = seat.querySelector(".seat-color-btn");
    colorBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    colorBtn.onclick = (e) => {
      e.stopPropagation();
      triggerHaptic(10);
      const currentThemeIdx = VALID_THEMES.indexOf(p.theme);
      p.theme = VALID_THEMES[(currentThemeIdx + 1) % VALID_THEMES.length];
      renderTableGrid();
    };

    const radarBtn = seat.querySelector(`#table-radar-${idx}`);
    radarBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    radarBtn.onclick = (e) => {
      e.stopPropagation();
      triggerHaptic(12);
      openTablePlayerTray(idx);
    };
  });
}

function checkTableSeatLethal(idx) {
  const p = tablePlayers[idx];
  if (!p) return false;
  const nextKo = hasLethalStats(p.life, p.poison, p.cmdrDamage);
  if (nextKo !== p.eliminated) {
    p.eliminated = nextKo;
    if (nextKo && tableMonarchIdx === idx) {
      tableMonarchIdx = null;
    }
    return true;
  }
  return false;
}

function changeTableLife(idx, amount) {
  const p = tablePlayers[idx];
  if (!p) return;

  p.life += amount;
  const koChanged = checkTableSeatLethal(idx);

  if (koChanged) {
    renderTableGrid();
  } else {
    const lifeEl = document.getElementById(`table-life-${idx}`);
    if (lifeEl) {
      lifeEl.textContent = p.life;
      lifeEl.classList.toggle("dead", p.eliminated || p.life <= 0);
    }
  }

  tableDeltaTotals[idx] = (tableDeltaTotals[idx] || 0) + amount;
  const deltaEl = document.getElementById(`table-delta-${idx}`);
  if (deltaEl) {
    const tot = tableDeltaTotals[idx];
    deltaEl.textContent = tot > 0 ? `+${tot}` : `${tot}`;
    deltaEl.className = `seat-delta ${tot >= 0 ? "delta-plus" : "delta-minus"}`;
  }

  clearTimeout(tableDeltaTimers[idx]);
  tableDeltaTimers[idx] = setTimeout(() => {
    tableDeltaTotals[idx] = 0;
    const currentDeltaEl = document.getElementById(`table-delta-${idx}`);
    if (currentDeltaEl) currentDeltaEl.textContent = "";
  }, 1800);
}

// --- PLAYER COMMAND TRAY ---
function openTablePlayerTray(idx) {
  activeTraySeatIdx = idx;
  const faceClass = getSeatOrientationClass(idx);

  if (tableTrayCard) {
    tableTrayCard.classList.remove("face-left", "face-right", "face-top", "face-bottom");
    tableTrayCard.classList.add(faceClass);
  }

  renderTablePlayerTray();
  tablePlayerModal.classList.remove("hidden");
}

function renderTablePlayerTray() {
  if (activeTraySeatIdx === null || !tablePlayers[activeTraySeatIdx]) return;
  const target = tablePlayers[activeTraySeatIdx];
  const isMonarch = tableMonarchIdx === activeTraySeatIdx;

  document.getElementById("trayPlayerTitle").textContent = `${target.name} — Command Tray`;

  const monarchBtn = document.getElementById("trayMonarchBtn");
  monarchBtn.classList.toggle("active", isMonarch);
  document.getElementById("trayMonarchState").textContent = isMonarch ? "ON" : "OFF";

  const elimBtn = document.getElementById("trayEliminatedBtn");
  elimBtn.classList.toggle("active", target.eliminated);
  document.getElementById("trayEliminatedState").textContent = target.eliminated ? "OUT" : "NO";

  const partnerBtn = document.getElementById("trayPartnerToggleBtn");
  partnerBtn.classList.toggle("active", target.hasPartner);
  document.getElementById("trayPartnerState").textContent = target.hasPartner ? "ON" : "OFF";

  document.getElementById("trayVal-poison").textContent = target.poison;
  document.getElementById("trayVal-tax").textContent = `+${target.tax}`;
  document.getElementById("trayVal-energy").textContent = target.energy;
  document.getElementById("trayVal-rad").textContent = target.rad;

  const matrix = document.getElementById("trayCmdrMatrix");
  matrix.innerHTML = "";

  tablePlayers.forEach((sourcePlayer, sourceIdx) => {
    const tile = document.createElement("div");
    const spanClass = tablePlayerCount === 3 && sourceIdx === 2 ? "span-2" : "";

    if (sourceIdx === activeTraySeatIdx) {
      tile.className = `matrix-tile self-tile ${spanClass}`;
      tile.innerHTML = `
        <div class="matrix-tile-header">${target.name} (You)</div>
        <div class="matrix-dmg-big">${target.life} ❤️</div>
      `;
      matrix.appendChild(tile);
      return;
    }

    tile.className = `matrix-tile theme-${sourcePlayer.theme} ${spanClass}`;

    if (sourcePlayer.hasPartner) {
      const dmgA = target.cmdrDamage[sourceIdx] || 0;
      const dmgB = target.cmdrDamage[`${sourceIdx}_partner`] || 0;
      tile.innerHTML = `
        <div class="matrix-tile-header">From ${sourcePlayer.name}</div>
        <div class="matrix-partner-split">
          <div class="matrix-partner-sub">
            <span>Cmdr A</span>
            <div class="matrix-partner-controls">
              <button type="button" class="tray-step-btn" data-key="${sourceIdx}" data-delta="-1">−</button>
              <strong class="${dmgA >= 21 ? "lethal" : ""}">${dmgA}</strong>
              <button type="button" class="tray-step-btn" data-key="${sourceIdx}" data-delta="1">+</button>
            </div>
          </div>
          <div class="matrix-partner-sub">
            <span>Cmdr B</span>
            <div class="matrix-partner-controls">
              <button type="button" class="tray-step-btn" data-key="${sourceIdx}_partner" data-delta="-1">−</button>
              <strong class="${dmgB >= 21 ? "lethal" : ""}">${dmgB}</strong>
              <button type="button" class="tray-step-btn" data-key="${sourceIdx}_partner" data-delta="1">+</button>
            </div>
          </div>
        </div>
      `;

      tile.querySelectorAll(".tray-step-btn").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          adjustTableCmdrDamage(activeTraySeatIdx, btn.dataset.key, parseInt(btn.dataset.delta, 10));
        };
      });
    } else {
      const dmg = target.cmdrDamage[sourceIdx] || 0;
      tile.innerHTML = `
        <button type="button" class="matrix-minus-btn" title="Subtract 1">−</button>
        <div class="matrix-tile-header">From ${sourcePlayer.name}</div>
        <div class="matrix-dmg-big ${dmg >= 21 ? "lethal" : ""}">${dmg}</div>
      `;

      tile.onclick = () => {
        adjustTableCmdrDamage(activeTraySeatIdx, sourceIdx, 1);
      };

      tile.querySelector(".matrix-minus-btn").onclick = (e) => {
        e.stopPropagation();
        adjustTableCmdrDamage(activeTraySeatIdx, sourceIdx, -1);
      };
    }

    matrix.appendChild(tile);
  });
}

function adjustTableCmdrDamage(targetIdx, dmgKey, delta) {
  const target = tablePlayers[targetIdx];
  if (!target) return;

  const current = target.cmdrDamage[dmgKey] || 0;
  const next = Math.max(0, current + delta);
  const actualDelta = next - current;
  if (actualDelta === 0) return;

  triggerHaptic(next >= 21 ? [30, 40, 30] : 14);
  target.cmdrDamage[dmgKey] = next;
  changeTableLife(targetIdx, -actualDelta);
  checkTableSeatLethal(targetIdx);
  renderTableGrid();
  if (!tablePlayerModal.classList.contains("hidden")) {
    renderTablePlayerTray();
  }
}

document.getElementById("trayMonarchBtn").onclick = () => {
  if (activeTraySeatIdx === null) return;
  triggerHaptic(12);
  tableMonarchIdx = tableMonarchIdx === activeTraySeatIdx ? null : activeTraySeatIdx;
  renderTableGrid();
  renderTablePlayerTray();
};

document.getElementById("trayEliminatedBtn").onclick = () => {
  if (activeTraySeatIdx === null) return;
  triggerHaptic(15);
  const p = tablePlayers[activeTraySeatIdx];
  p.eliminated = !p.eliminated;
  if (!p.eliminated && p.life <= 0) {
    p.life = 1;
  }
  if (p.eliminated && tableMonarchIdx === activeTraySeatIdx) {
    tableMonarchIdx = null;
  }
  renderTableGrid();
  renderTablePlayerTray();
};

document.getElementById("trayPartnerToggleBtn").onclick = () => {
  if (activeTraySeatIdx === null) return;
  triggerHaptic(12);
  const p = tablePlayers[activeTraySeatIdx];
  p.hasPartner = !p.hasPartner;
  renderTableGrid();
  renderTablePlayerTray();
};

document.querySelectorAll("#tablePlayerModal .tray-step-btn[data-counter]").forEach((btn) => {
  btn.onclick = () => {
    if (activeTraySeatIdx === null) return;
    triggerHaptic(12);
    const key = btn.dataset.counter;
    const delta = parseInt(btn.dataset.delta, 10);
    const p = tablePlayers[activeTraySeatIdx];
    p[key] = Math.max(0, (p[key] || 0) + delta);
    checkTableSeatLethal(activeTraySeatIdx);
    renderTableGrid();
    renderTablePlayerTray();
  };
});

document.getElementById("closeTableTrayBtn").onclick = () => {
  tablePlayerModal.classList.add("hidden");
};
tablePlayerModal.onclick = (e) => {
  if (e.target === tablePlayerModal) tablePlayerModal.classList.add("hidden");
};

document.getElementById("startTableGameBtn").onclick = initTableMode;

document.getElementById("tableHubBtn").onclick = (e) => {
  e.stopPropagation();
  triggerHaptic(12);
  tableHubMenu.classList.toggle("hidden");
};

document.addEventListener("click", (e) => {
  if (!tableHubMenu.classList.contains("hidden") && !tableHubMenu.contains(e.target)) {
    tableHubMenu.classList.add("hidden");
  }
});

document.getElementById("tableRollFirstBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  const aliveIndices = tablePlayers.map((p, i) => (!p.eliminated ? i : -1)).filter((i) => i !== -1);
  if (aliveIndices.length === 0) return;
  triggerHaptic([15, 30, 15]);
  const winnerIdx = aliveIndices[Math.floor(Math.random() * aliveIndices.length)];
  tablePlayers.forEach((p, idx) => {
    p.isFirst = idx === winnerIdx;
  });
  renderTableGrid();
};

document.getElementById("tableDiceBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  diceModal.classList.remove("hidden");
};

document.getElementById("tableResetBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  triggerHaptic(18);
  tableMonarchIdx = null;
  tablePlayers.forEach((p) => {
    p.life = tableStartingLife;
    p.isFirst = false;
    p.eliminated = false;
    p.poison = 0;
    p.tax = 0;
    p.energy = 0;
    p.rad = 0;
    p.cmdrDamage = {};
  });
  renderTableGrid();
};

document.getElementById("tableSetupAgainBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  tableSetupModal.classList.remove("hidden");
};

document.getElementById("tableExitBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  tableView.classList.add("hidden");
  lobbyTopBar.classList.remove("hidden");
  lobbyView.classList.remove("hidden");
};

// --- REGISTER SERVICE WORKER (AUTO-RELOADS APK ON NEW CACHE VERSION) ---
if ("serviceWorker" in navigator) {
  const isLocalhost =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";

  if (isLocalhost) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((reg) => reg.unregister());
    });
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  } else {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js", { updateViaCache: "none" })
        .then((reg) => reg.update())
        .catch(() => {});
    });
  }
}

function updateNetworkBanner() {
  if (offlineBanner) {
    offlineBanner.classList.toggle("hidden", navigator.onLine);
  }
}
window.addEventListener("online", updateNetworkBanner);
window.addEventListener("offline", updateNetworkBanner);
updateNetworkBanner();