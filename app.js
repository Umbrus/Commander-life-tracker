import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const statusBox = document.getElementById("statusBox");
const lobbyView = document.getElementById("lobbyView");
const podView = document.getElementById("podView");
const roomCodeInput = document.getElementById("roomCodeInput");
const playerNameInput = document.getElementById("playerNameInput");

let currentUser = null;
let currentPodCode = null;
let myCurrentLife = 40;
let myPoison = 0;
let myTax = 0;
let myCommanderDamage = {};
let deltaAccumulator = 0;
let deltaClearTimer = null;
let wakeLock = null;

// --- SESSION STORAGE HELPERS ---
function saveSession(code, name) {
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
  document.getElementById("joinPodBtn").className = "btn-primary";
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
      statusBox.textContent = `Reconnecting to Pod ${savedSession.code}...`;
      playerNameInput.value = savedSession.name;
      const rejoined = await enterPod(savedSession.code, false, true);
      if (rejoined) return;
    }

    statusBox.textContent = invitedPodCode
      ? `Invited to Pod ${roomCodeInput.value}! Enter your name to join.`
      : "Connected! Create a pod or enter a code.";
    statusBox.className = "status ok";
    lobbyView.classList.remove("hidden");
  })
  .catch((err) => {
    statusBox.textContent = "Auth Error: " + err.message;
    statusBox.className = "status err";
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
    colorDark: "#0f1115",
    colorLight: "#ffffff"
  });

  const copyBtn = document.getElementById("copyLinkBtn");
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(inviteUrl);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy Link"), 2000);
  };
}

document.getElementById("toggleQrBtn").onclick = () => {
  const drawer = document.getElementById("qrDrawer");
  const btn = document.getElementById("toggleQrBtn");
  drawer.classList.toggle("hidden");
  btn.textContent = drawer.classList.contains("hidden") ? "Show QR" : "Hide QR";
};

document.getElementById("leavePodBtn").onclick = () => {
  clearSession();
  window.location.href = window.location.origin + window.location.pathname;
};

// --- LIFE, POISON, TAX & COMMANDER DAMAGE UPDATERS ---
function changeMyLife(amount) {
  if (!currentPodCode || !currentUser) return;

  myCurrentLife += amount;
  document.getElementById("heroLifeDisplay").textContent = myCurrentLife;

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

function changeCommanderDamage(sourceUid, delta) {
  if (!currentPodCode || !currentUser) return;
  const currentDmg = myCommanderDamage[sourceUid] || 0;
  const nextDmg = Math.max(0, currentDmg + delta);
  const actualChange = nextDmg - currentDmg;

  if (actualChange === 0) return;

  myCommanderDamage[sourceUid] = nextDmg;
  // Commander combat damage also subtracts from (or restores) your life total
  changeMyLife(-actualChange);

  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}/commanderDamage`), {
    [sourceUid]: nextDmg
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
    await set(podRef, { createdAt: Date.now() });
  }

  currentPodCode = code;
  const playerRef = ref(db, `pods/${code}/players/${currentUser.uid}`);

  const existingPlayerSnap = await get(playerRef);
  if (!existingPlayerSnap.exists()) {
    await set(playerRef, {
      name: name,
      life: 40,
      poison: 0,
      tax: 0
    });
  } else {
    const existing = existingPlayerSnap.val();
    myCurrentLife = existing.life ?? 40;
    myPoison = existing.poison ?? 0;
    myTax = existing.tax ?? 0;
    myCommanderDamage = existing.commanderDamage || {};
  }

  saveSession(code, name);

  statusBox.classList.add("hidden");
  lobbyView.classList.add("hidden");
  podView.classList.remove("hidden");

  document.getElementById("displayRoomCode").textContent = code;
  document.getElementById("heroPlayerName").textContent = `${name} (You)`;
  renderInviteQR(code);
  enableWakeLock();

  if (!isNew) {
    document.getElementById("qrDrawer").classList.add("hidden");
    document.getElementById("toggleQrBtn").textContent = "Show QR";
  }

  onValue(ref(db, `pods/${code}/players`), (snapshot) => {
    const players = snapshot.val() || {};
    const opponentsGrid = document.getElementById("opponentsGrid");
    const cmdrDamageList = document.getElementById("cmdrDamageList");

    opponentsGrid.innerHTML = "";
    cmdrDamageList.innerHTML = "";

    const me = players[currentUser.uid];
    if (me) {
      myCurrentLife = me.life ?? 40;
      myPoison = me.poison ?? 0;
      myTax = me.tax ?? 0;
      myCommanderDamage = me.commanderDamage || {};

      document.getElementById("heroLifeDisplay").textContent = myCurrentLife;
      document.getElementById("poisonDisplay").textContent = myPoison;
      document.getElementById("taxDisplay").textContent = `+${myTax}`;

      const poisonBox = document.getElementById("poisonBox");
      poisonBox.classList.toggle("lethal-poison", myPoison >= 10);
    }

    let opponentCount = 0;

    Object.entries(players).forEach(([uid, p]) => {
      if (uid === currentUser.uid) return;
      opponentCount++;

      // 1. Render Opponent Overview Card at the top
      const poisonBadge = p.poison > 0 ? `☠ ${p.poison}` : "";
      const card = document.createElement("div");
      card.className = "opponent-card";
      card.innerHTML = `
        <div class="opponent-name">${p.name}</div>
        <div class="opponent-life ${p.life <= 0 ? "dead" : ""}">${p.life}</div>
        <div class="opponent-badges">${poisonBadge}</div>
      `;
      opponentsGrid.appendChild(card);

      // 2. Render Commander Damage Row for this opponent's commander
      const dmgTaken = myCommanderDamage[uid] || 0;
      const dmgRow = document.createElement("div");
      dmgRow.className = "cmdr-dmg-row";
      dmgRow.innerHTML = `
        <div class="cmdr-source-name">From ${p.name}</div>
        <div class="counter-controls">
          <button class="mini-btn cmdr-btn" data-uid="${uid}" data-delta="-1">−</button>
          <span class="cmdr-dmg-val ${dmgTaken >= 21 ? "lethal" : ""}">${dmgTaken}</span>
          <button class="mini-btn cmdr-btn" data-uid="${uid}" data-delta="1">+</button>
        </div>
      `;
      cmdrDamageList.appendChild(dmgRow);
    });

    if (opponentCount === 0) {
      cmdrDamageList.innerHTML = `<div class="empty-hint">Waiting for opponents to join...</div>`;
    } else {
      cmdrDamageList.querySelectorAll(".cmdr-btn").forEach((btn) => {
        btn.onclick = () => {
          changeCommanderDamage(btn.dataset.uid, parseInt(btn.dataset.delta, 10));
        };
      });
    }
  });

  return true;
}

document.getElementById("createPodBtn").onclick = () => enterPod(generateCode(), true);
document.getElementById("joinPodBtn").onclick = () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length === 4) enterPod(code, false);
};