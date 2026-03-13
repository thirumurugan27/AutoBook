// popup.js — PS AutoBook v3
// ============================================================
// ELEMENT REFS
// ============================================================
var $courseId = document.getElementById("courseId");
var $registerId = document.getElementById("registerId");
var $slotTime = document.getElementById("slotTime");
var $slotDate = document.getElementById("slotDate");
var $customRangeWrap = document.getElementById("customRangeWrap");
var $customStart = document.getElementById("customStart");
var $customEnd = document.getElementById("customEnd");
var $firstInRangeWrap = document.getElementById("firstInRangeWrap");
var $firStart = document.getElementById("firStart");
var $firEnd = document.getElementById("firEnd");
var $fetchBtn = document.getElementById("fetchBtn");
var $slotsBox = document.getElementById("slotsBox");
var $slotCount = document.getElementById("slotCount");
var $slotId = document.getElementById("slotId");
var $bookBtn = document.getElementById("bookBtn");
var $bookResult = document.getElementById("bookResult");
var $cookieStatus = document.getElementById("cookieStatus");
var $logBox = document.getElementById("logBox");
var $refreshLogBtn = document.getElementById("refreshLogBtn");
var $clearLogBtn = document.getElementById("clearLogBtn");
var $banner = document.getElementById("statusBanner");
var $bannerTitle = document.getElementById("statusTitle");
var $bannerDetail = document.getElementById("statusDetail");
var $countdown = document.getElementById("countdown");
var $cdTime = document.getElementById("cdTime");
var $scheduleBtn = document.getElementById("scheduleBtn");
var $runNowBtn = document.getElementById("runNowBtn");
var $cancelBtn = document.getElementById("cancelBtn");
var $bannerStopBtn = document.getElementById("bannerStopBtn");
var $tpH = document.getElementById("tpH");
var $tpM = document.getElementById("tpM");
var $tpS = document.getElementById("tpS");
var $tpAP = document.getElementById("tpAP");
var $pageReloadToggle = document.getElementById("pageReloadToggle");

var _lastRenderedFetchAt = 0;

// ============================================================
// UTILS
// ============================================================
function pad(n) { return String(n).padStart(2, "0"); }

function getDefaultDate() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function parseLabelDate(label) {
    if (!label) return "";
    var m = String(label).match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (!m) return "";
    var day = pad(parseInt(m[1], 10));
    var monMap = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
    var mon = monMap[m[2]] || "";
    if (!mon) return "";
    return m[3] + "-" + mon + "-" + day;
}

function parseLabelTimeRange(label) {
    if (!label) return "";
    var m = String(label).match(/\(([^)]+)\)/);
    return m ? m[1] : "";
}

function slotDateFromSlot(slot) {
    return slot.date || slot.slot_date || slot.booking_date || parseLabelDate(slot.label || slot.name || "");
}

function slotMatchesDateForDisplay(slot, preferredDate) {
    if (!preferredDate) return true;
    var sd = slotDateFromSlot(slot);
    return sd && sd === preferredDate;
}

// Mirror of the background.js time-matching logic so the popup can check matches locally
function normalizeTimeLocal(str) {
    return String(str).replace(/\s+/g, "").replace(/am|pm/gi, "").replace(/^0/, "").toLowerCase().trim();
}

function parseTimeToMinutesLocal(str) {
    if (!str) return null;
    var m = String(str).match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2] || "0", 10);
    if (isNaN(h) || isNaN(min)) return null;
    var ap = (m[3] || "").toLowerCase();
    if (ap) {
        if (h < 1 || h > 12 || min > 59) return null;
        if (ap === "am" && h === 12) h = 0;
        if (ap === "pm" && h !== 12) h += 12;
    } else {
        if (h > 23 || min > 59) return null;
    }
    return (h * 60) + min;
}

function extractFirstTimeMinutesLocal(text) {
    if (!text) return null;
    // Try AM/PM format first (e.g. "8:45 AM", "3:25 pm")
    var m = String(text).match(/\d{1,2}(?::\d{2})?\s*[ap]m/i);
    if (m) return parseTimeToMinutesLocal(m[0]);
    // Fallback: 24h format (e.g. "08:45", "15:25")
    var m2 = String(text).match(/(\d{1,2}):(\d{2})/);
    if (m2) return parseTimeToMinutesLocal(m2[0]);
    return null;
}

function extractSlotStartMinutesLocal(slot) {
    var labelRange = parseLabelTimeRange(slot.label || slot.name || "");
    var timeFields = [slot.time, slot.start_time, slot.timing, slot.slot_time, slot.from_time, slot.timeRange, labelRange, slot.label, slot.name];
    for (var i = 0; i < timeFields.length; i++) {
        var minutes = extractFirstTimeMinutesLocal(timeFields[i]);
        if (minutes !== null) return minutes;
    }
    return null;
}

function slotMatchesCustomRangeLocal(slot, startStr, endStr) {
    var startMin = parseTimeToMinutesLocal(startStr);
    var endMin = parseTimeToMinutesLocal(endStr);
    if (startMin === null || endMin === null || endMin < startMin) return false;
    var slotStart = extractSlotStartMinutesLocal(slot);
    if (slotStart === null) return false;
    return slotStart >= startMin && slotStart <= endMin;
}

function slotMatchesTimeLocal(slot, preferredTime, customStart, customEnd, firStartVal, firEndVal) {
    if (!preferredTime || preferredTime === "any") return true;
    if (preferredTime === "custom") {
        return slotMatchesCustomRangeLocal(slot, customStart, customEnd);
    }
    if (preferredTime === "first-in-range") {
        return slotMatchesCustomRangeLocal(slot, firStartVal, firEndVal);
    }
    // Primary: minute-based range comparison (handles 12h/24h mismatch)
    var parts = preferredTime.split(/\s*to\s*/i);
    if (parts.length === 2) {
        var rangeStart = parseTimeToMinutesLocal(parts[0].trim());
        var rangeEnd = parseTimeToMinutesLocal(parts[1].trim());
        if (rangeStart !== null && rangeEnd !== null && rangeEnd >= rangeStart) {
            var slotStart = extractSlotStartMinutesLocal(slot);
            if (slotStart !== null) {
                return slotStart >= rangeStart && slotStart <= rangeEnd;
            }
        }
    }
    // Fallback: substring search in JSON (for non-range preferences)
    var norm = normalizeTimeLocal(preferredTime);
    var hay = JSON.stringify(slot).toLowerCase();
    if (hay.indexOf(norm) !== -1) return true;
    var fparts = norm.split("to");
    var start = fparts[0] ? fparts[0].trim() : "";
    if (start) {
        if (hay.indexOf(start) !== -1) return true;
        var padded = start.replace(/^(\d):/, "0$1:");
        if (padded !== start && hay.indexOf(padded) !== -1) return true;
    }
    var labelRange = parseLabelTimeRange(slot.label || slot.name || "");
    var timeFields = [slot.time, slot.start_time, slot.timing, slot.slot_time, slot.from_time, slot.timeRange, labelRange];
    for (var tf = 0; tf < timeFields.length; tf++) {
        if (timeFields[tf] && normalizeTimeLocal(String(timeFields[tf])).indexOf(norm) !== -1) return true;
    }
    return false;
}

function fmt24to12(timeStr) {
    if (!timeStr) return "";
    var parts = timeStr.split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1] || "0", 10);
    var ap = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return h + ":" + pad(m) + " " + ap;
}

function slotTimeLabel() {
    if ($slotTime.value === "custom") {
        var s = ($customStart.value || "").trim();
        var e = ($customEnd.value || "").trim();
        return "Custom " + (s && e ? (fmt24to12(s) + " – " + fmt24to12(e)) : "(incomplete)");
    }
    if ($slotTime.value === "first-in-range") {
        var s2 = ($firStart.value || "").trim();
        var e2 = ($firEnd.value || "").trim();
        return "First in " + (s2 && e2 ? (fmt24to12(s2) + " – " + fmt24to12(e2)) : "(incomplete)");
    }
    return $slotTime.value;
}

function toggleCustomRangeUI() {
    if ($customRangeWrap) $customRangeWrap.style.display = $slotTime.value === "custom" ? "" : "none";
    if ($firstInRangeWrap) $firstInRangeWrap.style.display = $slotTime.value === "first-in-range" ? "" : "none";
}

function bgMsg(msg, attempt) {
    var tries = attempt || 0;
    return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage(msg, function (resp) {
            if (chrome.runtime.lastError) {
                var errMsg = chrome.runtime.lastError.message || "Unknown error";
                if (tries < 1 && errMsg.toLowerCase().indexOf("message port closed") !== -1) {
                    setTimeout(function () {
                        bgMsg(msg, tries + 1).then(resolve).catch(reject);
                    }, 250);
                    return;
                }
                reject(new Error(errMsg));
                return;
            }
            if (!resp) {
                reject(new Error("No response from background"));
                return;
            }
            if (!resp.ok) {
                reject(new Error(resp.error || "Background error"));
                return;
            }
            resolve(resp);
        });
    });
}

function ensureBgReady() {
    return new Promise(function (resolve, reject) {
        var tries = 0;
        function ping() {
            chrome.runtime.sendMessage({ action: "ping" }, function (resp) {
                if (chrome.runtime.lastError) {
                    if (tries < 2) {
                        tries++;
                        setTimeout(ping, 300);
                        return;
                    }
                    reject(new Error(chrome.runtime.lastError.message || "Background not ready"));
                    return;
                }
                if (resp && resp.ok) {
                    resolve(true);
                    return;
                }
                if (tries < 2) {
                    tries++;
                    setTimeout(ping, 300);
                    return;
                }
                reject(new Error("Background not ready"));
            });
        }
        ping();
    });
}

function localLog(msg) {
    chrome.storage.local.get("autoLog", function (r) {
        var logs = r.autoLog || [];
        logs.push("[" + new Date().toLocaleTimeString() + "] " + msg);
        if (logs.length > 150) logs.splice(0, logs.length - 150);
        chrome.storage.local.set({ autoLog: logs });
    });
}

// ============================================================
// BANNER STATES
// ============================================================
var BANNER_MAP = {
    idle: { cls: "banner-idle", title: "Ready" },
    scheduled: { cls: "banner-scheduled", title: "Scheduled" },
    running: { cls: "banner-running", title: "Running..." },
    booked: { cls: "banner-booked", title: "Booked!" },
    error: { cls: "banner-error", title: "Error" },
    no_slots: { cls: "banner-no_slots", title: "No Slots" },
    no_match: { cls: "banner-no_match", title: "Slot Not Available" }
};

function setBanner(state, detail) {
    var s = BANNER_MAP[state] || BANNER_MAP.idle;
    $banner.className = "banner " + s.cls;
    $bannerTitle.textContent = s.title;
    $bannerDetail.textContent = detail || "";
    var showStop = state === "scheduled" || state === "running";
    if ($bannerStopBtn) $bannerStopBtn.style.display = showStop ? "" : "none";
}

// ============================================================
// COUNTDOWN
// ============================================================
var cdInterval = null, cdTarget = 0;

function startCD(targetMs) {
    cdTarget = targetMs;
    $countdown.style.display = "";
    clearInterval(cdInterval);
    tickCD();
    cdInterval = setInterval(tickCD, 1000);
}

function stopCD() {
    clearInterval(cdInterval);
    cdInterval = null;
    $countdown.style.display = "none";
    $cdTime.textContent = "--:--:--";
}

function tickCD() {
    var diff = cdTarget - Date.now();
    if (diff <= 0) {
        stopCD();
        // If alarm hasn't fired yet (status still "scheduled"), trigger auto-book immediately
        // Chrome alarms can fire 30–60s late due to minimum-delay constraints.
        chrome.storage.local.get(["autoStatus", "autoEnabled"], function (r) {
            if (r.autoEnabled && r.autoStatus === "scheduled") {
                localLog("[PRECISION] Countdown hit 0 — triggering auto-book now (alarm may be delayed)");
                chrome.storage.local.set({ autoStatus: "running", autoDetail: "Triggered by precision timer…" }, function () {
                    ensureBgReady().then(function () {
                        return bgMsg({ action: "runNow" });
                    }).catch(function (e) {
                        localLog("[PRECISION ERROR] " + e.message);
                    });
                });
            } else {
                refreshStatus();
            }
        });
        return;
    }
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    $cdTime.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);
}

// ============================================================
// STATUS REFRESH (polls chrome.storage)
// ============================================================
function refreshStatus() {
    chrome.storage.local.get(["autoStatus", "autoDetail", "autoEnabled", "targetTime", "bookResult", "lastFetchedSlots", "lastFetchedAt", "lastMatchedSlotId"], function (r) {
        var st = r.autoStatus || "idle";
        var detail = r.autoDetail || "";
        if (st === "booked" && r.bookResult && !detail) {
            try {
                var br = JSON.parse(r.bookResult);
                detail = "Booked! " + (br.message || br.msg || JSON.stringify(br).substring(0, 80));
            } catch (e) {
                detail = "Booked! " + String(r.bookResult).substring(0, 80);
            }
        }
        setBanner(st, detail);
        if (st === "scheduled" && r.targetTime && r.targetTime > Date.now()) {
            startCD(r.targetTime);
        } else if (st !== "scheduled") {
            stopCD();
        }
        // Show slots fetched by the scheduled run in the Available Slots box
        var fetchAt = r.lastFetchedAt || 0;
        if (fetchAt && fetchAt !== _lastRenderedFetchAt && Array.isArray(r.lastFetchedSlots) && r.lastFetchedSlots.length > 0) {
            _lastRenderedFetchAt = fetchAt;
            renderFetchedSlots(r.lastFetchedSlots, r.lastMatchedSlotId || null);
        }
    });
}

// ============================================================
// LOAD LOGS
// ============================================================
function loadLogs() {
    chrome.storage.local.get("autoLog", function (r) {
        var logs = r.autoLog || [];
        $logBox.textContent = logs.length ? logs.join("\n") : "No logs yet.";
        $logBox.scrollTop = $logBox.scrollHeight;
    });
}

// ============================================================
// TIME PICKER
// ============================================================
function toggleAP() {
    var v = $tpAP.textContent.trim();
    $tpAP.textContent = (v === "AM") ? "PM" : "AM";
    $tpAP.className = "tp-ampm" + ($tpAP.textContent === "AM" ? " am" : "");
}

$tpAP.addEventListener("click", toggleAP);

document.querySelectorAll(".tp-arrow").forEach(function (btn) {
    btn.addEventListener("click", function () {
        var fid = btn.getAttribute("data-field");
        var dir = parseInt(btn.getAttribute("data-dir"), 10);
        if (fid === "tpAP") { toggleAP(); return; }
        var el = document.getElementById(fid);
        var v = parseInt(el.value, 10) || 0;
        if (fid === "tpH") {
            v += dir;
            if (v > 12) v = 1;
            if (v < 1) v = 12;
        } else {
            v += dir;
            if (v > 59) v = 0;
            if (v < 0) v = 59;
        }
        el.value = pad(v);
    });
});

[$tpH, $tpM, $tpS].forEach(function (el) {
    el.addEventListener("input", function () { el.value = el.value.replace(/\D/g, ""); });
    el.addEventListener("blur", function () {
        var v = parseInt(el.value, 10);
        if (el === $tpH) { v = (isNaN(v) || v < 1) ? 12 : (v > 12 ? 12 : v); }
        else { v = (isNaN(v) || v < 0) ? 0 : (v > 59 ? 59 : v); }
        el.value = pad(v);
    });
    el.addEventListener("focus", function () { el.select(); });
    el.addEventListener("wheel", function (e) {
        e.preventDefault();
        var d = e.deltaY < 0 ? 1 : -1;
        var v = parseInt(el.value, 10) || 0;
        if (el === $tpH) { v += d; if (v > 12) v = 1; if (v < 1) v = 12; }
        else { v += d; if (v > 59) v = 0; if (v < 0) v = 59; }
        el.value = pad(v);
    }, { passive: false });
});

function get24h() {
    var h = parseInt($tpH.value, 10) || 12;
    var m = parseInt($tpM.value, 10) || 0;
    var s = parseInt($tpS.value, 10) || 0;
    var ap = $tpAP.textContent.trim();
    if (ap === "AM" && h === 12) h = 0;
    if (ap === "PM" && h !== 12) h += 12;
    return { h: h, m: m, s: s };
}

function set12h(h24, m, s) {
    var ap = "AM", h = h24;
    if (h24 === 0) { h = 12; ap = "AM"; }
    else if (h24 === 12) { h = 12; ap = "PM"; }
    else if (h24 > 12) { h = h24 - 12; ap = "PM"; }
    $tpH.value = pad(h);
    $tpM.value = pad(m || 0);
    $tpS.value = pad(s || 0);
    $tpAP.textContent = ap;
    $tpAP.className = "tp-ampm" + (ap === "AM" ? " am" : "");
}

function fmt12(h24, m, s) {
    var ap = "AM", h = h24;
    if (h24 === 0) { h = 12; ap = "AM"; }
    else if (h24 === 12) { h = 12; ap = "PM"; }
    else if (h24 > 12) { h = h24 - 12; ap = "PM"; }
    return pad(h) + ":" + pad(m) + ":" + pad(s) + " " + ap;
}

// ============================================================
// SLOT HELPERS — extract ID & display fields from raw slot obj
// ============================================================
function extractSlotId(slot) {
    return slot.id || slot.slot_id || slot.slotId || slot.slot_Id || slot["_id"] || null;
}

function extractSlotDisplay(slot) {
    var sid = extractSlotId(slot) || "?";
    var name = slot.name || slot.slot_name || slot.label || slot.title || "";
    var time = slot.time || slot.start_time || slot.timing || slot.slot_time || slot.from_time || "";
    if (!time) time = parseLabelTimeRange(slot.label || slot.name || "");
    var date = slotDateFromSlot(slot);
    var seats = slot.available_seats !== undefined ? slot.available_seats
        : (slot.seats !== undefined ? slot.seats : (slot.remaining !== undefined ? slot.remaining : ""));
    return { sid: sid, name: name, time: time, date: date, seats: seats };
}

function parseSlots(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
        var candidates = ["data", "slots", "available_slots", "result", "items", "list"];
        for (var i = 0; i < candidates.length; i++) {
            if (Array.isArray(data[candidates[i]])) return data[candidates[i]];
        }
    }
    return [];
}

// Renders slot cards into slotsBox. matchedSlotId is used to highlight the auto-matched slot.
function renderFetchedSlots(slots, matchedSlotId) {
    if (!slots || slots.length === 0) {
        $slotsBox.innerHTML = '<div class="msg-row info">No available slots found.</div>';
        $slotCount.style.display = "none";
        return;
    }
    $slotCount.textContent = slots.length + " slot" + (slots.length !== 1 ? "s" : "");
    $slotCount.style.display = "";
    $slotsBox.innerHTML = "";
    slots.forEach(function (slot) {
        var d = extractSlotDisplay(slot);
        var sId = extractSlotId(slot);
        var isMatch = matchedSlotId !== null && matchedSlotId !== undefined && String(sId) === String(matchedSlotId);
        var card = document.createElement("div");
        card.className = "slot-card" + (isMatch ? " selected" : "");
        var meta = [d.date, d.time, d.seats !== "" ? "Seats: " + d.seats : ""]
            .filter(Boolean).join("  ·  ");
        card.innerHTML =
            '<div class="slot-body">' +
            '<div class="slot-id-label">ID: ' + d.sid + (d.name ? "  — " + d.name : "") + '</div>' +
            (meta ? '<div class="slot-meta">' + meta + '</div>' : "") +
            '</div>' +
            '<span class="slot-pick-tag">' + (isMatch ? "✓ Match" : "Select") + '</span>';
        card.addEventListener("click", function () {
            $slotId.value = d.sid;
            document.querySelectorAll(".slot-card").forEach(function (c) {
                c.classList.remove("selected");
                c.querySelector(".slot-pick-tag").textContent = "Select";
            });
            card.classList.add("selected");
            card.querySelector(".slot-pick-tag").textContent = "✓ Selected";
        });
        if (isMatch) {
            $slotId.value = d.sid;
        }
        $slotsBox.appendChild(card);
    });
}

// ============================================================
// INIT
// ============================================================
(function init() {
    // 1. Cookie / session check — verify via API (200 = valid, anything else = expired/no session)
    $cookieStatus.textContent = "● Checking…";
    $cookieStatus.className = "session-pill";
    chrome.runtime.sendMessage({ action: "checkSession" }, function (resp) {
        if (resp && resp.ok && resp.active) {
            $cookieStatus.textContent = "● Session Active";
            $cookieStatus.className = "session-pill active";
        } else {
            $cookieStatus.textContent = "● Please Login to PS";
            $cookieStatus.className = "session-pill inactive";
        }
    });

    // 2. Restore saved config
    chrome.storage.local.get([
        "courseId", "registerId", "slotTime", "slotDate",
        "slotTimeCustomStart", "slotTimeCustomEnd",
        "firStart", "firEnd",
        "triggerHour", "triggerMinute", "triggerSecond", "pageReloadEnabled"
    ], function (s) {
        if (s.courseId) $courseId.value = s.courseId;
        if (s.registerId) $registerId.value = s.registerId;
        if (s.slotTime) {
            $slotTime.value = s.slotTime;
            if ($slotTime.value !== s.slotTime) $slotTime.value = "any";
        }
        if (s.slotTimeCustomStart) $customStart.value = s.slotTimeCustomStart;
        if (s.slotTimeCustomEnd) $customEnd.value = s.slotTimeCustomEnd;
        if (s.firStart) $firStart.value = s.firStart;
        if (s.firEnd) $firEnd.value = s.firEnd;
        toggleCustomRangeUI();
        if (s.slotDate) {
            $slotDate.value = s.slotDate;
        } else {
            $slotDate.value = getDefaultDate();
            chrome.storage.local.set({ slotDate: $slotDate.value });
        }
        if (s.triggerHour !== undefined) {
            set12h(s.triggerHour, s.triggerMinute || 0, s.triggerSecond || 0);
        }
        // Default page reload = OFF (pure API mode)
        $pageReloadToggle.checked = s.pageReloadEnabled === true;
    });

    // 3. Initial status + log
    refreshStatus();
    loadLogs();

    // 4. Poll for updates every 1.5s
    setInterval(function () { refreshStatus(); loadLogs(); }, 1500);
})();

// ============================================================
// AUTO-SAVE
// ============================================================
$courseId.addEventListener("input", function () { chrome.storage.local.set({ courseId: $courseId.value }); });
$registerId.addEventListener("input", function () { chrome.storage.local.set({ registerId: $registerId.value }); });
$slotTime.addEventListener("change", function () {
    chrome.storage.local.set({ slotTime: $slotTime.value });
    toggleCustomRangeUI();
});
$customStart.addEventListener("change", function () { chrome.storage.local.set({ slotTimeCustomStart: $customStart.value }); });
$customEnd.addEventListener("change", function () { chrome.storage.local.set({ slotTimeCustomEnd: $customEnd.value }); });
$firStart.addEventListener("change", function () { chrome.storage.local.set({ firStart: $firStart.value }); });
$firEnd.addEventListener("change", function () { chrome.storage.local.set({ firEnd: $firEnd.value }); });
$slotDate.addEventListener("change", function () { chrome.storage.local.set({ slotDate: $slotDate.value }); });
$pageReloadToggle.addEventListener("change", function () {
    chrome.storage.local.set({ pageReloadEnabled: $pageReloadToggle.checked });
    localLog("Page Reload: " + ($pageReloadToggle.checked ? "ON (will open/reload PS tab)" : "OFF (pure API mode, no page reload)"));
    loadLogs();
});

// ============================================================
// FETCH SLOTS  (GET /available?id=courseId → parse → display)
// ============================================================
$fetchBtn.addEventListener("click", function () {
    var cid = $courseId.value.trim();
    var rid = $registerId.value.trim();
    if (!cid) {
        $slotsBox.innerHTML = '<div class="msg-row error">Enter a Course ID first.</div>';
        return;
    }

    $fetchBtn.disabled = true;
    $fetchBtn.textContent = "Fetching…";
    $slotsBox.innerHTML = '<div class="empty-state"><span class="spinner"></span>Fetching slots…</div>';
    $slotCount.style.display = "none";
    $bookResult.style.display = "none";

    ensureBgReady().then(function () {
        return bgMsg({ action: "fetchSlots", courseId: cid });
    })
        .then(function (resp) {
            var raw = resp.data;
            var allSlots = parseSlots(raw);
            var preferredDate = $slotDate.value;
            var preferredTime = $slotTime.value;
            var slots = allSlots;

            if (preferredDate) {
                slots = slots.filter(function (s) { return slotMatchesDateForDisplay(s, preferredDate); });
            }

            if (!slots || slots.length === 0) {
                $slotsBox.innerHTML = '<div class="msg-row info">No available slots found.</div>' +
                    (raw ? '<pre class="result-box" style="margin-top:8px;font-size:10px">' + JSON.stringify(raw, null, 2).substring(0, 600) + '</pre>' : "");
                return;
            }

            // ── Sort slots by start time for first-in-range mode ──
            if (preferredTime === "first-in-range") {
                slots.sort(function (a, b) {
                    var aMin = extractSlotStartMinutesLocal(a);
                    var bMin = extractSlotStartMinutesLocal(b);
                    if (aMin === null && bMin === null) return 0;
                    if (aMin === null) return 1;
                    if (bMin === null) return -1;
                    return aMin - bMin;
                });
            }

            // ── Find preferred-time match ──
            var matchedSlot = null;
            if (preferredTime && preferredTime !== "any") {
                for (var i = 0; i < slots.length; i++) {
                    if (slotMatchesTimeLocal(slots[i], preferredTime, $customStart.value, $customEnd.value, $firStart.value, $firEnd.value)) {
                        matchedSlot = slots[i];
                        break;
                    }
                }
            }

            var matchedSlotId = matchedSlot ? extractSlotId(matchedSlot) : null;
            // Persist so popup re-opens show latest fetch and refreshStatus doesn't re-render
            var fetchNow = Date.now();
            chrome.storage.local.set({ lastFetchedSlots: slots.slice(0, 50), lastFetchedAt: fetchNow, lastMatchedSlotId: matchedSlotId });
            _lastRenderedFetchAt = fetchNow;
            renderFetchedSlots(slots, matchedSlotId);

            // ── Auto-book the matched slot if Register ID is available ──
            if (matchedSlot && rid) {
                var sid = extractSlotId(matchedSlot);
                $bookResult.style.display = "";
                $bookResult.className = "result-box";
                $bookResult.textContent = "Match found (Slot #" + sid + ") — booking now…";
                localLog("[FETCH-MATCH] Auto-booking matched slot #" + sid + " (preferred: " + preferredTime + ")");

                ensureBgReady().then(function () {
                    return bgMsg({ action: "bookSlot", slotId: sid, registerId: rid });
                })
                    .then(function (bookResp) {
                        $bookResult.className = "result-box ok";
                        $bookResult.textContent = "BOOKED (Slot #" + sid + "):\n" + JSON.stringify(bookResp.data, null, 2);
                        localLog("[FETCH-MATCH] Booking success: " + JSON.stringify(bookResp.data).substring(0, 200));
                        setBanner("booked", "Slot #" + sid + " booked via Fetch!");
                        chrome.storage.local.set({ autoStatus: "booked", autoDetail: "Slot #" + sid + " booked via Fetch!", bookResult: JSON.stringify(bookResp.data) });
                    })
                    .catch(function (err) {
                        $bookResult.className = "result-box err";
                        $bookResult.textContent = "BOOKING FAILED (Slot #" + sid + "): " + err.message;
                        localLog("[FETCH-MATCH] Booking failed: " + err.message);
                    })
                    .finally(function () { loadLogs(); });

            } else if (matchedSlot && !rid) {
                // Match found but no Register ID — just highlight and prompt
                $bookResult.style.display = "";
                $bookResult.className = "result-box";
                $bookResult.textContent = "Preferred slot found (Slot #" + extractSlotId(matchedSlot) + ") — enter Register ID and click Book Now.";
            }
        })
        .catch(function (err) {
            $slotsBox.innerHTML = '<div class="msg-row error">' + err.message + '</div>';
        })
        .finally(function () {
            $fetchBtn.disabled = false;
            $fetchBtn.textContent = "Fetch Slots";
            loadLogs();
        });
});

// ============================================================
// MANUAL BOOK  (POST /register  { slot_id, register_id })
// ============================================================
$bookBtn.addEventListener("click", function () {
    var sid = String($slotId.value).trim();
    var rid = String($registerId.value).trim();

    if (!sid || !rid) {
        $bookResult.style.display = "";
        $bookResult.className = "result-box err";
        $bookResult.textContent = "Fill both Slot ID and Register ID.";
        return;
    }

    $bookBtn.disabled = true;
    $bookBtn.textContent = "Booking…";
    $bookResult.style.display = "none";

    ensureBgReady().then(function () {
        return bgMsg({ action: "bookSlot", slotId: sid, registerId: rid });
    })
        .then(function (resp) {
            $bookResult.style.display = "";
            $bookResult.className = "result-box ok";
            $bookResult.textContent = "SUCCESS:\n" + JSON.stringify(resp.data, null, 2);
            localLog("Manual book: slot #" + sid + " → " + JSON.stringify(resp.data).substring(0, 200));
        })
        .catch(function (err) {
            $bookResult.style.display = "";
            $bookResult.className = "result-box err";
            $bookResult.textContent = "FAILED: " + err.message;
            localLog("Manual book failed: " + err.message);
        })
        .finally(function () {
            $bookBtn.disabled = false;
            $bookBtn.textContent = "Book Now";
            loadLogs();
        });
});

// ============================================================
// SCHEDULE
// ============================================================
$scheduleBtn.addEventListener("click", function () {
    var cid = $courseId.value.trim();
    var rid = $registerId.value.trim();
    if (!cid || !rid) { setBanner("error", "Fill Course ID and Register ID first"); return; }

    var t = get24h();
    var now = new Date();
    var target = new Date();
    target.setHours(t.h, t.m, t.s, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    var targetMs = target.getTime();
    var delayMin = (target - now) / 60000;
    var disp = fmt12(t.h, t.m, t.s);

    chrome.storage.local.set({
        courseId: cid,
        registerId: rid,
        slotTime: $slotTime.value,
        slotTimeCustomStart: $customStart.value,
        slotTimeCustomEnd: $customEnd.value,
        firStart: $firStart.value,
        firEnd: $firEnd.value,
        slotDate: $slotDate.value,
        autoEnabled: true,
        triggerHour: t.h,
        triggerMinute: t.m,
        triggerSecond: t.s,
        targetTime: targetMs,
        autoStatus: "scheduled",
        autoDetail: "",
        bookResult: ""
    }, function () {
        ensureBgReady().then(function () {
            return bgMsg({ action: "setAlarm", when: targetMs });
        })
            .then(function () {
                startCD(targetMs);
                setBanner("scheduled", "Triggers at " + disp + "  ·  Slot: " + slotTimeLabel());
                localLog("===== SCHEDULED at " + disp + " =====");
                localLog("Course: " + cid + " | Register: " + rid + " | Slot: " + slotTimeLabel() + " | Date: " + ($slotDate.value || "any") + " | Delay: " + delayMin.toFixed(1) + " min");
                loadLogs();
            })
            .catch(function (err) {
                setBanner("error", "Alarm error: " + err.message);
                localLog("Alarm error: " + err.message);
                loadLogs();
            });
    });
});

// ============================================================
// RUN NOW
// ============================================================
$runNowBtn.addEventListener("click", function () {
    var cid = $courseId.value.trim();
    var rid = $registerId.value.trim();
    if (!cid || !rid) { setBanner("error", "Fill Course ID and Register ID first"); return; }

    stopCD();
    setBanner("running", "Starting auto-book now…");

    chrome.storage.local.set({
        courseId: cid,
        registerId: rid,
        slotTime: $slotTime.value,
        slotTimeCustomStart: $customStart.value,
        slotTimeCustomEnd: $customEnd.value,
        firStart: $firStart.value,
        firEnd: $firEnd.value,
        slotDate: $slotDate.value,
        autoEnabled: true,
        autoStatus: "running",
        autoDetail: "Starting…",
        targetTime: 0
    }, function () {
        localLog("=== RUN NOW ===  Course: " + cid + " | Register: " + rid + " | Slot: " + slotTimeLabel() + " | Date: " + ($slotDate.value || "any"));
        ensureBgReady().then(function () {
            return bgMsg({ action: "runNow" });
        })
            .catch(function (err) {
                setBanner("error", "Run error: " + err.message);
                localLog("Run error: " + err.message);
                chrome.storage.local.set({ autoEnabled: false, autoStatus: "error", autoDetail: err.message, targetTime: 0 }, refreshStatus);
            });
        // Frequent poll during active run
        var pollLimit = 0;
        var pollId = setInterval(function () {
            loadLogs(); refreshStatus();
            pollLimit++;
            if (pollLimit > 150) clearInterval(pollId);
        }, 2000);
    });
});

// ============================================================
// CANCEL / STOP
// ============================================================
$cancelBtn.addEventListener("click", function () {
    ensureBgReady().then(function () {
        return bgMsg({ action: "stopAutoBook" });
    }).catch(function () { });
    chrome.storage.local.set(
        { autoEnabled: false, autoStatus: "idle", autoDetail: "Stopped by user", targetTime: 0 },
        function () {
            stopCD();
            setBanner("idle", "Stopped by user");
            localLog("Cancelled by user.");
            loadLogs();
        }
    );
});

$bannerStopBtn.addEventListener("click", function () {
    ensureBgReady().then(function () {
        return bgMsg({ action: "stopAutoBook" });
    }).catch(function () { });
    chrome.storage.local.set(
        { autoEnabled: false, autoStatus: "idle", autoDetail: "Stopped by user", targetTime: 0 },
        function () {
            stopCD();
            setBanner("idle", "Stopped by user");
            localLog("Cancelled by user.");
            loadLogs();
        }
    );
});

// ============================================================
// LOG BUTTONS
// ============================================================
$refreshLogBtn.addEventListener("click", function () { loadLogs(); refreshStatus(); });
$clearLogBtn.addEventListener("click", function () {
    chrome.storage.local.set({ autoLog: [] }, function () {
        $logBox.textContent = "No logs yet.";
    });
});


