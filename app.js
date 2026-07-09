"use strict";

/* Fairway Log — Caddie (read-only viewer)
   The Mac app is the source of truth. This reads FairwayLog-Sync.json and
   renders your bag, greens, and rounds. No entry, no network, no accounts.
   Derivations mirror the Mac app's logic (mishit model, approach circle,
   putting/approach bands) so the numbers agree. */

const STORAGE_KEY = "fairway-log-caddie-db";
const IMPORT_KEY = "fairway-log-caddie-imported";

/* ---------------- data ---------------- */

function emptyDatabase() {
  return {
    schemaVersion: 4,
    golfer: { name: "Matthew", isLeftHanded: true, handicapIndex: 13.5, lowIndex: 13.2 },
    puttingSets: [], launchSessions: [], rounds: [],
    simulatorRounds: [], courses: [], contentDrafts: [], clubDistanceBaselines: []
  };
}

function normalize(value) {
  const db = { ...emptyDatabase(), ...(value || {}) };
  for (const k of ["puttingSets", "launchSessions", "rounds", "simulatorRounds", "courses", "contentDrafts", "clubDistanceBaselines"]) {
    db[k] = Array.isArray(db[k]) ? db[k] : [];
  }
  db.golfer = { ...emptyDatabase().golfer, ...(value && value.golfer ? value.golfer : {}) };
  return db;
}

function loadDatabase() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return emptyDatabase(); }
}

let db = loadDatabase();

/* ---------------- math ---------------- */

const num = v => (typeof v === "number" && isFinite(v)) ? v : null;
const avg = arr => { const a = arr.filter(x => x != null && isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
const median = arr => {
  const a = arr.filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const pct = v => v == null ? "—" : Math.round(v * 100) + "%";

function escapeHTML(v) {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
function fmtDate(v) {
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/* ---------------- putting ---------------- */

const PUTT_BANDS = [
  { label: "0–3 ft", lo: 0, hi: 3, three: false },
  { label: "4–6 ft", lo: 4, hi: 6, three: false },
  { label: "7–9 ft", lo: 7, hi: 9, three: false },
  { label: "10–15 ft", lo: 10, hi: 15, three: true },
  { label: "16–20 ft", lo: 16, hi: 20, three: true },
  { label: "21–30 ft", lo: 21, hi: 30, three: true },
  { label: "31–40 ft", lo: 31, hi: 40, three: true },
  { label: "41–50 ft", lo: 41, hi: 50, three: true },
  { label: "51–60 ft", lo: 51, hi: 60, three: true },
  { label: "61+ ft", lo: 61, hi: Infinity, three: true }
];

function puttingLadder() {
  return PUTT_BANDS.map(band => {
    const sets = db.puttingSets.filter(s => (s.distanceFeet ?? 0) >= band.lo && (s.distanceFeet ?? 0) <= band.hi);
    const made = sets.reduce((s, x) => s + (x.made || 0), 0);
    const attempts = sets.reduce((s, x) => s + (x.attempts || 0), 0);
    const threePutts = sets.reduce((s, x) => s + (x.threePutts || 0), 0);
    return {
      label: band.label, showThree: band.three,
      made, attempts, threePutts,
      makeRate: attempts ? made / attempts : null,
      threeRate: attempts ? threePutts / attempts : null
    };
  }).filter(b => b.attempts > 0);
}

/* highest band (by distance) where make rate >= 0.5, min attempts */
function makeableRange(ladder) {
  let best = null;
  for (const b of ladder) if (b.attempts >= 5 && b.makeRate != null && b.makeRate >= 0.5) best = b;
  return best;
}

/* ---------------- yardage / bag ---------------- */

function inferCategory(club) {
  const v = (club || "").toLowerCase();
  if (v.includes("driver") || v.includes("wood") || v.includes("hybrid")) return "Drive";
  if (v.includes("wedge") || v.includes("°") || v.includes("degree")) return "Approach";
  return "Iron";
}

function isRecorded(shot) { return (shot.carryDistance ?? 0) > 1; }
function isMishit(shot, medCarry, medSmash) {
  if (!isRecorded(shot)) return false;
  const carry = shot.carryDistance;
  if (medSmash != null && shot.smashFactor != null && shot.smashFactor < medSmash - 0.15) return true;
  if (medCarry > 0 && carry < 0.55 * medCarry) return true;
  return false;
}

function bagLadder() {
  const byClub = new Map();
  for (const s of db.launchSessions) {
    const club = (s.club || "").trim();
    if (!club) continue;
    if (!byClub.has(club)) byClub.set(club, { club, shots: [], category: inferCategory(club) });
    byClub.get(club).shots.push(...(Array.isArray(s.shots) ? s.shots : []));
  }

  const rows = [];
  for (const { club, shots, category } of byClub.values()) {
    const recorded = shots.filter(isRecorded);
    if (!recorded.length) continue;
    const medCarry = median(recorded.map(s => s.carryDistance));
    const medSmash = median(recorded.map(s => s.smashFactor).filter(x => x != null));
    const clean = recorded.filter(s => !isMishit(s, medCarry, medSmash));
    const use = clean.length ? clean : recorded;
    const offlines = use.map(s => s.offlineDistance).filter(x => x != null);
    rows.push({
      club, category,
      carry: avg(use.map(s => s.carryDistance)),
      total: avg(use.map(s => s.totalDistance)),
      count: use.length,
      mishitPct: recorded.length ? (recorded.length - clean.length) / recorded.length : null,
      offlineSigned: avg(offlines),
      offlineAbs: avg(offlines.map(Math.abs)),
      source: "Range"
    });
  }

  // fold in Grint baselines for clubs with no measured launch data
  const have = new Set(rows.map(r => r.club.toLowerCase()));
  for (const b of db.clubDistanceBaselines) {
    const club = (b.club || "").trim();
    if (!club || have.has(club.toLowerCase())) continue;
    const carry = num(b.averageYards) ?? num(b.medianYards);
    if (carry == null) continue;
    rows.push({ club, category: inferCategory(club), carry, total: null, count: null, mishitPct: null, offlineSigned: null, offlineAbs: null, source: b.source || "Grint" });
  }

  rows.sort((a, b) => {
    const d = bagOrderRank(a.club) - bagOrderRank(b.club);
    return d !== 0 ? d : (b.carry ?? 0) - (a.carry ?? 0);
  });
  return rows;
}

/* canonical bag order: driver → woods → hybrids → irons → wedges */
function bagOrderRank(club) {
  const v = (club || "").toLowerCase().trim();
  let m;
  if (v.includes("driver")) return 0;
  if ((m = v.match(/(\d+)\s*wood/))) return 10 + +m[1];
  if (v.includes("wood")) return 15;
  if ((m = v.match(/(\d+)\s*hybrid/))) return 30 + +m[1];
  if (v.includes("hybrid")) return 34;
  if ((m = v.match(/(\d+)\s*iron/))) return 40 + +m[1];
  if (v.includes("pitching")) return 60;
  if (v.includes("gap")) return 62;
  if (v.includes("sand")) return 72;
  if (v.includes("lob")) return 76;
  if ((m = v.match(/(\d+)\s*(?:°|deg)/))) return 60 + (+m[1] - 44);
  if (v.includes("wedge")) return 65;
  return 100;
}

/* ---------------- approach ---------------- */

const APPROACH_BANDS = [
  { label: "<60 yd", lo: -Infinity, hi: 60 },
  { label: "60–79 yd", lo: 60, hi: 80 },
  { label: "80–99 yd", lo: 80, hi: 100 },
  { label: "100–124 yd", lo: 100, hi: 125 },
  { label: "125–149 yd", lo: 125, hi: 150 },
  { label: "150–174 yd", lo: 150, hi: 175 },
  { label: "175+ yd", lo: 175, hi: Infinity }
];
function approachBandOf(target) {
  for (const b of APPROACH_BANDS) if (target >= b.lo && target < b.hi) return b.label;
  return "175+ yd";
}
function targetDistance(text) {
  const m = String(text || "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}
function circleRadius(target, hcp) {
  const base = Math.max(8, 4 + target * 0.10);
  const adj = 1 + clamp(hcp - 13, -8, 20) / 100;
  return base * adj;
}

function summarizeApproach(shots) {
  const bands = APPROACH_BANDS.map(b => {
    const g = shots.filter(x => x.band === b.label);
    return {
      label: b.label, attempts: g.length,
      execRate: g.length ? g.filter(x => x.success).length / g.length : null,
      avgMiss: avg(g.map(x => x.miss))
    };
  }).filter(b => b.attempts > 0);
  return {
    shots, bands,
    signedOffline: avg(shots.map(x => x.lateral)),
    signedCarry: avg(shots.map(x => x.carryDelta)),
    avgCircle: avg(shots.map(x => x.radius)),
    execRate: shots.length ? shots.filter(x => x.success).length / shots.length : null
  };
}

function approachModel() {
  const hcp = num(db.golfer.handicapIndex) ?? 13.5;
  const shots = [];
  for (const s of db.launchSessions) {
    if (inferCategory(s.club) !== "Approach" && s.category !== "Approach") continue;
    const target = targetDistance(s.target);
    if (target == null) continue;
    const club = (s.club || "").trim();
    for (const shot of (Array.isArray(s.shots) ? s.shots : [])) {
      if (shot.carryDistance == null) continue;
      const lateral = shot.offlineDistance ?? 0;
      const carryDelta = shot.carryDistance - target;
      const miss = Math.hypot(carryDelta, lateral);
      const radius = circleRadius(target, hcp);
      shots.push({ club, band: approachBandOf(target), target, lateral, carryDelta, miss, radius, success: miss <= radius });
    }
  }
  return summarizeApproach(shots);
}

function dirLR(v) { if (v == null) return ""; return v < 0 ? "Left" : v > 0 ? "Right" : "Center"; }
function dirSL(v) { if (v == null) return ""; return v < 0 ? "Short" : v > 0 ? "Long" : "Pin-high"; }

/* ---------------- rounds ---------------- */

function isNineHole(r) {
  if (r.holes && r.holes.length) return r.holes.length <= 9;
  if (r.score != null) return r.score < 60;
  return false;
}
function isPar3Course(r) {
  const pars = (r.holes || []).map(h => h.par).filter(p => p != null);
  return pars.length ? pars.every(p => p === 3) : false;
}
function fullRounds() { return db.rounds.filter(r => !isPar3Course(r)); }
function eighteenRounds() { return db.rounds.filter(r => !isNineHole(r) && !isPar3Course(r)); }

function roundStats() {
  const rs = eighteenRounds();
  const holes = rs.flatMap(r => r.holes || []);
  const scores = rs.map(r => r.score).filter(s => s != null);
  const fw = holes.filter(h => h.fairway && h.fairway !== "N/A");
  const gir = holes.filter(h => h.greenInRegulation != null);
  const puttedRounds = rs.filter(r => (r.holes || []).length);
  const parTypes = [3, 4, 5].map(par => {
    const hs = holes.filter(h => h.par === par && h.score != null);
    return { par, count: hs.length, toPar: hs.length ? avg(hs.map(h => h.score - par)) : null };
  }).filter(p => p.count > 0);
  // scrambling: missed GIR but scored par or better
  const scr = holes.filter(h => h.greenInRegulation === false && h.par != null && h.score != null);
  const scrMade = scr.filter(h => h.score <= h.par).length;
  return {
    n: rs.length,
    avgScore: avg(scores),
    bestScore: scores.length ? Math.min(...scores) : null,
    avgPutts: puttedRounds.length ? avg(puttedRounds.map(r => (r.holes || []).reduce((s, h) => s + (h.putts || 0), 0))) : null,
    firRate: fw.length ? fw.filter(h => h.fairway === "Hit").length / fw.length : null,
    girRate: gir.length ? gir.filter(h => h.greenInRegulation === true).length / gir.length : null,
    threePuttsPerRound: puttedRounds.length ? avg(puttedRounds.map(r => (r.holes || []).filter(h => (h.putts || 0) >= 3).length)) : null,
    parTypes,
    scrRate: scr.length ? scrMade / scr.length : null,
    trend: rs.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map(r => r.score).filter(s => s != null)
  };
}

/* ---------------- records ---------------- */

function records() {
  const out = [];
  const eighteen = eighteenRounds();
  const nine = db.rounds.filter(r => isNineHole(r) && !isPar3Course(r));
  const best18 = eighteen.map(r => r.score).filter(s => s != null);
  if (best18.length) out.push({ val: Math.min(...best18), unit: "", lbl: "Best 18" });
  const best9 = nine.map(r => r.score).filter(s => s != null);
  if (best9.length) out.push({ val: Math.min(...best9), unit: "", lbl: "Best 9" });

  const putted = eighteen.filter(r => (r.holes || []).length);
  if (putted.length) {
    const fewest = Math.min(...putted.map(r => (r.holes || []).reduce((s, h) => s + (h.putts || 0), 0)));
    out.push({ val: fewest, unit: "putts", lbl: "Fewest (18)" });
  }
  const girCounts = eighteen.map(r => (r.holes || []).filter(h => h.greenInRegulation === true).length);
  if (girCounts.some(c => c > 0)) out.push({ val: Math.max(...girCounts), unit: "GIR", lbl: "Most greens" });
  const firCounts = eighteen.map(r => (r.holes || []).filter(h => h.fairway === "Hit").length);
  if (firCounts.some(c => c > 0)) out.push({ val: Math.max(...firCounts), unit: "FW", lbl: "Most fairways" });

  const longMade = db.puttingSets.filter(s => (s.made || 0) > 0).map(s => s.distanceFeet || 0);
  if (longMade.length) out.push({ val: Math.max(...longMade), unit: "ft", lbl: "Made from" });

  const low = num(db.golfer.lowIndex);
  if (low != null) out.push({ val: r1(low), unit: "", lbl: "Low index" });
  return out.slice(0, 6);
}

/* ---------------- spotlight (weaknesses) ---------------- */

function spotlight(ladder, appr, rs) {
  const items = [];
  // short putts
  const short = ladder.filter(b => b.attempts >= 6 && /^(4–6|7–9|10–15) ft$/.test(b.label));
  const weakPutt = short.sort((a, b) => (a.makeRate ?? 1) - (b.makeRate ?? 1))[0];
  if (weakPutt && weakPutt.makeRate != null && weakPutt.makeRate < 0.6)
    items.push({ badge: pct(weakPutt.makeRate), title: `Makeable putts, ${weakPutt.label}`, why: `Only ${pct(weakPutt.makeRate)} falling (${weakPutt.made}/${weakPutt.attempts}). Build a ladder drill here — biggest scoring lever.`, sev: 0.6 - weakPutt.makeRate });
  // three putts
  const threeBands = ladder.filter(b => b.showThree && b.attempts >= 6 && b.threeRate != null);
  const weakThree = threeBands.sort((a, b) => (b.threeRate) - (a.threeRate))[0];
  if (weakThree && weakThree.threeRate > 0.1)
    items.push({ badge: pct(weakThree.threeRate), title: `3-putts from ${weakThree.label}`, why: `${pct(weakThree.threeRate)} three-putt rate. Work lag speed from distance to protect scores.`, sev: weakThree.threeRate });
  // approach
  const weakAppr = appr.bands.filter(b => b.attempts >= 5).sort((a, b) => (a.execRate ?? 1) - (b.execRate ?? 1))[0];
  if (weakAppr && weakAppr.execRate != null && weakAppr.execRate < 0.6)
    items.push({ badge: pct(weakAppr.execRate), title: `Approach ${weakAppr.label}`, why: `Hitting your circle only ${pct(weakAppr.execRate)} of the time. Avg miss ${r1(weakAppr.avgMiss)} yd.`, sev: 0.6 - weakAppr.execRate });
  // par-type scoring
  const weakPar = (rs.parTypes || []).filter(p => p.count >= 6).sort((a, b) => (b.toPar ?? 0) - (a.toPar ?? 0))[0];
  if (weakPar && weakPar.toPar != null && weakPar.toPar > 0.5)
    items.push({ badge: "+" + r1(weakPar.toPar), title: `Par ${weakPar.par}s`, why: `Averaging +${r1(weakPar.toPar)} to par on par ${weakPar.par}s. Plan a smarter miss off these tees.`, sev: weakPar.toPar / 3 });
  return items.sort((a, b) => b.sev - a.sev).slice(0, 2);
}

/* ---------------- game plan ---------------- */

function gamePlan(ladder, bag, appr, rs) {
  const rows = [];

  // lead with the money yardage: best-executing approach band = the layup number
  const money = appr.bands.filter(b => b.attempts >= 5).slice().sort((a, b) => (b.execRate ?? 0) - (a.execRate ?? 0))[0];
  if (money && money.execRate != null)
    rows.push(["Money range", `Lay up to <span class="em">${money.label}</span>`, `${pct(money.execRate)} inside the circle from there — pick your number, not just "closer".`]);

  const mk = makeableRange(ladder);
  if (mk) rows.push(["Makeable", `Confident through <span class="em">${mk.label.replace(" ft", " ft")}</span>`, `${pct(mk.makeRate)} make rate — be aggressive inside this.`]);

  if (appr.shots.length >= 6 && (appr.signedCarry != null || appr.signedOffline != null)) {
    const parts = [];
    if (appr.signedCarry != null && Math.abs(appr.signedCarry) >= 1) parts.push(`${Math.abs(Math.round(appr.signedCarry))} yd ${dirSL(appr.signedCarry)}`);
    if (appr.signedOffline != null && Math.abs(appr.signedOffline) >= 1) parts.push(`${Math.abs(Math.round(appr.signedOffline))} yd ${dirLR(appr.signedOffline)}`);
    if (parts.length) rows.push(["Approach bias", `Tends <span class="em">${parts.join(", ")}</span>`, "Aim to offset it — favor the fat side of the green."]);
  }

  if (rs.parTypes && rs.parTypes.length) {
    const best = rs.parTypes.slice().sort((a, b) => (a.toPar ?? 9) - (b.toPar ?? 9))[0];
    const worst = rs.parTypes.slice().sort((a, b) => (b.toPar ?? -9) - (a.toPar ?? -9))[0];
    if (best && worst && best.par !== worst.par)
      rows.push(["Scoring", `Attack <span class="em">par ${best.par}s</span> · protect <span class="em">par ${worst.par}s</span>`, `Best ${fmtToPar(best.toPar)}, toughest ${fmtToPar(worst.toPar)} per hole.`]);
  }

  if (rs.girRate != null) rows.push(["Greens", `Hitting <span class="em">${pct(rs.girRate)}</span> GIR`, rs.girRate < 0.4 ? "Take enough club and center-of-green targets." : "Solid — keep giving putts a look."]);
  return rows;
}
function fmtToPar(v) { if (v == null) return "—"; const r = r1(v); return r > 0 ? "+" + r : String(r); }

/* ---------------- rendering ---------------- */

function totalRecords() {
  return db.rounds.length + db.puttingSets.length + db.launchSessions.length + db.clubDistanceBaselines.length;
}

function render() {
  const has = totalRecords() > 0;
  document.getElementById("emptyState").hidden = has;
  document.getElementById("homeContent").hidden = !has;

  const hcp = num(db.golfer.handicapIndex);
  document.getElementById("hcpNum").textContent = hcp != null ? r1(hcp) : "—";

  const imported = localStorage.getItem(IMPORT_KEY);
  document.getElementById("freshness").textContent = imported ? "Synced " + new Date(imported).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
  document.getElementById("importStatus").textContent = imported
    ? `Loaded ${totalRecords()} records · ${new Date(imported).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "No file loaded on this device yet.";

  if (!has) { renderCounts(); return; }

  const ladder = puttingLadder();
  const bag = bagLadder();
  const appr = approachModel();
  const rs = roundStats();

  renderPlan(gamePlan(ladder, bag, appr, rs));
  renderSpotlight(spotlight(ladder, appr, rs));
  renderRecords(records());
  renderBag(bag, appr);
  renderGreens(ladder);
  renderRounds(rs);
  renderCounts();
}

function renderPlan(rows) {
  const el = document.getElementById("planBody");
  el.innerHTML = rows.length
    ? rows.map(([k, v, s]) => `<div class="play-row"><div class="play-key">${escapeHTML(k)}</div><div class="play-val">${v}<small>${escapeHTML(s)}</small></div></div>`).join("")
    : `<p class="muted">Load more launch and round data to build a plan.</p>`;
}

function renderSpotlight(items) {
  document.getElementById("spotlightCard").hidden = !items.length;
  document.getElementById("spotlightBody").innerHTML = items.map(i =>
    `<div class="spot-item"><div class="spot-badge">${i.badge}</div><div class="spot-text"><strong>${escapeHTML(i.title)}</strong><p>${i.why}</p></div></div>`).join("");
}

function renderRecords(recs) {
  document.getElementById("recordsBody").innerHTML = recs.map(r =>
    `<div class="record"><div class="r-val">${r.val}${r.unit ? `<small>${r.unit}</small>` : ""}</div><div class="r-lbl">${escapeHTML(r.lbl)}</div></div>`).join("")
    || `<p class="muted">No records yet.</p>`;
}

let apprClubFilter = "All";

function renderBag(bag, appr) {
  document.getElementById("bagEmpty").hidden = bag.length > 0;
  const el = document.getElementById("gappingBody");
  if (bag.length) {
    el.innerHTML = `
      <p class="section-label">Carry &amp; total by club · bag order</p>
      <div class="ladder">
        <div class="ladder-row head" style="grid-template-columns:1.4fr 1fr 1fr"><span>Club</span><span>Carry</span><span>Total</span></div>
        ${bag.map(r => `<div class="ladder-row" style="grid-template-columns:1.4fr 1fr 1fr">
            <div><span class="club-name">${escapeHTML(r.club)}</span><span class="club-src">${r.count ? r.count + " shots · " + r.source : r.source}</span></div>
            <div class="yd">${r.carry != null ? Math.round(r.carry) : "—"}<small> yd</small></div>
            <div class="yd">${r.total != null ? Math.round(r.total) : "<span style='color:var(--muted-2)'>—</span>"}</div>
          </div>`).join("")}
      </div>`;
  } else el.innerHTML = "";

  const head = document.getElementById("approachHead");
  const body = document.getElementById("approachBody");
  if (appr.shots.length) {
    head.hidden = false;
    // club filter chips (by shot count, desc)
    const counts = new Map();
    for (const s of appr.shots) if (s.club) counts.set(s.club, (counts.get(s.club) || 0) + 1);
    const clubs = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    if (apprClubFilter !== "All" && !counts.has(apprClubFilter)) apprClubFilter = "All";
    const filtered = apprClubFilter === "All" ? appr : summarizeApproach(appr.shots.filter(s => s.club === apprClubFilter));
    const chips = ["All", ...clubs].map(c =>
      `<button class="chip small ${c === apprClubFilter ? "active" : ""}" data-apprclub="${escapeHTML(c)}">${escapeHTML(c)}${c === "All" ? "" : ` <small>${counts.get(c)}</small>`}</button>`).join("");
    body.innerHTML = `
      <div class="panel">
        <div class="chip-row wrap" id="apprClubChips">${chips}</div>
        ${dispersionSVG(filtered)}
      </div>
      <div class="ladder">
        <div class="ladder-row head" style="grid-template-columns:1.4fr 1fr 1fr"><span>Distance</span><span>In circle</span><span>Avg miss</span></div>
        ${filtered.bands.map(b => `<div class="ladder-row" style="grid-template-columns:1.4fr 1fr 1fr">
          <div class="club-name">${b.label}</div>
          <div class="yd">${pct(b.execRate)}<small> ${b.attempts}</small></div>
          <div class="yd">${b.avgMiss != null ? r1(b.avgMiss) : "—"}<small> yd</small></div>
        </div>`).join("")}
      </div>`;
  } else { head.hidden = true; body.innerHTML = ""; }
}

function dispersionSVG(appr) {
  const S = 168, C = S / 2, pad = 14;
  const pts = appr.shots.slice(-120);
  const maxR = Math.max(
    appr.avgCircle ? appr.avgCircle * 1.3 : 12,
    ...pts.map(p => Math.max(Math.abs(p.lateral), Math.abs(p.carryDelta)))
  ) || 20;
  const scale = (C - pad) / maxR;
  const circle = appr.avgCircle ? appr.avgCircle * scale : 0;
  const dots = pts.map(p =>
    `<circle cx="${(C + p.lateral * scale).toFixed(1)}" cy="${(C - p.carryDelta * scale).toFixed(1)}" r="2.6" fill="${p.success ? "var(--green)" : "var(--red)"}" opacity="0.82"/>`
  ).join("");
  const lr = appr.signedOffline, sl = appr.signedCarry;
  return `<div class="disp-wrap">
    <svg class="disp-plot" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
      <line x1="${C}" y1="6" x2="${C}" y2="${S - 6}" stroke="var(--line)" stroke-width="1"/>
      <line x1="6" y1="${C}" x2="${S - 6}" y2="${C}" stroke="var(--line)" stroke-width="1"/>
      ${circle ? `<circle cx="${C}" cy="${C}" r="${circle.toFixed(1)}" fill="var(--green-dim)" stroke="var(--green-deep)" stroke-dasharray="3 3" stroke-width="1"/>` : ""}
      ${dots}
      <circle cx="${C}" cy="${C}" r="3" fill="none" stroke="var(--ink)" stroke-width="1.4"/>
      <text x="${C}" y="12" fill="var(--muted-2)" font-size="9" text-anchor="middle">LONG</text>
      <text x="${C}" y="${S - 3}" fill="var(--muted-2)" font-size="9" text-anchor="middle">SHORT</text>
    </svg>
    <div class="disp-legend">
      <div class="disp-stat"><span>In circle</span><b>${pct(appr.execRate)}</b></div>
      <div class="disp-stat"><span>Depth bias</span><b>${sl != null ? Math.abs(Math.round(sl)) + " " + dirSL(sl) : "—"}</b></div>
      <div class="disp-stat"><span>Side bias</span><b>${lr != null ? Math.abs(Math.round(lr)) + " " + dirLR(lr) : "—"}</b></div>
      <div class="disp-stat"><span>Shots</span><b>${appr.shots.length}</b></div>
    </div>
  </div>`;
}

function renderGreens(ladder) {
  document.getElementById("greensEmpty").hidden = ladder.length > 0;
  const el = document.getElementById("puttingBody");
  if (ladder.length) {
    el.innerHTML = `
      <p class="section-label">Practice make rate by distance</p>
      <div class="ladder">
        ${ladder.map(b => {
          const rate = b.makeRate ?? 0;
          const cls = rate >= 0.5 ? "" : rate >= 0.25 ? "warn" : "low";
          const three = b.showThree && b.threeRate != null ? `<div class="bar-sub">3-putt ${pct(b.threeRate)}</div>` : "";
          return `<div class="bar-row">
            <div class="bar-top"><div class="bar-label">${b.label}<small>${b.made}/${b.attempts}</small></div><div class="bar-val">${pct(b.makeRate)}</div></div>
            <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.round(clamp(rate, 0, 1) * 100)}%"></div></div>
            ${three}
          </div>`;
        }).join("")}
      </div>`;
  } else el.innerHTML = "";

  // round putting
  const rp = document.getElementById("roundPuttingBody");
  const rs = roundStats();
  if (rs.avgPutts != null) {
    rp.innerHTML = `
      <p class="section-label">On the course</p>
      <div class="metric-row">
        <div class="metric-cell"><div class="m-val">${r1(rs.avgPutts)}</div><div class="m-lbl">Putts / round</div></div>
        <div class="metric-cell"><div class="m-val">${rs.threePuttsPerRound != null ? r1(rs.threePuttsPerRound) : "—"}</div><div class="m-lbl">3-putts / rd</div></div>
        <div class="metric-cell"><div class="m-val">${pct(rs.girRate)}</div><div class="m-lbl">GIR</div></div>
      </div>`;
  } else rp.innerHTML = "";
}

function renderRounds(rs) {
  const list = db.rounds.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  document.getElementById("roundsEmpty").hidden = list.length > 0;

  const summary = document.getElementById("roundsSummary");
  if (rs.n > 0) {
    summary.innerHTML = `
      <div class="metric-row">
        <div class="metric-cell"><div class="m-val">${rs.avgScore != null ? r1(rs.avgScore) : "—"}</div><div class="m-lbl">Avg (18)</div></div>
        <div class="metric-cell"><div class="m-val">${rs.bestScore ?? "—"}</div><div class="m-lbl">Best</div></div>
        <div class="metric-cell"><div class="m-val">${rs.avgPutts != null ? r1(rs.avgPutts) : "—"}</div><div class="m-lbl">Putts</div></div>
      </div>
      <div class="metric-row">
        <div class="metric-cell"><div class="m-val">${pct(rs.firRate)}</div><div class="m-lbl">Fairways</div></div>
        <div class="metric-cell"><div class="m-val">${pct(rs.girRate)}</div><div class="m-lbl">Greens</div></div>
        <div class="metric-cell"><div class="m-val">${pct(rs.scrRate)}</div><div class="m-lbl">Scramble</div></div>
      </div>
      ${rs.trend.length >= 3 ? `<div class="panel trend-card"><div class="panel-head"><p class="eyebrow">SCORING TREND · 18</p><span class="freshness">${rs.n} rounds</span></div>${sparkline(rs.trend)}</div>` : ""}
      ${rs.parTypes.length ? `<div class="panel"><div class="panel-head"><p class="eyebrow">AVG TO PAR</p></div><div class="par-splits">${rs.parTypes.map(p => `<div class="par-cell"><div class="p-to">${fmtToPar(p.toPar)}</div><div class="p-lbl">Par ${p.par}s</div></div>`).join("")}</div></div>` : ""}
    `;
  } else summary.innerHTML = "";

  const listEl = document.getElementById("roundsList");
  const shown = list.slice(0, 25);
  listEl.innerHTML = shown.length ? `
    <p class="section-label">Recent cards${list.length > shown.length ? ` · ${shown.length} of ${list.length}` : ""}</p>
    <div class="ladder">
      ${shown.map(r => {
        const holes = r.holes || [];
        const putts = holes.reduce((s, h) => s + (h.putts || 0), 0);
        const gir = holes.filter(h => h.greenInRegulation === true).length;
        const fir = holes.filter(h => h.fairway === "Hit").length;
        const tags = [];
        if (putts) tags.push(`<span class="tag">putts <b>${putts}</b></span>`);
        if (holes.some(h => h.greenInRegulation != null)) tags.push(`<span class="tag">GIR <b>${gir}</b></span>`);
        if (holes.some(h => h.fairway && h.fairway !== "N/A")) tags.push(`<span class="tag">FW <b>${fir}</b></span>`);
        return `<div class="round-item">
          <div class="round-score">${r.score ?? "—"}</div>
          <div class="round-mid"><strong>${escapeHTML(r.courseName || "Round")}</strong><small>${fmtDate(r.date)}${r.teeName ? " · " + escapeHTML(r.teeName) : ""}${isNineHole(r) ? " · 9" : ""}</small></div>
          <div class="round-tags">${tags.join("")}</div>
        </div>`;
      }).join("")}
    </div>` : "";
}

function sparkline(scores) {
  const W = 480, H = 64, pad = 6;
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const span = (hi - lo) || 1;
  const step = scores.length > 1 ? (W - pad * 2) / (scores.length - 1) : 0;
  const pts = scores.map((s, i) => [pad + i * step, H - pad - ((s - lo) / span) * (H - pad * 2)]);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="var(--green)"/>`).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="var(--green)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}

function renderCounts() {
  const panel = document.getElementById("countsPanel");
  const has = totalRecords() > 0;
  panel.hidden = !has;
  if (!has) return;
  const cells = [
    ["Rounds", db.rounds.length], ["Putting", db.puttingSets.length], ["Launch", db.launchSessions.length],
    ["Sim", db.simulatorRounds.length], ["Courses", db.courses.length], ["Baselines", db.clubDistanceBaselines.length]
  ];
  document.getElementById("countsBody").innerHTML = cells.map(([l, v]) => `<div class="count-cell"><b>${v}</b><span>${l}</span></div>`).join("");
}

/* ---------------- Stewart (caddie · beta) ---------------- */

/* plays-like adjustments: wind as % of the shot, elevation in yards */
const WIND_PCT = {
  into:  { light: 0.05, medium: 0.10, strong: 0.20 },
  down:  { light: -0.04, medium: -0.07, strong: -0.12 },
  cross: { light: 0.02, medium: 0.04, strong: 0.06 } // cross still knocks a little off carry; hold your line
};
const ELEV_YDS = {
  up:   { slight: 4, moderate: 8, big: 14 },
  down: { slight: -4, moderate: -8, big: -14 }
};

const stew = { wind: "none", windStr: "light", elev: "flat", elevAmt: "slight" };

function stewartClubs() {
  return bagLadder().filter(r => r.carry != null).sort((a, b) => a.carry - b.carry);
}

function stewartCall(yards) {
  const clubs = stewartClubs();
  if (!clubs.length) return { line: "Can't club you without your carries, boss — load the sync file first.", detail: "" };

  const windAdj = stew.wind !== "none" ? Math.round(yards * WIND_PCT[stew.wind][stew.windStr]) : 0;
  const elevAdj = stew.elev !== "flat" ? ELEV_YDS[stew.elev][stew.elevAmt] : 0;
  const plays = Math.round(yards + windAdj + elevAdj);

  const parts = [`${yards} to the pin`];
  if (windAdj) parts.push(`${windAdj > 0 ? "+" : ""}${windAdj} wind`);
  if (elevAdj) parts.push(`${elevAdj > 0 ? "+" : ""}${elevAdj} slope`);
  const detail = parts.join(" · ") + ` → plays ${plays}`;

  const longest = clubs[clubs.length - 1];
  const shortest = clubs[0];
  if (plays > longest.carry + 8)
    return { line: `That's playing ${plays} — all of it. ${longest.club} and commit.`, detail: `${detail}. ${longest.club} carries ${Math.round(longest.carry)}.` };
  if (plays < shortest.carry - 12)
    return { line: `That's playing ${plays} — inside your shortest carry. Feel shot with the ${shortest.club}.`, detail: `${detail}. ${shortest.club} carries ${Math.round(shortest.carry)}.` };

  // take enough club: shortest carry that still covers the number (small grace)
  const pick = clubs.find(c => c.carry >= plays - 2) || longest;
  const diff = pick.carry - plays;
  const feel = diff >= 5 ? "smooth" : diff <= -3 ? "hard" : "stock";
  const flavor = feel === "smooth" ? ", don't force it" : feel === "hard" ? " — stay through it" : "";
  const shots = pick.count ? ` (${pick.count} shots logged)` : "";
  return {
    line: `That's playing ${plays} — ${feel} ${pick.club}${flavor}.`,
    detail: `${detail}. Your ${pick.club} carries ${Math.round(pick.carry)}${shots}.`
  };
}

/* ---- Course-attack framework (scaffold — course input UI ships next update) ----
   Profile shape Stewart will consume:
     { name, tee, holes: [{ number, par, yards,
         hazards: [{ type: "water"|"ob"|"bunker"|"trees", side: "left"|"right"|"long"|"short", carry: 230 }],
         green: { depth: 28, favor: "front-left" }, notes: "" }] }
   Next update adds the input UI (and/or reads db.courses, which already rides
   along in the sync file). Nothing calls stewartAttack yet. */
const COURSE_PROFILES = [];

function stewartAttack(hole) {
  const bag = stewartClubs();
  if (!hole || !bag.length) return null;
  if (hole.par === 3) return { shot: "tee", ...stewartCall(hole.yards) };
  // tee club: longest club that stays short of the first hazard carry (10 yd buffer)
  const dangers = (hole.hazards || []).map(h => h.carry).filter(c => c != null);
  const ceiling = dangers.length ? Math.min(...dangers) - 10 : Infinity;
  const tee = bag.filter(c => c.carry <= ceiling).pop() || bag[0];
  // approach: lay up to the best-executing band (the "money range")
  const money = approachModel().bands.filter(b => b.attempts >= 5).sort((a, b) => (b.execRate ?? 0) - (a.execRate ?? 0))[0];
  return { shot: "tee", club: tee.club, layupTo: money ? money.label : null, notes: hole.notes || "" };
}

function bindStewart() {
  const bindChips = (rowId, attr, subRowId, onPick) => {
    document.getElementById(rowId).addEventListener("click", e => {
      const btn = e.target.closest(`[data-${attr}]`);
      if (!btn) return;
      document.querySelectorAll(`#${rowId} .chip`).forEach(c => c.classList.toggle("active", c === btn));
      onPick(btn.dataset[attr]);
      if (subRowId) document.getElementById(subRowId).hidden = btn.dataset[attr] === "none" || btn.dataset[attr] === "flat";
    });
  };
  bindChips("stewWindDir", "wind", "stewWindStr", v => { stew.wind = v; });
  bindChips("stewWindStr", "windstr", null, v => { stew.windStr = v; });
  bindChips("stewElevDir", "elev", "stewElevAmt", v => { stew.elev = v; });
  bindChips("stewElevAmt", "elevamt", null, v => { stew.elevAmt = v; });

  document.getElementById("goodProcess").addEventListener("click", () => {
    const yards = parseFloat(document.getElementById("stewYards").value);
    const out = document.getElementById("stewAnswer");
    if (!isFinite(yards) || yards <= 0) {
      out.hidden = false;
      out.innerHTML = `<div class="stew-line">Need a number first, boss.</div>`;
      return;
    }
    const call = stewartCall(yards);
    out.hidden = false;
    out.innerHTML = `<div class="stew-line">${escapeHTML(call.line)}</div>${call.detail ? `<small>${escapeHTML(call.detail)}</small>` : ""}`;
  });
}

/* ---------------- navigation + events ---------------- */

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === id));
  document.querySelectorAll(".tab-bar button").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  window.scrollTo({ top: 0, behavior: "instant" });
}

document.addEventListener("click", e => {
  const target = e.target.closest("[data-view]");
  if (target) showView(target.dataset.view);
  const chip = e.target.closest("[data-apprclub]");
  if (chip) {
    apprClubFilter = chip.dataset.apprclub;
    renderBag(bagLadder(), approachModel());
  }
});

document.getElementById("syncFileInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || parsed.schemaVersion == null) throw new Error("Not a Fairway Log database");
    db = normalize(parsed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    localStorage.setItem(IMPORT_KEY, new Date().toISOString());
    render();
    toast(`Loaded ${totalRecords()} records`);
    showView("homeView");
  } catch (err) {
    toast("Could not read file: " + err.message);
  }
  e.target.value = "";
});

document.getElementById("clearLocalData").addEventListener("click", () => {
  if (!confirm("Clear this device's cached copy? Your Mac data and files are untouched.")) return;
  db = emptyDatabase();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(IMPORT_KEY);
  render();
  toast("Cached copy cleared");
});

bindStewart();
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js");
}
