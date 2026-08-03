
const DATA = window.OPERATIONSLOGS_MASTER_DATA;
const DB_NAME = "OperationsLogsDB";
const DB_VERSION = 3;
let db;
let currentType = "winch";
let editingFlightId = null;
let currentAdminList = "names";
const flyingDaySaveTimers = new Map();
let lastLoadedRunway = "";
const flyingDayDirtyFields = new Set();

const $ = id => document.getElementById(id);
const upper = value => (value || "").trim().replace(/\s+/g, " ").toUpperCase();
const todayISO = () => new Date().toISOString().slice(0, 10);
const timeHHMM = () => new Date().toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit"}).replace(":", "");

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains("days")) {
        database.createObjectStore("days", {keyPath:"date"});
      }
      if (!database.objectStoreNames.contains("flights")) {
        const store = database.createObjectStore("flights", {keyPath:"id"});
        store.createIndex("date", "date", {unique:false});
      }
      if (!database.objectStoreNames.contains("syncQueue")) {
        database.createObjectStore("syncQueue", {keyPath:"id"});
      }
      if (!database.objectStoreNames.contains("masterLists")) {
        database.createObjectStore("masterLists", {keyPath:"key"});
      }
      if (!database.objectStoreNames.contains("conflicts")) {
        database.createObjectStore("conflicts", {keyPath:"id"});
      }
    };
    request.onsuccess = e => { db = e.target.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function get(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function remove(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

const MASTER_LIST_KEYS = ["names", "gliders", "tugAircraft", "tugPilots", "payees"];

function cleanMasterValues(values) {
  return [...new Set((values || []).map(upper).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en-GB"));
}

async function loadMasterLists() {
  for (const key of MASTER_LIST_KEYS) {
    const saved = await get("masterLists", key);
    const defaults = Array.isArray(DATA[key]) ? DATA[key] : [];
    DATA[key] = cleanMasterValues(saved?.values ?? defaults);
  }
  if (!DATA.payees.length) DATA.payees = ["P1", "P2", "VOUCHER", "SHARE"];
  refreshMasterDatalists();
}

async function saveMasterList(key) {
  DATA[key] = cleanMasterValues(DATA[key]);
  await put("masterLists", {
    key,
    values: DATA[key],
    modifiedAt: new Date().toISOString()
  });
  refreshMasterDatalists();
  await syncMasterList(key);
}

function getFlightsByDate(date) {
  return new Promise((resolve, reject) => {
    const req = db.transaction("flights").objectStore("flights").index("date").getAll(date);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function removeFlight(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("flights", "readwrite");
    tx.objectStore("flights").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function fillList(id, values) {
  $(id).innerHTML = values.map(v => `<option value="${String(v).replaceAll('"','&quot;')}"></option>`).join("");
}
function refreshMasterDatalists() {
  fillList("nameList", DATA.names);
  fillList("nameListWithSolo", ["SOLO", ...DATA.names]);
  fillList("tugAircraftList", DATA.tugAircraft);
  fillList("tugPilotList", DATA.tugPilots);
  fillList("gliderList", DATA.gliders);
  fillList("payeeList", DATA.payees);
}
function initialiseLists() {
  refreshMasterDatalists();
  $("runway").innerHTML = DATA.runways.map(v => `<option>${v}</option>`).join("");
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo(0,0);
}
function setDate(date) {
  $("flyingDate").value = date;
  $("flyingDay").value = new Date(date + "T12:00:00").toLocaleDateString("en-GB", {weekday:"long"}).toUpperCase();
}
function isValidHHMM(value) {
  if (!/^\d{4}$/.test(value)) return false;
  const h = +value.slice(0,2), m = +value.slice(2);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
function calcDuration(start, end) {
  if (!isValidHHMM(start) || !isValidHHMM(end)) return "";
  const sh = +start.slice(0,2), sm = +start.slice(2);
  const eh = +end.slice(0,2), em = +end.slice(2);
  let mins = (eh*60+em) - (sh*60+sm);
  if (mins < 0) mins += 1440;
  return mins;
}
function elapsedMinutes(flight) {
  if (flight.status !== "airborne") return +flight.duration || 0;
  const start = new Date(flight.takeoffAt || flight.createdAt);
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
}
function hhmmToDate(date, hhmm) {
  const dt = new Date(date + "T00:00:00");
  dt.setHours(+hhmm.slice(0,2), +hhmm.slice(2), 0, 0);
  if (dt.getTime() > Date.now() + 12*60*60*1000) dt.setDate(dt.getDate()-1);
  return dt.toISOString();
}
function validateListed(inputId, validValues, allowSolo=false) {
  const el = $(inputId);
  const value = upper(el.value);
  el.value = value;
  const warning = document.querySelector(`[data-warning-for="${inputId}"]`);
  if (!value) { warning.textContent = ""; return false; }
  const okay = validValues.includes(value) || (allowSolo && value === "SOLO");
  if (okay) {
    warning.textContent = "";
  } else {
    const listMap = {
      p1: "names",
      p2: "names",
      glider: "gliders",
      tugReg: "tugAircraft",
      tugPilot: "tugPilots"
    };
    const listKey = listMap[inputId];
    warning.innerHTML = `⚠ ${excelXmlEscape(value)} IS NOT ON THE APPROVED LIST. IT MAY STILL BE USED.` +
      (listKey ? ` <button type="button" class="inline-add-btn" data-add-master="${listKey}" data-add-value="${excelXmlEscape(value)}">ADD TO LIST</button>` : "");
  }
  return !okay;
}
function wireValidation() {
  document.querySelectorAll(".uppercase").forEach(el => {
    el.addEventListener("input", () => {
      const pos = el.selectionStart;
      el.value = el.value.toUpperCase();
      try { el.setSelectionRange(pos, pos); } catch {}
    });
    el.addEventListener("blur", () => el.value = upper(el.value));
  });
  $("p1").addEventListener("blur", () => validateListed("p1", DATA.names));
  $("p2").addEventListener("blur", () => validateListed("p2", DATA.names, true));
  $("tugReg").addEventListener("blur", () => validateListed("tugReg", DATA.tugAircraft));
  $("tugPilot").addEventListener("blur", () => validateListed("tugPilot", DATA.tugPilots));
  $("glider").addEventListener("blur", () => validateListed("glider", DATA.gliders));
  ["takeoff","landing"].forEach(id => $(id).addEventListener("input", () => {
    $(id).value = $(id).value.replace(/\D/g,"").slice(0,4);
    $("duration").value = calcDuration($("takeoff").value, $("landing").value);
    $("saveFlightBtn").textContent = $("landing").value ? "SAVE COMPLETED FLIGHT" : "SAVE AS AIRBORNE";
  }));
}

async function loadDay() {
  const date = $("flyingDate").value;
  const day = await get("days", date);
  const pendingPatch = typeof pendingDayFields === "function"
    ? await pendingDayFields(date)
    : {};

  if (day) {
    if (!flyingDayDirtyFields.has("day") && !Object.prototype.hasOwnProperty.call(pendingPatch, "day")) {
      $("flyingDay").value = day.day || new Date(date + "T12:00:00").toLocaleDateString("en-GB", {weekday:"long"}).toUpperCase();
    }
    if (!flyingDayDirtyFields.has("runway") && !Object.prototype.hasOwnProperty.call(pendingPatch, "runway")) {
      $("runway").value = day.runway || DATA.runways[0] || "";
      lastLoadedRunway = day.runway || "";
    }
    if (!flyingDayDirtyFields.has("windDirection") && !Object.prototype.hasOwnProperty.call(pendingPatch, "windDirection")) {
      $("windDirection").value = day.windDirection || "";
    }
    if (!flyingDayDirtyFields.has("windSpeed") && !Object.prototype.hasOwnProperty.call(pendingPatch, "windSpeed")) {
      $("windSpeed").value = day.windSpeed || "";
    }
  } else {
    $("flyingDay").value = new Date(date + "T12:00:00").toLocaleDateString("en-GB", {weekday:"long"}).toUpperCase();
    $("runway").value = DATA.runways[0] || "";
    $("windDirection").value = "";
    $("windSpeed").value = "";
    lastLoadedRunway = $("runway").value;
    if (!navigator.onLine || !currentDevice?.approved) {
      await saveDayFields(["day", "runway", "windDirection", "windSpeed"], false);
    }
  }

  await updateDashboard();
}

async function saveDayFields(changedFields, confirmRunwayChange = true) {
  const date = $("flyingDate").value;
  const existing = (await get("days", date)) || {
    date,
    day: $("flyingDay").value,
    runway: "",
    windDirection: "",
    windSpeed: "",
    modifiedAt: new Date().toISOString()
  };

  const patch = {};
  if (changedFields.includes("day")) patch.day = $("flyingDay").value;
  if (changedFields.includes("runway")) patch.runway = $("runway").value;
  if (changedFields.includes("windDirection")) patch.windDirection = $("windDirection").value.trim();
  if (changedFields.includes("windSpeed")) patch.windSpeed = $("windSpeed").value.trim();

  if (
    changedFields.includes("runway") &&
    confirmRunwayChange &&
    lastLoadedRunway &&
    patch.runway &&
    patch.runway !== lastLoadedRunway
  ) {
    const confirmed = await askYesNo(
      `CHANGE RUNWAY FROM ${lastLoadedRunway} TO ${patch.runway} FOR ALL DEVICES?`
    );
    if (!confirmed) {
      $("runway").value = lastLoadedRunway;
      flyingDayDirtyFields.delete("runway");
      return false;
    }
  }

  const modifiedAt = new Date().toISOString();
  const value = { ...existing, ...patch, date, modifiedAt };
  await put("days", value);

  if (changedFields.includes("runway")) lastLoadedRunway = value.runway;

  for (const [fieldName, fieldValue] of Object.entries(patch)) {
    await queueFlyingDayField(date, fieldName, fieldValue, modifiedAt);
  }

  if (navigator.onLine && currentDevice?.approved) {
    setTimeout(() => reconcileCloudState("flying day field saved"), 500);
  }
  return true;
}

function scheduleFlyingDayFieldSave(fieldName, options = {}) {
  flyingDayDirtyFields.add(fieldName);
  const existingTimer = flyingDaySaveTimers.get(fieldName);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    try {
      const saved = await saveDayFields(
        [fieldName],
        options.confirmRunwayChange !== false
      );
      if (saved) flyingDayDirtyFields.delete(fieldName);
    } catch (error) {
      console.error(`Flying day ${fieldName} auto-save failed:`, error);
      setSyncStatus("SYNC PROBLEM · FLYING DAY", "error");
    } finally {
      flyingDaySaveTimers.delete(fieldName);
    }
  }, 700);

  flyingDaySaveTimers.set(fieldName, timer);
}

function openEntry(type) {
  editingFlightId = null;
  currentType = type;
  $("entryTitle").textContent = type === "winch" ? "New Winch Flight" : "New Aerotow Flight";
  $("aerotowOnly").classList.toggle("visible", type === "aerotow");
  $("flightForm").reset();
  $("p2").value = "";
  $("formMessage").textContent = "";
  $("saveFlightBtn").textContent = "SAVE AS AIRBORNE";
  document.querySelectorAll(".warning-text").forEach(x => x.textContent = "");
  showView("entryView");
}
async function saveFlight(e) {
  e.preventDefault();
  const takeoff = $("takeoff").value, landing = $("landing").value;
  if (!isValidHHMM(takeoff)) {
    $("formMessage").textContent = "ENTER A VALID FOUR-DIGIT TAKE-OFF TIME.";
    return;
  }
  if (landing && !isValidHHMM(landing)) {
    $("formMessage").textContent = "ENTER A VALID FOUR-DIGIT LANDING TIME OR LEAVE IT BLANK.";
    return;
  }

  let p2Value = upper($("p2").value);
  if (!p2Value) {
    const isSolo = await askYesNo("P2 IS BLANK. IS THIS A SOLO FLIGHT?");
    if (isSolo) {
      p2Value = "SOLO";
      $("p2").value = "SOLO";
    } else {
      $("p2").focus();
      $("formMessage").textContent = "ENTER P2 OR SELECT SOLO.";
      return;
    }
  }

  const warnings = [];
  if (validateListed("glider", DATA.gliders)) warnings.push("UNLISTED GLIDER");
  if (validateListed("p1", DATA.names)) warnings.push("UNLISTED P1");
  if (validateListed("p2", DATA.names, true)) warnings.push("UNLISTED P2");
  if (currentType === "aerotow" && validateListed("tugReg", DATA.tugAircraft)) warnings.push("UNLISTED TUG AIRCRAFT");
  if (currentType === "aerotow" && validateListed("tugPilot", DATA.tugPilots)) warnings.push("UNLISTED TUG PILOT");

  const date = $("flyingDate").value;
  const existing = await getFlightsByDate(date);
  const sameGliderAirborne = existing.find(f =>
    f.status === "airborne" &&
    upper(f.glider) === upper($("glider").value) &&
    f.id !== editingFlightId
  );
  if (sameGliderAirborne && !confirm(`${upper($("glider").value)} IS ALREADY SHOWN AS AIRBORNE. SAVE ANOTHER OPEN FLIGHT?`)) return;

  const now = new Date().toISOString();
  const status = landing ? "completed" : "airborne";
  const duration = landing ? calcDuration(takeoff, landing) : "";

  let flight;
  if (editingFlightId) {
    flight = await get("flights", editingFlightId);
    if (!flight) {
      $("formMessage").textContent = "THE FLIGHT COULD NOT BE FOUND.";
      return;
    }
  } else {
    const id = `${currentType === "winch" ? "WL" : "AT"}-${date.replaceAll("-","")}-${crypto.randomUUID()}`;
    flight = {
      id,
      createdAt: now,
      createdOnDevice: "local"
    };
  }

  Object.assign(flight, {
    type: currentType,
    date,
    status,
    tugReg: upper($("tugReg").value),
    tugPilot: upper($("tugPilot").value),
    towHeight: $("towHeight").value.trim(),
    glider: upper($("glider").value),
    p1: upper($("p1").value),
    p2: p2Value,
    payee: upper($("payee").value),
    takeoff,
    landing,
    duration,
    takeoffAt: hhmmToDate(date, takeoff),
    landedAt: landing ? hhmmToDate(date, landing) : null,
    remarks: upper($("remarks").value),
    aeros: $("aeros").value.trim(),
    officeUse: upper($("officeUse").value),
    warnings,
    syncStatus: "pending",
    modifiedAt: now
  });

  flight.syncStatus = "pending";
  flight.pendingModifiedAt = flight.modifiedAt;
  await put("flights", flight);
  await queueSyncRecord("flight", flight.id, "upsert");
  editingFlightId = null;
  showView("homeView");
  await updateDashboard();
}

async function editFlight(id) {
  const flight = await get("flights", id);
  if (!flight) {
    alert("THE FLIGHT COULD NOT BE FOUND.");
    return;
  }

  editingFlightId = id;
  currentType = flight.type;
  $("entryTitle").textContent = `Edit ${flight.type === "winch" ? "Winch" : "Aerotow"} Flight`;
  $("aerotowOnly").classList.toggle("visible", flight.type === "aerotow");

  $("tugReg").value = flight.tugReg || "";
  $("tugPilot").value = flight.tugPilot || "";
  $("towHeight").value = flight.towHeight || "";
  $("glider").value = flight.glider || "";
  $("p1").value = flight.p1 || "";
  $("p2").value = flight.p2 || "";
  $("payee").value = flight.payee || "";
  $("takeoff").value = flight.takeoff || "";
  $("landing").value = flight.landing || "";
  $("duration").value = flight.duration || "";
  $("remarks").value = flight.remarks || "";
  $("aeros").value = flight.aeros || "";
  $("officeUse").value = flight.officeUse || "";
  $("formMessage").textContent = "";
  $("saveFlightBtn").textContent = flight.status === "airborne" ? "SAVE AIRBORNE CHANGES" : "SAVE FLIGHT CHANGES";
  document.querySelectorAll(".warning-text").forEach(x => x.textContent = "");
  validateListed("glider", DATA.gliders);
  validateListed("p1", DATA.names);
  validateListed("p2", DATA.names, true);
  if (flight.type === "aerotow") {
    validateListed("tugReg", DATA.tugAircraft);
    validateListed("tugPilot", DATA.tugPilots);
  }
  showView("entryView");
}


function hhmmValue(value) {
  const text = String(value || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

function operationalTimeValue(flight) {
  if (flight.status === "airborne") return hhmmValue(flight.takeoff);
  return hhmmValue(flight.landing || flight.takeoff);
}

async function updateDashboard() {
  if (!db) return;
  const flights = await getFlightsByDate($("flyingDate").value);
  const completed = flights.filter(f => (f.status || "completed") === "completed");
  const airborne = flights.filter(f => f.status === "airborne").sort((a, b) => operationalTimeValue(b) - operationalTimeValue(a));
  $("winchCount").textContent = flights.filter(f => f.type === "winch").length;
  $("aerotowCount").textContent = flights.filter(f => f.type === "aerotow").length;
  $("minutesCount").textContent = completed.reduce((a,f) => a + (+f.duration || 0), 0);
  $("warningCount").textContent = flights.reduce((a,f) => a + (f.warnings?.length || 0), 0);
  $("airborneCountBadge").textContent = airborne.length;
  $("airborneList").innerHTML = airborne.length ? airborne.map(f => `
    <article class="airborne-card" data-airborne-id="${f.id}">
      <h3>${f.glider} · ${f.type.toUpperCase()}</h3>
      <p><strong>P1:</strong> ${f.p1} &nbsp; <strong>P2:</strong> ${f.p2 || "SOLO"}</p>
      <p>Took off <strong>${f.takeoff}</strong></p>
      <p class="elapsed">${elapsedMinutes(f)} MINUTES AIRBORNE</p>
      <div class="airborne-actions">
        <button type="button" class="land-btn" data-land-now="${f.id}">LAND NOW</button>
        <button type="button" class="manual-land-btn" data-land-manual="${f.id}">ENTER TIME</button>
      </div>
    </article>`).join("") : '<p class="muted">No aircraft currently airborne.</p>';
}
async function landFlight(id, landingTime) {
  const flight = await get("flights", id);
  if (!flight || flight.status !== "airborne") return;
  if (!isValidHHMM(landingTime)) {
    alert("ENTER A VALID FOUR-DIGIT LANDING TIME.");
    return;
  }
  flight.landing = landingTime;
  flight.landedAt = hhmmToDate(flight.date, landingTime);
  flight.duration = calcDuration(flight.takeoff, landingTime);
  flight.status = "completed";
  flight.modifiedAt = new Date().toISOString();
  flight.syncStatus = "pending";
  flight.pendingModifiedAt = flight.modifiedAt;
  flight.syncStatus = "pending";
  flight.pendingModifiedAt = flight.modifiedAt;
  await put("flights", flight);
  await queueSyncRecord("flight", id, "upsert");
  await updateDashboard();
  if (navigator.onLine && currentDevice?.approved) {
    setTimeout(() => reconcileCloudState("landing saved"), 500);
  }
}

function reviewSortTime(flight) {
  return operationalTimeValue(flight);
}

async function reviewFlights() {
  const date = $("flyingDate").value;
  const flights = await getFlightsByDate(date);

  flights.sort((a, b) => {
    const aAirborne = a.status === "airborne" ? 1 : 0;
    const bAirborne = b.status === "airborne" ? 1 : 0;
    if (aAirborne !== bAirborne) return bAirborne - aAirborne;
    return reviewSortTime(b) - reviewSortTime(a);
  });

  $("reviewDate").textContent = new Date(date+"T12:00:00").toLocaleDateString("en-GB");
  $("flightList").innerHTML = flights.length ? flights.map((f,i) => `
    <article class="flight-card ${f.warnings?.length ? "warning" : ""}">
      <h3>${i+1}. ${f.type.toUpperCase()} — ${f.glider}</h3>
      <p><strong>P1:</strong> ${f.p1} &nbsp; <strong>P2:</strong> ${f.p2 || "SOLO"}</p>
      ${f.type === "aerotow" ? `<p><strong>TUG:</strong> ${f.tugReg} — ${f.tugPilot}</p>` : ""}
      <p><strong>${f.takeoff}${f.landing ? "–"+f.landing : " · AIRBORNE"}</strong>${f.status === "airborne" ? ` · ${elapsedMinutes(f)} MINUTES SO FAR` : ` · ${f.duration} MINUTES`}</p>
      ${f.remarks ? `<p>${f.remarks}</p>` : ""}
      ${f.warnings?.length ? `<span class="badge">${f.warnings.join(" · ")}</span>` : ""}
      <div class="review-actions">
        <button type="button" class="edit-btn" data-edit="${f.id}">EDIT</button>
        <button type="button" class="delete-btn" data-delete="${f.id}">DELETE</button>
      </div>
    </article>`).join("") : "<p>No flights recorded for this date.</p>";
  showView("reviewView");
}

function excelXmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function exportRows(flights, type) {
  const sorted = flights
    .filter(f => f.type === type)
    .sort((a, b) => hhmmValue(a.takeoff) - hhmmValue(b.takeoff));

  if (type === "winch") {
    return sorted.map(f => ({
      DATE: f.date,
      GLIDER: f.glider,
      P1: f.p1,
      P2: f.p2,
      PAYEE: f.payee,
      "TAKE OFF": f.takeoff,
      LANDING: f.landing,
      "TOTAL MINUTES": Number(f.duration) || "",
      REMARKS: f.remarks,
      AEROS: f.aeros,
      "OFFICE USE": f.officeUse,
      STATUS: (f.status || "completed").toUpperCase(),
      WARNINGS: (f.warnings || []).join("; ")
    }));
  }

  return sorted.map(f => ({
    DATE: f.date,
    "TUG REG": f.tugReg,
    "TUG PILOT": f.tugPilot,
    HEIGHT: f.towHeight,
    GLIDER: f.glider,
    P1: f.p1,
    P2: f.p2,
    PAYEE: f.payee,
    "TAKE OFF": f.takeoff,
    LANDING: f.landing,
    "TOTAL MINUTES": Number(f.duration) || "",
    REMARKS: f.remarks,
    AEROS: f.aeros,
    "OFFICE USE": f.officeUse,
    STATUS: (f.status || "completed").toUpperCase(),
    WARNINGS: (f.warnings || []).join("; ")
  }));
}

async function exportCsv() {
  const date = $("flyingDate").value;
  const flights = await getFlightsByDate(date);
  if (!flights.length) {
    alert("NO FLIGHTS TO EXPORT");
    return;
  }
  if (!window.XLSX) {
    alert("THE EXCEL EXPORT LIBRARY HAS NOT LOADED. CONNECT TO THE INTERNET ONCE AND REOPEN OPERATIONSLOGS.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const winchRows = exportRows(flights, "winch");
  const aerotowRows = exportRows(flights, "aerotow");

  const winchSheet = XLSX.utils.json_to_sheet(winchRows.length ? winchRows : [{
    DATE: "", GLIDER: "", P1: "", P2: "", PAYEE: "", "TAKE OFF": "", LANDING: "",
    "TOTAL MINUTES": "", REMARKS: "", AEROS: "", "OFFICE USE": "", STATUS: "", WARNINGS: ""
  }]);
  const aerotowSheet = XLSX.utils.json_to_sheet(aerotowRows.length ? aerotowRows : [{
    DATE: "", "TUG REG": "", "TUG PILOT": "", HEIGHT: "", GLIDER: "", P1: "", P2: "",
    PAYEE: "", "TAKE OFF": "", LANDING: "", "TOTAL MINUTES": "", REMARKS: "",
    AEROS: "", "OFFICE USE": "", STATUS: "", WARNINGS: ""
  }]);

  winchSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  aerotowSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  winchSheet["!cols"] = [12,12,24,24,14,11,11,14,28,10,14,12,24].map(wch => ({ wch }));
  aerotowSheet["!cols"] = [12,12,24,10,12,24,24,14,11,11,14,28,10,14,12,24].map(wch => ({ wch }));

  XLSX.utils.book_append_sheet(workbook, winchSheet, "Winch");
  XLSX.utils.book_append_sheet(workbook, aerotowSheet, "Aerotow");
  XLSX.writeFile(workbook, `OperationsLogs_${date}.xlsx`, { compression: true });
}

function updateConnection() {
  if (!navigator.onLine) {
    updatePendingCount();
  } else if (currentDevice?.approved) {
    processSyncQueue();
  } else if (currentDevice) {
    setSyncStatus("DEVICE WAITING FOR ADMIN APPROVAL", "pending");
  } else {
    setSyncStatus("CONNECTING…", "pending");
  }
}



function askYesNo(message) {
  return new Promise(resolve => {
    const overlay = $("yesNoDialog");
    const messageEl = $("yesNoDialogMessage");
    const yesBtn = $("yesNoYesBtn");
    const noBtn = $("yesNoNoBtn");

    messageEl.textContent = message;
    overlay.hidden = false;
    yesBtn.focus();

    const finish = answer => {
      overlay.hidden = true;
      yesBtn.removeEventListener("click", yes);
      noBtn.removeEventListener("click", no);
      document.removeEventListener("keydown", keyHandler);
      resolve(answer);
    };
    const yes = () => finish(true);
    const no = () => finish(false);
    const keyHandler = event => {
      if (event.key === "Escape") finish(false);
    };

    yesBtn.addEventListener("click", yes);
    noBtn.addEventListener("click", no);
    document.addEventListener("keydown", keyHandler);
  });
}

function moveFocusWhenChosen(inputId, nextId, allowedValues = null) {
  const input = $(inputId);
  if (!input) return;
  const move = () => {
    const value = upper(input.value);
    if (!value) return;
    if (allowedValues && !allowedValues.some(item => upper(item) === value)) return;
    const next = $(nextId);
    if (next) setTimeout(() => { next.focus(); if (typeof next.select === "function") next.select(); }, 0);
  };
  input.addEventListener("change", move);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); move(); }
  });
}


const ADMIN_LABELS = {
  names: "PILOT",
  gliders: "GLIDER",
  tugAircraft: "TUG AIRCRAFT",
  tugPilots: "TUG PILOT",
  payees: "PAYEE"
};

function openAdministration(listKey = "names") {
  currentAdminList = listKey;
  $("adminSearch").value = "";
  $("adminNewValue").value = "";
  $("adminMessage").textContent = "";
  document.querySelectorAll(".admin-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.adminList === currentAdminList);
  });
  renderAdminList();
  showView("adminView");
}

function renderAdminList() {
  const query = upper($("adminSearch").value);
  const values = cleanMasterValues(DATA[currentAdminList])
    .filter(value => !query || value.includes(query));

  $("adminList").innerHTML = values.length ? values.map(value => `
    <div class="admin-list-row">
      <span>${excelXmlEscape(value)}</span>
      <div class="admin-row-actions">
        <button type="button" class="edit-btn" data-master-edit="${excelXmlEscape(value)}">EDIT</button>
        <button type="button" class="delete-btn" data-master-delete="${excelXmlEscape(value)}">DELETE</button>
      </div>
    </div>
  `).join("") : '<p class="muted">No matching entries.</p>';
}

async function addMasterValue(key, rawValue) {
  const value = upper(rawValue);
  if (!value) return false;
  if (key === "names" && value === "SOLO") {
    $("adminMessage").textContent = "SOLO IS ALREADY AVAILABLE AS A SPECIAL P2 ENTRY.";
    return false;
  }
  if (DATA[key].includes(value)) {
    $("adminMessage").textContent = `${value} IS ALREADY ON THE LIST.`;
    return false;
  }
  DATA[key].push(value);
  await saveMasterList(key);
  $("adminMessage").textContent = `${value} ADDED.`;
  return true;
}

async function editMasterValue(key, oldValue) {
  const typed = prompt(`EDIT ${ADMIN_LABELS[key]}:`, oldValue);
  if (typed === null) return;
  const newValue = upper(typed);
  if (!newValue || newValue === oldValue) return;
  if (DATA[key].includes(newValue)) {
    alert(`${newValue} IS ALREADY ON THE LIST.`);
    return;
  }
  DATA[key] = DATA[key].map(value => value === oldValue ? newValue : value);
  await saveMasterList(key);
  renderAdminList();
}

async function deleteMasterValue(key, value) {
  const okay = await askYesNo(`DELETE ${value} FROM THE ${ADMIN_LABELS[key]} LIST?`);
  if (!okay) return;
  DATA[key] = DATA[key].filter(item => item !== value);
  await saveMasterList(key);
  renderAdminList();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
  initialiseLists();
  wireValidation();
  await openDb();
  await loadMasterLists();
  await initializeCloudSync();
  setDate(todayISO());
  await loadDay();
  updateConnection();
  if (adminAccess && adminUser) $("adminIdentity").textContent = (adminUser.email || "ADMIN").toUpperCase();

  $("flyingDate").addEventListener("change", async () => {
    setDate($("flyingDate").value);
    await loadDay();
  });

  $("runway").addEventListener("change", async () => {
    flyingDayDirtyFields.add("runway");
    try {
      const saved = await saveDayFields(["runway"], true);
      if (saved) flyingDayDirtyFields.delete("runway");
    } catch (error) {
      console.error("Runway save failed:", error);
      setSyncStatus("SYNC PROBLEM · RUNWAY", "error");
    }
  });
  $("windDirection").addEventListener("input", () => {
    flyingDayDirtyFields.add("windDirection");
    $("windDirection").value = $("windDirection").value.replace(/\D/g, "").slice(0, 3);
    scheduleFlyingDayFieldSave("windDirection", { confirmRunwayChange: false });
  });
  $("windDirection").addEventListener("blur", async () => {
    if (!flyingDayDirtyFields.has("windDirection")) return;
    const saved = await saveDayFields(["windDirection"], false);
    if (saved) flyingDayDirtyFields.delete("windDirection");
  });
  $("windDirection").addEventListener("change", async () => {
    flyingDayDirtyFields.add("windDirection");
    const saved = await saveDayFields(["windDirection"], false);
    if (saved) flyingDayDirtyFields.delete("windDirection");
  });

  $("windSpeed").addEventListener("input", () => {
    flyingDayDirtyFields.add("windSpeed");
    $("windSpeed").value = $("windSpeed").value.replace(/\D/g, "").slice(0, 2);
    scheduleFlyingDayFieldSave("windSpeed", { confirmRunwayChange: false });
  });
  $("windSpeed").addEventListener("blur", async () => {
    if (!flyingDayDirtyFields.has("windSpeed")) return;
    const saved = await saveDayFields(["windSpeed"], false);
    if (saved) flyingDayDirtyFields.delete("windSpeed");
  });
  $("windSpeed").addEventListener("change", async () => {
    flyingDayDirtyFields.add("windSpeed");
    const saved = await saveDayFields(["windSpeed"], false);
    if (saved) flyingDayDirtyFields.delete("windSpeed");
  });
  $("winchFlightBtn").addEventListener("click", () => openEntry("winch"));
  $("aerotowFlightBtn").addEventListener("click", () => openEntry("aerotow"));
  document.querySelectorAll("[data-time-target]").forEach(b => b.addEventListener("click", () => {
    $(b.dataset.timeTarget).value = timeHHMM();
    $("duration").value = calcDuration($("takeoff").value, $("landing").value);
    $("saveFlightBtn").textContent = $("landing").value ? "SAVE COMPLETED FLIGHT" : "SAVE AS AIRBORNE";
  }));
  $("flightForm").addEventListener("submit", saveFlight);
  moveFocusWhenChosen("p1", "p2", DATA.names);
  moveFocusWhenChosen("p2", "payee", [...DATA.names, "SOLO"]);
  moveFocusWhenChosen("payee", "takeoff", DATA.names);
  $("backBtn").addEventListener("click", () => showView("homeView"));
  $("reviewBackBtn").addEventListener("click", () => showView("homeView"));
  $("reviewBtn").addEventListener("click", reviewFlights);
  $("exportBtn").addEventListener("click", exportCsv);
  $("adminBtn").addEventListener("click", requestAdminAccess);
  $("adminBackBtn").addEventListener("click", () => showView("homeView"));
  $("adminLoginBtn").addEventListener("click", adminSignIn);
  $("adminLoginCancelBtn").addEventListener("click", () => $("adminLoginDialog").hidden = true);
  $("adminSignOutBtn").addEventListener("click", adminSignOut);
  $("adminPassword").addEventListener("keydown", event => {
    if (event.key === "Enter") adminSignIn();
  });
  $("adminDeviceList").addEventListener("click", async event => {
    const button = event.target.closest("[data-device-toggle]");
    if (!button) return;
    await toggleDeviceApproval(button.dataset.deviceToggle, button.dataset.deviceApproved === "true");
  });
  $("adminSearch").addEventListener("input", renderAdminList);
  $("adminAddBtn").addEventListener("click", async () => {
    const added = await addMasterValue(currentAdminList, $("adminNewValue").value);
    if (added) {
      $("adminNewValue").value = "";
      renderAdminList();
      $("adminNewValue").focus();
    }
  });
  $("adminNewValue").addEventListener("keydown", async event => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("adminAddBtn").click();
    }
  });
  document.querySelectorAll(".admin-tab").forEach(button => {
    button.addEventListener("click", () => openAdministration(button.dataset.adminList));
  });
  $("adminList").addEventListener("click", async event => {
    const editButton = event.target.closest("[data-master-edit]");
    const deleteButton = event.target.closest("[data-master-delete]");
    if (editButton) await editMasterValue(currentAdminList, editButton.dataset.masterEdit);
    if (deleteButton) await deleteMasterValue(currentAdminList, deleteButton.dataset.masterDelete);
  });
  document.body.addEventListener("click", async event => {
    const button = event.target.closest("[data-add-master]");
    if (!button) return;
    if (!adminAccess) {
      await requestAdminAccess();
      return;
    }
    const added = await addMasterValue(button.dataset.addMaster, button.dataset.addValue);
    if (added) {
      button.closest(".warning-text").textContent = "";
    }
  });
  $("flightList").addEventListener("click", async e => {
    const editButton = e.target.closest("[data-edit]");
    const deleteButton = e.target.closest("[data-delete]");

    if (editButton) {
      e.preventDefault();
      await editFlight(editButton.dataset.edit);
      return;
    }

    if (deleteButton && confirm("DELETE THIS FLIGHT FROM THIS DEVICE?")) {
      e.preventDefault();
      const id = deleteButton.dataset.delete;
      await removeFlight(id);
      await queueSyncRecord("flight", id, "delete");
      await reviewFlights();
      await updateDashboard();
    }
  });
  $("airborneList").addEventListener("click", async e => {
    const nowId = e.target.dataset.landNow;
    const manualId = e.target.dataset.landManual;
    if (nowId) await landFlight(nowId, timeHHMM());
    if (manualId) {
      const value = prompt("ENTER LANDING TIME AS FOUR DIGITS (HHMM):", timeHHMM());
      if (value !== null) await landFlight(manualId, value.replace(/\D/g,"").slice(0,4));
    }
  });
  setInterval(() => {
    if ($("homeView").classList.contains("active")) updateDashboard();
  }, 60000);
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js?v=129").catch(error => {
      console.warn("Service worker registration failed:", error);
    });
  }
  } catch (error) {
    console.error(error);
    const message = document.getElementById("formMessage");
    if (message) message.textContent = "APP STARTUP ERROR: " + error.message;
    alert("OPERATIONSLOGS STARTUP ERROR: " + error.message);
  }
});
