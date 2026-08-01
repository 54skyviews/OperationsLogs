
let operatorSupabase = null;
let adminSupabase = null;
let operatorUser = null;
let currentDevice = null;
let adminUser = null;
let adminAccess = false;
let realtimeChannel = null;
let syncBusy = false;

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
  if (!navigator.onLine) {
    setSyncStatus(`OFFLINE · ${pending.length} WAITING`, "offline");
  } else if (pending.length && currentDevice?.approved) {
    setSyncStatus(`ONLINE · ${pending.length} WAITING`, "pending");
  }
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
  if (syncBusy || !navigator.onLine || !operatorSupabase || !currentDevice?.approved) {
    await updatePendingCount();
    return;
  }
  syncBusy = true;
  try {
    const items = (await allFromStore("syncQueue"))
      .sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));

    for (const item of items) {
      try {
        if (item.recordType === "flight") await syncFlightQueueItem(item);
        if (item.recordType === "day") await syncDayQueueItem(item);
        if (item.recordType === "master") await syncMasterQueueItem(item);
        await removeQueueItem(item.id);
      } catch (error) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = error.message;
        await put("syncQueue", item);
        throw error;
      }
    }

    setSyncStatus("ONLINE · SYNCED", "online");
  } catch (error) {
    console.error("Sync failed:", error);
    setSyncStatus("SYNC PROBLEM · REVIEW REQUIRED", "error");
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

async function pullCloudData() {
  if (!currentDevice?.approved) return;
  await Promise.all([pullFlights(), pullFlyingDays(), pullMasterLists()]);
  await updateDashboard();
  if (document.getElementById("reviewView")?.classList.contains("active")) await reviewFlights();
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
    .on("postgres_changes", { event: "*", schema: "public", table: "flying_days" }, async () => {
      await pullFlyingDays();
      await loadDay();
    })
    .subscribe();
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
