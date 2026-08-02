
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
    setSyncStatus(`ONLINE · ${operationalWaiting} FLIGHT CHANGES WAITING`, "pending");
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
  const { error } = await operatorSupabase
    .from("flights")
    .upsert(remoteFlightFromLocal(flight), { onConflict: "id" });
  if (error) throw error;
  flight.syncStatus = "synced";
  await put("flights", flight);
}

async function syncDayQueueItem(item) {
  const day = await get("days", item.recordId);
  if (!day) return;
  const { error } = await operatorSupabase.from("flying_days").upsert({
    date: day.date,
    day: day.day || "",
    runway: day.runway || "",
    wind_direction: day.windDirection || "",
    wind_speed: day.windSpeed || "",
    modified_by_device: currentDevice?.id || null,
    modified_at: day.modifiedAt || new Date().toISOString()
  }, { onConflict: "date" });
  if (error) throw error;
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
        if (item.recordType === "flight") await syncFlightQueueItem(item);
        else if (item.recordType === "day") await syncDayQueueItem(item);
        else if (item.recordType === "master") await syncMasterQueueItem(item);
        else {
          // Remove obsolete queue entries created by pre-1.2 versions.
          await removeQueueItem(item.id);
          continue;
        }
        await removeQueueItem(item.id);
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
  if (local?.syncStatus === "pending") {
    const remoteTime = new Date(row.modified_at || 0).getTime();
    const localTime = new Date(local.modifiedAt || 0).getTime();
    if (remoteTime > localTime) {
      await put("conflicts", {
        id: `flight:${row.id}`,
        recordType: "flight",
        recordId: row.id,
        local,
        remote: row,
        detectedAt: new Date().toISOString()
      });
      setSyncStatus("SYNC PROBLEM · CONFLICT", "error");
      return;
    }
  }
  await put("flights", localFlightFromRemote(row));
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

async function pullFlyingDays() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 31);
  const { data, error } = await operatorSupabase
    .from("flying_days")
    .select("*")
    .gte("date", cutoff.toISOString().slice(0, 10));
  if (error) throw error;

  for (const row of data || []) {
    await put("days", {
      date: row.date,
      day: row.day || "",
      runway: row.runway || "",
      windDirection: row.wind_direction || "",
      windSpeed: row.wind_speed || "",
      modifiedAt: row.modified_at
    });
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


async function refreshVisibleFlyingDay() {
  const dateInput = document.getElementById("flyingDate");
  if (!dateInput?.value) return;
  await loadDay();
}

async function pullCloudData() {
  if (!currentDevice?.approved || !navigator.onLine) return;
  await Promise.all([pullFlights(), pullFlyingDays(), pullMasterLists()]);
  lastCloudPullAt = Date.now();
  await refreshVisibleFlyingDay();
  await updateDashboard();
  if (document.getElementById("reviewView")?.classList.contains("active")) await reviewFlights();
}

async function reconcileCloudState(reason = "periodic") {
  if (!currentDevice?.approved || !navigator.onLine || syncBusy) return;
  try {
    await processSyncQueue();
    await pullCloudData();
    setSyncStatus("ONLINE · SYNCED", "online");
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
    .on("postgres_changes", { event: "*", schema: "public", table: "flying_days" }, async payload => {
      if (payload.eventType !== "DELETE" && payload.new) {
        const row = payload.new;
        await put("days", {
          date: row.date,
          day: row.day || "",
          runway: row.runway || "",
          windDirection: row.wind_direction || "",
          windSpeed: row.wind_speed || "",
          modifiedAt: row.modified_at
        });
      } else {
        await pullFlyingDays();
      }
      await refreshVisibleFlyingDay();
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
