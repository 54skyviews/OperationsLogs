
let operatorSupabase = null;
let adminSupabase = null;
let operatorUser = null;
let currentDevice = null;
let adminUser = null;
let adminAccess = false;
let realtimeChannel = null;
let syncBusy = false;
let reconciliationTimer = null;
let lastCloudPullAt = 0;
let approvalWatcher = null;
let lastSyncError = "";
let lastVerification = null;

const CLOUD = window.OPERATIONSLOGS_SUPABASE;

function cloudAvailable() {
  return Boolean(window.supabase && CLOUD?.url && CLOUD?.publishableKey);
}

function makeCloudClients() {
  if (!cloudAvailable()) return false;
  operatorSupabase = window.supabase.createClient(CLOUD.url, CLOUD.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "operationslogs-operator-auth"
    }
  });
  adminSupabase = window.supabase.createClient(CLOUD.url, CLOUD.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "operationslogs-admin-auth"
    }
  });
  return true;
}

function setSyncStatus(text, kind = "offline") {
  const badge = document.getElementById("statusBadge");
  if (!badge) return;
  badge.textContent = text;
  badge.className = `status ${kind}`;
}

function localDeviceName() {
  return localStorage.getItem("operationslogs-device-name") || "";
}

async function askDeviceName() {
  let name = localDeviceName();
  while (!name) {
    const typed = prompt(
      "NAME THIS DEVICE, FOR EXAMPLE:\nLAUNCH POINT IPAD\nOFFICE COMPUTER\nTUG TABLET",
      ""
    );
    if (typed === null) return "";
    name = upper(typed);
  }
  localStorage.setItem("operationslogs-device-name", name);
  return name;
}

async function ensureOperatorSession() {
  const { data: sessionData } = await operatorSupabase.auth.getSession();
  if (sessionData.session?.user) {
    operatorUser = sessionData.session.user;
    return operatorUser;
  }
  const { data, error } = await operatorSupabase.auth.signInAnonymously();
  if (error) throw error;
  operatorUser = data.user;
  return operatorUser;
}

async function ensureDeviceRegistration() {
  const name = await askDeviceName();
  if (!name) {
    setSyncStatus("LOCAL ONLY · DEVICE NOT NAMED", "offline");
    return null;
  }

  const { data: existing, error: selectError } = await operatorSupabase
    .from("devices")
    .select("*")
    .eq("auth_user_id", operatorUser.id)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    currentDevice = existing;
    if (existing.name !== name) {
      await operatorSupabase
        .from("devices")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      currentDevice.name = name;
    }
    return currentDevice;
  }

  const { data: inserted, error: insertError } = await operatorSupabase
    .from("devices")
    .insert({
      auth_user_id: operatorUser.id,
      name,
      approved: false,
      active: true
    })
    .select()
    .single();

  if (insertError) throw insertError;
  currentDevice = inserted;
  return currentDevice;
}


async function refreshCurrentDeviceStatus() {
  if (!operatorSupabase || !operatorUser) return currentDevice;

  const { data, error } = await operatorSupabase
    .from("devices")
    .select("*")
    .eq("auth_user_id", operatorUser.id)
    .maybeSingle();

  if (error) {
    console.warn("Could not refresh device approval:", error);
    return currentDevice;
  }
  if (!data) return currentDevice;

  const wasApproved = Boolean(currentDevice?.approved && currentDevice?.active);
  currentDevice = data;
  const isApproved = Boolean(data.approved && data.active);

  if (isApproved && !wasApproved) {
    setSyncStatus("DEVICE APPROVED · STARTING SYNC", "online");
    await pullCloudData();
    subscribeRealtime();
    await processSyncQueue();
  } else if (!isApproved) {
    setSyncStatus("DEVICE WAITING FOR ADMIN APPROVAL", "pending");
  }

  return currentDevice;
}

function startApprovalWatcher() {
  if (approvalWatcher) clearInterval(approvalWatcher);
  approvalWatcher = setInterval(async () => {
    if (!navigator.onLine || !operatorSupabase || !operatorUser) return;
    await refreshCurrentDeviceStatus();
  }, 10000);

  window.addEventListener("focus", refreshCurrentDeviceStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCurrentDeviceStatus();
  });
}

function remoteFlightFromLocal(flight) {
  return {
    id: flight.id,
    date: flight.date,
    type: flight.type,
    status: flight.status || "completed",
    tug_reg: flight.tugReg || "",
    tug_pilot: flight.tugPilot || "",
    tow_height: flight.towHeight || "",
    glider: flight.glider || "",
    p1: flight.p1 || "",
    p2: flight.p2 || "",
    payee: flight.payee || "",
    takeoff: flight.takeoff || "",
    landing: flight.landing || "",
    duration: Number(flight.duration) || null,
    takeoff_at: flight.takeoffAt || null,
    landed_at: flight.landedAt || null,
    remarks: flight.remarks || "",
    aeros: flight.aeros || "",
    office_use: flight.officeUse || "",
    warnings: flight.warnings || [],
    created_by_device: flight.createdByDevice || currentDevice?.id || null,
    modified_by_device: currentDevice?.id || null,
    created_at: flight.createdAt || new Date().toISOString(),
    modified_at: flight.modifiedAt || new Date().toISOString()
  };
}

function localFlightFromRemote(row) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    status: row.status,
    tugReg: row.tug_reg || "",
    tugPilot: row.tug_pilot || "",
    towHeight: row.tow_height || "",
    glider: row.glider || "",
    p1: row.p1 || "",
    p2: row.p2 || "",
    payee: row.payee || "",
    takeoff: row.takeoff || "",
    landing: row.landing || "",
    duration: row.duration ?? "",
    takeoffAt: row.takeoff_at,
    landedAt: row.landed_at,
    remarks: row.remarks || "",
    aeros: row.aeros || "",
    officeUse: row.office_use || "",
    warnings: row.warnings || [],
    createdByDevice: row.created_by_device,
    modifiedByDevice: row.modified_by_device,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    syncStatus: "synced"
  };
}

function allFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function removeQueueItem(id) {
  await remove("syncQueue", id);
}


const DAY_FIELD_COLUMN_MAP = {
  day: "day",
  runway: "runway",
  windDirection: "wind_direction",
  windSpeed: "wind_speed"
};

async function queueFlyingDayField(date, fieldName, value, modifiedAt) {
  const queueId = `day:${date}:${fieldName}`;
  const existing = await get("syncQueue", queueId);
  await put("syncQueue", {
    id: queueId,
    recordType: "dayField",
    recordId: date,
    fieldName,
    value: value ?? "",
    modifiedAt: modifiedAt || new Date().toISOString(),
    queuedAt: new Date().toISOString(),
    attempts: existing?.attempts || 0,
    version: (existing?.version || 0) + 1
  });
  updatePendingCount();
  if (navigator.onLine) setTimeout(processSyncQueue, 0);
}

async function pendingDayFields(date) {
  const items = await allFromStore("syncQueue");
  const pending = {};
  for (const item of items) {
    if (item.recordType === "dayField" && item.recordId === date) {
      pending[item.fieldName] = item.value;
    }
  }
  return pending;
}

async function fetchCloudFlyingDayValues(date) {
  const { data, error } = await operatorSupabase
    .from("flying_day_values")
    .select("field_name,value")
    .eq("date", date);
  if (error) throw error;
  if (!data?.length) return null;

  const values = { date, day:"", runway:"", windDirection:"", windSpeed:"" };
  for (const row of data) {
    if (Object.prototype.hasOwnProperty.call(values, row.field_name)) {
      values[row.field_name] = row.value ?? "";
    }
  }
  return values;
}

async function queueSyncRecord(recordType, recordId, action = "upsert") {
  const queueId = `${recordType}:${recordId}`;
  await put("syncQueue", {
    id: queueId,
    recordType,
    recordId,
    action,
    queuedAt: new Date().toISOString(),
    attempts: 0
  });
  updatePendingCount();
  if (navigator.onLine) setTimeout(processSyncQueue, 0);
}


async function cleanupLegacyFlyingDayQueue() {
  const cleanupKey = "operationslogs-flying-day-queue-cleanup-v130";
  if (localStorage.getItem(cleanupKey) === "done") return false;

  const items = await allFromStore("syncQueue");
  for (const item of items) {
    if (item.recordType === "day" || item.recordType === "dayField") {
      await removeQueueItem(item.id);
    }
  }

  localStorage.setItem(cleanupKey, "done");
  return true;
}

async function updatePendingCount() {
  if (!db) return;
  const pending = await allFromStore("syncQueue");
  const masterWaiting = pending.filter(item => item.recordType === "master").length;
  const operationalWaiting = pending.length - masterWaiting;

  if (!navigator.onLine) {
    setSyncStatus(`OFFLINE · ${pending.length} WAITING`, "offline");
    return;
  }
  if (!currentDevice?.approved || !currentDevice?.active) {
    setSyncStatus("DEVICE WAITING FOR ADMIN APPROVAL", "pending");
    return;
  }
  if (lastSyncError) {
    setSyncStatus(`SYNC PROBLEM · ${lastSyncError}`, "error");
    return;
  }
  if (operationalWaiting > 0) {
    setSyncStatus(`ONLINE · ${operationalWaiting} CHANGES WAITING`, "pending");
    return;
  }
  if (masterWaiting > 0 && !adminAccess) {
    setSyncStatus(`ONLINE · ${masterWaiting} ADMIN CHANGE WAITING`, "pending");
    return;
  }
  if (pending.length > 0) {
    setSyncStatus(`ONLINE · ${pending.length} WAITING`, "pending");
    return;
  }
  setSyncStatus("ONLINE · SYNCED", "online");
}

async function syncFlightQueueItem(item) {
  if (item.action === "delete") {
    const { error } = await operatorSupabase.from("flights").delete().eq("id", item.recordId);
    if (error) throw error;
    return;
  }
  const flight = await get("flights", item.recordId);
  if (!flight) return;
  const { data, error } = await operatorSupabase
    .from("flights")
    .upsert(remoteFlightFromLocal(flight), { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;

  const synced = data ? localFlightFromRemote(data) : flight;
  synced.syncStatus = "synced";
  synced.pendingModifiedAt = null;
  await put("flights", synced);
}

async function syncDayFieldQueueItem(item) {
  const { data, error } = await operatorSupabase
    .from("flying_day_values")
    .upsert({
      date:item.recordId,
      field_name:item.fieldName,
      value:item.value ?? "",
      modified_by_device:currentDevice?.id || null,
      modified_at:item.modifiedAt || new Date().toISOString()
    }, { onConflict:"date,field_name" })
    .select()
    .single();

  if (error) throw error;

  const latest = await get("syncQueue", item.id);
  if (!latest || latest.version === item.version) {
    if (typeof flyingDayState !== "undefined") {
      flyingDayState.pending.delete(item.fieldName);
      flyingDayState.displayed[item.fieldName] = data.value ?? "";
    }
    const local = (await get("days", item.recordId)) || { date:item.recordId };
    local[item.fieldName] = data.value ?? "";
    local.modifiedAt = data.modified_at;
    await put("days", local);
  }
  return data;
}

async function syncMasterQueueItem(item) {
  if (!adminAccess) throw new Error("Administrator sign-in required for master-list synchronisation.");
  const key = item.recordId;
  const values = cleanMasterValues(DATA[key]);
  const { error: deleteError } = await adminSupabase.from("master_lists").delete().eq("list_key", key);
  if (deleteError) throw deleteError;
  if (values.length) {
    const rows = values.map(value => ({
      list_key: key,
      value,
      active: true,
      modified_by: adminUser?.id || null
    }));
    const { error: insertError } = await adminSupabase.from("master_lists").insert(rows);
    if (insertError) throw insertError;
  }
}

async function processSyncQueue() {
  if (syncBusy || !navigator.onLine || !operatorSupabase) {
    await updatePendingCount();
    return;
  }

  if (!currentDevice?.approved || !currentDevice?.active) {
    await refreshCurrentDeviceStatus();
  }
  if (!currentDevice?.approved || !currentDevice?.active) {
    await updatePendingCount();
    return;
  }

  syncBusy = true;
  lastSyncError = "";
  try {
    const items = (await allFromStore("syncQueue"))
      .sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));

    for (const item of items) {
      // Administrator list changes must not prevent flights or flying-day records syncing.
      if (item.recordType === "master" && !adminAccess) continue;

      try {
        if (item.recordType === "flight") {
          await syncFlightQueueItem(item);
          await removeQueueItem(item.id);
        } else if (item.recordType === "dayField") {
          await syncDayFieldQueueItem(item);
          const latest = await get("syncQueue", item.id);
          if (!latest || latest.version === item.version) {
            await removeQueueItem(item.id);
          }
        } else if (item.recordType === "day") {
          // Legacy whole-day records can contain stale blank fields. Never replay them.
          await removeQueueItem(item.id);
        } else if (item.recordType === "master") {
          await syncMasterQueueItem(item);
          await removeQueueItem(item.id);
        } else {
          // Remove obsolete queue entries created by pre-1.2 versions.
          await removeQueueItem(item.id);
          continue;
        }
      } catch (error) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = error.message;
        await put("syncQueue", item);
        lastSyncError = String(error.message || "UNKNOWN ERROR").toUpperCase().slice(0, 45);
        console.error("Sync item failed:", item, error);
        // Continue with other records so one bad item cannot block all flights.
      }
    }
  } finally {
    syncBusy = false;
    await updatePendingCount();
  }
}
async function applyRemoteFlight(row) {
  const local = await get("flights", row.id);
  const pendingQueueItem = await get("syncQueue", `flight:${row.id}`);
  const localPending = local?.syncStatus === "pending" || Boolean(pendingQueueItem);

  if (localPending) {
    const remoteTime = new Date(row.modified_at || 0).getTime();
    const localTime = new Date(local?.pendingModifiedAt || local?.modifiedAt || 0).getTime();
    const remoteMatchesLocal =
      row.status === local?.status &&
      (row.landing || "") === (local?.landing || "") &&
      Number(row.duration || 0) === Number(local?.duration || 0);

    if (remoteMatchesLocal && remoteTime >= localTime) {
      const synced = localFlightFromRemote(row);
      synced.syncStatus = "synced";
      synced.pendingModifiedAt = null;
      await put("flights", synced);
      if (pendingQueueItem) await removeQueueItem(pendingQueueItem.id);
      return;
    }

    if (local?.status === "completed" && row.status === "airborne") {
      return;
    }

    if (remoteTime <= localTime || !remoteMatchesLocal) {
      return;
    }
  }

  await put("flights", localFlightFromRemote(row));
}

async function reconcileFlightsForDate(date) {
  const { data, error } = await operatorSupabase
    .from("flights")
    .select("*")
    .eq("date", date);
  if (error) throw error;

  const cloudRows = data || [];
  const cloudIds = new Set(cloudRows.map(row => row.id));
  for (const row of cloudRows) await applyRemoteFlight(row);

  const localRows = await getFlightsByDate(date);
  for (const local of localRows) {
    const pending = await get("syncQueue", `flight:${local.id}`);
    if (!cloudIds.has(local.id) && !pending && local.syncStatus !== "pending") {
      await removeFlight(local.id);
    }
  }

  const repairedLocal = await getFlightsByDate(date);
  const cloudById = new Map(cloudRows.map(row => [row.id, row]));
  let mismatches = 0;
  for (const local of repairedLocal) {
    const remote = cloudById.get(local.id);
    const pending = await get("syncQueue", `flight:${local.id}`);
    if (pending) continue;
    if (!remote) { mismatches++; continue; }
    if ((local.status || "") !== (remote.status || "") ||
        (local.takeoff || "") !== (remote.takeoff || "") ||
        (local.landing || "") !== (remote.landing || "")) mismatches++;
  }

  lastVerification = {
    date,
    cloudCount: cloudRows.length,
    localCount: repairedLocal.length,
    cloudAirborne: cloudRows.filter(r => r.status === "airborne").length,
    localAirborne: repairedLocal.filter(r => r.status === "airborne").length,
    mismatches,
    checkedAt: new Date()
  };
  updateSyncVerificationDisplay();
  return lastVerification;
}

function updateSyncVerificationDisplay() {
  const el = document.getElementById("syncVerificationText");
  if (!el) return;
  if (!lastVerification) {
    el.textContent = "Waiting for full check…";
    return;
  }
  const v = lastVerification;
  const ok = v.cloudCount === v.localCount && v.cloudAirborne === v.localAirborne && v.mismatches === 0;
  const time = v.checkedAt.toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  el.innerHTML = `<strong>${ok ? "ONLINE · VERIFIED" : "DATA MISMATCH"}</strong><br>` +
    `Cloud ${v.cloudCount} flights · Device ${v.localCount} flights · ` +
    `Airborne ${v.localAirborne}<br>Last full check ${time}`;
  el.className = `sync-verification-text ${ok ? "verified" : "mismatch"}`;
}

async function pullFlights() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 31);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { data, error } = await operatorSupabase
    .from("flights")
    .select("*")
    .gte("date", cutoffDate);

  if (error) throw error;
  for (const row of data || []) await applyRemoteFlight(row);
}


async function readFlyingDayValueRows() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 31);

  const { data, error } = await operatorSupabase
    .from("flying_day_values")
    .select("*")
    .gte("date", cutoff.toISOString().slice(0, 10));

  if (error) throw error;
  return data || [];
}

async function forcePullFlyingDays() {
  const rows = await readFlyingDayValueRows();
  const grouped = {};

  for (const row of rows) {
    if (!grouped[row.date]) grouped[row.date] = {};
    grouped[row.date][row.field_name] = row;
  }

  for (const [date, fields] of Object.entries(grouped)) {
    const local = (await get("days", date)) || {
      date,
      day: new Date(date + "T12:00:00").toLocaleDateString(
        "en-GB", { weekday: "long" }
      ).toUpperCase(),
      runway: "",
      windDirection: "",
      windSpeed: ""
    };

    for (const fieldName of ["day", "runway", "windDirection", "windSpeed"]) {
      if (fields[fieldName]) local[fieldName] = fields[fieldName].value ?? "";
    }

    local.modifiedAt = new Date().toISOString();
    await put("days", local);
  }
}

async function pullFlyingDays() {
  const rows = await readFlyingDayValueRows();
  const grouped = {};

  for (const row of rows) {
    if (!grouped[row.date]) grouped[row.date] = {};
    grouped[row.date][row.field_name] = row;
  }

  for (const [date, fields] of Object.entries(grouped)) {
    const local = (await get("days", date)) || {
      date,
      day: new Date(date + "T12:00:00").toLocaleDateString(
        "en-GB", { weekday: "long" }
      ).toUpperCase(),
      runway: "",
      windDirection: "",
      windSpeed: ""
    };
    const pending = await pendingDayFields(date);

    for (const fieldName of ["day", "runway", "windDirection", "windSpeed"]) {
      if (
        fields[fieldName] &&
        !Object.prototype.hasOwnProperty.call(pending, fieldName)
      ) {
        local[fieldName] = fields[fieldName].value ?? "";
      }
    }

    local.modifiedAt = new Date().toISOString();
    await put("days", local);
  }
}

async function pullMasterLists(client = operatorSupabase) {
  const { data, error } = await client
    .from("master_lists")
    .select("list_key,value")
    .eq("active", true);
  if (error) throw error;

  const grouped = {};
  for (const key of MASTER_LIST_KEYS) grouped[key] = [];
  for (const row of data || []) {
    if (grouped[row.list_key]) grouped[row.list_key].push(row.value);
  }

  for (const key of MASTER_LIST_KEYS) {
    if (grouped[key].length) {
      DATA[key] = cleanMasterValues(grouped[key]);
      await put("masterLists", {
        key,
        values: DATA[key],
        modifiedAt: new Date().toISOString()
      });
    }
  }
  refreshMasterDatalists();
  if (document.getElementById("adminView")?.classList.contains("active")) renderAdminList();
}


async function pullCloudData() {
  if (!currentDevice?.approved || !navigator.onLine) return;
  await Promise.all([pullFlights(), pullFlyingDays(), pullMasterLists()]);
  const selectedDate = document.getElementById("flyingDate")?.value;
  if (selectedDate) await reconcileFlightsForDate(selectedDate);
  lastCloudPullAt = Date.now();
  
  await updateDashboard();
  if (document.getElementById("reviewView")?.classList.contains("active")) await reviewFlights();
}

async function reconcileCloudState(reason = "periodic") {
  if (!currentDevice?.approved || !navigator.onLine || syncBusy) return;
  try {
    await processSyncQueue();
    await pullCloudData();
    const verified = lastVerification &&
      lastVerification.cloudCount === lastVerification.localCount &&
      lastVerification.cloudAirborne === lastVerification.localAirborne &&
      lastVerification.mismatches === 0;
    setSyncStatus(verified ? "ONLINE · VERIFIED" : "ONLINE · CHECKING", verified ? "online" : "pending");
  } catch (error) {
    console.error(`Cloud reconciliation failed (${reason}):`, error);
    setSyncStatus("SYNC PROBLEM · RETRYING", "error");
  }
}

function startCloudReconciliation() {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = setInterval(() => reconcileCloudState("scheduled"), 30000);
}

async function restartRealtimeSubscription() {
  if (!operatorSupabase || !currentDevice?.approved) return;
  if (realtimeChannel) {
    try { await operatorSupabase.removeChannel(realtimeChannel); } catch {}
    realtimeChannel = null;
  }
  subscribeRealtime();
}

function subscribeRealtime() {
  if (!currentDevice?.approved || realtimeChannel) return;
  realtimeChannel = operatorSupabase
    .channel("operationslogs-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "flights" }, async payload => {
      if (payload.eventType === "DELETE") {
        await remove("flights", payload.old.id);
      } else {
        await applyRemoteFlight(payload.new);
      }
      await updateDashboard();
      if (document.getElementById("reviewView")?.classList.contains("active")) await reviewFlights();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "master_lists" }, async () => {
      await pullMasterLists();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "flying_day_values" }, async payload => {
      if (payload.eventType !== "DELETE" && payload.new) {
        const row = payload.new;
        const pending = await pendingDayFields(row.date);

        if (!Object.prototype.hasOwnProperty.call(pending, row.field_name)) {
          const local = (await get("days", row.date)) || {
            date: row.date,
            day: new Date(row.date + "T12:00:00").toLocaleDateString(
              "en-GB", { weekday: "long" }
            ).toUpperCase(),
            runway: "",
            windDirection: "",
            windSpeed: ""
          };

          local[row.field_name] = row.value ?? "";
          local.modifiedAt = row.modified_at;
          await put("days", local);

          if (
            document.getElementById("flyingDate")?.value === row.date &&
            typeof setFlyingDayControl === "function"
          ) {
            setFlyingDayControl(row.field_name, row.value ?? "");
          }
        }
      } else {
        await pullFlyingDays();
      }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices" }, async payload => {
      if (payload.new?.auth_user_id === operatorUser?.id) {
        await refreshCurrentDeviceStatus();
      }
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        setSyncStatus("ONLINE · SYNCED", "online");
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        setSyncStatus("REALTIME INTERRUPTED · RECONNECTING", "pending");
        setTimeout(async () => {
          await restartRealtimeSubscription();
          await reconcileCloudState("realtime reconnect");
        }, 3000);
      }
    });
}

async function initializeCloudSync() {
  if (!makeCloudClients()) {
    setSyncStatus("LOCAL ONLY · CLOUD LIBRARY MISSING", "error");
    return;
  }

  try {
    setSyncStatus("CONNECTING…", "pending");
    await ensureOperatorSession();
    await ensureDeviceRegistration();
    const flyingDayQueueWasCleaned = await cleanupLegacyFlyingDayQueue();
    startApprovalWatcher();
    await refreshCurrentDeviceStatus();

    const { data: adminSession } = await adminSupabase.auth.getSession();
    if (adminSession.session?.user) {
      adminUser = adminSession.session.user;
      const { data: adminRow } = await adminSupabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", adminUser.id)
        .maybeSingle();
      adminAccess = Boolean(adminRow);
    }

    if (!currentDevice?.approved) {
      setSyncStatus("DEVICE WAITING FOR ADMIN APPROVAL", "pending");
      return;
    }

    if (flyingDayQueueWasCleaned) {
      await forcePullFlyingDays();
      
    }
    await pullCloudData();
    await processSyncQueue();
    subscribeRealtime();
    startCloudReconciliation();
    setSyncStatus("ONLINE · SYNCED", "online");
  } catch (error) {
    console.error("Cloud startup failed:", error);
    setSyncStatus(navigator.onLine ? "CLOUD SETUP REQUIRED" : "OFFLINE · LOCAL SAVE", "error");
  }
}

async function requestAdminAccess() {
  if (adminAccess && adminUser) {
    await loadAdminDevices();
    openAdministration("names");
    return;
  }
  document.getElementById("adminLoginMessage").textContent = "";
  document.getElementById("adminLoginDialog").hidden = false;
  document.getElementById("adminEmail").focus();
}

async function adminSignIn() {
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  const message = document.getElementById("adminLoginMessage");
  message.textContent = "SIGNING IN…";

  const { data, error } = await adminSupabase.auth.signInWithPassword({ email, password });
  if (error) {
    message.textContent = error.message.toUpperCase();
    return;
  }

  const user = data.user;
  const { data: row, error: roleError } = await adminSupabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError || !row) {
    await adminSupabase.auth.signOut();
    message.textContent = "THIS ACCOUNT IS NOT AN OPERATIONSLOGS ADMINISTRATOR.";
    return;
  }

  adminUser = user;
  adminAccess = true;
  document.getElementById("adminLoginDialog").hidden = true;
  document.getElementById("adminPassword").value = "";
  document.getElementById("adminIdentity").textContent = email.toUpperCase();
  await pullMasterLists(adminSupabase);
  await loadAdminDevices();
  openAdministration("names");
}

async function adminSignOut() {
  await adminSupabase.auth.signOut();
  adminUser = null;
  adminAccess = false;
  document.getElementById("adminIdentity").textContent = "NOT SIGNED IN";
  showView("homeView");
}

async function loadAdminDevices() {
  if (!adminAccess) return;
  const { data, error } = await adminSupabase
    .from("devices")
    .select("*")
    .order("name");
  const container = document.getElementById("adminDeviceList");
  if (error) {
    container.innerHTML = `<p class="form-message">${excelXmlEscape(error.message)}</p>`;
    return;
  }
  container.innerHTML = (data || []).map(device => `
    <div class="admin-list-row">
      <span>
        ${excelXmlEscape(device.name)}
        <small>${device.approved ? "APPROVED" : "WAITING APPROVAL"}</small>
      </span>
      <div class="admin-row-actions">
        <button type="button" class="${device.approved ? "delete-btn" : "edit-btn"}"
          data-device-toggle="${device.id}" data-device-approved="${device.approved}">
          ${device.approved ? "DISABLE" : "APPROVE"}
        </button>
      </div>
    </div>
  `).join("") || '<p class="muted">No registered devices.</p>';
}

async function toggleDeviceApproval(id, currentlyApproved) {
  if (!adminAccess) return;
  const { error } = await adminSupabase
    .from("devices")
    .update({
      approved: !currentlyApproved,
      active: !currentlyApproved,
      approved_by: adminUser.id,
      approved_at: !currentlyApproved ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }
  await loadAdminDevices();
  await refreshCurrentDeviceStatus();

  if (currentDevice?.id === id) {
    currentDevice.approved = !currentlyApproved;
    if (currentDevice.approved) {
      await pullCloudData();
      await processSyncQueue();
      subscribeRealtime();
    }
  }
}

async function syncMasterList(key) {
  await queueSyncRecord("master", key, "replace");
  if (adminAccess && currentDevice?.approved) await processSyncQueue();
}


document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconcileCloudState("visibility");
});
window.addEventListener("focus", () => reconcileCloudState("focus"));
window.addEventListener("online", async () => {
  await restartRealtimeSubscription();
  await reconcileCloudState("online");
});
