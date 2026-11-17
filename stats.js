import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCh_fJv3mMlQQ2teHyryAxtd0x_mCmMzTU",
  authDomain: "commander-life-tracker-6938f.firebaseapp.com",
  databaseURL: "https://commander-life-tracker-6938f-default-rtdb.firebaseio.com",
  projectId: "commander-life-tracker-6938f",
  storageBucket: "commander-life-tracker-6938f.firebasestorage.app",
  messagingSenderId: "989326008841",
  appId: "1:989326008841:web:13b9a36110891cebcf0ed8"
};

const LOCAL_DECKS_KEY = "mtg_local_deck_locker";
const LOCAL_MATCHES_KEY = "mtg_local_match_history";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let userDecks = {};
let userMatches = [];

const statsDropdownMenu = document.getElementById("statsDropdownMenu");
document.getElementById("statsMenuBtn").onclick = (e) => {
  e.stopPropagation();
  statsDropdownMenu.classList.toggle("hidden");
};
document.addEventListener("click", (e) => {
  if (!statsDropdownMenu.classList.contains("hidden") && !statsDropdownMenu.contains(e.target)) {
    statsDropdownMenu.classList.add("hidden");
  }
});

function loadLocalData() {
  try {
    userDecks = JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}");
    userMatches = JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) || "[]");
  } catch {
    userDecks = {};
    userMatches = [];
  }
}

function renderStats() {
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
        <div class="history-delta" style="color:var(--gold-foil);">
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
    userMatches.slice(0, 30).forEach((m) => {
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

loadLocalData();
renderStats();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch {}
    return;
  }

  const labelEl = document.getElementById("statsSyncLabel");
  const subEl = document.getElementById("statsEmailSub");
  if (labelEl && subEl && !user.isAnonymous) {
    labelEl.textContent = `☁️ ${user.displayName || "Google Account"}`;
    subEl.textContent = user.email || "Cloud backup active";
  }

  try {
    const snap = await get(ref(db, `users/${user.uid}`));
    if (snap.exists()) {
      const data = snap.val();
      if (data.decks) userDecks = { ...userDecks, ...data.decks };
      if (data.matches) {
        userMatches = Object.values(data.matches).sort((a, b) => (b.at || 0) - (a.at || 0));
      }
      localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(userDecks));
      localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(userMatches));
      renderStats();
    }
  } catch {}
});