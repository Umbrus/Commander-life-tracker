import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, set, get, push, update, onValue } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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
const lobbyView = document.getElementById("lobbyView");
const lobbyForm = document.getElementById("lobbyForm");
const podView = document.getElementById("podView");
const roomCodeInput = document.getElementById("roomCodeInput");
const playerNameInput = document.getElementById("playerNameInput");
const dropdownMenu = document.getElementById("podDropdownMenu");
const howItWorksModal = document.getElementById("howItWorksModal");
const historyModal = document.getElementById("historyModal");
const diceModal = document.getElementById("diceModal");
const extraCountersModal = document.getElementById("extraCountersModal");
const offlineBanner = document.getElementById("offlineBanner");

let currentUser = null;
let currentPodCode = null;
let latestPodData = null;
let inspectedOpponentUid = null;

let myCurrentLife = 40;
let myPoison = 0;
let myTax = 0;
let myHasPartner = false;
let myTheme = localStorage.getItem(THEME_PREF_KEY) || "blue";
let myCommanderDamage = {};
let myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0 };
let myPinnedCounters = [];

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
  if (document.visibilityState === "visible" && currentPodCode) {
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

// --- INITIALIZE FIREBASE ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

signInAnonymously(auth)
  .then(async (cred) => {
    currentUser = cred.user;

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
  })
  .catch((err) => {
    statusText.textContent = "Connection Error: " + err.message;
    statusBox.className = "conn-pill err";
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
    colorDark: "#090b0e",
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

document.getElementById("leavePodBtn").onclick = () => {
  clearSession();
  window.location.href = window.location.origin + window.location.pathname;
};

// --- TURN ORDER HELPERS ---
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

document.getElementById("passTurnBtn").onclick = async () => {
  if (!currentPodCode || !latestPodData) return;
  const orderedUids = getOrderedPlayerUids(latestPodData);
  if (orderedUids.length === 0) return;

  const currentIdx = orderedUids.indexOf(latestPodData.activeTurnUid);
  const nextIdx = (currentIdx + 1) % orderedUids.length;
  const nextUid = orderedUids[nextIdx];

  const isNewRound = nextUid === latestPodData.firstPlayerUid;
  const nextTurnNumber = (latestPodData.turnNumber || 1) + (isNewRound ? 1 : 0);

  await update(ref(db, `pods/${currentPodCode}`), {
    activeTurnUid: nextUid,
    turnNumber: nextTurnNumber
  });
};

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
    label.textContent = `${index + 1}. ${players[uid].name}${uid === currentUser.uid ? " (You)" : ""}`;

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
    if (orderedUids.length === 0) return;
    const winnerUid = orderedUids[Math.floor(Math.random() * orderedUids.length)];
    const winnerName = players[winnerUid].name;
    const resultBox = document.getElementById("diceResultBox");
    resultBox.textContent = `🎲 ${winnerName} goes first!`;
    resultBox.classList.remove("hidden");
    await setFirstPlayer(winnerUid);
    setTimeout(() => {
      document.getElementById("firstPlayerModal").classList.add("hidden");
    }, 1100);
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

// --- HOST-ONLY: NEW GAME RESET ---
document.getElementById("newGameBtn").onclick = async () => {
  dropdownMenu.classList.add("hidden");
  if (!currentPodCode || !latestPodData || latestPodData.hostUid !== currentUser.uid) return;
  if (!confirm("Start a New Game? This resets everyone to 40 life and clears all counters, turns & history.")) return;

  const players = latestPodData.players || {};
  const resetUpdates = {
    monarchUid: null,
    firstPlayerUid: null,
    activeTurnUid: null,
    turnNumber: null,
    history: null
  };

  Object.entries(players).forEach(([uid, p]) => {
    resetUpdates[`players/${uid}`] = {
      name: p.name,
      theme: p.theme || "blue",
      hasPartner: Boolean(p.hasPartner),
      pinnedCounters: Array.isArray(p.pinnedCounters) ? p.pinnedCounters : [],
      joinedAt: p.joinedAt || Date.now(),
      life: 40,
      poison: 0,
      tax: 0,
      extraCounters: { energy: 0, experience: 0, storm: 0, rad: 0 },
      commanderDamage: null
    };
  });

  await update(ref(db, `pods/${currentPodCode}`), resetUpdates);
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

  document.getElementById("modalPlayerName").textContent = `${isMonarch ? "👑 " : ""}${target.name}`;
  document.getElementById("modalLifeVal").textContent = target.life ?? 40;
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

  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
    life: myCurrentLife
  });
}

function changePoison(delta) {
  if (!currentPodCode || !currentUser) return;
  myPoison = Math.max(0, myPoison + delta);
  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
    poison: myPoison
  });
}

function changeTax(delta) {
  if (!currentPodCode || !currentUser) return;
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

  myCommanderDamage[dmgKey] = nextDmg;
  const attackerName = latestPodData?.players?.[sourceUid]?.name || "Commander";
  const labelSuffix = slotLabel ? ` (${slotLabel})` : "";
  changeMyLife(-actualChange, `Cmdr from ${attackerName}${labelSuffix}`);

  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}/commanderDamage`), {
    [dmgKey]: nextDmg
  });
}

document.getElementById("poisonMinusBtn").onclick = () => changePoison(-1);
document.getElementById("poisonPlusBtn").onclick = () => changePoison(1);
document.getElementById("taxMinusBtn").onclick = () => changeTax(-2);
document.getElementById("taxPlusBtn").onclick = () => changeTax(2);

// --- TAP FOR 1, HOLD FOR 5 HELPER ---
function bindLifeTapZone(element, step) {
  let holdTimer = null;
  let didHold = false;

  const startPress = (e) => {
    e.preventDefault();
    didHold = false;
    holdTimer = setTimeout(() => {
      didHold = true;
      changeMyLife(step * 5);
    }, 450);
  };

  const endPress = (e) => {
    e.preventDefault();
    clearTimeout(holdTimer);
    if (!didHold) {
      changeMyLife(step);
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

  if (!isNew) {
    const snap = await get(podRef);
    if (!snap.exists()) {
      clearSession();
      if (!isAutoRejoin) alert("Pod not found! Check the 4-letter code.");
      return false;
    }
  } else {
    await set(podRef, {
      createdAt: Date.now(),
      hostUid: currentUser.uid
    });
  }

  currentPodCode = code;
  const playerRef = ref(db, `pods/${code}/players/${currentUser.uid}`);

  const existingPlayerSnap = await get(playerRef);
  if (!existingPlayerSnap.exists()) {
    await set(playerRef, {
      name: name,
      theme: myTheme,
      hasPartner: false,
      pinnedCounters: [],
      joinedAt: Date.now(),
      life: 40,
      poison: 0,
      tax: 0,
      extraCounters: { energy: 0, experience: 0, storm: 0, rad: 0 }
    });
  } else {
    const existing = existingPlayerSnap.val();
    myCurrentLife = existing.life ?? 40;
    myPoison = existing.poison ?? 0;
    myTax = existing.tax ?? 0;
    myHasPartner = Boolean(existing.hasPartner);
    myCommanderDamage = existing.commanderDamage || {};
    myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0, ...(existing.extraCounters || {}) };
    myPinnedCounters = Array.isArray(existing.pinnedCounters) ? existing.pinnedCounters : [];
    if (existing.theme) applyMyThemeUI(existing.theme);
  }

  saveSession(code, name);

  lobbyView.classList.add("hidden");
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

    document.getElementById("openFirstPlayerBtn").classList.toggle("hidden", !isHost);
    document.getElementById("newGameBtn").classList.toggle("hidden", !isHost);

    // Update Turn Tracker Banner & Clockwise Order Strip
    const turnBanner = document.getElementById("turnBanner");
    if (activeTurnUid && players[activeTurnUid]) {
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
      const activeIdx = orderedUids.indexOf(activeTurnUid);
      const nextIdx = orderedUids.length > 0 ? (activeIdx + 1) % orderedUids.length : -1;

      orderedUids.forEach((uid, idx) => {
        const chip = document.createElement("span");
        const isCurrent = uid === activeTurnUid;
        const isNext = idx === nextIdx && orderedUids.length > 1;
        chip.className = `order-chip ${isCurrent ? "active" : ""} ${isNext ? "next-up" : ""}`;
        chip.textContent = `${idx + 1}. ${players[uid].name}`;
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
      myCurrentLife = me.life ?? 40;
      myPoison = me.poison ?? 0;
      myTax = me.tax ?? 0;
      myHasPartner = Boolean(me.hasPartner);
      myCommanderDamage = me.commanderDamage || {};
      myExtraCounters = { energy: 0, experience: 0, storm: 0, rad: 0, ...(me.extraCounters || {}) };
      myPinnedCounters = Array.isArray(me.pinnedCounters) ? me.pinnedCounters : [];

      if (me.theme && me.theme !== myTheme) applyMyThemeUI(me.theme);

      const partnerBtn = document.getElementById("togglePartnerBtn");
      partnerBtn.textContent = myHasPartner ? "🤝 Partner Commander: ON" : "🤝 Partner Commander: OFF";
      partnerBtn.classList.toggle("active-opt", myHasPartner);

      const iAmMonarch = monarchUid === currentUser.uid;
      document.getElementById("heroPlayerName").textContent = `${iAmMonarch ? "👑 " : ""}${me.name} (You)${myHasPartner ? " • Partners" : ""}`;
      document.getElementById("heroTracker").classList.toggle("is-monarch", iAmMonarch);

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
      const oppTheme = VALID_THEMES.includes(p.theme) ? p.theme : "blue";

      const badges = [];
      if (p.poison > 0) badges.push(`☠${p.poison}`);
      const cmdrValues = Object.values(p.commanderDamage || {});
      const maxCmdr = cmdrValues.length > 0 ? Math.max(...cmdrValues) : 0;
      if (maxCmdr > 0) badges.push(`⚔${maxCmdr}`);

      const card = document.createElement("button");
      card.type = "button";
      card.className = `opponent-card theme-${oppTheme} ${oppIsMonarch ? "is-monarch" : ""} ${oppIsActiveTurn ? "is-active-turn" : ""}`;
      card.innerHTML = `
        <div class="opponent-name">${oppIsMonarch ? "👑 " : ""}${p.name}</div>
        <div class="opponent-life ${p.life <= 0 ? "dead" : ""}">${p.life}</div>
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

// --- REGISTER SERVICE WORKER & MONITOR ONLINE/OFFLINE STATUS ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function updateNetworkBanner() {
  if (offlineBanner) {
    offlineBanner.classList.toggle("hidden", navigator.onLine);
  }
}
window.addEventListener("online", updateNetworkBanner);
window.addEventListener("offline", updateNetworkBanner);
updateNetworkBanner();