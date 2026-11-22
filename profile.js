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

const SAVED_NAME_KEY = "mtg_saved_player_name";
const THEME_PREF_KEY = "mtg_preferred_theme";
const LOCAL_DECKS_KEY = "mtg_local_deck_locker";
const LOCAL_MATCHES_KEY = "mtg_local_match_history";
const APP_PALETTE_KEY = "mtg_app_palette";
const FOIL_FRAME_KEY = "mtg_supporter_foil_frame";
const SUPPORTER_KEY = "mtg_is_supporter";
const POWER_SAVER_KEY = "mtg_power_saver_enabled";
const POWER_SAVER_TIMEOUT_KEY = "mtg_power_saver_timeout";
const STANDARD_THEMES = ["blue", "red", "green", "gold", "purple", "slate"];
const FREE_APP_PALETTES = ["crimson", "rare", "uncommon", "common"];
const PALETTE_THEME_COLORS = {
  crimson: "#070606",
  chocobo: "#151004",
  teal: "#03080c",
  abyssal: "#030b0e",
  fracture: "#040811",
  uncommon: "#080c12",
  rare: "#100b14",
  common: "#0b0908"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

function triggerHaptic(pattern) {
  if ("vibrate" in navigator) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

// =========================================================
// SUPPORTER ENTITLEMENT GATING & VIP CODE REDEMPTION
// =========================================================
function applySupporterState(isSupporter) {
  localStorage.setItem(SUPPORTER_KEY, isSupporter ? "true" : "false");
  document.body.classList.toggle("is-supporter", isSupporter);

  const badge = document.getElementById("supporterActiveBadge");
  const redeemBox = document.getElementById("supporterRedeemBox");
  if (badge) badge.classList.toggle("hidden", !isSupporter);
  if (redeemBox) redeemBox.classList.toggle("hidden", isSupporter);

  if (!isSupporter) {
    isFoilFrame = false;
    localStorage.setItem(FOIL_FRAME_KEY, "false");
    renderFoilToggleUI();

    const savedPalette = localStorage.getItem(APP_PALETTE_KEY);
    if (savedPalette && !FREE_APP_PALETTES.includes(savedPalette)) {
      applyAppPalette("crimson");
    }
    if (!STANDARD_THEMES.includes(currentTheme)) {
      currentTheme = "blue";
      localStorage.setItem(THEME_PREF_KEY, "blue");
      renderThemeSwatches();
    }
  }
}

async function verifySupporterStatus(user) {
  if (!user) {
    applySupporterState(false);
    return false;
  }

  let entitled = localStorage.getItem(SUPPORTER_KEY) === "true";

  try {
    const uidSnap = await get(ref(db, `supporters/${user.uid}`));
    if (uidSnap.exists() && uidSnap.val() === true) {
      entitled = true;
    }

    if (!entitled && user.email) {
      const emailKey = user.email.toLowerCase().replace(/\./g, ",");
      const emailSnap = await get(ref(db, `supporterEmails/${emailKey}`));
      if (emailSnap.exists() && emailSnap.val() === true) {
        entitled = true;
      }
    }
  } catch {}

  applySupporterState(entitled);
  return entitled;
}

const redeemBtn = document.getElementById("redeemSupporterCodeBtn");
if (redeemBtn) {
  redeemBtn.onclick = async () => {
    const input = document.getElementById("supporterCodeInput");
    const code = (input?.value || "").trim().toUpperCase();
    if (!code) return;

    triggerHaptic(12);
    try {
      const codeSnap = await get(ref(db, `supporterCodes/${code}`));
      if (codeSnap.exists() && codeSnap.val() === true) {
        applySupporterState(true);
        if (input) input.value = "";
        alert("Supporter Pack unlocked! Exclusive set themes, card frames, and foil treatments are now active.");
      } else {
        alert("Invalid supporter or tester code.");
      }
    } catch {
      alert("Could not verify code while offline.");
    }
  };
}

// Collector Edition App Themes & Supporter Foil Frame
let currentPalette = localStorage.getItem(APP_PALETTE_KEY) || "crimson";
function applyAppPalette(paletteName) {
  if (!Object.prototype.hasOwnProperty.call(PALETTE_THEME_COLORS, paletteName)) {
    paletteName = "crimson";
  }
  currentPalette = paletteName;
  localStorage.setItem(APP_PALETTE_KEY, paletteName);
  if (paletteName === "crimson") {
    document.documentElement.removeAttribute("data-palette");
  } else {
    document.documentElement.setAttribute("data-palette", paletteName);
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme && PALETTE_THEME_COLORS[paletteName]) {
    metaTheme.setAttribute("content", PALETTE_THEME_COLORS[paletteName]);
  }
  document.querySelectorAll("#appPaletteSelector .palette-btn").forEach((btn) => {
    const selected = btn.dataset.palette === paletteName;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  const morePalettes = document.getElementById("moreAppPalettes");
  if (morePalettes) {
    morePalettes.open = Array.from(morePalettes.querySelectorAll(".palette-btn"))
      .some((btn) => btn.dataset.palette === paletteName);
  }
}
applyAppPalette(currentPalette);

document.querySelectorAll("#appPaletteSelector .palette-btn").forEach((btn) => {
  btn.onclick = () => {
    triggerHaptic(12);
    applyAppPalette(btn.dataset.palette);
  };
});

let isFoilFrame = localStorage.getItem(FOIL_FRAME_KEY) === "true";
function renderFoilToggleUI() {
  const btn = document.getElementById("toggleFoilFrameBtn");
  const badge = document.getElementById("badgeFoilFrame");
  if (btn) btn.classList.toggle("pinned", isFoilFrame);
  if (badge) badge.textContent = isFoilFrame ? "ON" : "OFF";
  const preview = document.getElementById("defaultThemePreview");
  if (preview) preview.classList.toggle("supporter-foil", isFoilFrame);
}
renderFoilToggleUI();

const foilToggleBtn = document.getElementById("toggleFoilFrameBtn");
if (foilToggleBtn) {
  foilToggleBtn.onclick = () => {
    triggerHaptic(14);
    isFoilFrame = !isFoilFrame;
    localStorage.setItem(FOIL_FRAME_KEY, String(isFoilFrame));
    renderFoilToggleUI();
  };
}

const powerSaverToggle = document.getElementById("togglePowerSaverBtn");
const powerSaverBadge = document.getElementById("badgePowerSaver");
const powerSaverTimeoutSelect = document.getElementById("powerSaverTimeoutSelect");
let powerSaverEnabled = localStorage.getItem(POWER_SAVER_KEY) === "true";

function renderPowerSaverUI() {
  if (powerSaverToggle) {
    powerSaverToggle.classList.toggle("pinned", powerSaverEnabled);
    powerSaverToggle.setAttribute("aria-pressed", String(powerSaverEnabled));
  }
  if (powerSaverBadge) powerSaverBadge.textContent = powerSaverEnabled ? "ON" : "OFF";
  if (powerSaverTimeoutSelect) {
    const savedTimeout = localStorage.getItem(POWER_SAVER_TIMEOUT_KEY) || "300";
    const validTimeout = Array.from(powerSaverTimeoutSelect.options).some((option) => option.value === savedTimeout)
      ? savedTimeout
      : "300";
    powerSaverTimeoutSelect.value = validTimeout;
    localStorage.setItem(POWER_SAVER_TIMEOUT_KEY, validTimeout);
  }
}
renderPowerSaverUI();

if (powerSaverToggle) {
  powerSaverToggle.onclick = () => {
    triggerHaptic(12);
    powerSaverEnabled = !powerSaverEnabled;
    localStorage.setItem(POWER_SAVER_KEY, String(powerSaverEnabled));
    renderPowerSaverUI();
  };
}
if (powerSaverTimeoutSelect) {
  powerSaverTimeoutSelect.onchange = () => {
    localStorage.setItem(POWER_SAVER_TIMEOUT_KEY, powerSaverTimeoutSelect.value);
  };
}

// Standalone Scryfall Oracle & Rulings Lookup
async function runProfileOracleSearch(queryStr) {
  const resultsEl = document.getElementById("profileOracleResults");
  if (!resultsEl) return;
  const trimmed = (queryStr || "").trim();
  if (!trimmed) return;

  resultsEl.innerHTML = `<div class="empty-hint">Searching Scryfall Oracle database...</div>`;

  try {
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(trimmed)}`);
    if (!res.ok) {
      resultsEl.innerHTML = `<div class="empty-hint">No exact card found for "${trimmed}".</div>`;
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
            ${imgUris.normal || imgUris.large ? `<button type="button" class="oracle-card-image-button" data-large-image="${imgUris.large || imgUris.normal}" title="View larger card image" aria-label="Enlarge image of ${card.name}"><img src="${imgUris.normal || imgUris.large}" alt="${card.name}" class="oracle-card-thumb" /></button>` : ""}
            <div class="oracle-card-meta">
              <div class="oracle-card-name">${card.name}</div>
              <div class="oracle-card-cost">${card.mana_cost || ""} • ${card.type_line || ""}</div>
              <div class="oracle-card-legality">Commander: <strong>${(card.legalities?.commander || "unknown").toUpperCase()}</strong></div>
            </div>
          </div>
          <div class="oracle-text-section">
            <div class="oracle-section-title">Oracle Text</div>
            <div class="oracle-text-box">${oracleText.replace(/\n/g, "<br/>")}</div>
          </div>
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

const profileOracleInput = document.getElementById("profileOracleInput");
const profileOracleSearchBtn = document.getElementById("profileOracleSearchBtn");
const profileOracleResults = document.getElementById("profileOracleResults");
const profileCardImageModal = document.getElementById("profileCardImageModal");
const profileCardLargeImage = document.getElementById("profileCardLargeImage");
const profileCardImageTitle = document.getElementById("profileCardImageTitle");
const closeProfileCardImageBtn = document.getElementById("closeProfileCardImageBtn");
let lastClickedCardImageButton = null;

function closeProfileCardImageModal() {
  profileCardImageModal.classList.add("hidden");
  profileCardLargeImage.removeAttribute("src");
  if (lastClickedCardImageButton?.isConnected) lastClickedCardImageButton.focus();
  lastClickedCardImageButton = null;
}

profileOracleResults.addEventListener("click", (event) => {
  const imageButton = event.target.closest(".oracle-card-image-button");
  if (!imageButton) return;

  const thumbnail = imageButton.querySelector("img");
  const largeImageUrl = imageButton.dataset.largeImage || thumbnail?.src;
  if (!largeImageUrl || !thumbnail) return;

  lastClickedCardImageButton = imageButton;
  profileCardImageTitle.textContent = thumbnail.alt;
  profileCardLargeImage.src = largeImageUrl;
  profileCardLargeImage.alt = thumbnail.alt;
  profileCardImageModal.classList.remove("hidden");
  closeProfileCardImageBtn.focus();
});

closeProfileCardImageBtn.onclick = closeProfileCardImageModal;
profileCardImageModal.onclick = (event) => {
  if (event.target === profileCardImageModal) closeProfileCardImageModal();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileCardImageModal.classList.contains("hidden")) {
    closeProfileCardImageModal();
  }
});

if (profileOracleSearchBtn && profileOracleInput) {
  profileOracleSearchBtn.onclick = () => runProfileOracleSearch(profileOracleInput.value);
  profileOracleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runProfileOracleSearch(profileOracleInput.value);
    }
  });
}

// Player Defaults (Name & Theme)
const nameInput = document.getElementById("defaultNameInput");
nameInput.value = localStorage.getItem(SAVED_NAME_KEY) || "";

document.getElementById("saveDefaultNameBtn").onclick = () => {
  triggerHaptic(12);
  const val = nameInput.value.trim();
  localStorage.setItem(SAVED_NAME_KEY, val);
  const btn = document.getElementById("saveDefaultNameBtn");
  btn.textContent = "Saved!";
  setTimeout(() => (btn.textContent = "Save"), 1600);
};

let currentTheme = localStorage.getItem(THEME_PREF_KEY) || "blue";
const THEME_DISPLAY_NAMES = {
  blue: "Azorius Blue",
  red: "Rakdos Crimson",
  green: "Golgari Emerald",
  gold: "Boros Gold",
  purple: "Dimir Violet",
  slate: "Eldrazi Obsidian",
  aether: "Prismatic Aether",
  phyrexian: "Phyrexian Oil",
  ivory: "Celestial Ivory",
  fracture: "Reality Fracture"
};
function renderThemeSwatches() {
  document.querySelectorAll("#defaultThemeSwatches .swatch-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.theme === currentTheme);
  });
  const preview = document.getElementById("defaultThemePreview");
  const previewName = document.getElementById("defaultThemePreviewName");
  if (preview) {
    preview.classList.remove(...Object.keys(THEME_DISPLAY_NAMES).map((theme) => `theme-${theme}`));
    preview.classList.add(`theme-${currentTheme}`);
  }
  if (previewName) previewName.textContent = THEME_DISPLAY_NAMES[currentTheme] || THEME_DISPLAY_NAMES.blue;
}
renderThemeSwatches();

document.querySelectorAll("#defaultThemeSwatches .swatch-btn").forEach((btn) => {
  btn.onclick = () => {
    triggerHaptic(12);
    currentTheme = btn.dataset.theme;
    localStorage.setItem(THEME_PREF_KEY, currentTheme);
    renderThemeSwatches();
  };
});

// Standalone Dice & Coin Roller
const recentRolls = [];
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
    const r = Math.floor(Math.random() * 6) + 1;
    if (r === 1) result = "Planeswalk";
    else if (r === 6) result = "Chaos";
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
  recentRolls.unshift(shortTag);
  if (recentRolls.length > 5) recentRolls.pop();
  document.getElementById("recentRollsBar").textContent = `Recent: ${recentRolls.join("  •  ")}`;
}

document.querySelectorAll(".die-btn").forEach((btn) => {
  btn.onclick = () => rollDie(btn.dataset.die);
});

// Google Sign-In & Cloud Backup
function updateProfileAuthUI(user) {
  const statusEl = document.getElementById("profileSyncStatus");
  const authBtn = document.getElementById("googleAuthBtn");
  if (!user || user.isAnonymous) {
    statusEl.textContent = "Currently using an anonymous Device ID. Sign in with Google to sync decks and stats across your phone and PC.";
    authBtn.textContent = "Sign in with Google";
    authBtn.className = "btn-primary";
    authBtn.style.marginBottom = "0";
  } else {
    statusEl.textContent = `Signed in as ${user.displayName || "Planeswalker"} (${user.email}). Your decks and match stats are backed up.`;
    authBtn.textContent = "Sign Out of Google";
    authBtn.className = "btn-secondary";
    authBtn.style.marginBottom = "0";
  }
}

document.getElementById("googleAuthBtn").onclick = async () => {
  if (!auth.currentUser) return;

  if (!auth.currentUser.isAnonymous) {
    await signOut(auth);
    await signInAnonymously(auth);
    return;
  }

  const prevUid = auth.currentUser.uid;
  try {
    const res = await linkWithPopup(auth.currentUser, googleProvider);
    updateProfileAuthUI(res.user);
    await verifySupporterStatus(res.user);
    const localDecks = JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}");
    if (Object.keys(localDecks).length > 0) {
      await update(ref(db, `users/${res.user.uid}/decks`), localDecks).catch(() => {});
    }
  } catch (err) {
    if (err.code === "auth/credential-already-in-use" || err.code === "auth/email-already-in-use") {
      try {
        const oldSnap = await get(ref(db, `users/${prevUid}/decks`));
        const oldDecks = oldSnap.exists() ? oldSnap.val() : {};
        const signInRes = await signInWithPopup(auth, googleProvider);
        const merged = { ...oldDecks, ...JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}") };
        localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(merged));
        if (Object.keys(merged).length > 0) {
          await update(ref(db, `users/${signInRes.user.uid}/decks`), merged).catch(() => {});
        }
        updateProfileAuthUI(signInRes.user);
        await verifySupporterStatus(signInRes.user);
      } catch (innerErr) {
        alert(`Google Sign-In failed: ${innerErr.message}`);
      }
    } else if (err.code !== "auth/popup-closed-by-user") {
      alert(`Google Sign-In error: ${err.message}`);
    }
  }
};

applySupporterState(localStorage.getItem(SUPPORTER_KEY) === "true");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInAnonymously(auth); } catch {}
    return;
  }
  updateProfileAuthUI(user);
  await verifySupporterStatus(user);
});

// JSON Export / Import Backup
document.getElementById("exportBackupBtn").onclick = () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    decks: JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}"),
    matches: JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) || "[]")
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `commandsync-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById("importBackupInput").onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.decks) {
      const mergedDecks = { ...JSON.parse(localStorage.getItem(LOCAL_DECKS_KEY) || "{}"), ...parsed.decks };
      localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(mergedDecks));
      if (auth.currentUser) {
        await update(ref(db, `users/${auth.currentUser.uid}/decks`), mergedDecks).catch(() => {});
      }
    }
    if (Array.isArray(parsed.matches)) {
      localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(parsed.matches));
    }
    alert("Backup restored successfully!");
  } catch {
    alert("Invalid backup JSON file.");
  }
};