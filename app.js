import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
  query,
  orderByChild,
  endAt
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCh_fJv3mMlQQ2teHyryAxtd0x_mCmMzTU",
  authDomain: "commander-life-tracker-6938f.firebaseapp.com",
  databaseURL: "https://commander-life-tracker-6938f-default-rtdb.firebaseio.com",
  projectId: "commander-life-tracker-6938f",
  storageBucket: "commander-life-tracker-6938f.firebasestorage.app",
  messagingSenderId: "989326008841",
  appId: "1:989326008841:web:13b9a36110891cebcf0ed8"
};

const SESSION_KEY = "mtg_active_pod_session";
const SAVED_NAME_KEY = "mtg_saved_player_name";
const THEME_PREF_KEY = "mtg_preferred_theme";
const ACTIVE_DECK_KEY = "mtg_active_deck_id";
const LOCAL_DECKS_KEY = "mtg_local_deck_locker";
const LOCAL_MATCHES_KEY = "mtg_local_match_history";
const FOIL_FRAME_KEY = "mtg_supporter_foil_frame";
const SUPPORTER_KEY = "mtg_is_supporter";
const POWER_SAVER_KEY = "mtg_power_saver_enabled";
const POWER_SAVER_TIMEOUT_KEY = "mtg_power_saver_timeout";
const APP_PALETTE_KEY = "mtg_app_palette";
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const STANDARD_THEMES = ["blue", "red", "green", "gold", "purple", "slate"];
const VALID_THEMES = ["blue", "red", "green", "gold", "purple", "slate", "aether", "phyrexian", "ivory", "fracture"];
const FREE_APP_PALETTES = ["crimson", "rare", "uncommon", "common"];

const EXTRA_COUNTER_META = {
  energy: { label: "Energy", iconClass: "cs-icon-energy" },
  experience: { label: "Experience", iconClass: "cs-icon-experience" },
  storm: { label: "Storm", iconClass: "cs-icon-storm" },
  rad: { label: "Rad", iconClass: "cs-icon-rad" }
};

const MANA_COLORS = [
  { key: "W", label: "W", title: "White" },
  { key: "U", label: "U", title: "Blue" },
  { key: "B", label: "B", title: "Black" },
  { key: "R", label: "R", title: "Red" },
  { key: "G", label: "G", title: "Green" },
  { key: "C", label: "C", title: "Colorless" }
];

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const lobbyTopBar = document.getElementById("lobbyTopBar");
const lobbyView = document.getElementById("lobbyView");
const lobbyForm = document.getElementById("lobbyForm");
const podView = document.getElementById("podView");
const mainBottomNav = document.getElementById("mainBottomNav");
const roomCodeInput = document.getElementById("roomCodeInput");
const playerNameInput = document.getElementById("playerNameInput");
const dropdownMenu = document.getElementById("podDropdownMenu");
const historyModal = document.getElementById("historyModal");
const diceModal = document.getElementById("diceModal");
const extraCountersModal = document.getElementById("extraCountersModal");
const howItWorksModal = document.getElementById("howItWorksModal");
document.getElementById("openGuideBtn").onclick = () => howItWorksModal.classList.remove("hidden");
document.getElementById("closeHowItWorksBtn").onclick = () => howItWorksModal.classList.add("hidden");
document.getElementById("gotItBtn").onclick = () => howItWorksModal.classList.add("hidden");
howItWorksModal.onclick = (e) => {
  if (e.target === howItWorksModal) howItWorksModal.classList.add("hidden");
};
const newGameModal = document.getElementById("newGameModal");
const oracleLookupModal = document.getElementById("oracleLookupModal");
const deckSelectModal = document.getElementById("deckSelectModal");
const offlineBanner = document.getElementById("offlineBanner");

const undoToast = document.getElementById("undoToast");
const undoToastMsg = document.getElementById("undoToastMsg");
const undoToastBtn = document.getElementById("undoToastBtn");

let currentUser = null;
let currentPodCode = null;
let latestPodData = null;
let inspectedOpponentUid = null;
let pendingPodLaunch = null;
let authReadyResolve = null;
const authReadyPromise = new Promise((resolve) => {
  authReadyResolve = resolve;
});
let authReady = false;
let authErrorMessage = "";

let selectedLobbyStartingLife = 40;
let isCustomLobbyLifeSelected = false;
let customLobbyStartingLife = null;
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
let myShowManaPool = false;
let myManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

let userDecks = {};
let userMatches = [];
let activeDeckId = localStorage.getItem(ACTIVE_DECK_KEY) || "";
let lastRecordedPodMatchKey = "";
let activeGameMatchRecord = null;
let previousActiveTurnUid = null;

let deltaAccumulator = 0;
let deltaClearTimer = null;
let wakeLock = null;
let undoTimer = null;
let pendingUndoCallback = null;
let powerDimTimer = null;
let powerScreenDimmed = false;

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
// FLOATING UNDO TOAST HELPER
// =========================================================
function showUndoToast(message, undoCallback, durationMs = 6000) {
  if (!undoToast || !undoToastMsg || !undoToastBtn) return;
  undoToastMsg.textContent = message;
  pendingUndoCallback = undoCallback;
  undoToast.classList.remove("hidden");

  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoToast.classList.add("hidden");
    pendingUndoCallback = null;
  }, durationMs);
}

if (undoToastBtn) {
  undoToastBtn.onclick = async () => {
    clearTimeout(undoTimer);
    undoToast.classList.add("hidden");
    if (typeof pendingUndoCallback === "function") {
      const fn = pendingUndoCallback;
      pendingUndoCallback = null;
      triggerHaptic(15);
      await fn();
    }
  };
}

// =========================================================
// COMMANDER ART BACKDROP & SUPPORTER FOIL FRAME
// =========================================================
function applyHeroCommanderBackdrop(artUrl) {
  const backdrop = document.getElementById("heroArtBackdrop");
  if (!backdrop) return;
  if (artUrl) {
    backdrop.style.backgroundImage = `url("${artUrl}")`;
  } else {
    backdrop.style.backgroundImage = "none";
  }
}

function applySupporterFoilFrame() {
  const hero = document.getElementById("heroTracker");
  const isSupporter = localStorage.getItem(SUPPORTER_KEY) === "true";
  const isFoil = isSupporter && localStorage.getItem(FOIL_FRAME_KEY) === "true";
  if (hero) hero.classList.toggle("supporter-foil", isFoil);
  document.querySelectorAll(".table-seat").forEach((seat) => {
    seat.classList.toggle("supporter-foil", isFoil);
  });
}

// =========================================================
// VISUAL DECK PICKER MODAL & MATCH RECORDING
// =========================================================
function loadLocalUserProfile() {
  try {
    userDecks = JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}");
    userMatches = JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) || "[]");
  } catch {
    userDecks = {};
    userMatches = [];
  }
  if (activeDeckId && !userDecks[activeDeckId]) {
    activeDeckId = "";
    localStorage.removeItem(ACTIVE_DECK_KEY);
  }
}

function saveLocalUserProfile() {
  localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(userDecks));
  localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(userMatches));
}

async function waitForAuthenticatedUser() {
  if (currentUser) return true;

  try {
    await Promise.race([
      authReadyPromise,
      new Promise((resolve) => setTimeout(resolve, 15000))
    ]);
  } catch {}

  if (currentUser) return true;
  setPodJoinStatus(authErrorMessage || "Could not connect to the pod network. Check your connection and try again.", true);
  return false;
}

function setPodJoinStatus(message, isError = false) {
  statusText.textContent = message;
  statusBox.className = `conn-pill ${isError ? "err" : "ok"}`;
  lobbyForm.classList.remove("hidden");
  const joinBtn = document.getElementById("joinPodBtn");
  joinBtn.disabled = false;
  joinBtn.textContent = "Join Pod";
}

async function launchPodWithDeckSelection(code, isNew) {
  if (!await waitForAuthenticatedUser()) return false;

  const deckList = Object.values(userDecks).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (deckList.length === 0 || !deckSelectModal) {
    return enterPod(code, isNew);
  }

  pendingPodLaunch = { code, isNew };
  const joinBtn = document.getElementById("joinPodBtn");
  if (!isNew && joinBtn) {
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Pod";
  }
  const grid = document.getElementById("visualDeckPickerGrid");
  grid.innerHTML = "";

  deckList.forEach((deck) => {
    const isSelected = deck.id === activeDeckId;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `visual-deck-card ${isSelected ? "selected" : ""}`;

    const artHtml = deck.artCrop
      ? `<img src="${deck.artCrop}" alt="${deck.commander}" class="visual-deck-art" />`
      : `<div class="visual-deck-art-fallback"><span class="cs-icon cs-icon-decks"></span></div>`;

    card.innerHTML = `
      ${artHtml}
      <div class="visual-deck-meta">
        <div class="visual-deck-name">${deck.name}</div>
        <div class="visual-deck-cmdr">${deck.commander || "Commander"}</div>
        <div class="visual-deck-rec">${deck.wins || 0}W - ${deck.losses || 0}L</div>
      </div>
    `;

    card.onclick = () => {
      triggerHaptic(14);
      activeDeckId = deck.id;
      localStorage.setItem(ACTIVE_DECK_KEY, deck.id);
      deckSelectModal.classList.add("hidden");
      const launch = pendingPodLaunch;
      pendingPodLaunch = null;
      if (launch) enterPod(launch.code, launch.isNew);
    };
    grid.appendChild(card);
  });

  const casualBtn = document.createElement("button");
  casualBtn.type = "button";
  casualBtn.className = `visual-deck-card casual-card ${!activeDeckId ? "selected" : ""}`;
  casualBtn.innerHTML = `
    <div class="visual-deck-art-fallback"><span class="cs-icon cs-icon-play"></span></div>
    <div class="visual-deck-meta">
      <div class="visual-deck-name">Casual / No Deck</div>
      <div class="visual-deck-cmdr">Play without logging deck stats</div>
    </div>
  `;
  casualBtn.onclick = () => {
    triggerHaptic(12);
    activeDeckId = "";
    localStorage.removeItem(ACTIVE_DECK_KEY);
    deckSelectModal.classList.add("hidden");
    const launch = pendingPodLaunch;
    pendingPodLaunch = null;
    if (launch) enterPod(launch.code, launch.isNew);
  };
  grid.appendChild(casualBtn);

  deckSelectModal.classList.remove("hidden");
}

if (document.getElementById("closeDeckSelectModalBtn")) {
  document.getElementById("closeDeckSelectModalBtn").onclick = () => {
    deckSelectModal.classList.add("hidden");
    pendingPodLaunch = null;
  };
}
if (deckSelectModal) {
  deckSelectModal.onclick = (e) => {
    if (e.target === deckSelectModal) {
      deckSelectModal.classList.add("hidden");
      pendingPodLaunch = null;
    }
  };
}

function detectWinCondition(podData) {
  const players = podData?.players || {};
  const otherPlayers = Object.entries(players).filter(([uid]) => uid !== currentUser?.uid);
  if (otherPlayers.length === 0) return "Combat / Life";

  const allPoisoned = otherPlayers.every(([, p]) => (p.poison || 0) >= 10);
  if (allPoisoned) return "Poison / Infect";

  const anyCmdrKill = otherPlayers.some(([, p]) => {
    const dmg = p.commanderDamage || {};
    return (dmg[currentUser.uid] || 0) >= 21 || (dmg[`${currentUser.uid}_partner`] || 0) >= 21;
  });
  if (anyCmdrKill) return "Commander Damage";

  return "Combat / Life";
}

function countMyCommanderKills(podData) {
  const players = podData?.players || {};
  let kills = 0;
  Object.entries(players).forEach(([uid, p]) => {
    if (uid === currentUser?.uid) return;
    const dmg = p.commanderDamage || {};
    if ((dmg[currentUser.uid] || 0) >= 21 || (dmg[`${currentUser.uid}_partner`] || 0) >= 21) {
      kills++;
    }
  });
  return kills;
}

function buildPodMatchMeta(podData, outcome, myExitTurn, gameEndTurn) {
  const players = podData?.players || {};
  const orderedUids = getOrderedPlayerUids(podData);
  const opponents = orderedUids
    .filter((uid) => uid !== currentUser?.uid)
    .map((uid) => {
      const opp = players[uid] || {};
      return opp.commander || opp.deckName || opp.name || "Opponent";
    });

  return {
    opponents,
    podSize: orderedUids.length || 4,
    wentFirst: Boolean(podData?.firstPlayerUid && podData.firstPlayerUid === currentUser?.uid),
    winCondition: outcome === "win" ? detectWinCondition(podData) : null,
    commanderKills: countMyCommanderKills(podData),
    myExitTurn: myExitTurn || null,
    gameEndTurn: gameEndTurn || null
  };
}

function recordDeckMatchOutcome(deckId, outcome, podLabel = "", turns = null, extraMeta = {}) {
  const deck = userDecks[deckId];
  if (!deck) return null;

  if (outcome === "win") {
    deck.wins = (deck.wins || 0) + 1;
  } else {
    deck.losses = (deck.losses || 0) + 1;
  }

  const now = Date.now();
  const exitTurn = extraMeta.myExitTurn || turns || null;
  const endTurn = extraMeta.gameEndTurn || turns || null;

  const matchEntry = {
    id: `m_${now}`,
    deckId,
    deckName: deck.name,
    commander: deck.commander,
    outcome,
    turns: endTurn || exitTurn || null,
    myExitTurn: exitTurn,
    gameEndTurn: endTurn,
    opponents: Array.isArray(extraMeta.opponents) ? extraMeta.opponents : [],
    podSize: extraMeta.podSize || null,
    wentFirst: typeof extraMeta.wentFirst === "boolean" ? extraMeta.wentFirst : null,
    winCondition: extraMeta.winCondition || null,
    commanderKills: extraMeta.commanderKills || 0,
    podLabel,
    dateStr: new Date(now).toISOString().slice(0, 10),
    at: now
  };
  userMatches.unshift(matchEntry);
  if (userMatches.length > 100) userMatches.pop();

  saveLocalUserProfile();

  if (currentUser) {
    update(ref(db, `users/${currentUser.uid}/decks/${deckId}`), {
      wins: deck.wins,
      losses: deck.losses
    }).catch(() => {});
    const newMatchRef = push(ref(db, `users/${currentUser.uid}/matches`));
    matchEntry.firebaseKey = newMatchRef.key;
    set(newMatchRef, matchEntry).catch(() => {});
  }

  return matchEntry;
}

function patchMatchGameEndTurn(matchEntry, finalPodTurn) {
  if (!matchEntry || !finalPodTurn) return;
  if (matchEntry.gameEndTurn === finalPodTurn) return;

  matchEntry.gameEndTurn = finalPodTurn;
  matchEntry.turns = finalPodTurn;
  saveLocalUserProfile();

  if (currentUser && matchEntry.firebaseKey) {
    update(ref(db, `users/${currentUser.uid}/matches/${matchEntry.firebaseKey}`), {
      gameEndTurn: finalPodTurn,
      turns: finalPodTurn
    }).catch(() => {});
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

// --- STARTING LIFE PRESET SELECTORS ---
document.querySelectorAll("#lobbyLifeSelector .preset-btn").forEach((btn) => {
  btn.onclick = () => {
    isCustomLobbyLifeSelected = btn.dataset.life === "custom";
    if (!isCustomLobbyLifeSelected) {
      selectedLobbyStartingLife = parseInt(btn.dataset.life, 10);
    }
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

// =========================================================
// IN-POD SCRYFALL ORACLE & RULINGS LOOKUP
// =========================================================
async function lookupOracleCard(queryStr) {
  const resultsEl = document.getElementById("podOracleResults");
  if (!resultsEl) return;
  const trimmed = (queryStr || "").trim();
  if (!trimmed) {
    resultsEl.innerHTML = `<div class="empty-hint">Type a card name above to view Oracle text &amp; rulings.</div>`;
    return;
  }

  resultsEl.innerHTML = `<div class="empty-hint">Searching Scryfall Oracle database...</div>`;

  try {
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(trimmed)}`);
    if (!res.ok) {
      resultsEl.innerHTML = `<div class="empty-hint">No exact card found for "${trimmed}". Check spelling and try again.</div>`;
      return;
    }
    const card = await res.json();
    const imgUris = card.image_uris || card.card_faces?.[0]?.image_uris || {};
    const oracleText = card.oracle_text ||
      (card.card_faces ? card.card_faces.map((f) => `${f.name}: ${f.oracle_text}`).join("\n\n") : "No Oracle text.");

    let rulingsHtml = `<div class="empty-hint" style="padding:4px 0;">Loading official rulings...</div>`;

    const renderCardBox = (rulingsSection) => {
      resultsEl.innerHTML = `
        <div class="oracle-card-result">
          <div class="oracle-card-header">
            ${imgUris.normal ? `<img src="${imgUris.normal}" alt="${card.name}" class="oracle-card-thumb" />` : ""}
            <div class="oracle-card-meta">
              <div class="oracle-card-name">${card.name}</div>
              <div class="oracle-card-cost">${card.mana_cost || ""} • ${card.type_line || ""}</div>
              <div class="oracle-card-legality">Commander: <strong>${(card.legalities?.commander || "unknown").toUpperCase()}</strong></div>
            </div>
          </div>
          <div class="oracle-text-box">${oracleText.replace(/\n/g, "<br/>")}</div>
          <div class="oracle-rulings-section">${rulingsSection}</div>
        </div>
      `;
    };

    renderCardBox(rulingsHtml);

    if (card.rulings_uri) {
      const rRes = await fetch(card.rulings_uri);
      if (rRes.ok) {
        const rData = await rRes.json();
        const rulings = rData.data || [];
        if (rulings.length === 0) {
          rulingsHtml = `<div class="oracle-ruling-empty">No special Gatherer/Scryfall rulings on file.</div>`;
        } else {
          rulingsHtml = `<div class="oracle-ruling-heading">Official Rulings (${rulings.length})</div>` +
            rulings.slice(0, 8).map((r) => `
              <div class="oracle-ruling-item">
                <span class="oracle-ruling-date">${r.published_at}</span>
                <span>${r.comment}</span>
              </div>
            `).join("");
        }
        renderCardBox(rulingsHtml);
      }
    }
  } catch {
    resultsEl.innerHTML = `<div class="empty-hint">Unable to reach Scryfall while offline.</div>`;
  }
}

const openOracleBtn = document.getElementById("openOracleLookupBtn");
if (openOracleBtn && oracleLookupModal) {
  openOracleBtn.onclick = () => {
    dropdownMenu.classList.add("hidden");
    oracleLookupModal.classList.remove("hidden");
    const inp = document.getElementById("podOracleInput");
    if (inp) setTimeout(() => inp.focus(), 60);
  };
}
const closeOracleBtn = document.getElementById("closeOracleLookupBtn");
if (closeOracleBtn && oracleLookupModal) {
  closeOracleBtn.onclick = () => oracleLookupModal.classList.add("hidden");
  oracleLookupModal.onclick = (e) => {
    if (e.target === oracleLookupModal) oracleLookupModal.classList.add("hidden");
  };
}
const podOracleSearchBtn = document.getElementById("podOracleSearchBtn");
const podOracleInput = document.getElementById("podOracleInput");
if (podOracleSearchBtn && podOracleInput) {
  podOracleSearchBtn.onclick = () => lookupOracleCard(podOracleInput.value);
  podOracleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lookupOracleCard(podOracleInput.value);
    }
  });
}

// --- EXTRA COUNTERS & FLOATING MANA POOL PICKER / RENDERER ---
function renderFloatingManaStrip() {
  const manaBar = document.getElementById("floatingManaStrip");
  if (!manaBar) return;

  const manaRowBtn = document.querySelector(`.toggle-counter-row[data-counter="mana"]`);
  const manaBadge = document.getElementById("badge-mana");
  if (manaRowBtn) manaRowBtn.classList.toggle("pinned", myShowManaPool);
  if (manaBadge) manaBadge.textContent = myShowManaPool ? "ON" : "OFF";

  if (!myShowManaPool) {
    manaBar.classList.add("hidden");
    return;
  }

  manaBar.classList.remove("hidden");
  const pillsWrap = document.getElementById("manaPillsRow");
  if (!pillsWrap) return;
  pillsWrap.innerHTML = "";

  MANA_COLORS.forEach((m) => {
    const val = myManaPool[m.key] || 0;
    const pip = document.createElement("button");
    pip.type = "button";
    pip.className = `mana-pip-btn mana-${m.key.toLowerCase()} ${val > 0 ? "has-mana" : ""}`;
    pip.title = `${m.title} Mana (Tap +1, Hold −1)`;
    pip.innerHTML = `
      <span class="mana-sym">${m.label}</span>
      <span class="mana-count">${val}</span>
    `;

    let holdTimer = null;
    let didHold = false;
    let isPressing = false;

    const clearHold = () => {
      clearTimeout(holdTimer);
      holdTimer = null;
    };

    pip.addEventListener("contextmenu", (e) => e.preventDefault());

    pip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (pip.setPointerCapture) {
        try { pip.setPointerCapture(e.pointerId); } catch {}
      }
      isPressing = true;
      didHold = false;
      clearHold();

      holdTimer = setTimeout(() => {
        if (!isPressing) return;
        didHold = true;
        triggerHaptic([15, 25, 15]);
        adjustManaPool(m.key, -1);
      }, 380);
    });

    pip.addEventListener("pointerup", (e) => {
      e.preventDefault();
      if (!isPressing) return;
      isPressing = false;
      clearHold();
      if (!didHold) {
        triggerHaptic(10);
        adjustManaPool(m.key, 1);
      }
    });

    pip.addEventListener("pointercancel", () => {
      isPressing = false;
      clearHold();
    });

    pillsWrap.appendChild(pip);
  });
}

function adjustManaPool(colorKey, delta) {
  myManaPool[colorKey] = Math.max(0, (myManaPool[colorKey] || 0) + delta);
  renderFloatingManaStrip();
  if (currentPodCode && currentUser) {
    update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}/manaPool`), {
      [colorKey]: myManaPool[colorKey]
    });
  }
}

const clearManaBtn = document.getElementById("clearManaPoolBtn");
if (clearManaBtn) {
  clearManaBtn.onclick = () => {
    triggerHaptic(12);
    myManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    renderFloatingManaStrip();
    if (currentPodCode && currentUser) {
      update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
        manaPool: myManaPool
      });
    }
  };
}

function renderPinnedExtraCounters() {
  renderFloatingManaStrip();
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
      <div class="counter-title"><span class="cs-icon ${meta.iconClass}" aria-hidden="true"></span> ${meta.label}</div>
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
    if (key === "mana") {
      myShowManaPool = !myShowManaPool;
      renderPinnedExtraCounters();
      if (currentPodCode && currentUser) {
        update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
          showManaPool: myShowManaPool
        });
      }
      return;
    }

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

  const prevMonarchUid = latestPodData.monarchUid || null;
  const prevTurnUid = latestPodData.activeTurnUid || null;
  const prevTurnNumber = latestPodData.turnNumber || 1;
  const targetName = latestPodData.players?.[targetUid]?.name || "Player";
  const currentTurn = latestPodData.turnNumber || 1;

  const updates = {
    [`players/${targetUid}/eliminated`]: nextState,
    [`players/${targetUid}/eliminatedTurn`]: nextState ? currentTurn : null
  };

  if (nextState && prevMonarchUid === targetUid) {
    updates.monarchUid = null;
  }

  await update(ref(db, `pods/${currentPodCode}`), updates);

  if (nextState && prevTurnUid === targetUid) {
    await advancePodTurn();
  }

  if (nextState) {
    const label = targetUid === currentUser.uid ? "You scooped / knocked out" : `${targetName} marked — OUT —`;
    showUndoToast(label, async () => {
      const restoreUpdates = {
        [`players/${targetUid}/eliminated`]: false,
        [`players/${targetUid}/eliminatedTurn`]: null
      };
      if (prevMonarchUid === targetUid) {
        restoreUpdates.monarchUid = targetUid;
      }
      if (prevTurnUid === targetUid) {
        restoreUpdates.activeTurnUid = targetUid;
        restoreUpdates.turnNumber = prevTurnNumber;
      }
      await update(ref(db, `pods/${currentPodCode}`), restoreUpdates);
    });
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
  const updates = { eliminated: false, eliminatedTurn: null };
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
    result = Math.random() < 0.5 ? "Heads" : "Tails";
  } else if (type === "planar") {
    label = "Planar Die (d6)";
    const roll = Math.floor(Math.random() * 6) + 1;
    if (roll === 1) result = "Planeswalk";
    else if (roll === 6) result = "Chaos";
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

  const shortTag = type === "coin" || type === "planar" ? result : `d${type}: ${result}`;
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
  const isSupporter = localStorage.getItem(SUPPORTER_KEY) === "true";
  const allowedList = isSupporter ? VALID_THEMES : STANDARD_THEMES;
  const safeTheme = allowedList.includes(themeName) ? themeName : "blue";

  myTheme = safeTheme;
  localStorage.setItem(THEME_PREF_KEY, safeTheme);

  const hero = document.getElementById("heroTracker");
  VALID_THEMES.forEach((t) => hero.classList.remove(`theme-${t}`));
  hero.classList.add(`theme-${safeTheme}`);

  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.theme === safeTheme);
  });
  const selectedSwatch = document.querySelector(`.swatch-btn[data-theme="${safeTheme}"]`);
  const selectedFrameName = document.getElementById("selectedFrameName");
  if (selectedFrameName) {
    selectedFrameName.textContent = `Selected: ${selectedSwatch?.title || safeTheme}`;
  }
}

document.querySelectorAll(".swatch-btn").forEach((btn) => {
  btn.onclick = () => {
    const chosen = btn.dataset.theme;
    applyMyThemeUI(chosen);
    if (currentPodCode && currentUser) {
      update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
        theme: myTheme
      });
    }
  };
});

applyMyThemeUI(myTheme);
applySupporterFoilFrame();

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
  if (powerScreenDimmed) return;
  if ("wakeLock" in navigator) {
    try {
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request("screen");
      document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Active";
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        if (!powerScreenDimmed) {
          document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Paused";
        }
      });
    } catch {
      document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Unavailable";
    }
  } else {
    document.getElementById("wakeStatus").textContent = "Screen Wake Lock: Unavailable";
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch {}
  wakeLock = null;
}

function getPowerSaverTimeoutMs() {
  const seconds = parseInt(localStorage.getItem(POWER_SAVER_TIMEOUT_KEY) || "300", 10);
  return (Number.isFinite(seconds) ? seconds : 300) * 1000;
}

function dimScreenForPowerSaving() {
  if (powerScreenDimmed) return;
  powerScreenDimmed = true;
  const overlay = document.getElementById("powerDimOverlay");
  if (overlay) overlay.classList.remove("hidden");
  document.getElementById("wakeStatus").textContent = "Power Saving: Screen Dimmed";
  releaseWakeLock();
}

function wakeScreenFromPowerSaving() {
  powerScreenDimmed = false;
  const overlay = document.getElementById("powerDimOverlay");
  if (overlay) overlay.classList.add("hidden");
  resetPowerSaverTimer();
  enableWakeLock();
}

function resetPowerSaverTimer() {
  if (powerDimTimer) clearTimeout(powerDimTimer);
  powerDimTimer = null;
  if (localStorage.getItem(POWER_SAVER_KEY) !== "true") {
    powerScreenDimmed = false;
    const overlay = document.getElementById("powerDimOverlay");
    if (overlay) overlay.classList.add("hidden");
    return;
  }
  if (powerScreenDimmed) return;
  powerDimTimer = setTimeout(dimScreenForPowerSaving, getPowerSaverTimeoutMs());
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (currentPodCode || !document.getElementById("tableView").classList.contains("hidden"))) {
    if (powerScreenDimmed) wakeScreenFromPowerSaving();
    else {
      resetPowerSaverTimer();
      enableWakeLock();
    }
  }
});

const powerDimOverlay = document.getElementById("powerDimOverlay");
if (powerDimOverlay) {
  powerDimOverlay.addEventListener("click", wakeScreenFromPowerSaving);
  powerDimOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      wakeScreenFromPowerSaving();
    }
  });
}

["pointerdown", "pointermove", "keydown", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, () => {
    if (powerScreenDimmed) return;
    resetPowerSaverTimer();
  }, { passive: true });
});
resetPowerSaverTimer();

// --- CHECK URL FOR ?pod=XXXX INVITE ---
const urlParams = new URLSearchParams(window.location.search);
const invitedPodCode = urlParams.get("pod");
if (invitedPodCode) {
  roomCodeInput.value = invitedPodCode.toUpperCase().slice(0, 4);
  document.getElementById("joinPodBtn").className = "btn-primary join-submit-btn";
  document.getElementById("standardCreateSection").classList.add("hidden");
}

loadLocalUserProfile();

// --- INITIALIZE FIREBASE & SUPPORTER ENTITLEMENT CHECK ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let hasBootstrappedSession = false;

async function verifySupporterInPod(user) {
  let entitled = localStorage.getItem(SUPPORTER_KEY) === "true";
  try {
    if (user) {
      const uidSnap = await get(ref(db, `supporters/${user.uid}`));
      if (uidSnap.exists() && uidSnap.val() === true) entitled = true;

      if (!entitled && user.email) {
        const emailKey = user.email.toLowerCase().replace(/\./g, ",");
        const emailSnap = await get(ref(db, `supporterEmails/${emailKey}`));
        if (emailSnap.exists() && emailSnap.val() === true) entitled = true;
      }
    }
  } catch {}

  localStorage.setItem(SUPPORTER_KEY, entitled ? "true" : "false");
  document.body.classList.toggle("is-supporter", entitled);

  if (!entitled) {
    localStorage.setItem(FOIL_FRAME_KEY, "false");
    const savedPalette = localStorage.getItem(APP_PALETTE_KEY);
    if (savedPalette && !FREE_APP_PALETTES.includes(savedPalette)) {
      localStorage.setItem(APP_PALETTE_KEY, "crimson");
      document.documentElement.removeAttribute("data-palette");
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute("content", "#070606");
    }
    if (!STANDARD_THEMES.includes(myTheme)) {
      applyMyThemeUI("blue");
    }
  }
  applySupporterFoilFrame();
}

async function pruneStalePods() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const staleQuery = query(
      ref(db, "pods"),
      orderByChild("createdAt"),
      endAt(cutoff)
    );
    const snap = await get(staleQuery);
    if (!snap.exists()) return;

    const deletions = {};
    snap.forEach((childSnap) => {
      deletions[`pods/${childSnap.key}`] = null;
    });

    if (Object.keys(deletions).length > 0) {
      await update(ref(db), deletions);
    }
  } catch {}
}

function updateAccountMenuUI(user) {
  const badge = document.getElementById("lobbyAccountBadge");
  if (!badge) return;
  if (user && !user.isAnonymous) {
    badge.textContent = user.displayName ? user.displayName.split(" ")[0] : "Synced";
  } else {
    badge.textContent = "Sign In";
  }
}

async function syncCloudProfileForUser(uid) {
  try {
    const userSnap = await get(ref(db, `users/${uid}`));
    if (userSnap.exists()) {
      const cloudData = userSnap.val();
      if (cloudData.decks) {
        userDecks = { ...userDecks, ...cloudData.decks };
      }
      if (cloudData.matches) {
        const cloudMatches = Object.values(cloudData.matches);
        const merged = [...userMatches, ...cloudMatches];
        const seen = new Set();
        userMatches = merged
          .filter((m) => {
            const key = `${m.deckId}_${m.at}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => (b.at || 0) - (a.at || 0));
      }
      saveLocalUserProfile();
    }
    if (Object.keys(userDecks).length > 0) {
      await update(ref(db, `users/${uid}/decks`), userDecks).catch(() => {});
    }
  } catch {}
}

document.body.classList.toggle("is-supporter", localStorage.getItem(SUPPORTER_KEY) === "true");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      authErrorMessage = "Could not sign in anonymously. Check your connection and try again.";
      authReady = false;
      if (authReadyResolve) {
        authReadyResolve(false);
        authReadyResolve = null;
      }
      statusText.textContent = "Offline — Table Mode Ready";
      statusBox.className = "conn-pill err";
      lobbyForm.classList.remove("hidden");
      console.error("Anonymous authentication failed:", error);
    }
    return;
  }

  currentUser = user;
  authReady = true;
  authErrorMessage = "";
  if (authReadyResolve) {
    authReadyResolve(true);
    authReadyResolve = null;
  }
  updateAccountMenuUI(user);
  await verifySupporterInPod(user);
  pruneStalePods();

  if (!user.isAnonymous && user.displayName && !playerNameInput.value.trim()) {
    playerNameInput.value = user.displayName.split(" ")[0];
  }

  await syncCloudProfileForUser(user.uid);

  if (!hasBootstrappedSession) {
    hasBootstrappedSession = true;
    const savedSession = getValidSession();
    if (savedSession && !invitedPodCode) {
      statusText.textContent = `Reconnecting to Pod ${savedSession.code}...`;
      playerNameInput.value = savedSession.name;
      const rejoined = await enterPod(savedSession.code, false, true);
      if (rejoined) return;
    }

    statusText.textContent = invitedPodCode
      ? `Invited to Pod ${roomCodeInput.value}`
      : "Pod Network Ready";
    statusBox.className = "conn-pill ok";
    lobbyForm.classList.remove("hidden");
  }
});

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function renderInviteQR(code) {
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  const baseUrl = isNative
    ? "https://YOUR-GITHUB-USERNAME.github.io/Commander-life-tracker-1/"
    : window.location.origin + window.location.pathname;
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
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = inviteUrl;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy Link"), 2000);
  };
}

function toggleQrDrawer() {
  const drawer = document.getElementById("qrDrawer");
  const menuBtn = document.getElementById("toggleQrBtn");
  drawer.classList.toggle("hidden");
  menuBtn.textContent = drawer.classList.contains("hidden") ? "Show QR Invite" : "Hide QR Invite";
  dropdownMenu.classList.add("hidden");
}

document.getElementById("toggleQrBtn").onclick = toggleQrDrawer;
document.getElementById("inlineHideQrBtn").onclick = toggleQrDrawer;

// --- LEAVE POD ---
document.getElementById("leavePodBtn").onclick = async () => {
  if (currentPodCode && currentUser && latestPodData) {
    const myOnlineRef = ref(db, `pods/${currentPodCode}/players/${currentUser.uid}/online`);
    await onDisconnect(myOnlineRef).cancel().catch(() => {});

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
    label.textContent = `${index + 1}. ${players[uid].name}${uid === currentUser.uid ? " (You)" : ""}${players[uid].eliminated ? " — OUT —" : ""}`;

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
    resultBox.textContent = `${winnerName} goes first!`;
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

// --- HOST-ONLY: NEW GAME / REMATCH MODAL ---
function openNewGameModal() {
  dropdownMenu.classList.add("hidden");
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return;

  selectedNewGameLife = latestPodData.startingLife || 40;
  document.querySelectorAll("#newGameLifeSelector .preset-btn").forEach((btn) => {
    btn.classList.toggle("selected", parseInt(btn.dataset.life, 10) === selectedNewGameLife);
  });
  newGameModal.classList.remove("hidden");
}

document.getElementById("newGameBtn").onclick = openNewGameModal;
const bannerRematchBtn = document.getElementById("bannerRematchBtn");
if (bannerRematchBtn) {
  bannerRematchBtn.onclick = openNewGameModal;
}

document.getElementById("closeNewGameModalBtn").onclick = () => newGameModal.classList.add("hidden");
newGameModal.onclick = (e) => {
  if (e.target === newGameModal) newGameModal.classList.add("hidden");
};

document.getElementById("confirmNewGameBtn").onclick = async () => {
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return;

  lastRecordedPodMatchKey = "";
  activeGameMatchRecord = null;
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
      commander: p.commander || "",
      artCrop: p.artCrop || "",
      theme: p.theme || "blue",
      hasPartner: Boolean(p.hasPartner),
      eliminated: false,
      eliminatedTurn: null,
      online: p.online !== false,
      pinnedCounters: Array.isArray(p.pinnedCounters) ? p.pinnedCounters : [],
      showManaPool: Boolean(p.showManaPool),
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
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

  document.getElementById("modalPlayerName").textContent = `${isMonarch ? "[Monarch] " : ""}${target.name}${isEliminated ? " (- OUT -)" : ""}`;
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
      chip.innerHTML = `<span class="cs-icon ${meta.iconClass}" aria-hidden="true"></span> ${meta.label}: ${val}`;
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
        <div class="cmdr-dmg-val" role="group" aria-label="Commander damage from ${otherPlayer.name}">
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
  koBtn.textContent = isEliminated ? "Revive Player" : "Mark Knocked Out";
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
  const currentTurn = latestPodData?.turnNumber || 1;

  if (shouldBeKo !== myEliminated) {
    myEliminated = shouldBeKo;
    extraUpdates.eliminated = shouldBeKo;
    extraUpdates.eliminatedTurn = shouldBeKo ? currentTurn : null;
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

// --- PROGRESSIVE PRESS-AND-HOLD LIFE ACCELERATION (±5 -> ±5 -> ±10 REPEATING) ---
function bindLifeTapZone(element, step, customCallback = null) {
  let holdTimeout = null;
  let repeatInterval = null;
  let didHold = false;
  let holdTicks = 0;
  let keyboardKey = null;

  const invokeChange = customCallback || changeMyLife;

  const clearTimers = () => {
    clearTimeout(holdTimeout);
    clearInterval(repeatInterval);
    holdTimeout = null;
    repeatInterval = null;
  };

  const startPress = (e) => {
    e.preventDefault();
    clearTimers();
    didHold = false;
    holdTicks = 0;

    holdTimeout = setTimeout(() => {
      didHold = true;
      holdTicks = 1;
      triggerHaptic([18, 25, 18]);
      invokeChange(step * 5);

      repeatInterval = setInterval(() => {
        holdTicks++;
        const multiplier = holdTicks === 2 ? 5 : 10;
        triggerHaptic(multiplier === 10 ? 22 : 14);
        invokeChange(step * multiplier);
      }, 460);
    }, 450);
  };

  const endPress = (e) => {
    e.preventDefault();
    const wasHolding = didHold;
    clearTimers();
    if (!wasHolding) {
      triggerHaptic(12);
      invokeChange(step);
    }
  };

  const cancelPress = () => {
    clearTimers();
  };

  element.addEventListener("pointerdown", startPress);
  element.addEventListener("pointerup", endPress);
  element.addEventListener("pointerleave", cancelPress);
  element.addEventListener("pointercancel", cancelPress);
  element.addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || e.repeat || keyboardKey) return;
    keyboardKey = e.key;
    startPress(e);
  });
  element.addEventListener("keyup", (e) => {
    if (e.key !== keyboardKey) return;
    keyboardKey = null;
    endPress(e);
  });
  element.addEventListener("blur", () => {
    keyboardKey = null;
    cancelPress();
  });
  element.addEventListener("click", (e) => {
    if (e.detail !== 0) return;
    triggerHaptic(12);
    invokeChange(step);
  });
}

bindLifeTapZone(document.getElementById("minusZone"), -1);
bindLifeTapZone(document.getElementById("plusZone"), 1);

// --- ENTER POD & LISTEN FOR REAL-TIME SYNC ---
async function enterPod(code, isNew, isAutoRejoin = false) {
  if (!currentUser) {
    const authenticated = await waitForAuthenticatedUser();
    if (!authenticated) return false;
  }

  const name = playerNameInput.value.trim() || "Player";
  const podRef = ref(db, `pods/${code}`);
  const selectedDeckObj = activeDeckId ? userDecks[activeDeckId] : null;
  const selectedDeckLabel = selectedDeckObj ? selectedDeckObj.name : "";
  const selectedCommander = selectedDeckObj ? (selectedDeckObj.commander || "") : "";
  const selectedArtCrop = selectedDeckObj ? (selectedDeckObj.artCrop || "") : "";

  applyHeroCommanderBackdrop(selectedArtCrop);
  applySupporterFoilFrame();

  let podStartingLife = selectedLobbyStartingLife;

  if (!isNew) {
    try {
      const snap = await get(podRef);
      if (!snap.exists()) {
        clearSession();
        if (!isAutoRejoin) setPodJoinStatus(`Pod ${code} was not found. Check the 4-letter code.`, true);
        return false;
      }
      podStartingLife = snap.val().startingLife || 40;
    } catch (error) {
      console.error("Could not look up pod:", error);
      if (!isAutoRejoin) setPodJoinStatus("Could not reach the pod network. Check your connection and try again.", true);
      return false;
    }
  } else {
    try {
      await set(podRef, {
        createdAt: Date.now(),
        hostUid: currentUser.uid,
        startingLife: selectedLobbyStartingLife,
        gameNumber: 1
      });
    } catch (error) {
      console.error("Could not create pod:", error);
      setPodJoinStatus("Could not create the pod. Check your connection and try again.", true);
      return false;
    }
  }

  currentPodCode = code;
  const playerRef = ref(db, `pods/${code}/players/${currentUser.uid}`);

  try {
    const existingPlayerSnap = await get(playerRef);
    if (!existingPlayerSnap.exists()) {
      await set(playerRef, {
        name: name,
        deckName: selectedDeckLabel,
        commander: selectedCommander,
        artCrop: selectedArtCrop,
        theme: myTheme,
        hasPartner: false,
        eliminated: false,
        eliminatedTurn: null,
        online: true,
        pinnedCounters: [],
        showManaPool: false,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
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
      myShowManaPool = Boolean(existing.showManaPool);
      myManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...(existing.manaPool || {}) };
      if (existing.theme) applyMyThemeUI(existing.theme);
      if (existing.artCrop && !selectedArtCrop) applyHeroCommanderBackdrop(existing.artCrop);

      const patchUpdates = { online: true };
      if (existing.deckName !== selectedDeckLabel) {
        patchUpdates.deckName = selectedDeckLabel;
        patchUpdates.commander = selectedCommander;
        patchUpdates.artCrop = selectedArtCrop;
      }
      await update(playerRef, patchUpdates);
    }
  } catch (error) {
    console.error("Could not join pod:", error);
    setPodJoinStatus("Could not join the pod. Firebase may be offline or the database rejected access.", true);
    currentPodCode = null;
    return false;
  }

  const myOnlineRef = ref(db, `pods/${code}/players/${currentUser.uid}/online`);
  onDisconnect(myOnlineRef).set(false);

  saveSession(code, name);

  lobbyTopBar.classList.add("hidden");
  lobbyView.classList.add("hidden");
  if (mainBottomNav) mainBottomNav.classList.add("hidden");
  podView.classList.remove("hidden");

  document.getElementById("displayRoomCode").textContent = code;
  statusText.textContent = "Pod Network Ready";
  statusBox.className = "conn-pill ok";
  renderInviteQR(code);
  resetPowerSaverTimer();
  enableWakeLock();

  if (!isNew) {
    document.getElementById("qrDrawer").classList.add("hidden");
    document.getElementById("toggleQrBtn").textContent = "Show QR Invite";
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
    if (bannerRematchBtn) {
      bannerRematchBtn.classList.toggle("hidden", !isHost);
    }

    if (activeTurnUid && activeTurnUid !== previousActiveTurnUid) {
      if (activeTurnUid === currentUser.uid && previousActiveTurnUid !== null) {
        triggerHaptic([20, 45, 20]);
        const heroCard = document.getElementById("heroTracker");
        if (heroCard) {
          heroCard.classList.remove("turn-pulse-alert");
          void heroCard.offsetWidth;
          heroCard.classList.add("turn-pulse-alert");
        }
      }
      previousActiveTurnUid = activeTurnUid;
    }

    const me = players[currentUser.uid];
    const aliveUids = orderedUids.filter((uid) => !players[uid]?.eliminated);
    const winnerBanner = document.getElementById("podWinnerBanner");
    const winnerDeckNote = document.getElementById("podWinnerDeckNote");
    const matchUniqueKey = `${code}_g${gameNum}`;

    if (
      orderedUids.length >= 2 &&
      aliveUids.length > 1 &&
      me?.eliminated &&
      activeDeckId &&
      userDecks[activeDeckId] &&
      lastRecordedPodMatchKey !== matchUniqueKey
    ) {
      lastRecordedPodMatchKey = matchUniqueKey;
      const exitTurn = me.eliminatedTurn || turnNumber;
      const meta = buildPodMatchMeta(podData, "loss", exitTurn, null);
      activeGameMatchRecord = recordDeckMatchOutcome(activeDeckId, "loss", `Pod ${code}`, exitTurn, meta);
    }

    if (orderedUids.length >= 2 && aliveUids.length === 1) {
      const winnerUid = aliveUids[0];
      const winnerName = players[winnerUid]?.name || "Player";
      document.getElementById("podWinnerText").textContent = `${winnerName} Wins the Pod!`;
      winnerBanner.classList.remove("hidden");

      if (activeDeckId && userDecks[activeDeckId]) {
        if (lastRecordedPodMatchKey !== matchUniqueKey) {
          lastRecordedPodMatchKey = matchUniqueKey;
          const iWon = winnerUid === currentUser.uid;
          const exitTurn = iWon ? turnNumber : (me?.eliminatedTurn || turnNumber);
          const meta = buildPodMatchMeta(podData, iWon ? "win" : "loss", exitTurn, turnNumber);
          activeGameMatchRecord = recordDeckMatchOutcome(activeDeckId, iWon ? "win" : "loss", `Pod ${code}`, turnNumber, meta);
          winnerDeckNote.textContent = `Logged ${iWon ? "+1 Win" : "+1 Loss"} (Turn ${turnNumber}) to ${userDecks[activeDeckId].name}`;
          winnerDeckNote.classList.remove("hidden");
        } else if (activeGameMatchRecord && activeGameMatchRecord.gameEndTurn !== turnNumber) {
          patchMatchGameEndTurn(activeGameMatchRecord, turnNumber);
          winnerDeckNote.textContent = `Logged Loss (Out T${activeGameMatchRecord.myExitTurn} • Pod ended T${turnNumber}) to ${userDecks[activeDeckId].name}`;
          winnerDeckNote.classList.remove("hidden");
        }
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
        chip.textContent = `${idx + 1}. ${p.name}${p.eliminated ? " — OUT" : ""}`;
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

    if (me) {
      myCurrentLife = me.life ?? activeStartLife;
      myPoison = me.poison ?? 0;
      myTax = me.tax ?? 0;
      myHasPartner = Boolean(me.hasPartner);
      myEliminated = Boolean(me.eliminated);
      myCommanderDamage = me.commanderDamage || {};
      myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0, ...(me.extraCounters || {}) };
      myPinnedCounters = Array.isArray(me.pinnedCounters) ? me.pinnedCounters : [];
      myShowManaPool = Boolean(me.showManaPool);
      myManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...(me.manaPool || {}) };

      if (me.theme && me.theme !== myTheme) applyMyThemeUI(me.theme);
      if (me.artCrop) applyHeroCommanderBackdrop(me.artCrop);

      const partnerBtn = document.getElementById("togglePartnerBtn");
      partnerBtn.textContent = myHasPartner ? "Partner Commander: ON" : "Partner Commander: OFF";
      partnerBtn.classList.toggle("active-opt", myHasPartner);

      const koMenuBtn = document.getElementById("toggleEliminatedBtn");
      koMenuBtn.textContent = myEliminated ? "Revive / Rejoin Game" : "Scoop / Knocked Out";
      koMenuBtn.classList.toggle("warning", myEliminated);

      const iAmMonarch = monarchUid === currentUser.uid;
      document.getElementById("heroPlayerName").innerHTML = `${iAmMonarch ? `<span class="cs-icon cs-icon-monarch"></span> ` : ""}${me.name} (You)${myHasPartner ? " • Partners" : ""}`;

      const heroDeckTag = document.getElementById("heroDeckTag");
      if (me.deckName) {
        heroDeckTag.innerHTML = `<span class="cs-icon cs-icon-cmdr"></span> ${me.deckName}`;
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
      monarchBtn.textContent = iAmMonarch ? "Give Up Monarch" : "Claim the Monarch";

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
      if (oppIsEliminated) badges.push(`<span class="out-pill-tag">- OUT -</span>`);
      else if (p.deckName) badges.push(p.deckName);
      else if (oppIsHost) badges.push("Host");
      if (p.poison > 0) badges.push(`<span class="cs-icon cs-icon-poison"></span>${p.poison}`);
      const cmdrValues = Object.values(p.commanderDamage || {});
      const maxCmdr = cmdrValues.length > 0 ? Math.max(...cmdrValues) : 0;
      if (maxCmdr > 0) badges.push(`<span class="cs-icon cs-icon-cmdr"></span>${maxCmdr}`);

      const card = document.createElement("button");
      card.type = "button";
      card.className = `opponent-card theme-${oppTheme} ${oppIsMonarch ? "is-monarch" : ""} ${oppIsActiveTurn ? "is-active-turn" : ""} ${oppIsEliminated ? "is-eliminated" : ""}`;
      card.innerHTML = `
        <div class="opponent-name">${oppIsMonarch ? `<span class="cs-icon cs-icon-monarch"></span> ` : ""}${p.name}</div>
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
          <div class="cmdr-partner-header">From ${p.name}</div>
          <div class="cmdr-partner-subgrid">
            <div class="cmdr-sub-pill">
              <span class="cmdr-sub-tag">Commander A</span>
              <div class="counter-controls" style="gap:5px;">
                <button type="button" class="mini-btn cmdr-btn" style="width:30px;height:30px;" aria-label="Subtract 1 Commander A damage from ${p.name}" data-key="${uid}" data-uid="${uid}" data-slot="Commander A" data-delta="-1">−</button>
                <span class="cmdr-dmg-val ${dmgA >= 21 ? "lethal" : ""}" style="min-width:24px;font-size:1.05rem;">${dmgA}</span>
                <button type="button" class="mini-btn cmdr-btn" style="width:30px;height:30px;" aria-label="Add 1 Commander A damage from ${p.name}" data-key="${uid}" data-uid="${uid}" data-slot="Commander A" data-delta="1">+</button>
              </div>
            </div>
            <div class="cmdr-sub-pill">
              <span class="cmdr-sub-tag">Commander B</span>
              <div class="counter-controls" style="gap:5px;">
                <button type="button" class="mini-btn cmdr-btn" style="width:30px;height:30px;" aria-label="Subtract 1 Commander B damage from ${p.name}" data-key="${uid}_partner" data-uid="${uid}" data-slot="Commander B" data-delta="-1">−</button>
                <span class="cmdr-dmg-val ${dmgB >= 21 ? "lethal" : ""}" style="min-width:24px;font-size:1.05rem;">${dmgB}</span>
                <button type="button" class="mini-btn cmdr-btn" style="width:30px;height:30px;" aria-label="Add 1 Commander B damage from ${p.name}" data-key="${uid}_partner" data-uid="${uid}" data-slot="Commander B" data-delta="1">+</button>
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
            <button type="button" class="mini-btn cmdr-btn" aria-label="Subtract 1 commander damage from ${p.name}" data-key="${uid}" data-uid="${uid}" data-slot="" data-delta="-1">−</button>
            <span class="cmdr-dmg-val ${dmgTaken >= 21 ? "lethal" : ""}">${dmgTaken}</span>
            <button type="button" class="mini-btn cmdr-btn" aria-label="Add 1 commander damage from ${p.name}" data-key="${uid}" data-uid="${uid}" data-slot="" data-delta="1">+</button>
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

const createPodBtn = document.getElementById("createPodBtn");
const customLobbyLifeModal = document.getElementById("customLobbyLifeModal");
const customLobbyLifeForm = document.getElementById("customLobbyLifeForm");
const customLobbyLifeInput = document.getElementById("customLobbyLifeInput");

function closeCustomLobbyLifeModal(restoreFocus = true) {
  customLobbyLifeModal.classList.add("hidden");
  customLobbyLifeInput.setCustomValidity("");
  if (restoreFocus) createPodBtn.focus();
}

createPodBtn.onclick = () => {
  if (isCustomLobbyLifeSelected) {
    customLobbyLifeInput.value = customLobbyStartingLife ?? "";
    customLobbyLifeModal.classList.remove("hidden");
    customLobbyLifeInput.focus();
    return;
  }
  launchPodWithDeckSelection(generateCode(), true);
};

document.getElementById("cancelCustomLobbyLifeBtn").onclick = () => closeCustomLobbyLifeModal();
customLobbyLifeModal.onclick = (event) => {
  if (event.target === customLobbyLifeModal) closeCustomLobbyLifeModal();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !customLobbyLifeModal.classList.contains("hidden")) {
    closeCustomLobbyLifeModal();
  }
});
customLobbyLifeInput.addEventListener("input", () => customLobbyLifeInput.setCustomValidity(""));
customLobbyLifeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const startingLife = customLobbyLifeInput.valueAsNumber;
  if (!Number.isSafeInteger(startingLife) || startingLife < 1) {
    customLobbyLifeInput.setCustomValidity("Enter a whole number greater than 0.");
    customLobbyLifeInput.reportValidity();
    return;
  }

  customLobbyStartingLife = startingLife;
  selectedLobbyStartingLife = startingLife;
  closeCustomLobbyLifeModal(false);
  launchPodWithDeckSelection(generateCode(), true);
});

const joinPodBtn = document.getElementById("joinPodBtn");

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  roomCodeInput.setCustomValidity("");
  if (joinPodBtn) joinPodBtn.disabled = false;
});

joinPodBtn.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    roomCodeInput.setCustomValidity("Enter the full 4-character pod code.");
    roomCodeInput.reportValidity();
    return;
  }

  joinPodBtn.disabled = true;
  joinPodBtn.textContent = "Joining...";
  statusText.textContent = "Connecting to pod...";
  statusBox.className = "conn-pill";

  const joined = await launchPodWithDeckSelection(code, false);
  if (joined === false) {
    joinPodBtn.disabled = false;
    joinPodBtn.textContent = "Join Pod";
  }
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinPodBtn.click();
  }
});

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
  if (mainBottomNav) mainBottomNav.classList.add("hidden");
  tableView.classList.remove("hidden");
  resetPowerSaverTimer();
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

function getRadarPlayerOrder(ownerIdx) {
  const playerIndices = tablePlayers.map((_, idx) => idx);
  if (tablePlayerCount !== 4) return playerIndices;

  const viewTurns = getSeatOrientationClass(ownerIdx) === "face-left" ? 1 : 3;
  const turns = (4 - viewTurns) % 4;
  const getSlot = (idx) => {
    let x = idx % 2;
    let y = Math.floor(idx / 2);
    for (let turn = 0; turn < turns; turn += 1) {
      [x, y] = [1 - y, x];
    }
    return y * 2 + x;
  };

  return playerIndices.sort((a, b) => getSlot(a) - getSlot(b));
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
    if (p.poison > 0) statusPills.push(`<span class="seat-mini-badge poison"><span class="cs-icon cs-icon-poison"></span>${p.poison}</span>`);
    if (p.tax > 0) statusPills.push(`<span class="seat-mini-badge"><span class="cs-icon cs-icon-tax"></span>+${p.tax}</span>`);
    if (p.energy > 0) statusPills.push(`<span class="seat-mini-badge"><span class="cs-icon cs-icon-energy" aria-hidden="true"></span>${p.energy}</span>`);
    if (p.rad > 0) statusPills.push(`<span class="seat-mini-badge"><span class="cs-icon cs-icon-rad" aria-hidden="true"></span>${p.rad}</span>`);

    const radarCellsHtml = getRadarPlayerOrder(idx)
      .map((otherIdx) => {
        const other = tablePlayers[otherIdx];
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
            ${isMonarch ? `<span class="cs-icon cs-icon-monarch"></span> ` : ""}${p.isFirst ? "1st • " : ""}${p.name}
          </span>
          <button type="button" class="seat-color-btn" data-idx="${idx}" title="Cycle Color">●</button>
        </div>

        <div class="seat-center-stack">
          <div id="table-life-${idx}" class="seat-life-num ${p.eliminated || p.life <= 0 ? "dead" : ""}">${p.life}</div>
          ${p.eliminated ? `<div class="seat-ko-tag">- OUT -</div>` : isWinner ? `<div class="seat-winner-tag">WINNER</div>` : ""}
          <div id="table-delta-${idx}" class="seat-delta"></div>
        </div>

        <div class="seat-bottom-dock">
          <div class="seat-status-pills">${statusPills.join("")}</div>
          <button type="button" class="cmdr-radar-btn players-${tablePlayerCount}" id="table-radar-${idx}" aria-label="Open Command Tray">
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
      const isSupporter = localStorage.getItem(SUPPORTER_KEY) === "true";
      const pool = isSupporter ? VALID_THEMES : STANDARD_THEMES;
      const currentThemeIdx = pool.indexOf(p.theme);
      p.theme = pool[(currentThemeIdx + 1) % pool.length];
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
  applySupporterFoilFrame();
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

  const nameInputEl = document.getElementById("trayPlayerNameInput");
  if (nameInputEl) {
    nameInputEl.value = target.name;
    nameInputEl.oninput = (e) => {
      const cleaned = e.target.value.trim();
      target.name = cleaned || `Player ${activeTraySeatIdx + 1}`;
      renderTableGrid();
    };
  }

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
  matrix.className = `tray-cmdr-matrix players-${tablePlayerCount}`;
  matrix.innerHTML = "";

  getRadarPlayerOrder(activeTraySeatIdx).forEach((sourceIdx) => {
    const sourcePlayer = tablePlayers[sourceIdx];
    const tile = document.createElement("div");
    const spanClass = (
      (tablePlayerCount === 3 && sourceIdx === 2) ||
      (sourceIdx !== activeTraySeatIdx && sourcePlayer.hasPartner)
    ) ? "span-2" : "";

    if (sourceIdx === activeTraySeatIdx) {
      tile.className = `matrix-tile self-tile ${spanClass}`;
      tile.innerHTML = `
        <div class="matrix-tile-header">${target.name} (You)</div>
        <div class="matrix-dmg-big">${target.life}</div>
      `;
      matrix.appendChild(tile);
      return;
    }

    tile.className = `matrix-tile theme-${sourcePlayer.theme} ${spanClass} ${sourcePlayer.hasPartner ? "partner-source" : "damage-source-tile"}`;

    if (sourcePlayer.hasPartner) {
      const dmgA = target.cmdrDamage[sourceIdx] || 0;
      const dmgB = target.cmdrDamage[`${sourceIdx}_partner`] || 0;
      tile.innerHTML = `
        <div class="matrix-tile-header">From ${sourcePlayer.name}</div>
        <div class="matrix-partner-split">
          <div class="matrix-partner-sub">
            <span>Commander A</span>
            <div class="matrix-partner-controls">
              <button type="button" class="matrix-damage-btn" aria-label="Subtract 1 Commander A damage from ${sourcePlayer.name}" data-key="${sourceIdx}" data-delta="-1">−</button>
              <strong class="${dmgA >= 21 ? "lethal" : ""}">${dmgA}</strong>
              <button type="button" class="matrix-damage-btn" aria-label="Add 1 Commander A damage from ${sourcePlayer.name}" data-key="${sourceIdx}" data-delta="1">+</button>
            </div>
          </div>
          <div class="matrix-partner-sub">
            <span>Commander B</span>
            <div class="matrix-partner-controls">
              <button type="button" class="matrix-damage-btn" aria-label="Subtract 1 Commander B damage from ${sourcePlayer.name}" data-key="${sourceIdx}_partner" data-delta="-1">−</button>
              <strong class="${dmgB >= 21 ? "lethal" : ""}">${dmgB}</strong>
              <button type="button" class="matrix-damage-btn" aria-label="Add 1 Commander B damage from ${sourcePlayer.name}" data-key="${sourceIdx}_partner" data-delta="1">+</button>
            </div>
          </div>
        </div>
      `;
    } else {
      const dmg = target.cmdrDamage[sourceIdx] || 0;
      tile.innerHTML = `
        <div class="matrix-tile-header">From ${sourcePlayer.name}</div>
        <div class="matrix-damage-stepper">
          <button type="button" class="matrix-damage-btn" aria-label="Subtract 1 commander damage from ${sourcePlayer.name}" data-key="${sourceIdx}" data-delta="-1">−</button>
          <strong class="matrix-dmg-big ${dmg >= 21 ? "lethal" : ""}">${dmg}</strong>
          <button type="button" class="matrix-damage-btn" aria-label="Add 1 commander damage from ${sourcePlayer.name}" data-key="${sourceIdx}" data-delta="1">+</button>
        </div>
      `;
    }

    tile.querySelectorAll(".matrix-damage-btn").forEach((btn) => {
      btn.onclick = (event) => {
        event.stopPropagation();
        adjustTableCmdrDamage(activeTraySeatIdx, btn.dataset.key, parseInt(btn.dataset.delta, 10));
      };
    });

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
  const seatIdx = activeTraySeatIdx;
  const p = tablePlayers[seatIdx];
  const nextKo = !p.eliminated;
  const prevLife = p.life;
  const prevMonarch = tableMonarchIdx;

  p.eliminated = nextKo;
  if (!nextKo && p.life <= 0) {
    p.life = 1;
  }
  if (nextKo && tableMonarchIdx === seatIdx) {
    tableMonarchIdx = null;
  }
  renderTableGrid();
  renderTablePlayerTray();

  if (nextKo) {
    showUndoToast(`${p.name} marked — OUT —`, () => {
      p.eliminated = false;
      p.life = prevLife;
      tableMonarchIdx = prevMonarch;
      renderTableGrid();
      if (!tablePlayerModal.classList.contains("hidden") && activeTraySeatIdx === seatIdx) {
        renderTablePlayerTray();
      }
    });
  }
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

  const snapshotPlayers = JSON.parse(JSON.stringify(tablePlayers));
  const snapshotMonarch = tableMonarchIdx;

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

  showUndoToast("Table reset to starting life", () => {
    tablePlayers = snapshotPlayers;
    tableMonarchIdx = snapshotMonarch;
    renderTableGrid();
  });
};

document.getElementById("tableSetupAgainBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  tableSetupModal.classList.remove("hidden");
};

const tableQuickLogModal = document.getElementById("tableQuickLogModal");
let tableLogOutcome = "win";

document.getElementById("tableLogWinBtn").onclick = () => {
  tableLogOutcome = "win";
  document.getElementById("tableLogWinBtn").classList.add("selected-win");
  document.getElementById("tableLogLossBtn").classList.remove("selected-loss");
};
document.getElementById("tableLogLossBtn").onclick = () => {
  tableLogOutcome = "loss";
  document.getElementById("tableLogLossBtn").classList.add("selected-loss");
  document.getElementById("tableLogWinBtn").classList.remove("selected-win");
};

function finishExitingTableMode() {
  tableQuickLogModal.classList.add("hidden");
  tableView.classList.add("hidden");
  lobbyTopBar.classList.remove("hidden");
  lobbyView.classList.remove("hidden");
  if (mainBottomNav) mainBottomNav.classList.remove("hidden");
}

document.getElementById("tableExitBtn").onclick = () => {
  tableHubMenu.classList.add("hidden");
  const anyLifeChanged = tablePlayers.some((p) => p.life !== tableStartingLife || p.eliminated);

  if (anyLifeChanged && Object.keys(userDecks).length > 0 && tableQuickLogModal) {
    const sel = document.getElementById("tableLogDeckSelect");
    sel.innerHTML = "";
    Object.entries(userDecks).forEach(([id, deck]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = deck.name;
      if (id === activeDeckId) opt.selected = true;
      sel.appendChild(opt);
    });
    document.getElementById("tableLogTurnsInput").value = "";
    tableLogOutcome = "win";
    document.getElementById("tableLogWinBtn").classList.add("selected-win");
    document.getElementById("tableLogLossBtn").classList.remove("selected-loss");
    tableQuickLogModal.classList.remove("hidden");
  } else {
    finishExitingTableMode();
  }
};

document.getElementById("skipTableLogBtn").onclick = finishExitingTableMode;

document.getElementById("saveTableLogBtn").onclick = () => {
  const deckId = document.getElementById("tableLogDeckSelect").value;
  const turnsRaw = parseInt(document.getElementById("tableLogTurnsInput").value, 10);
  const turns = !isNaN(turnsRaw) && turnsRaw > 0 ? turnsRaw : null;
  if (deckId) {
    recordDeckMatchOutcome(deckId, tableLogOutcome, "Table Mode", turns, {
      podSize: tablePlayerCount,
      myExitTurn: turns,
      gameEndTurn: turns
    });
  }
  finishExitingTableMode();
};

// Register the service worker and reload clients after updates.
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
        .catch((error) => console.error("Service worker registration or update failed:", error));
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

// Route incoming Android App Links (?pod=XXXX) into the app
window.Capacitor?.Plugins?.App?.addListener("appUrlOpen", (event) => {
  if (!event?.url) return;
  try {
    const incoming = new URL(event.url);
    if (incoming.search && window.location.search !== incoming.search) {
      window.location.search = incoming.search;
    }
  } catch {}
});