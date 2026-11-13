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

const statusBox = document.getElementById("statusBox");
const lobbyView = document.getElementById("lobbyView");
const podView = document.getElementById("podView");
const roomCodeInput = document.getElementById("roomCodeInput");

let currentUser = null;
let currentPodCode = null;
let myCurrentLife = 40;
let deltaAccumulator = 0;
let deltaClearTimer = null;
let wakeLock = null;

// --- SCREEN WAKE LOCK (Keeps phone screen awake during games) ---
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

// Re-acquire wake lock automatically if user switches apps and comes back
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
  .then((cred) => {
    currentUser = cred.user;
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

// Toggle QR drawer visibility so it doesn't take space during gameplay
document.getElementById("toggleQrBtn").onclick = () => {
  const drawer = document.getElementById("qrDrawer");
  const btn = document.getElementById("toggleQrBtn");
  drawer.classList.toggle("hidden");
  btn.textContent = drawer.classList.contains("hidden") ? "Show QR" : "Hide QR";
};

// --- CHANGE YOUR OWN LIFE + SHOW TEMPORARY DELTA ---
function changeMyLife(amount) {
  if (!currentPodCode || !currentUser) return;

  myCurrentLife += amount;
  document.getElementById("heroLifeDisplay").textContent = myCurrentLife;

  // Show cumulative change badge (+5, -3, etc.) for 2 seconds
  deltaAccumulator += amount;
  const badge = document.getElementById("deltaBadge");
  badge.textContent = deltaAccumulator > 0 ? `+${deltaAccumulator}` : `${deltaAccumulator}`;
  badge.className = `delta-badge ${deltaAccumulator >= 0 ? "delta-plus" : "delta-minus"}`;

  clearTimeout(deltaClearTimer);
  deltaClearTimer = setTimeout(() => {
    deltaAccumulator = 0;
    badge.textContent = "";
  }, 2000);

  update(ref(db, `pods/${currentPodCode}/players/${currentUser.uid}`), {
    life: myCurrentLife
  });
}

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
    }, 450); // Hold for 0.45s to add/subtract 5
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
async function enterPod(code, isNew) {
  const name = document.getElementById("playerNameInput").value.trim() || "Player";
  const podRef = ref(db, `pods/${code}`);

  if (!isNew) {
    const snap = await get(podRef);
    if (!snap.exists()) {
      alert("Pod not found! Check the 4-letter code.");
      return;
    }
  } else {
    await set(podRef, { createdAt: Date.now() });
  }

  currentPodCode = code;
  const playerRef = ref(db, `pods/${code}/players/${currentUser.uid}`);
  await set(playerRef, { name: name, life: 40 });

  // Switch screens & activate wake lock
  statusBox.classList.add("hidden");
  lobbyView.classList.add("hidden");
  podView.classList.remove("hidden");

  document.getElementById("displayRoomCode").textContent = code;
  document.getElementById("heroPlayerName").textContent = `${name} (You)`;
  renderInviteQR(code);
  enableWakeLock();

  // Auto-hide QR drawer if joining an existing pod (host keeps it open initially)
  if (!isNew) {
    document.getElementById("qrDrawer").classList.add("hidden");
    document.getElementById("toggleQrBtn").textContent = "Show QR";
  }

  // Listen for live updates from all phones in the pod
  onValue(ref(db, `pods/${code}/players`), (snapshot) => {
    const players = snapshot.val() || {};
    const opponentsGrid = document.getElementById("opponentsGrid");
    opponentsGrid.innerHTML = "";

    Object.entries(players).forEach(([uid, p]) => {
      if (uid === currentUser.uid) {
        // Keep your local life synced with database
        myCurrentLife = p.life;
        document.getElementById("heroLifeDisplay").textContent = p.life;
      } else {
        // Render compact opponent card
        const card = document.createElement("div");
        card.className = "opponent-card";
        card.innerHTML = `
          <div class="opponent-name">${p.name}</div>
          <div class="opponent-life ${p.life <= 0 ? "dead" : ""}">${p.life}</div>
        `;
        opponentsGrid.appendChild(card);
      }
    });
  });
}

document.getElementById("createPodBtn").onclick = () => enterPod(generateCode(), true);
document.getElementById("joinPodBtn").onclick = () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length === 4) enterPod(code, false);
};