// popup.js
var $courseId = document.getElementById("courseId");
var $registerId = document.getElementById("registerId");
var $courseSelect = document.getElementById("courseSelect");
var $coursePicker = document.getElementById("coursePicker");
var $courseSearchInput = document.getElementById("courseSearchInput");
var $courseDropdownBtn = document.getElementById("courseDropdownBtn");
var $courseOptions = document.getElementById("courseOptions");
var $loadCoursesBtn = document.getElementById("loadCoursesBtn");
var $slotTime = document.getElementById("slotTime");
var $slotDate = document.getElementById("slotDate");
var $datePreferenceToggle = document.getElementById("datePreferenceToggle");
var $datePrefWrap = document.getElementById("datePrefWrap");
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
var $addPlanBtn = document.getElementById("addPlanBtn");
var $clearPlansBtn = document.getElementById("clearPlansBtn");
var $planList = document.getElementById("planList");
var $banner = document.getElementById("statusBanner");
var $bannerTitle = document.getElementById("statusTitle");
var $bannerDetail = document.getElementById("statusDetail");
var $planLimitNotice = document.getElementById("planLimitNotice");
var $planLimitText = document.getElementById("planLimitText");
var $planLimitCloseBtn = document.getElementById("planLimitCloseBtn");
var $countdown = document.getElementById("countdown");
var $cdTime = document.getElementById("cdTime");
var $scheduleBtn = document.getElementById("scheduleBtn");
var $runNowBtn = document.getElementById("runNowBtn");
var $cancelBtn = document.getElementById("cancelBtn");
var $bannerStopBtn = document.getElementById("bannerStopBtn");
var $triggerTime = document.getElementById("triggerTime");
var $pageReloadToggle = document.getElementById("pageReloadToggle");

var _lastRenderedFetchAt = 0;
var _courseList = [];
var _courseDropdownOpen = false;
var _bookingPlans = [];
var _stopInProgress = false;
var _planLimitNoticeTimer = null;
var MAX_PARALLEL_BOOKINGS = 5;

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
    var m = String(text).match(/\d{1,2}(?::\d{2})?\s*[ap]m/i);
    if (m) return parseTimeToMinutesLocal(m[0]);
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

function slotTimeLabelFromValues(slotTime, customStart, customEnd, firStartVal, firEndVal) {
    if (slotTime === "custom") {
        var s = (customStart || "").trim();
        var e = (customEnd || "").trim();
        return "Custom " + (s && e ? (fmt24to12(s) + " – " + fmt24to12(e)) : "(incomplete)");
    }
    if (slotTime === "first-in-range") {
        var s2 = (firStartVal || "").trim();
        var e2 = (firEndVal || "").trim();
        return "First in " + (s2 && e2 ? (fmt24to12(s2) + " – " + fmt24to12(e2)) : "(incomplete)");
    }
    return slotTime || "any";
}

function slotTimeLabel() {
    return slotTimeLabelFromValues($slotTime.value, $customStart.value, $customEnd.value, $firStart.value, $firEnd.value);
}

function isDatePreferenceEnabled() {
    return !!($datePreferenceToggle && $datePreferenceToggle.checked);
}

function toggleDatePreferenceUI() {
    if (!$datePrefWrap) return;
    $datePrefWrap.style.display = isDatePreferenceEnabled() ? "" : "none";
}

function toggleCustomRangeUI() {
    if ($customRangeWrap) $customRangeWrap.style.display = $slotTime.value === "custom" ? "" : "none";
    if ($firstInRangeWrap) $firstInRangeWrap.style.display = $slotTime.value === "first-in-range" ? "" : "none";
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function hidePlanLimitNotice() {
    if (!$planLimitNotice) return;
    $planLimitNotice.style.display = "none";
}

function showPlanLimitNotice(message) {
    if (!$planLimitNotice || !$planLimitText) return;
    if (_planLimitNoticeTimer) {
        clearTimeout(_planLimitNoticeTimer);
        _planLimitNoticeTimer = null;
    }
    $planLimitText.textContent = message || "Vaipilla raja 5 slot tha maximun";
    $planLimitNotice.style.display = "flex";
    _planLimitNoticeTimer = setTimeout(function () {
        hidePlanLimitNotice();
        _planLimitNoticeTimer = null;
    }, 4500);
}

function buildPlanId() {
    return "plan_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
}

function normalizePlan(plan) {
    if (!plan) return null;
    var cid = String(plan.courseId || "").trim();
    var rid = String(plan.registerId || "").trim();
    if (!isValidId(cid) || !isValidId(rid)) return null;
    var useDatePreference = plan.useDatePreference === true || (plan.useDatePreference === undefined && !!plan.slotDate);
    return {
        id: String(plan.id || buildPlanId()),
        courseKey: String(plan.courseKey || ""),
        courseName: String(plan.courseName || "Course"),
        courseId: cid,
        registerId: rid,
        slotTime: String(plan.slotTime || "any"),
        useDatePreference: useDatePreference,
        slotDate: useDatePreference ? String(plan.slotDate || "") : "",
        slotTimeCustomStart: String(plan.slotTimeCustomStart || ""),
        slotTimeCustomEnd: String(plan.slotTimeCustomEnd || ""),
        firStart: String(plan.firStart || ""),
        firEnd: String(plan.firEnd || "")
    };
}

function saveBookingPlans() {
    return chrome.storage.local.set({ bookingPlans: _bookingPlans });
}

function renderBookingPlans() {
    if (!$planList) return;
    if (!_bookingPlans.length) {
        $planList.innerHTML = '<div class="plan-empty">No plans yet. Choose course + slot preference, then click Add Current.</div>';
        return;
    }

    $planList.innerHTML = "";
    _bookingPlans.forEach(function (plan, index) {
        var item = document.createElement("div");
        item.className = "plan-item";
        var timeLabel = slotTimeLabelFromValues(plan.slotTime, plan.slotTimeCustomStart, plan.slotTimeCustomEnd, plan.firStart, plan.firEnd);
        var dateLabel = plan.useDatePreference ? ("Date: " + (plan.slotDate || "not set")) : "Date: off";
        var meta = "#" + (index + 1) + "  |  C:" + plan.courseId + "  R:" + plan.registerId + "  |  " + timeLabel + "  |  " + dateLabel;
        item.innerHTML =
            '<div>' +
            '<div class="plan-title">' + escapeHtml(plan.courseName) + '</div>' +
            '<div class="plan-meta">' + escapeHtml(meta) + '</div>' +
            '</div>' +
            '<button class="plan-remove" data-id="' + escapeHtml(plan.id) + '" type="button">Remove</button>';
        $planList.appendChild(item);
    });
}

function setBookingPlans(nextPlans) {
    _bookingPlans = (nextPlans || []).map(normalizePlan).filter(Boolean).slice(0, MAX_PARALLEL_BOOKINGS);
    renderBookingPlans();
    saveBookingPlans();
}

function upsertBookingPlan(plan) {
    var normalized = normalizePlan(plan);
    if (!normalized) {
        return { ok: false, error: "Could not store this booking plan" };
    }

    var updated = false;
    _bookingPlans = _bookingPlans.map(function (existing) {
        if (existing.courseId === normalized.courseId) {
            updated = true;
            return Object.assign({}, normalized, { id: existing.id || normalized.id });
        }
        return existing;
    });
    if (!updated) {
        if (_bookingPlans.length >= MAX_PARALLEL_BOOKINGS) {
            return { ok: false, error: "Parallel slot booking limit is " + MAX_PARALLEL_BOOKINGS + " plans" };
        }
        _bookingPlans.push(normalized);
    }
    renderBookingPlans();
    saveBookingPlans();
    return { ok: true };
}

function removeBookingPlanById(id) {
    var before = _bookingPlans.length;
    _bookingPlans = _bookingPlans.filter(function (plan) { return plan.id !== id; });
    if (_bookingPlans.length !== before) {
        renderBookingPlans();
        saveBookingPlans();
    }
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

function bgMsgWithActionFallback(actions, payload) {
    var list = Array.isArray(actions) ? actions.slice() : [actions];
    var idx = 0;

    function next(lastErr) {
        if (idx >= list.length) {
            return Promise.reject(lastErr || new Error("No action available"));
        }
        var action = list[idx++];
        var req = Object.assign({}, payload || {}, { action: action });
        return bgMsg(req).catch(function (err) {
            var msg = String(err && err.message || "");
            if (/unknown action/i.test(msg) || /no response from background/i.test(msg)) {
                return next(err);
            }
            throw err;
        });
    }

    return next();
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

function withTimeout(promise, ms, timeoutMessage) {
    var timeoutId = null;
    var timeoutPromise = new Promise(function (_, reject) {
        timeoutId = setTimeout(function () {
            reject(new Error(timeoutMessage || "Request timed out"));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(function () {
        if (timeoutId) clearTimeout(timeoutId);
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
        chrome.storage.local.get(["autoStatus", "autoEnabled"], function (r) {
            if (r.autoEnabled && r.autoStatus === "scheduled") {
                chrome.storage.local.set({ autoStatus: "running", autoDetail: "Running..." }, function () {
                    ensureBgReady().then(function () {
                        return bgMsg({ action: "runNow" });
                    }).catch(function (e) {
                        localLog("auto-book error: " + e.message);
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
        var nearBottomThreshold = 24;
        var distanceFromBottom = $logBox.scrollHeight - ($logBox.scrollTop + $logBox.clientHeight);
        var shouldStickToBottom = distanceFromBottom <= nearBottomThreshold;
        var logs = r.autoLog || [];
        $logBox.textContent = logs.length ? logs.join("\n") : "No logs yet.";
        if (shouldStickToBottom) {
            $logBox.scrollTop = $logBox.scrollHeight;
        }
    });
}

// ============================================================
// TIME PICKER
// ============================================================
function normalizeTriggerTimeInput(raw) {
    var txt = String(raw || "").trim();
    if (!txt) return "20:00:00";

    var parts = txt.split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var s = parseInt(parts[2], 10);

    if (isNaN(h) || h < 0 || h > 23) h = 20;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    if (isNaN(s) || s < 0 || s > 59) s = 0;

    return pad(h) + ":" + pad(m) + ":" + pad(s);
}

if ($triggerTime) {
    $triggerTime.value = normalizeTriggerTimeInput($triggerTime.value || "20:00:00");
    $triggerTime.addEventListener("change", function () {
        $triggerTime.value = normalizeTriggerTimeInput($triggerTime.value);
    });
    $triggerTime.addEventListener("blur", function () {
        $triggerTime.value = normalizeTriggerTimeInput($triggerTime.value);
    });
}

function get24h() {
    var raw = String($triggerTime && $triggerTime.value || "").trim();
    var parts = raw.split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var s = parseInt(parts[2] || "0", 10);
    if (isNaN(h) || h < 0 || h > 23) h = 20;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    if (isNaN(s) || s < 0 || s > 59) s = 0;
    return { h: h, m: m, s: s };
}

function set12h(h24, m, s) {
    var hh = parseInt(h24, 10);
    var mm = parseInt(m, 10);
    var ss = parseInt(s, 10);
    if (isNaN(hh) || hh < 0 || hh > 23) hh = 20;
    if (isNaN(mm) || mm < 0 || mm > 59) mm = 0;
    if (isNaN(ss) || ss < 0 || ss > 59) ss = 0;
    if ($triggerTime) {
        $triggerTime.value = pad(hh) + ":" + pad(mm) + ":" + pad(ss);
    }
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
    var sidRaw = extractSlotId(slot);
    var sid = sidRaw !== null && sidRaw !== undefined ? String(sidRaw) : "";
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
        var sId = extractSlotId(slot);
        var sidText = sId !== null && sId !== undefined ? String(sId) : "";
        var hasSlotId = isValidId(sidText);
        var isMatch = matchedSlotId !== null && matchedSlotId !== undefined && String(sId) === String(matchedSlotId);
        var card = document.createElement("div");
        card.className = "slot-card" + (isMatch ? " selected" : "");
        var labelText = String(slot && slot.label !== undefined ? slot.label : "");
        card.innerHTML =
            '<div class="slot-body">' +
            '<div class="slot-name">' + escapeHtml(labelText || "No label") + '</div>' +
            '</div>' +
            '<div class="slot-actions">' +
            (hasSlotId
                ? '<button class="slot-book-btn" data-slot-id="' + escapeHtml(sidText) + '" type="button">Book Now</button>'
                : '<button class="slot-book-btn" type="button" disabled>Book Now</button>') +
            '</div>';
        $slotsBox.appendChild(card);
    });
}

function showBookResult(kind, message) {
    $bookResult.style.display = "";
    $bookResult.className = kind === "ok" ? "result-box ok" : (kind === "err" ? "result-box err" : "result-box");
    $bookResult.textContent = message;
}

function bookSlotById(slotId, triggerButton) {
    var sid = String(slotId || "").trim();
    var rid = String($registerId.value || "").trim();

    if (!isValidId(sid)) {
        showBookResult("err", "This slot does not have a valid slot ID.");
        return Promise.resolve(false);
    }
    if (!isValidId(rid)) {
        showBookResult("err", "Register ID is missing. Select a valid course first.");
        return Promise.resolve(false);
    }

    $slotId.value = sid;
    showBookResult("", "Booking Slot #" + sid + "...");

    $bookBtn.disabled = true;
    $bookBtn.textContent = "Booking...";
    if (triggerButton) {
        triggerButton.disabled = true;
        triggerButton.classList.add("is-loading");
        triggerButton.textContent = "Booking...";
    }

    return ensureBgReady().then(function () {
        return bgMsg({ action: "bookSlot", slotId: sid, registerId: rid });
    }).then(function (resp) {
        showBookResult("ok", "Booked Slot #" + sid + " successfully.\n" + JSON.stringify(resp.data, null, 2));
        localLog("Booked slot #" + sid + " successfully");
        setBanner("booked", "Slot #" + sid + " booked successfully");
        chrome.storage.local.set({ autoStatus: "booked", autoDetail: "Slot #" + sid + " booked", bookResult: JSON.stringify(resp.data) });
        return true;
    }).catch(function (err) {
        showBookResult("err", "Booking failed for Slot #" + sid + ": " + err.message);
        localLog("Booking failed for slot #" + sid + ": " + err.message);
        return false;
    }).finally(function () {
        $bookBtn.disabled = false;
        $bookBtn.textContent = "Book Now";
        if (triggerButton) {
            triggerButton.disabled = false;
            triggerButton.classList.remove("is-loading");
            triggerButton.textContent = "Book Now";
        }
        loadLogs();
    });
}

function isDigits(v) {
    return /^\d+$/.test(String(v || "").trim());
}

function isValidId(v) {
    if (!isDigits(v)) return false;
    return parseInt(String(v), 10) > 0;
}

function syncResolvedIds(courseId, registerId) {
    $courseId.value = String(courseId || "");
    $registerId.value = String(registerId || "");
    chrome.storage.local.set({
        courseId: $courseId.value,
        registerId: $registerId.value
    });
}

function courseMetaLabel(course) {
    var parts = [];
    if (isValidId(course.courseId)) parts.push("C:" + course.courseId);
    if (isValidId(course.registerId)) parts.push("R:" + course.registerId);
    return parts.length ? parts.join("  ·  ") : "IDs will be resolved when selected";
}

function setCoursePickerOpen(open) {
    _courseDropdownOpen = !!open;
    if ($courseOptions) $courseOptions.style.display = open ? "" : "none";
    if ($coursePicker) {
        if (open) $coursePicker.classList.add("open");
        else $coursePicker.classList.remove("open");
    }
}

function getCourseSearchTerm() {
    return String($courseSearchInput && $courseSearchInput.value || "").trim().toLowerCase();
}

function filteredCourses(query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return _courseList.slice();
    return _courseList.filter(function (course) {
        var hay = [course.name, course.courseId, course.registerId].join(" ").toLowerCase();
        return hay.indexOf(q) !== -1;
    });
}

function updateCourseSearchDisplay() {
    if (!$courseSearchInput) return;
    var selected = getSelectedCourse();
    if (selected) {
        $courseSearchInput.value = selected.name;
        return;
    }
    $courseSearchInput.value = "";
}

function renderCourseDropdown(query) {
    if (!$courseOptions) return;

    var list = filteredCourses(query);
    var selected = getSelectedCourse();
    var selectedKey = selected ? selected.key : "";

    $courseOptions.innerHTML = '<div class="course-options-inner"></div>';
    var inner = $courseOptions.querySelector(".course-options-inner");
    if (!inner) return;

    if (list.length === 0) {
        inner.innerHTML = '<div class="course-empty">No course matches your search</div>';
        return;
    }

    list.forEach(function (course) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "course-opt" + (selectedKey === course.key ? " active" : "");
        btn.innerHTML =
            '<div class="course-opt-name">' + course.name + '</div>' +
            '<div class="course-opt-meta">' + courseMetaLabel(course) + '</div>';
        btn.addEventListener("click", function () {
            $courseSelect.value = course.key;
            chrome.storage.local.set({ selectedCourseKey: course.key });
            updateCourseSearchDisplay();
            setCoursePickerOpen(false);
            $courseSelect.dispatchEvent(new Event("change"));
        });
        inner.appendChild(btn);
    });
}

function renderCourseOptions(selectedKey) {
    if (!$courseSelect) return;

    $courseSelect.innerHTML = '<option value="">-- Select a registered course --</option>';
    _courseList.forEach(function (course) {
        var opt = document.createElement("option");
        opt.value = course.key;
        opt.textContent = course.name;
        $courseSelect.appendChild(opt);
    });

    if (selectedKey && _courseList.some(function (c) { return c.key === selectedKey; })) {
        $courseSelect.value = selectedKey;
    } else if (_courseList.length > 0) {
        // Keep selection deterministic when list refresh changes keys.
        $courseSelect.value = _courseList[0].key;
    } else {
        $courseSelect.value = "";
    }

    updateCourseSearchDisplay();
    renderCourseDropdown(getCourseSearchTerm());
}

function getSelectedCourse() {
    var key = String($courseSelect && $courseSelect.value || "");
    if (!key) return null;
    for (var i = 0; i < _courseList.length; i++) {
        if (_courseList[i].key === key) return _courseList[i];
    }
    return null;
}

function updateCourseInState(updated) {
    _courseList = _courseList.map(function (c) {
        return c.key === updated.key ? updated : c;
    });
}

function resolveCourseSelection(course, silent) {
    if (!course) {
        return Promise.reject(new Error("Select a registered course first"));
    }

    if (isValidId(course.courseId) && isValidId(course.registerId)) {
        syncResolvedIds(course.courseId, course.registerId);
        return Promise.resolve({ courseId: course.courseId, registerId: course.registerId });
    }

    $loadCoursesBtn.disabled = true;
    $courseSelect.disabled = true;

    return ensureBgReady().then(function () {
        return bgMsgWithActionFallback([
            "resolveCourseSelection",
            "resolveSelectedCourse",
            "resolveCourseIds"
        ], { selection: course });
    }).then(function (resp) {
        var data = resp.data || {};
        var nextCourse = {
            key: course.key,
            name: course.name,
            courseId: String(data.courseId || ""),
            registerId: String(data.registerId || ""),
            courseCandidates: course.courseCandidates || [],
            registerCandidates: course.registerCandidates || []
        };
        updateCourseInState(nextCourse);
        renderCourseOptions(nextCourse.key);
        syncResolvedIds(nextCourse.courseId, nextCourse.registerId);
        if (!silent) {
            localLog("Resolved IDs for " + course.name + " -> C:" + nextCourse.courseId + " R:" + nextCourse.registerId);
            loadLogs();
        }
        return { courseId: nextCourse.courseId, registerId: nextCourse.registerId };
    }).finally(function () {
        $loadCoursesBtn.disabled = false;
        $courseSelect.disabled = false;
        if ($courseSearchInput) $courseSearchInput.disabled = false;
        if ($courseDropdownBtn) $courseDropdownBtn.disabled = false;
    });
}

function loadRegisteredCourses(preferredKey, quiet) {
    if (!$loadCoursesBtn) return Promise.resolve();

    $loadCoursesBtn.disabled = true;
    $loadCoursesBtn.textContent = "Loading...";
    if ($courseSearchInput) $courseSearchInput.disabled = true;
    if ($courseDropdownBtn) $courseDropdownBtn.disabled = true;
    if (!quiet) {
        $slotsBox.innerHTML = '<div class="empty-state"><span class="spinner"></span>Loading registered courses…</div>';
        $slotCount.style.display = "none";
    }

    return withTimeout(ensureBgReady(), 6000, "Background did not start in time").then(function () {
        return withTimeout(bgMsgWithActionFallback([
            "fetchRegisteredCourses",
            "fetcRegisteredCourses",
            "fetchRegistredCourses",
            "fetchCourses"
        ], {}), 12000, "Loading courses took too long. Please reopen PS tab and try again.");
    }).then(function (resp) {
        _courseList = Array.isArray(resp.data) ? resp.data : [];
        renderCourseOptions(preferredKey || "");
        if (_courseList.length === 0) {
            $courseSelect.value = "";
            syncResolvedIds("", "");
            if (!quiet) {
                $slotsBox.innerHTML = '<div class="msg-row info">No registered courses found. Make sure PS session is active.</div>';
            }
            return;
        }

        if (!$courseSelect.value) {
            $courseSelect.value = _courseList[0].key;
        }

        chrome.storage.local.set({ selectedCourseKey: $courseSelect.value });
        var selected = getSelectedCourse();
        return resolveCourseSelection(selected, true);
    }).catch(function (err) {
        if (!quiet) {
            $slotsBox.innerHTML = '<div class="msg-row error">Failed to load courses: ' + err.message + '</div>';
        }
        throw err;
    }).finally(function () {
        $loadCoursesBtn.disabled = false;
        $loadCoursesBtn.textContent = "Load Courses";
        if ($courseSearchInput) $courseSearchInput.disabled = false;
        if ($courseDropdownBtn) $courseDropdownBtn.disabled = false;
    });
}

function validateSlotPreference(slotTime, customStart, customEnd, firStartVal, firEndVal) {
    if (slotTime === "custom") {
        if (!customStart || !customEnd) return "Set both custom start and end time";
        var cs = parseTimeToMinutesLocal(customStart);
        var ce = parseTimeToMinutesLocal(customEnd);
        if (cs === null || ce === null || ce < cs) return "Custom range is invalid";
    }
    if (slotTime === "first-in-range") {
        if (!firStartVal || !firEndVal) return "Set both first-in-range start and end time";
        var fs = parseTimeToMinutesLocal(firStartVal);
        var fe = parseTimeToMinutesLocal(firEndVal);
        if (fs === null || fe === null || fe < fs) return "First-in-range window is invalid";
    }
    return "";
}

function validateDatePreference(useDatePreference, slotDate) {
    if (useDatePreference && !slotDate) {
        return "Select preferred slot date or turn off Date Preference";
    }
    return "";
}

function buildCurrentSelectionPlan() {
    var selected = getSelectedCourse();
    if (!selected) return Promise.reject(new Error("Select a registered course first"));

    var slotTime = String($slotTime.value || "any");
    var useDatePreference = isDatePreferenceEnabled();
    var slotDate = String($slotDate.value || "");
    var customStart = String($customStart.value || "");
    var customEnd = String($customEnd.value || "");
    var firStartVal = String($firStart.value || "");
    var firEndVal = String($firEnd.value || "");
    var preferenceError = validateSlotPreference(slotTime, customStart, customEnd, firStartVal, firEndVal);
    if (preferenceError) return Promise.reject(new Error(preferenceError));
    var datePreferenceError = validateDatePreference(useDatePreference, slotDate);
    if (datePreferenceError) return Promise.reject(new Error(datePreferenceError));

    return resolveCourseSelection(selected, true).then(function (ids) {
        return normalizePlan({
            id: buildPlanId(),
            courseKey: selected.key,
            courseName: selected.name,
            courseId: ids.courseId,
            registerId: ids.registerId,
            slotTime: slotTime,
            useDatePreference: useDatePreference,
            slotDate: useDatePreference ? slotDate : "",
            slotTimeCustomStart: customStart,
            slotTimeCustomEnd: customEnd,
            firStart: firStartVal,
            firEnd: firEndVal
        });
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
        "courseId", "registerId", "slotTime", "slotDate", "useDatePreference",
        "slotTimeCustomStart", "slotTimeCustomEnd",
        "firStart", "firEnd",
        "triggerHour", "triggerMinute", "triggerSecond", "pageReloadEnabled", "selectedCourseKey", "bookingPlans"
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
        if ($datePreferenceToggle) {
            $datePreferenceToggle.checked = s.useDatePreference === true;
        }
        if (s.slotDate) {
            $slotDate.value = s.slotDate;
        } else {
            $slotDate.value = getDefaultDate();
            chrome.storage.local.set({ slotDate: $slotDate.value });
        }
        toggleDatePreferenceUI();
        if (s.triggerHour !== undefined) {
            set12h(s.triggerHour, s.triggerMinute || 0, s.triggerSecond || 0);
        }
        // Default page reload = OFF (pure API mode)
        $pageReloadToggle.checked = s.pageReloadEnabled === true;
        setBookingPlans(Array.isArray(s.bookingPlans) ? s.bookingPlans : []);

        loadRegisteredCourses(s.selectedCourseKey || "", true).catch(function () {
            // Keep the popup usable even if course-list API fails initially.
        });
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

if ($courseDropdownBtn) {
    $courseDropdownBtn.addEventListener("click", function () {
        if (_courseDropdownOpen) {
            setCoursePickerOpen(false);
            return;
        }
        renderCourseDropdown(getCourseSearchTerm());
        setCoursePickerOpen(true);
        if ($courseSearchInput) $courseSearchInput.focus();
    });
}

if ($courseSearchInput) {
    $courseSearchInput.addEventListener("focus", function () {
        renderCourseDropdown(getCourseSearchTerm());
        setCoursePickerOpen(true);
    });

    $courseSearchInput.addEventListener("input", function () {
        renderCourseDropdown(getCourseSearchTerm());
        setCoursePickerOpen(true);
    });

    $courseSearchInput.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            setCoursePickerOpen(false);
            updateCourseSearchDisplay();
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            var first = filteredCourses(getCourseSearchTerm())[0];
            if (!first) return;
            $courseSelect.value = first.key;
            chrome.storage.local.set({ selectedCourseKey: first.key });
            updateCourseSearchDisplay();
            setCoursePickerOpen(false);
            $courseSelect.dispatchEvent(new Event("change"));
        }
    });
}

document.addEventListener("click", function (e) {
    if (!$coursePicker || !$courseOptions) return;
    if ($coursePicker.contains(e.target) || $courseOptions.contains(e.target)) return;
    if (_courseDropdownOpen) {
        setCoursePickerOpen(false);
        updateCourseSearchDisplay();
    }
});

$loadCoursesBtn.addEventListener("click", function () {
    loadRegisteredCourses($courseSelect.value || "", false).then(function () {
        localLog("Registered course list refreshed");
        loadLogs();
    }).catch(function (err) {
        localLog("Course load failed: " + err.message);
        loadLogs();
    });
});

if ($addPlanBtn) {
    $addPlanBtn.addEventListener("click", function () {
        $addPlanBtn.disabled = true;
        $addPlanBtn.textContent = "Adding...";
        buildCurrentSelectionPlan().then(function (plan) {
            if (!plan) throw new Error("Could not prepare booking plan");
            var upsertResult = upsertBookingPlan(plan);
            if (!upsertResult.ok) {
                var msg = upsertResult.error || "Could not store this booking plan";
                if (msg.toLowerCase().indexOf("limit") !== -1) {
                    showPlanLimitNotice("Vaipilla raja 5 slot tha maximun");
                    return;
                }
                throw new Error(msg);
            }
            var timeLabel = slotTimeLabelFromValues(plan.slotTime, plan.slotTimeCustomStart, plan.slotTimeCustomEnd, plan.firStart, plan.firEnd);
            localLog("Plan saved: " + plan.courseName + " | " + timeLabel + " | Date: " + (plan.useDatePreference ? (plan.slotDate || "not set") : "off"));
            loadLogs();
        }).catch(function (err) {
            $bookResult.style.display = "";
            $bookResult.className = "result-box err";
            $bookResult.textContent = err.message;
        }).finally(function () {
            $addPlanBtn.disabled = false;
            $addPlanBtn.textContent = "Add Current";
        });
    });
}

if ($planLimitCloseBtn) {
    $planLimitCloseBtn.addEventListener("click", function () {
        if (_planLimitNoticeTimer) {
            clearTimeout(_planLimitNoticeTimer);
            _planLimitNoticeTimer = null;
        }
        hidePlanLimitNotice();
    });
}

if ($clearPlansBtn) {
    $clearPlansBtn.addEventListener("click", function () {
        setBookingPlans([]);
        localLog("All booking plans cleared");
        loadLogs();
    });
}

if ($planList) {
    $planList.addEventListener("click", function (e) {
        var target = e.target;
        if (!target || !target.classList || !target.classList.contains("plan-remove")) return;
        var id = String(target.getAttribute("data-id") || "");
        if (!id) return;
        removeBookingPlanById(id);
        localLog("Removed booking plan");
        loadLogs();
    });
}

$courseSelect.addEventListener("change", function () {
    chrome.storage.local.set({ selectedCourseKey: $courseSelect.value });
    updateCourseSearchDisplay();
    var selected = getSelectedCourse();
    if (!selected) {
        syncResolvedIds("", "");
        return;
    }
    resolveCourseSelection(selected, false).catch(function () {
        syncResolvedIds("", "");
        $bookResult.style.display = "";
        $bookResult.className = "result-box err";
        $bookResult.textContent = "Could not resolve IDs for selected course. Open My Courses in PS portal, click that course card once, then try again.";
    });
});

$slotTime.addEventListener("change", function () {
    chrome.storage.local.set({ slotTime: $slotTime.value });
    toggleCustomRangeUI();
});
$customStart.addEventListener("change", function () { chrome.storage.local.set({ slotTimeCustomStart: $customStart.value }); });
$customEnd.addEventListener("change", function () { chrome.storage.local.set({ slotTimeCustomEnd: $customEnd.value }); });
$firStart.addEventListener("change", function () { chrome.storage.local.set({ firStart: $firStart.value }); });
$firEnd.addEventListener("change", function () { chrome.storage.local.set({ firEnd: $firEnd.value }); });
$slotDate.addEventListener("change", function () { chrome.storage.local.set({ slotDate: $slotDate.value }); });
if ($datePreferenceToggle) {
    $datePreferenceToggle.addEventListener("change", function () {
        chrome.storage.local.set({ useDatePreference: $datePreferenceToggle.checked });
        toggleDatePreferenceUI();
    });
}
$pageReloadToggle.addEventListener("change", function () {
    chrome.storage.local.set({ pageReloadEnabled: $pageReloadToggle.checked });
    localLog("Page Reload: " + ($pageReloadToggle.checked ? "ON (will open/reload PS tab)" : "OFF (pure API mode, no page reload)"));
    loadLogs();
});
if ($slotsBox) {
    $slotsBox.addEventListener("click", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var btn = target.closest(".slot-book-btn");
        if (!btn || btn.disabled) return;
        var sid = String(btn.getAttribute("data-slot-id") || "").trim();
        if (!sid) {
            showBookResult("err", "This slot does not have a valid slot ID.");
            return;
        }
        bookSlotById(sid, btn);
    });
}
// ============================================================
// FETCH SLOTS  (GET /available?id=courseId → parse → display)
// ============================================================
$fetchBtn.addEventListener("click", function () {
    var selected = getSelectedCourse();
    if (!selected) {
        $slotsBox.innerHTML = '<div class="msg-row error">Select a registered course first.</div>';
        return;
    }

    var cid = "";
    var rid = "";

    $fetchBtn.disabled = true;
    $fetchBtn.textContent = "Fetching…";
    $slotsBox.innerHTML = '<div class="empty-state"><span class="spinner"></span>Fetching slots…</div>';
    $slotCount.style.display = "none";
    $bookResult.style.display = "none";

    resolveCourseSelection(selected, true).then(function (ids) {
        cid = String(ids.courseId || "").trim();
        rid = String(ids.registerId || "").trim();
        if (!cid) {
            throw new Error("Course ID is missing for selected course");
        }
        return ensureBgReady();
    }).then(function () {
        return bgMsg({ action: "fetchSlots", courseId: cid });
    })
        .then(function (resp) {
            var raw = resp.data;
            var allSlots = parseSlots(raw);
            var useDatePreference = isDatePreferenceEnabled();
            var preferredDate = useDatePreference ? $slotDate.value : "";
            var preferredTime = $slotTime.value;
            var slots = allSlots;

            if (useDatePreference && preferredDate) {
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

            // ── Match hint only. Manual booking is disabled currently. ──
            if (matchedSlot) {
                var matchedSid = extractSlotId(matchedSlot);
                showBookResult("", "Preferred slot matched: Slot #" + matchedSid + ". Use Schedule/Run Now for booking.");
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
// Temporarily disabled by request. Keep this block for future unlock.
// $bookBtn.addEventListener("click", function () {
//     var sid = String($slotId.value || "").trim();
//     if (!isValidId(sid)) {
//         showBookResult("err", "Choose a slot and then click Book.");
//         return;
//     }
//     bookSlotById(sid, null);
// });

function getActivePlansForRun() {
    if (_bookingPlans.length > 0) {
        return Promise.resolve(_bookingPlans.slice());
    }
    return buildCurrentSelectionPlan().then(function (plan) {
        if (!plan) throw new Error("Could not prepare selected course plan");
        return [plan];
    });
}

function persistRunConfig(plans, extra, done) {
    var first = plans[0] || {};
    var payload = Object.assign({
        bookingPlans: plans,
        courseId: String(first.courseId || ""),
        registerId: String(first.registerId || ""),
        slotTime: String(first.slotTime || "any"),
        slotTimeCustomStart: String(first.slotTimeCustomStart || ""),
        slotTimeCustomEnd: String(first.slotTimeCustomEnd || ""),
        firStart: String(first.firStart || ""),
        firEnd: String(first.firEnd || ""),
        useDatePreference: !!first.useDatePreference,
        slotDate: String(first.slotDate || "")
    }, extra || {});
    chrome.storage.local.set(payload, done);
}

function setScheduleActionBusy(isBusy) {
    $scheduleBtn.disabled = !!isBusy;
    $runNowBtn.disabled = !!isBusy;
    $cancelBtn.disabled = !!isBusy;
    if ($bannerStopBtn) $bannerStopBtn.disabled = !!isBusy;
}

function stopAutomation(source) {
    if (_stopInProgress) return;
    _stopInProgress = true;

    stopCD();
    setScheduleActionBusy(true);
    $cancelBtn.textContent = "Stopping...";
    setBanner("running", "Stopping auto-book...");

    ensureBgReady().then(function () {
        return bgMsg({ action: "stopAutoBook" });
    }).then(function () {
        chrome.storage.local.set({
            autoEnabled: false,
            autoStatus: "idle",
            autoDetail: "Stopped by user",
            targetTime: 0,
            bookResult: "",
            lastMatchedSlotId: null
        }, function () {
            setBanner("idle", "Stopped by user");
            localLog("Stopped by user" + (source ? (" (" + source + ")") : "") + ".");
            loadLogs();
            refreshStatus();
        });
    }).catch(function (err) {
        chrome.storage.local.set({ autoEnabled: false, autoStatus: "idle", autoDetail: "Stopped (local fallback)", targetTime: 0 }, function () {
            setBanner("idle", "Stopped");
            localLog("Stop fallback: " + (err && err.message ? err.message : "unknown error"));
            loadLogs();
            refreshStatus();
        });
    }).finally(function () {
        _stopInProgress = false;
        setScheduleActionBusy(false);
        $cancelBtn.textContent = "Cancel";
    });
}

// ============================================================
// SCHEDULE
// ============================================================
$scheduleBtn.addEventListener("click", function () {
    $scheduleBtn.disabled = true;
    $runNowBtn.disabled = true;
    $scheduleBtn.textContent = "Scheduling…";

    getActivePlansForRun().then(function (plans) {
        if (!plans.length) throw new Error("Add at least one valid booking plan");

        var t = get24h();
        var now = new Date();
        var target = new Date();
        target.setHours(t.h, t.m, t.s, 0);
        if (target <= now) target.setDate(target.getDate() + 1);

        var targetMs = target.getTime();
        var delayMin = (target - now) / 60000;
        var disp = fmt12(t.h, t.m, t.s);

        persistRunConfig(plans, {
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
                    setBanner("scheduled", "Triggers at " + disp + "  ·  Plans: " + plans.length);
                    localLog("===== SCHEDULED at " + disp + " =====");
                    localLog("Plans: " + plans.length + " | Delay: " + delayMin.toFixed(1) + " min");
                    plans.forEach(function (p, idx) {
                        var pLabel = slotTimeLabelFromValues(p.slotTime, p.slotTimeCustomStart, p.slotTimeCustomEnd, p.firStart, p.firEnd);
                        localLog("Plan " + (idx + 1) + ": " + p.courseName + " | C:" + p.courseId + " R:" + p.registerId + " | " + pLabel + " | Date: " + (p.useDatePreference ? (p.slotDate || "not set") : "off"));
                    });
                    loadLogs();
                })
                .catch(function (err) {
                    setBanner("error", "Alarm error: " + err.message);
                    localLog("Alarm error: " + err.message);
                    loadLogs();
                })
                .finally(function () {
                    $scheduleBtn.disabled = false;
                    $runNowBtn.disabled = false;
                    $scheduleBtn.textContent = "Schedule";
                });
        });
    }).catch(function (err) {
        setBanner("error", err.message || "Could not resolve selected course");
        $scheduleBtn.disabled = false;
        $runNowBtn.disabled = false;
        $scheduleBtn.textContent = "Schedule";
    });
});

// ============================================================
// RUN NOW
// ============================================================
$runNowBtn.addEventListener("click", function () {
    $runNowBtn.disabled = true;
    $scheduleBtn.disabled = true;
    $runNowBtn.textContent = "Starting…";

    getActivePlansForRun().then(function (plans) {
        if (!plans.length) throw new Error("Add at least one valid booking plan");

        stopCD();
        setBanner("running", "Starting auto-book now for " + plans.length + " plan(s)…");

        persistRunConfig(plans, {
            autoEnabled: true,
            autoStatus: "running",
            autoDetail: "Starting…",
            targetTime: 0
        }, function () {
            localLog("=== RUN NOW ===  Plans: " + plans.length);
            plans.forEach(function (p, idx) {
                var pLabel = slotTimeLabelFromValues(p.slotTime, p.slotTimeCustomStart, p.slotTimeCustomEnd, p.firStart, p.firEnd);
                localLog("Plan " + (idx + 1) + ": " + p.courseName + " | C:" + p.courseId + " R:" + p.registerId + " | " + pLabel + " | Date: " + (p.useDatePreference ? (p.slotDate || "not set") : "off"));
            });
            ensureBgReady().then(function () {
                return bgMsg({ action: "runNow" });
            })
                .then(function () {
                    $runNowBtn.disabled = false;
                    $scheduleBtn.disabled = false;
                    $runNowBtn.textContent = "Run Now";
                })
                .catch(function (err) {
                    setBanner("error", "Run error: " + err.message);
                    localLog("Run error: " + err.message);
                    chrome.storage.local.set({ autoEnabled: false, autoStatus: "error", autoDetail: err.message, targetTime: 0 }, refreshStatus);
                    $runNowBtn.disabled = false;
                    $scheduleBtn.disabled = false;
                    $runNowBtn.textContent = "Run Now";
                });
        });
    }).catch(function (err) {
        setBanner("error", err.message || "Could not resolve selected course");
        $runNowBtn.disabled = false;
        $scheduleBtn.disabled = false;
        $runNowBtn.textContent = "Run Now";
    });
});

// ============================================================
// CANCEL / STOP
// ============================================================
$cancelBtn.addEventListener("click", function () {
    stopAutomation("cancel button");
});

$bannerStopBtn.addEventListener("click", function () {
    stopAutomation("banner stop");
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


