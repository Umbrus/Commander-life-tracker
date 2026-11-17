import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, set, get, push, update, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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
const ACTIVE_DECK_KEY = "mtg_active_deck_id";
const LOCAL_DECKS_KEY = "mtg_local_deck_locker";
const LOCAL_MATCHES_KEY = "mtg_local_match_history";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

let currentUser = null;
let userDecks = {};
let userMatches = [];
let activeDeckId = localStorage.getItem(ACTIVE_DECK_KEY) || "";
let currentDetailDeckId = null;

function triggerHaptic(pattern) {
  if ("vibrate" in navigator) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

// Hamburger Menu
const pageDropdownMenu = document.getElementById("pageDropdownMenu");
document.getElementById("pageMenuBtn").onclick = (e) => {
  e.stopPropagation();
  pageDropdownMenu.classList.toggle("hidden");
};
document.addEventListener("click", (e) => {
  if (!pageDropdownMenu.classList.contains("hidden") && !pageDropdownMenu.contains(e.target)) {
    pageDropdownMenu.classList.add("hidden");
  }
});

// Storage Helpers
function loadLocalData() {
  try {
    userDecks = JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}");
    userMatches = JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) || "[]");
  } catch {
    userDecks = {};
    userMatches = [];
  }
}

function saveLocalData() {
  localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(userDecks));
  localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(userMatches));
}

loadLocalData();
renderDeckLocker();

function updateDeckPageAuthUI(user) {
  const labelEl = document.getElementById("profileSyncLabel");
  const subEl = document.getElementById("accountEmailSub");
  const authBtn = document.getElementById("googleAuthBtn");
  if (!labelEl || !subEl || !authBtn) return;

  if (user && !user.isAnonymous) {
    labelEl.textContent = `☁️ ${user.displayName || "Google Account"}`;
    subEl.textContent = user.email || "Cloud backup active";
    authBtn.textContent = "🚪 Sign Out of Google";
  } else {
    labelEl.textContent = "☁️ Profile Sync: Device ID";
    subEl.textContent = "Sign in to back up decks across devices";
    authBtn.textContent = "🔐 Sign in with Google";
  }
}

const deckPageAuthBtn = document.getElementById("googleAuthBtn");
if (deckPageAuthBtn) {
  deckPageAuthBtn.onclick = async () => {
    pageDropdownMenu.classList.add("hidden");
    if (!auth.currentUser) return;

    if (!auth.currentUser.isAnonymous) {
      await signOut(auth);
      await signInAnonymously(auth);
      return;
    }

    const previousAnonUid = auth.currentUser.uid;
    try {
      const result = await linkWithPopup(auth.currentUser, googleProvider);
      currentUser = result.user;
      updateDeckPageAuthUI(currentUser);
      if (Object.keys(userDecks).length > 0) {
        await update(ref(db, `users/${currentUser.uid}/decks`), userDecks).catch(() => {});
      }
      alert(`Signed in as ${currentUser.displayName || currentUser.email}! Your decks are now backed up.`);
    } catch (err) {
      if (err.code === "auth/credential-already-in-use" || err.code === "auth/email-already-in-use") {
        try {
          const oldSnap = await get(ref(db, `users/${previousAnonUid}`));
          const oldData = oldSnap.exists() ? oldSnap.val() : null;

          const res = await signInWithPopup(auth, googleProvider);
          currentUser = res.user;
          if (oldData?.decks) {
            userDecks = { ...oldData.decks, ...userDecks };
          }
          updateDeckPageAuthUI(currentUser);
        } catch (innerErr) {
          alert(`Google Sign-In failed: ${innerErr.message}`);
        }
      } else if (err.code !== "auth/popup-closed-by-user") {
        alert(`Google Sign-In error: ${err.message}`);
      }
    }
  };
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch {
      document.getElementById("profileSyncLabel").textContent = "☁️ Profile Sync: Offline";
    }
    return;
  }

  currentUser = user;
  updateDeckPageAuthUI(user);

  try {
    const snap = await get(ref(db, `users/${currentUser.uid}/decks`));
    if (snap.exists()) {
      userDecks = { ...userDecks, ...snap.val() };
      saveLocalData();
      renderDeckLocker();
    }
    if (Object.keys(userDecks).length > 0) {
      await update(ref(db, `users/${currentUser.uid}/decks`), userDecks).catch(() => {});
    }
  } catch {}
});

// Scryfall Card & Secret Lair / Alternate Printings Lookup
async function fetchScryfallCard(cardName) {
  if (!cardName) return null;
  const cleanName = cardName.replace(/\s*\([^)]+\)\s*$/, "").trim();
  try {
    const exactRes = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${cleanName}" include:extras`)}&unique:prints`
    );
    if (exactRes.ok) {
      const searchData = await exactRes.json();
      if (searchData.data && searchData.data.length > 0) {
        const card = searchData.data[0];
        const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
        return {
          exactName: card.flavor_name ? `${card.flavor_name} (${card.name})` : card.name,
          oracleName: card.name,
          artCrop: imgUris.art_crop || imgUris.normal || "",
          normalImg: imgUris.normal || ""
        };
      }
    }

    const fuzzyRes = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`);
    if (!fuzzyRes.ok) return null;
    const card = await fuzzyRes.json();
    const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
    return {
      exactName: card.flavor_name ? `${card.flavor_name} (${card.name})` : card.name,
      oracleName: card.name,
      artCrop: imgUris.art_crop || imgUris.normal || "",
      normalImg: imgUris.normal || ""
    };
  } catch {
    return null;
  }
}

async function fetchScryfallAllPrintings(queryName) {
  const cleanName = (queryName || "").replace(/\s*\([^)]+\)\s*$/, "").trim();
  if (!cleanName) return [];

  try {
    let oracleId = null;

    const exactLookup = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${cleanName}" include:extras`)}`
    );
    if (exactLookup.ok) {
      const exactJson = await exactLookup.json();
      oracleId = exactJson.data?.[0]?.oracle_id || null;
    }

    if (!oracleId) {
      const fuzzyLookup = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`);
      if (fuzzyLookup.ok) {
        const fuzzyJson = await fuzzyLookup.json();
        oracleId = fuzzyJson.oracle_id || null;
      }
    }

    const searchQuery = oracleId
      ? `oracleid:${oracleId} include:extras`
      : `${cleanName} include:extras`;

    const printsRes = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(searchQuery)}&unique:prints&order=released&dir=desc`
    );
    if (!printsRes.ok) return [];
    const printsData = await printsRes.json();

    return (printsData.data || [])
      .map((card) => {
        const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
        const label = card.flavor_name
          ? `${card.flavor_name} (${card.set.toUpperCase()})`
          : `${card.set_name} (${card.set.toUpperCase()})`;
        return {
          label,
          flavorName: card.flavor_name || "",
          oracleName: card.name,
          artCrop: imgUris.art_crop || imgUris.normal || "",
          normalImg: imgUris.normal || ""
        };
      })
      .filter((p) => p.artCrop);
  } catch {
    return [];
  }
}

// Render Main Deck Locker Grid
function renderDeckLocker() {
  const list = document.getElementById("deckLockerList");
  const decks = Object.values(userDecks).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (decks.length === 0) {
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
  decks.forEach((deck) => {
    const isPiloting = deck.id === activeDeckId;
    const totalCards = (deck.cards || []).reduce((sum, c) => sum + (c.qty || 1), 0);
    const cardEl = document.createElement("div");
    cardEl.className = `deck-card-item ${isPiloting ? "is-piloting" : ""}`;

    const thumbHtml = deck.artCrop
      ? `<img src="${deck.artCrop}" alt="${deck.commander}" class="deck-thumb" />`
      : `<div class="deck-thumb-placeholder">⚔️</div>`;

    const cmdrText = deck.partner ? `${deck.commander} + ${deck.partner}` : deck.commander;

    cardEl.innerHTML = `
      ${thumbHtml}
      <div class="deck-card-info">
        <div class="deck-card-title-row">
          <div class="deck-card-title">${deck.name}</div>
          ${isPiloting ? `<span class="piloting-badge">PILOTING</span>` : ""}
        </div>
        <div class="deck-card-cmdr">${cmdrText}</div>
        <div class="deck-card-meta">
          <span>🏆 ${deck.wins || 0}W - ${deck.losses || 0}L</span>
          ${totalCards > 0 ? `<span>• ${totalCards} Cards</span>` : ""}
        </div>
      </div>
    `;

    cardEl.onclick = () => openDeckDetail(deck.id);
    list.appendChild(cardEl);
  });
}

// Open Full-Page Deck Detail & Art Customizer
function openDeckDetail(deckId) {
  const deck = userDecks[deckId];
  if (!deck) return;
  currentDetailDeckId = deckId;

  document.getElementById("lockerMainSection").classList.add("hidden");
  document.getElementById("deckDetailSection").classList.remove("hidden");
  document.getElementById("dedicatedArtPicker").classList.add("hidden");
  document.getElementById("cardHoverPreview").classList.add("hidden");

  document.getElementById("detailDeckTitle").textContent = deck.name;
  document.getElementById("detailCmdrName").textContent = deck.partner
    ? `${deck.commander} & ${deck.partner}`
    : deck.commander;

  const totalCards = (deck.cards || []).reduce((sum, c) => sum + (c.qty || 1), 0);
  document.getElementById("detailCardCount").textContent = `${totalCards} Cards • ${deck.wins || 0}W - ${deck.losses || 0}L`;

  const imgEl = document.getElementById("detailCmdrImg");
  if (deck.artCrop) {
    imgEl.src = deck.artCrop;
    imgEl.classList.remove("hidden");
  } else {
    imgEl.classList.add("hidden");
  }

  const extLink = document.getElementById("detailExternalLink");
  if (deck.url) {
    extLink.href = deck.url;
    extLink.classList.remove("hidden");
  } else {
    extLink.classList.add("hidden");
  }

  const pilotBtn = document.getElementById("detailPilotBtn");
  pilotBtn.textContent = activeDeckId === deckId ? "✓ Active Deck" : "⚔️ Pilot Deck";
  pilotBtn.onclick = () => {
    triggerHaptic(12);
    activeDeckId = deckId;
    localStorage.setItem(ACTIVE_DECK_KEY, deckId);
    pilotBtn.textContent = "✓ Active Deck";
    renderDeckLocker();
  };

  // Render 100-Card Decklist
  const listEl = document.getElementById("detailCardsList");
  listEl.innerHTML = "";
  if (!deck.cards || deck.cards.length === 0) {
    listEl.innerHTML = `<div class="empty-hint" style="padding:18px 8px;">No full card list imported for this deck yet.</div>`;
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
      const count = cardsArr.reduce((s, c) => s + (c.qty || 1), 0);
      header.textContent = `${cat} (${count})`;
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
          const previewBox = document.getElementById("cardHoverPreview");
          const titleEl = document.getElementById("previewCardTitle");
          const previewImg = document.getElementById("previewCardImg");
          titleEl.textContent = `Loading ${c.name}...`;
          previewImg.src = "";
          previewBox.classList.remove("hidden");
          previewBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

          const info = await fetchScryfallCard(c.name);
          if (info?.normalImg) {
            titleEl.textContent = info.exactName;
            previewImg.src = info.normalImg;
          } else {
            titleEl.textContent = `${c.name} (Art unavailable)`;
          }
        };
        listEl.appendChild(line);
      });
    });
  }
}

document.getElementById("backToLockerBtn").onclick = () => {
  document.getElementById("deckDetailSection").classList.add("hidden");
  document.getElementById("lockerMainSection").classList.remove("hidden");
  renderDeckLocker();
};

document.getElementById("closeCardPreviewBtn").onclick = () => {
  document.getElementById("cardHoverPreview").classList.add("hidden");
};

// Dedicated Art & Secret Lair Reskin Picker Logic
async function runArtSearch(searchQuery) {
  const deck = userDecks[currentDetailDeckId];
  if (!deck) return;

  const heading = document.getElementById("artPickerHeading");
  const grid = document.getElementById("artPickerGrid");

  heading.textContent = "Searching Scryfall...";
  grid.innerHTML = `<div class="empty-hint" style="grid-column:1 / span 3;">Loading printings &amp; Secret Lairs...</div>`;

  const prints = await fetchScryfallAllPrintings(searchQuery);

  if (prints.length === 0) {
    heading.textContent = "No Prints Found — Try Another Name";
    grid.innerHTML = `<div class="empty-hint" style="grid-column:1 / span 3;">Type your Commander or Secret Lair name above (e.g. "Miku, Font of Song" or "Trostani, Selesnya's Voice") and tap Search.</div>`;
    return;
  }

  heading.textContent = `Choose Art (${prints.length} Printings)`;
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
      deck.oracleCommander = print.oracleName;
      deck.commander = print.flavorName
        ? `${print.flavorName} (${print.oracleName})`
        : print.oracleName;

      saveLocalData();
      if (currentUser) {
        await update(ref(db, `users/${currentUser.uid}/decks/${deck.id}`), {
          artCrop: deck.artCrop,
          normalImg: deck.normalImg,
          commander: deck.commander,
          oracleCommander: deck.oracleCommander
        }).catch(() => {});
      }
      openDeckDetail(deck.id);
    };
    grid.appendChild(btn);
  });
}

document.getElementById("detailToggleArtBtn").onclick = () => {
  triggerHaptic(12);
  const picker = document.getElementById("dedicatedArtPicker");
  const isOpening = picker.classList.contains("hidden");
  picker.classList.toggle("hidden", !isOpening);

  if (isOpening && currentDetailDeckId && userDecks[currentDetailDeckId]) {
    const deck = userDecks[currentDetailDeckId];
    const initialQuery = (deck.oracleCommander || deck.commander || "").replace(/\s*\([^)]+\)\s*$/, "").trim();
    document.getElementById("artSearchInput").value = initialQuery === "Unknown Commander" ? "" : initialQuery;
    if (initialQuery && initialQuery !== "Unknown Commander") {
      runArtSearch(initialQuery);
    }
  }
};

document.getElementById("artSearchBtn").onclick = () => {
  const val = document.getElementById("artSearchInput").value.trim();
  if (val) runArtSearch(val);
};

document.getElementById("closeArtPickerBtn").onclick = () => {
  document.getElementById("dedicatedArtPicker").classList.add("hidden");
};

// Manual Win / Loss & Delete Deck
function logOutcome(outcome) {
  const deck = userDecks[currentDetailDeckId];
  if (!deck) return;
  triggerHaptic(12);

  if (outcome === "win") deck.wins = (deck.wins || 0) + 1;
  else deck.losses = (deck.losses || 0) + 1;

  const entry = {
    deckId: deck.id,
    deckName: deck.name,
    commander: deck.commander,
    outcome,
    podLabel: "Manual Log",
    at: Date.now()
  };
  userMatches.unshift(entry);
  saveLocalData();

  if (currentUser) {
    update(ref(db, `users/${currentUser.uid}/decks/${deck.id}`), {
      wins: deck.wins,
      losses: deck.losses
    }).catch(() => {});
    push(ref(db, `users/${currentUser.uid}/matches`), entry).catch(() => {});
  }
  openDeckDetail(deck.id);
}

document.getElementById("detailLogWinBtn").onclick = () => logOutcome("win");
document.getElementById("detailLogLossBtn").onclick = () => logOutcome("loss");

document.getElementById("detailDeleteDeckBtn").onclick = async () => {
  const deck = userDecks[currentDetailDeckId];
  if (!deck) return;
  if (!confirm(`Delete "${deck.name}" from your Deck Locker?`)) return;

  const delId = deck.id;
  delete userDecks[delId];
  if (activeDeckId === delId) {
    activeDeckId = "";
    localStorage.removeItem(ACTIVE_DECK_KEY);
  }
  saveLocalData();
  if (currentUser) {
    await remove(ref(db, `users/${currentUser.uid}/decks/${delId}`)).catch(() => {});
  }
  document.getElementById("deckDetailSection").classList.add("hidden");
  document.getElementById("lockerMainSection").classList.remove("hidden");
  renderDeckLocker();
};

// Add / Fetch Deck Modal
const addDeckModal = document.getElementById("addDeckModal");
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
      cards.push({ qty: parseInt(match[1], 10), name: match[2].trim(), category: currentSection });
    } else if (trimmed.length > 1 && !trimmed.startsWith("//")) {
      cards.push({ qty: 1, name: trimmed, category: currentSection });
    }
  });
  return cards;
}

async function fetchViaWorker(targetUrl) {
  try {
    const res = await fetch(`${DECK_PROXY_WORKER}/?url=${encodeURIComponent(targetUrl)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && !data.error ? data : null;
  } catch {
    return null;
  }
}

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
    statusEl.textContent = "⏳ Importing deck from Archidekt...";
    const data = await fetchViaWorker(`https://archidekt.com/api/decks/${archidektMatch[1]}/`);
    if (data && Array.isArray(data.cards)) {
      if (data.name) document.getElementById("deckNameInput").value = data.name;
      const commanders = [];
      const textLines = [];
      data.cards.forEach((entry) => {
        const cardName = entry.card?.oracleCard?.name || entry.card?.name;
        const qty = entry.quantity || 1;
        const cats = entry.categories || [];
        if (!cardName) return;
        if (cats.some((c) => c.toLowerCase() === "commander")) commanders.push(cardName);
        textLines.push(`${qty} ${cardName}`);
      });
      if (commanders[0]) document.getElementById("deckCommanderInput").value = commanders[0];
      if (commanders[1]) document.getElementById("deckPartnerInput").value = commanders[1];
      document.getElementById("deckListTextarea").value = textLines.join("\n");
      statusEl.textContent = `✅ Imported "${data.name || "Deck"}" (${textLines.length} unique cards)!`;
    } else {
      statusEl.textContent = "⚠️ Could not auto-fetch (make sure deck & folder are Public), or paste text below.";
    }
  } else if (moxfieldMatch) {
    statusEl.textContent = "⏳ Importing deck from Moxfield...";
    const data = await fetchViaWorker(`https://api2.moxfield.com/v2/decks/all/${moxfieldMatch[1]}`);
    if (data && data.mainboard) {
      if (data.name) document.getElementById("deckNameInput").value = data.name;
      const cmdrNames = Object.keys(data.commanders || {});
      if (cmdrNames[0]) document.getElementById("deckCommanderInput").value = cmdrNames[0];
      if (cmdrNames[1]) document.getElementById("deckPartnerInput").value = cmdrNames[1];
      const textLines = [];
      cmdrNames.forEach((cName) => textLines.push(`${data.commanders[cName]?.quantity || 1} ${cName}`));
      Object.entries(data.mainboard).forEach(([cName, info]) => textLines.push(`${info.quantity || 1} ${cName}`));
      document.getElementById("deckListTextarea").value = textLines.join("\n");
      statusEl.textContent = `✅ Imported "${data.name || "Moxfield Deck"}" (${textLines.length} unique cards)!`;
    } else {
      statusEl.textContent = "🔗 Moxfield link attached! Paste exported text list below if blocked.";
    }
  } else {
    statusEl.textContent = "Link saved! Fill in your Deck Name, Commander, and optional 100-card list below.";
  }
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

  const scryfallData = await fetchScryfallCard(commanderInput);
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

  saveLocalData();
  if (currentUser) {
    await set(ref(db, `users/${currentUser.uid}/decks/${deckId}`), newDeck).catch(() => {});
  }

  saveBtn.disabled = false;
  saveBtn.textContent = "💾 Save to Deck Locker";
  addDeckModal.classList.add("hidden");
  renderDeckLocker();
};