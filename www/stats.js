import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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
const ACTIVE_DECK_KEY = "mtg_active_deck_id";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let userDecks = {};
let userMatches = [];
let selectedRange = "month";
let editingMatchIndex = null;
let modalOutcome = "win";
let expandedDeckId = null;

function triggerHaptic(pattern) {
  if ("vibrate" in navigator) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseMatchDate(match) {
  if (match.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(match.dateStr)) {
    const [y, m, d] = match.dateStr.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  return new Date(match.at || Date.now());
}

function isMatchInSelectedRange(match, range) {
  if (range === "all") return true;
  const now = new Date();
  const d = parseMatchDate(match);

  if (range === "year") {
    return d.getFullYear() === now.getFullYear();
  }
  if (range === "quarter") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const matchQuarter = Math.floor(d.getMonth() / 3);
    return d.getFullYear() === now.getFullYear() && matchQuarter === currentQuarter;
  }
  if (range === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

function loadLocalData() {
  try {
    userDecks = JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}");
    userMatches = JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) || "[]");
  } catch {
    userDecks = {};
    userMatches = [];
  }
}

async function saveAndSyncAllStats() {
  Object.values(userDecks).forEach((deck) => {
    deck.wins = 0;
    deck.losses = 0;
  });

  userMatches.forEach((m) => {
    if (m.deckId && userDecks[m.deckId]) {
      if (m.outcome === "win") userDecks[m.deckId].wins += 1;
      else userDecks[m.deckId].losses += 1;
    }
  });

  userMatches.sort((a, b) => parseMatchDate(b).getTime() - parseMatchDate(a).getTime());

  localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(userDecks));
  localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(userMatches));

  if (currentUser) {
    const matchesMap = {};
    userMatches.forEach((m, idx) => {
      const key = m.id || `m_${m.at || Date.now()}_${idx}`;
      m.id = key;
      matchesMap[key] = m;
    });
    await update(ref(db, `users/${currentUser.uid}`), {
      decks: userDecks,
      matches: matchesMap
    }).catch(() => {});
  }
}

// Collapsible Pod & Matchup Insights Accordion
const toggleInsightsBtn = document.getElementById("toggleInsightsBtn");
const insightsAccordionBody = document.getElementById("insightsAccordionBody");
const insightsChevron = document.getElementById("insightsChevron");
if (toggleInsightsBtn && insightsAccordionBody) {
  toggleInsightsBtn.onclick = () => {
    triggerHaptic(10);
    const isHidden = insightsAccordionBody.classList.toggle("hidden");
    if (insightsChevron) insightsChevron.textContent = isHidden ? "▾" : "▴";
  };
}

// Timeframe Filter Buttons
document.querySelectorAll("#timeframeFilterBar .timeframe-pill").forEach((btn) => {
  btn.onclick = () => {
    triggerHaptic(10);
    selectedRange = btn.dataset.range;
    document.querySelectorAll("#timeframeFilterBar .timeframe-pill").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    renderStats();
  };
});

function computeCurrentStreak(matchesArr) {
  if (!matchesArr || matchesArr.length === 0) return null;
  const sorted = [...matchesArr].sort((a, b) => parseMatchDate(b).getTime() - parseMatchDate(a).getTime());
  const firstOutcome = sorted[0].outcome;
  let count = 0;
  for (const m of sorted) {
    if (m.outcome === firstOutcome) count++;
    else break;
  }
  return count >= 2 ? { type: firstOutcome, count } : null;
}

function renderStats() {
  const filteredMatches = userMatches.filter((m) => isMatchInSelectedRange(m, selectedRange));

  let totalWins = 0;
  let totalLosses = 0;
  let winTurnsSum = 0;
  let winTurnsCount = 0;
  let exitTurnsSum = 0;
  let exitTurnsCount = 0;
  let allTurnsSum = 0;
  let allTurnsCount = 0;

  let firstSeatGames = 0;
  let firstSeatWins = 0;
  let totalCmdrKills = 0;
  const podSizeMap = {};
  const winConMap = {};
  const opponentMap = {};

  const perDeckStats = {};
  Object.entries(userDecks).forEach(([id, deck]) => {
    perDeckStats[id] = {
      id,
      name: deck.name,
      commander: deck.commander,
      wins: 0,
      losses: 0,
      winTurnsSum: 0,
      winTurnsCount: 0,
      cmdrKills: 0,
      matches: [],
      opponents: {}
    };
  });

  filteredMatches.forEach((m) => {
    const isWin = m.outcome === "win";
    if (isWin) totalWins += 1;
    else totalLosses += 1;

    const endTurnVal = parseInt(m.gameEndTurn || m.turns, 10);
    const exitTurnVal = parseInt(m.myExitTurn || m.turns, 10);

    if (!isNaN(endTurnVal) && endTurnVal > 0) {
      allTurnsSum += endTurnVal;
      allTurnsCount += 1;
      if (isWin) {
        winTurnsSum += endTurnVal;
        winTurnsCount += 1;
      }
    }

    if (!isWin && !isNaN(exitTurnVal) && exitTurnVal > 0) {
      exitTurnsSum += exitTurnVal;
      exitTurnsCount += 1;
    }

    if (m.wentFirst === true) {
      firstSeatGames++;
      if (isWin) firstSeatWins++;
    }

    totalCmdrKills += parseInt(m.commanderKills || 0, 10) || 0;

    if (m.podSize) {
      const pKey = `${m.podSize}-Pod`;
      if (!podSizeMap[pKey]) podSizeMap[pKey] = { wins: 0, total: 0 };
      podSizeMap[pKey].total++;
      if (isWin) podSizeMap[pKey].wins++;
    }

    if (isWin && m.winCondition) {
      winConMap[m.winCondition] = (winConMap[m.winCondition] || 0) + 1;
    }

    const oppList = Array.isArray(m.opponents) ? m.opponents : [];
    oppList.forEach((oppName) => {
      const clean = (oppName || "").trim();
      if (!clean) return;
      if (!opponentMap[clean]) opponentMap[clean] = { wins: 0, losses: 0 };
      if (isWin) opponentMap[clean].wins++;
      else opponentMap[clean].losses++;
    });

    const deckKey = m.deckId || `custom_${m.deckName}`;
    if (!perDeckStats[deckKey]) {
      perDeckStats[deckKey] = {
        id: deckKey,
        name: m.deckName || "Casual / Unlisted",
        commander: m.commander || "",
        wins: 0,
        losses: 0,
        winTurnsSum: 0,
        winTurnsCount: 0,
        cmdrKills: 0,
        matches: [],
        opponents: {}
      };
    }

    perDeckStats[deckKey].matches.push(m);
    perDeckStats[deckKey].cmdrKills += parseInt(m.commanderKills || 0, 10) || 0;
    oppList.forEach((oppName) => {
      const clean = (oppName || "").trim();
      if (!clean) return;
      if (!perDeckStats[deckKey].opponents[clean]) {
        perDeckStats[deckKey].opponents[clean] = { wins: 0, losses: 0 };
      }
      if (isWin) perDeckStats[deckKey].opponents[clean].wins++;
      else perDeckStats[deckKey].opponents[clean].losses++;
    });

    if (isWin) {
      perDeckStats[deckKey].wins += 1;
      if (!isNaN(endTurnVal) && endTurnVal > 0) {
        perDeckStats[deckKey].winTurnsSum += endTurnVal;
        perDeckStats[deckKey].winTurnsCount += 1;
      }
    } else {
      perDeckStats[deckKey].losses += 1;
    }
  });

  const totalGames = totalWins + totalLosses;
  const overallRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const avgWinTurn = winTurnsCount > 0 ? `T${(winTurnsSum / winTurnsCount).toFixed(1)}` : "—";
  const avgExitTurn = exitTurnsCount > 0 ? `T${(exitTurnsSum / exitTurnsCount).toFixed(1)}` : "—";
  const avgAllTurn = allTurnsCount > 0 ? `T${(allTurnsSum / allTurnsCount).toFixed(1)}` : "—";

  document.getElementById("statTotalGames").textContent = totalGames;
  document.getElementById("statTotalWins").textContent = totalWins;
  document.getElementById("statTotalLosses").textContent = totalLosses;
  document.getElementById("statWinRate").textContent = `${overallRate}%`;
  document.getElementById("statAvgWinTurn").textContent = avgWinTurn;
  document.getElementById("statAvgExitTurn").textContent = avgExitTurn;
  document.getElementById("statAvgAllTurn").textContent = avgAllTurn;

  // Populate Pod & Matchup Insights Accordion
  const firstSeatValEl = document.getElementById("insightFirstSeatVal");
  const firstSeatSubEl = document.getElementById("insightFirstSeatSub");
  if (firstSeatValEl && firstSeatSubEl) {
    if (firstSeatGames > 0) {
      firstSeatValEl.textContent = `${Math.round((firstSeatWins / firstSeatGames) * 100)}%`;
      firstSeatSubEl.textContent = `${firstSeatWins}W in ${firstSeatGames} games going 1st`;
    } else {
      firstSeatValEl.textContent = "—";
      firstSeatSubEl.textContent = "Roll 1st player in pods to track";
    }
  }
  const cmdrKillsEl = document.getElementById("insightCmdrKillsVal");
  if (cmdrKillsEl) cmdrKillsEl.textContent = totalCmdrKills;

  const podSizeEl = document.getElementById("insightPodSizeList");
  if (podSizeEl) {
    const entries = Object.entries(podSizeMap);
    if (entries.length === 0) {
      podSizeEl.innerHTML = `<span class="empty-hint">No pod size data yet</span>`;
    } else {
      podSizeEl.innerHTML = entries
        .map(([label, s]) => `<span class="insight-pill">${label}: <strong>${Math.round((s.wins / s.total) * 100)}%</strong> (${s.wins}/${s.total})</span>`)
        .join("");
    }
  }

  const winConEl = document.getElementById("insightWinConList");
  if (winConEl) {
    const entries = Object.entries(winConMap).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      winConEl.innerHTML = `<span class="empty-hint">No win conditions logged yet</span>`;
    } else {
      winConEl.innerHTML = entries
        .map(([wc, cnt]) => `<span class="insight-pill">${wc}: <strong>${cnt}</strong></span>`)
        .join("");
    }
  }

  const oppListEl = document.getElementById("insightOpponentsList");
  if (oppListEl) {
    const oppEntries = Object.entries(opponentMap)
      .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
      .slice(0, 6);
    if (oppEntries.length === 0) {
      oppListEl.innerHTML = `<div class="empty-hint">Play synced pods or log opponents to track matchups</div>`;
    } else {
      oppListEl.innerHTML = oppEntries
        .map(([name, rec]) => {
          const g = rec.wins + rec.losses;
          const r = Math.round((rec.wins / g) * 100);
          return `
            <div class="insight-opp-row">
              <span class="insight-opp-name">vs. ${name}</span>
              <span class="insight-opp-rec">${rec.wins}W-${rec.losses}L (${r}%)</span>
            </div>
          `;
        })
        .join("");
    }
  }

  // Render Per-Deck Breakdown (Expandable Rows)
  const breakdownEl = document.getElementById("deckStatsBreakdown");
  breakdownEl.innerHTML = "";

  const deckRows = Object.values(perDeckStats).filter(
    (d) => selectedRange === "all" || d.wins + d.losses > 0
  );

  if (deckRows.length === 0) {
    breakdownEl.innerHTML = `<div class="empty-hint">No games recorded for this timeframe yet.</div>`;
  } else {
    deckRows
      .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))
      .forEach((d) => {
        const games = d.wins + d.losses;
        const rate = games > 0 ? Math.round((d.wins / games) * 100) : 0;
        const deckAvgWin = d.winTurnsCount > 0 ? ` • Avg Win: T${(d.winTurnsSum / d.winTurnsCount).toFixed(1)}` : "";
        const streak = computeCurrentStreak(d.matches);
        const streakBadge = streak
          ? `<span class="deck-streak-pill ${streak.type}">${streak.type === "win" ? `🔥 ${streak.count}W` : `❄️ ${streak.count}L`}</span>`
          : "";

        const isExpanded = expandedDeckId === d.id;
        const oppPairs = Object.entries(d.opponents).sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));
        const matchupSummary = oppPairs.length > 0
          ? oppPairs.slice(0, 4).map(([oName, rec]) => `vs. ${oName} (${rec.wins}W-${rec.losses}L)`).join(" • ")
          : "No opponent commanders recorded for this deck yet.";

        const wrapper = document.createElement("div");
        wrapper.className = "deck-stat-card-expandable";
        wrapper.dataset.deckId = String(d.id);
        wrapper.setAttribute("role", "button");
        wrapper.tabIndex = 0;
        wrapper.setAttribute("aria-expanded", String(isExpanded));
        wrapper.setAttribute("aria-label", `Toggle matchup statistics for ${d.name}, ${d.wins} wins and ${d.losses} losses.`);
        wrapper.innerHTML = `
          <div class="deck-stat-row">
            <div class="history-main">
              <div class="history-player">${d.name} ${streakBadge}</div>
              <div class="history-sub">${d.commander}${deckAvgWin}</div>
            </div>
            <div class="history-delta" style="color:var(--gold-foil);">
              ${d.wins}W - ${d.losses}L (${rate}%)
            </div>
          </div>
          <div class="deck-stat-drawer ${isExpanded ? "" : "hidden"}">
            <div><strong>Cmdr KOs:</strong> ${d.cmdrKills}</div>
            <div style="margin-top:4px;"><strong>Matchups:</strong> ${matchupSummary}</div>
          </div>
        `;
        wrapper.onclick = () => {
          triggerHaptic(10);
          expandedDeckId = expandedDeckId === d.id ? null : d.id;
          breakdownEl.querySelectorAll(".deck-stat-card-expandable").forEach((card) => {
            const expanded = card.dataset.deckId === String(expandedDeckId);
            card.setAttribute("aria-expanded", String(expanded));
            const drawer = card.querySelector(".deck-stat-drawer");
            if (drawer) drawer.classList.toggle("hidden", !expanded);
          });
        };
        wrapper.addEventListener("keydown", (event) => {
          if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
            event.preventDefault();
            wrapper.click();
          }
        });
        breakdownEl.appendChild(wrapper);
      });
  }

  // Render Editable Match History List
  const matchList = document.getElementById("matchHistoryList");
  matchList.innerHTML = "";
  if (filteredMatches.length === 0) {
    matchList.innerHTML = `<div class="empty-hint">No completed matches logged in this timeframe.</div>`;
  } else {
    filteredMatches.forEach((m) => {
      const globalIdx = userMatches.indexOf(m);
      const isWin = m.outcome === "win";
      const dateStr = m.dateStr || (m.at ? new Date(m.at).toISOString().slice(0, 10) : "");

      const exitT = m.myExitTurn || m.turns;
      const endT = m.gameEndTurn || m.turns;
      let turnText = "";
      if (isWin && endT) {
        turnText = ` • Turn ${endT}`;
      } else if (!isWin && exitT && endT && exitT !== endT) {
        turnText = ` • Out Turn ${exitT} (Game ended T${endT})`;
      } else if (!isWin && exitT) {
        turnText = ` • Out Turn ${exitT}`;
      } else if (endT) {
        turnText = ` • Turn ${endT}`;
      }

      const podTag = m.podSize ? ` • ${m.podSize}-Pod` : (m.podLabel && m.podLabel !== "Manual Log" ? ` • ${m.podLabel}` : "");
      const oppLine = Array.isArray(m.opponents) && m.opponents.length > 0
        ? `<div class="match-opponents-tag">vs. ${m.opponents.join(", ")}</div>`
        : "";
      const noteHtml = m.note ? `<div class="match-note-tag">“${m.note}”</div>` : "";

      const row = document.createElement("div");
      row.className = "history-row editable-match-row";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Edit ${m.deckName}, ${isWin ? "win" : "loss"} match from ${dateStr}`);
      row.innerHTML = `
        <div class="history-main">
          <div class="history-player">${m.deckName}</div>
          <div class="history-sub">${dateStr}${turnText}${podTag}</div>
          ${oppLine}
          ${noteHtml}
        </div>
        <div class="history-delta ${isWin ? "gain" : "loss"}">
          ${isWin ? "WIN" : "LOSS"} ✎
        </div>
      `;
      row.onclick = () => openMatchEditor(globalIdx);
      row.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          row.click();
        }
      });
      matchList.appendChild(row);
    });
  }
}

// Add / Edit Match Modal
const matchEditorModal = document.getElementById("matchEditorModal");
const outcomeWinBtn = document.getElementById("outcomeWinBtn");
const outcomeLossBtn = document.getElementById("outcomeLossBtn");

function setModalOutcome(val) {
  modalOutcome = val;
  outcomeWinBtn.classList.toggle("selected-win", val === "win");
  outcomeLossBtn.classList.toggle("selected-loss", val === "loss");
}

outcomeWinBtn.onclick = () => setModalOutcome("win");
outcomeLossBtn.onclick = () => setModalOutcome("loss");

function populateDeckSelector(selectedId) {
  const select = document.getElementById("matchDeckSelect");
  select.innerHTML = "";

  const deckEntries = Object.entries(userDecks);
  if (deckEntries.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Casual / Unlisted Deck";
    select.appendChild(opt);
    return;
  }

  deckEntries.forEach(([id, deck]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${deck.name} (${deck.commander})`;
    if (id === selectedId) opt.selected = true;
    select.appendChild(opt);
  });

  const casualOpt = document.createElement("option");
  casualOpt.value = "";
  casualOpt.textContent = "Casual / Unlisted Deck";
  if (!selectedId) casualOpt.selected = true;
  select.appendChild(casualOpt);
}

function openMatchEditor(matchIndex = null) {
  triggerHaptic(12);
  editingMatchIndex = matchIndex;

  const titleEl = document.getElementById("matchEditorTitle");
  const deleteBtn = document.getElementById("deleteMatchBtn");

  if (matchIndex !== null && userMatches[matchIndex]) {
    const m = userMatches[matchIndex];
    titleEl.textContent = "Edit Match Record";
    deleteBtn.classList.remove("hidden");
    populateDeckSelector(m.deckId || "");
    setModalOutcome(m.outcome || "win");
    document.getElementById("matchDateInput").value = m.dateStr || getTodayDateString();
    document.getElementById("matchExitTurnInput").value = m.myExitTurn || m.turns || "";
    document.getElementById("matchEndTurnInput").value = m.gameEndTurn || m.turns || "";
    document.getElementById("matchOpponentsInput").value = Array.isArray(m.opponents) ? m.opponents.join(", ") : "";
    document.getElementById("matchWinConSelect").value = m.winCondition || "";
    document.getElementById("matchNoteInput").value = m.note || "";
  } else {
    titleEl.textContent = "Log Commander Game";
    deleteBtn.classList.add("hidden");
    const defaultDeckId = localStorage.getItem(ACTIVE_DECK_KEY) || Object.keys(userDecks)[0] || "";
    populateDeckSelector(defaultDeckId);
    setModalOutcome("win");
    document.getElementById("matchDateInput").value = getTodayDateString();
    document.getElementById("matchExitTurnInput").value = "";
    document.getElementById("matchEndTurnInput").value = "";
    document.getElementById("matchOpponentsInput").value = "";
    document.getElementById("matchWinConSelect").value = "";
    document.getElementById("matchNoteInput").value = "";
  }

  matchEditorModal.classList.remove("hidden");
}

document.getElementById("openAddMatchBtn").onclick = () => openMatchEditor(null);
document.getElementById("closeMatchEditorBtn").onclick = () => matchEditorModal.classList.add("hidden");
matchEditorModal.onclick = (e) => {
  if (e.target === matchEditorModal) matchEditorModal.classList.add("hidden");
};

document.getElementById("saveMatchBtn").onclick = async () => {
  triggerHaptic(15);
  const deckId = document.getElementById("matchDeckSelect").value;
  const deckObj = deckId ? userDecks[deckId] : null;
  const dateStr = document.getElementById("matchDateInput").value || getTodayDateString();

  const exitRaw = parseInt(document.getElementById("matchExitTurnInput").value, 10);
  const endRaw = parseInt(document.getElementById("matchEndTurnInput").value, 10);
  const myExitTurn = !isNaN(exitRaw) && exitRaw > 0 ? exitRaw : (!isNaN(endRaw) && endRaw > 0 ? endRaw : null);
  const gameEndTurn = !isNaN(endRaw) && endRaw > 0 ? endRaw : myExitTurn;

  const opponentsRaw = document.getElementById("matchOpponentsInput").value.trim();
  const opponents = opponentsRaw
    ? opponentsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const winCondition = document.getElementById("matchWinConSelect").value || null;
  const note = document.getElementById("matchNoteInput").value.trim();

  const [y, m, d] = dateStr.split("-").map(Number);
  const timestamp = new Date(y, m - 1, d, 12, 0, 0).getTime();

  const prev = editingMatchIndex !== null ? userMatches[editingMatchIndex] : null;
  const record = {
    id: prev?.id || `m_${Date.now()}`,
    deckId: deckId || "",
    deckName: deckObj ? deckObj.name : "Casual / Unlisted Deck",
    commander: deckObj ? deckObj.commander : "Commander",
    outcome: modalOutcome,
    turns: gameEndTurn,
    myExitTurn,
    gameEndTurn,
    opponents,
    podSize: prev?.podSize || (opponents.length > 0 ? opponents.length + 1 : null),
    wentFirst: prev?.wentFirst ?? null,
    winCondition: modalOutcome === "win" ? winCondition : null,
    commanderKills: prev?.commanderKills || 0,
    note,
    dateStr,
    podLabel: prev?.podLabel || "Manual Log",
    at: timestamp
  };

  if (editingMatchIndex !== null) {
    userMatches[editingMatchIndex] = record;
  } else {
    userMatches.unshift(record);
  }

  await saveAndSyncAllStats();
  matchEditorModal.classList.add("hidden");
  renderStats();
};

document.getElementById("deleteMatchBtn").onclick = async () => {
  if (editingMatchIndex === null) return;
  if (!confirm("Delete this match record? Deck Win/Loss totals will update automatically.")) return;

  userMatches.splice(editingMatchIndex, 1);
  await saveAndSyncAllStats();
  matchEditorModal.classList.add("hidden");
  renderStats();
};

loadLocalData();
renderStats();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInAnonymously(auth); } catch {}
    return;
  }
  currentUser = user;

  try {
    const snap = await get(ref(db, `users/${user.uid}`));
    if (snap.exists()) {
      const data = snap.val();
      if (data.decks) userDecks = { ...userDecks, ...data.decks };
      if (data.matches) {
        const cloudList = Object.entries(data.matches).map(([key, val]) => ({
          ...val,
          id: val.id || key
        }));
        const merged = [...userMatches, ...cloudList];
        const seen = new Set();
        userMatches = merged.filter((item) => {
          const k = item.id || `${item.deckId}_${item.at}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(userDecks));
      localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(userMatches));
      renderStats();
    }
  } catch {}
});