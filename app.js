const STORAGE_KEY = "fairway-log-mobile-v1";
const IMPORT_DATE_KEY = "fairway-log-last-import";

function emptyDatabase() {
  return {
    schemaVersion: 4,
    golfer: { name: "Matthew", isLeftHanded: true, handicapIndex: 13.5, lowIndex: 13.2 },
    puttingSets: [],
    launchSessions: [],
    rounds: [],
    simulatorRounds: [],
    courses: [],
    contentDrafts: []
  };
}

function normalizeDatabase(value) {
  const db = { ...emptyDatabase(), ...(value || {}) };
  for (const key of ["puttingSets", "launchSessions", "rounds", "simulatorRounds", "courses", "contentDrafts"]) {
    db[key] = Array.isArray(db[key]) ? db[key] : [];
  }
  db.schemaVersion = 4;
  return db;
}

function loadDatabase() {
  try {
    return normalizeDatabase(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return emptyDatabase();
  }
}

let database = loadDatabase();

function saveDatabase(message = "Saved locally") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  renderDashboard();
  toast(message);
}

function mergeByID(local, remote) {
  const ids = new Set(local.map(item => item.id));
  const additions = remote.filter(item => item.id && !ids.has(item.id));
  return { values: [...local, ...additions], added: additions.length };
}

function mergeDatabase(remoteValue) {
  const remote = normalizeDatabase(remoteValue);
  let added = 0;
  for (const key of ["puttingSets", "launchSessions", "rounds", "simulatorRounds", "contentDrafts"]) {
    const result = mergeByID(database[key], remote[key]);
    database[key] = result.values;
    added += result.added;
  }

  const courseNames = new Set(database.courses.map(course => (course.name || "").toLowerCase()));
  const courseIDs = new Set(database.courses.map(course => course.id));
  for (const course of remote.courses) {
    if (!courseIDs.has(course.id) && !courseNames.has((course.name || "").toLowerCase())) {
      database.courses.push(course);
      added++;
    }
  }
  localStorage.setItem(IMPORT_DATE_KEY, new Date().toISOString());
  saveDatabase(added ? `Imported ${added} new record${added === 1 ? "" : "s"}` : "Already up to date");
}

function uuid() {
  return crypto.randomUUID();
}

function golfDate(dateString) {
  return `${dateString}T12:00:00Z`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function optionalNumber(value) {
  return value === "" ? null : Number(value);
}

function showView(id) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".tab-bar button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === id);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

let toastTimer;
function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2200);
}

function renderDashboard() {
  const count = database.rounds.length + database.puttingSets.length + database.launchSessions.length;
  document.getElementById("recordTotal").textContent = `${count} record${count === 1 ? "" : "s"}`;
  document.getElementById("roundCount").textContent = database.rounds.length;
  document.getElementById("puttingCount").textContent = database.puttingSets.length;
  document.getElementById("launchCount").textContent = database.launchSessions.length;

  const imported = localStorage.getItem(IMPORT_DATE_KEY);
  document.getElementById("lastImport").textContent = imported
    ? `Last file import ${new Date(imported).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "Import the desktop sync file before logging.";

  const entries = [
    ...database.rounds.map(item => ({
      date: item.date, title: item.courseName || "Outdoor round", detail: "Round",
      value: item.score == null ? "—" : item.score
    })),
    ...database.puttingSets.map(item => ({
      date: item.date, title: `${item.distanceFeet} ft putting`, detail: "Practice",
      value: `${item.made}/${item.attempts}`
    })),
    ...database.launchSessions.map(item => ({
      date: item.date, title: item.club || "Launch session", detail: item.category || "Practice",
      value: `${item.shots?.length || item.shotsRecorded || 0} shots`
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

  document.getElementById("recentEntries").innerHTML = entries.length
    ? entries.map(entry => `
      <div class="recent-item">
        <div><strong>${escapeHTML(entry.title)}</strong><small>${escapeHTML(entry.detail)} · ${formatDate(entry.date)}</small></div>
        <div class="recent-value">${escapeHTML(String(entry.value))}</div>
      </div>`).join("")
    : `<p class="empty">No local entries yet.</p>`;
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function holeMarkup(number) {
  return `
    <article class="hole-card" data-hole="${number}">
      <div class="hole-top"><span class="hole-number">Hole ${number}</span><span class="hole-summary"></span></div>
      <div class="hole-fields">
        <label>Par<input data-field="par" type="number" inputmode="numeric" min="3" max="6"></label>
        <label>Score<input data-field="score" type="number" inputmode="numeric" min="1" max="15"></label>
        <label>Putts<input data-field="putts" type="number" inputmode="numeric" min="0" max="8"></label>
        <label>First putt<input data-field="firstPuttDistanceFeet" type="number" inputmode="numeric" min="0" placeholder="ft"></label>
        <label>Fairway<select data-field="fairway"><option value="">—</option><option>Hit</option><option>Left</option><option>Right</option><option>Short</option><option>Long</option><option>N/A</option></select></label>
        <label>GIR<select data-field="greenInRegulation"><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Penalty<input data-field="penalties" type="number" inputmode="numeric" min="0" max="10"></label>
        <label class="wide">Tee club<input data-field="teeClub" type="text" placeholder="Driver"></label>
      </div>
    </article>`;
}

function createHoleEditor() {
  document.getElementById("holeEditor").innerHTML = Array.from({ length: 18 }, (_, index) => holeMarkup(index + 1)).join("");
}

function readHoles() {
  return [...document.querySelectorAll(".hole-card")].map(card => {
    const value = field => card.querySelector(`[data-field="${field}"]`).value;
    const hasData = ["par", "score", "putts", "firstPuttDistanceFeet", "fairway", "greenInRegulation", "penalties", "teeClub"]
      .some(field => value(field) !== "");
    if (!hasData) return null;
    return {
      id: uuid(),
      number: Number(card.dataset.hole),
      par: optionalNumber(value("par")),
      score: optionalNumber(value("score")),
      putts: Number(value("putts") || 0),
      firstPuttDistanceFeet: optionalNumber(value("firstPuttDistanceFeet")),
      fairway: value("fairway") || null,
      greenInRegulation: value("greenInRegulation") === "" ? null : value("greenInRegulation") === "true",
      teeClub: value("teeClub"),
      penalties: Number(value("penalties") || 0),
      notes: ""
    };
  }).filter(Boolean);
}

function clearRoundForm() {
  document.getElementById("roundForm").reset();
  document.getElementById("roundDate").value = today();
  createHoleEditor();
}

function syncBlob() {
  return new Blob([JSON.stringify(database, null, 2)], { type: "application/json" });
}

async function shareSyncFile() {
  const file = new File([syncBlob()], "FairwayLog-Sync.json", { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Fairway Log Sync" });
      toast("Choose Save to Files");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  downloadSyncFile();
}

function downloadSyncFile() {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(syncBlob());
  link.download = "FairwayLog-Sync.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast("Sync file downloaded");
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.getElementById("roundForm").addEventListener("submit", event => {
  event.preventDefault();
  const holes = readHoles();
  const enteredScore = optionalNumber(document.getElementById("roundScore").value);
  const holeScores = holes.map(hole => hole.score).filter(value => value != null);
  database.rounds.push({
    id: uuid(),
    date: golfDate(document.getElementById("roundDate").value),
    courseName: document.getElementById("roundCourse").value.trim(),
    teeName: document.getElementById("roundTees").value.trim(),
    score: enteredScore ?? (holeScores.length ? holeScores.reduce((sum, value) => sum + value, 0) : null),
    holes,
    notes: document.getElementById("roundNotes").value.trim()
  });
  saveDatabase("Round saved locally");
  clearRoundForm();
  showView("homeView");
});

document.getElementById("puttingForm").addEventListener("submit", event => {
  event.preventDefault();
  database.puttingSets.push({
    id: uuid(),
    date: golfDate(document.getElementById("puttingDate").value),
    surface: document.getElementById("puttingSurface").value.trim(),
    distanceFeet: Number(document.getElementById("puttingDistance").value),
    setNumber: Number(document.getElementById("puttingSetNumber").value || 1),
    made: Number(document.getElementById("puttingMade").value),
    attempts: Number(document.getElementById("puttingAttempts").value),
    threePutts: Number(document.getElementById("puttingThreePutts").value || 0),
    notes: document.getElementById("puttingNotes").value.trim()
  });
  saveDatabase("Putting set saved locally");
  event.target.reset();
  document.getElementById("puttingDate").value = today();
  document.getElementById("puttingSurface").value = "Mat";
  document.getElementById("puttingDistance").value = 7;
  document.getElementById("puttingAttempts").value = 10;
  showView("homeView");
});

document.getElementById("launchForm").addEventListener("submit", event => {
  event.preventDefault();
  database.launchSessions.push({
    id: uuid(),
    date: golfDate(document.getElementById("launchDate").value),
    club: document.getElementById("launchClub").value.trim(),
    category: document.getElementById("launchCategory").value,
    sessionType: document.getElementById("launchType").value.trim(),
    target: document.getElementById("launchTarget").value.trim(),
    surface: document.getElementById("launchSurface").value.trim(),
    shotsRecorded: Number(document.getElementById("launchShots").value || 0),
    shots: [],
    notes: document.getElementById("launchNotes").value.trim()
  });
  saveDatabase("Launch session saved locally");
  event.target.reset();
  document.getElementById("launchDate").value = today();
  document.getElementById("launchSurface").value = "Mat";
  document.getElementById("launchShots").value = 10;
  showView("homeView");
});

document.getElementById("syncFileInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed.schemaVersion) throw new Error("Not a Fairway Log database");
    mergeDatabase(parsed);
  } catch (error) {
    toast(`Could not import: ${error.message}`);
  }
  event.target.value = "";
});

document.getElementById("shareSyncFile").addEventListener("click", shareSyncFile);
document.getElementById("downloadSyncFile").addEventListener("click", downloadSyncFile);
document.getElementById("clearHoles").addEventListener("click", createHoleEditor);
document.getElementById("clearLocalData").addEventListener("click", () => {
  if (!confirm("Clear only the data stored in this phone browser? Your Mac and exported files are not changed.")) return;
  database = emptyDatabase();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(IMPORT_DATE_KEY);
  renderDashboard();
  toast("Phone copy cleared");
});

for (const id of ["roundDate", "puttingDate", "launchDate"]) {
  document.getElementById(id).value = today();
}
createHoleEditor();
renderDashboard();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js");
}
