// background.js
var API_BASE = "https://ps.bitsathy.ac.in/api/ps_v2";
var BASE = API_BASE + "/slots";

// keep service worker alive during booking
var keepAliveTimer = null;

function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(function () {
        chrome.runtime.getPlatformInfo(function () { });
    }, 20000);
}

function stopKeepAlive() {
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

// helpers
function normalizeTime(str) {
    return str.replace(/\s+/g, "").replace(/am|pm/gi, "").replace(/^0/, "").toLowerCase().trim();
}

function parseTimeToMinutes(str) {
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

function extractFirstTimeMinutes(text) {
    if (!text) return null;
    // Try AM/PM format first (e.g. "8:45 AM", "3:25 pm")
    var m = String(text).match(/\d{1,2}(?::\d{2})?\s*[ap]m/i);
    if (m) return parseTimeToMinutes(m[0]);
    // Fallback: 24h format (e.g. "08:45", "15:25")
    var m2 = String(text).match(/(\d{1,2}):(\d{2})/);
    if (m2) return parseTimeToMinutes(m2[0]);
    return null;
}

function extractSlotStartMinutes(slot) {
    var labelRange = parseLabelTimeRange(slot.label || slot.name || "");
    var timeFields = [slot.time, slot.start_time, slot.timing, slot.slot_time, slot.from_time, slot.timeRange, labelRange, slot.label, slot.name];
    for (var i = 0; i < timeFields.length; i++) {
        var minutes = extractFirstTimeMinutes(timeFields[i]);
        if (minutes !== null) return minutes;
    }
    return null;
}

function slotMatchesCustomRange(slot, startStr, endStr) {
    var startMin = parseTimeToMinutes(startStr);
    var endMin = parseTimeToMinutes(endStr);
    if (startMin === null || endMin === null || endMin < startMin) return false;
    var slotStart = extractSlotStartMinutes(slot);
    if (slotStart === null) return false;
    return slotStart >= startMin && slotStart <= endMin;
}

function parseLabelDateToIso(label) {
    if (!label) return "";
    var m = String(label).match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (!m) return "";
    var day = String(parseInt(m[1], 10)).padStart(2, "0");
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
    return slot.date || slot.slot_date || slot.booking_date || parseLabelDateToIso(slot.label || slot.name || "");
}

function slotMatchesTime(slot, preferredTime) {
    // Primary: minute-based range comparison (handles 12h/24h mismatch)
    var parts = preferredTime.split(/\s*to\s*/i);
    if (parts.length === 2) {
        var rangeStart = parseTimeToMinutes(parts[0].trim());
        var rangeEnd = parseTimeToMinutes(parts[1].trim());
        if (rangeStart !== null && rangeEnd !== null && rangeEnd >= rangeStart) {
            var slotStart = extractSlotStartMinutes(slot);
            if (slotStart !== null) {
                return slotStart >= rangeStart && slotStart <= rangeEnd;
            }
        }
    }
    // Fallback: substring search in JSON (for non-range preferences)
    var norm = normalizeTime(preferredTime);
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
        if (timeFields[tf] && normalizeTime(String(timeFields[tf])).indexOf(norm) !== -1) return true;
    }
    return false;
}

function addLog(msg) {
    return chrome.storage.local.get("autoLog").then(function (r) {
        var logs = r.autoLog || [];
        logs.push("[" + new Date().toLocaleTimeString() + "] " + msg);
        if (logs.length > 200) logs.splice(0, logs.length - 200);
        return chrome.storage.local.set({ autoLog: logs });
    });
}

function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function runWithTimeout(promise, ms, fallbackValue) {
    return Promise.race([
        promise,
        new Promise(function (resolve) {
            setTimeout(function () {
                resolve(fallbackValue);
            }, ms);
        })
    ]);
}

function toNumString(v) {
    if (v === null || v === undefined) return "";
    var s = String(v).trim();
    return /^\d+$/.test(s) ? s : "";
}

function toPositiveInt(v) {
    var s = toNumString(v);
    if (!s) return 0;
    var n = parseInt(s, 10);
    return isNaN(n) || n <= 0 ? 0 : n;
}

function toPositiveNumStrings(arr) {
    var out = [];
    (arr || []).forEach(function (v) {
        var n = toPositiveInt(v);
        if (n > 0) out.push(String(n));
    });
    return uniq(out);
}

function sortNumStringsAsc(arr) {
    return (arr || []).slice().sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
}

function sortNumStringsDesc(arr) {
    return (arr || []).slice().sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
}

function pickRegisterId(regCandidates, idCandidates) {
    var regs = sortNumStringsDesc(toPositiveNumStrings((regCandidates || []).concat(idCandidates || [])));
    if (!regs.length) return "";
    for (var i = 0; i < regs.length; i++) {
        if (parseInt(regs[i], 10) >= 100000) return regs[i];
    }
    return regs[0];
}

function pickCourseId(courseCandidates, idCandidates, registerId) {
    var regNum = toPositiveInt(registerId);
    var courses = toPositiveNumStrings(courseCandidates || []).filter(function (v) {
        return parseInt(v, 10) !== regNum;
    });
    if (courses.length) return sortNumStringsAsc(courses)[0];

    var fromIds = toPositiveNumStrings(idCandidates || []).filter(function (v) {
        var n = parseInt(v, 10);
        return n !== regNum && n < 100000;
    });
    if (fromIds.length) return sortNumStringsAsc(fromIds)[0];
    return "";
}

function collectKeyValues(node, out) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) collectKeyValues(node[i], out);
        return;
    }
    if (typeof node !== "object") return;
    Object.keys(node).forEach(function (k) {
        var lk = String(k).toLowerCase();
        var v = node[k];
        if (typeof v === "number" || typeof v === "string") {
            if (!out[lk]) out[lk] = [];
            out[lk].push(v);
        }
        collectKeyValues(v, out);
    });
}

function uniq(arr) {
    var seen = {};
    var out = [];
    (arr || []).forEach(function (v) {
        var key = String(v);
        if (!seen[key]) {
            seen[key] = true;
            out.push(v);
        }
    });
    return out;
}

function getCandidatesByKeyMap(keyMap, includes) {
    var vals = [];
    Object.keys(keyMap || {}).forEach(function (k) {
        for (var i = 0; i < includes.length; i++) {
            if (k.indexOf(includes[i]) !== -1) {
                vals = vals.concat(keyMap[k]);
                break;
            }
        }
    });
    return uniq(vals.map(toNumString).filter(Boolean));
}

function pickCourseName(raw) {
    var nameKeys = ["course_name", "coursename", "course", "title", "name", "skill", "skill_name", "subject_name"];
    for (var i = 0; i < nameKeys.length; i++) {
        var key = nameKeys[i];
        if (raw && raw[key] && String(raw[key]).trim()) return String(raw[key]).trim();
    }
    var queue = [raw];
    while (queue.length) {
        var node = queue.shift();
        if (!node || typeof node !== "object") continue;
        Object.keys(node).forEach(function (k) {
            var v = node[k];
            var lk = String(k).toLowerCase();
            if (typeof v === "string" && v.trim()) {
                if (nameKeys.some(function (nk) { return lk.indexOf(nk) !== -1; })) {
                    queue.length = 0;
                    raw.__pickedName = v.trim();
                    return;
                }
            }
            if (v && typeof v === "object") queue.push(v);
        });
    }
    return raw && raw.__pickedName ? raw.__pickedName : "";
}

function parseAnyArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
        var keys = ["data", "list", "items", "result", "courses", "my_courses", "registered_courses"];
        for (var i = 0; i < keys.length; i++) {
            if (Array.isArray(data[keys[i]])) return data[keys[i]];
        }
    }
    return [];
}

function normalizeCourseRecord(raw, index) {
    var keyMap = {};
    collectKeyValues(raw, keyMap);
    var idCandidates = toPositiveNumStrings((keyMap.id || []));
    var regCandidates = getCandidatesByKeyMap(keyMap, ["register", "registration", "reg_id", "regid", "student_course", "studentcourse", "r"]);
    var courseCandidates = getCandidatesByKeyMap(keyMap, ["course_id", "courseid", "cid", "subject_id", "skill_id"]);

    var registerId = pickRegisterId(regCandidates, idCandidates);
    var courseId = pickCourseId(courseCandidates, idCandidates, registerId);
    var courseName = pickCourseName(raw) || ("Course " + (index + 1));
    var safeName = courseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "course";
    var key = "course_" + index + "_" + (registerId || "na") + "_" + (courseId || "na") + "_" + safeName;

    return {
        key: key,
        name: courseName,
        courseId: courseId,
        registerId: registerId,
        courseCandidates: uniq(toPositiveNumStrings(courseCandidates).concat(courseId ? [courseId] : [])),
        registerCandidates: uniq(toPositiveNumStrings(regCandidates).concat(registerId ? [registerId] : []))
    };
}

async function apiGet(path) {
    var cookieStr = await getCookieHeader();
    var headers = { "Accept": "application/json" };
    if (cookieStr) headers["Cookie"] = cookieStr;

    var response = await fetch(API_BASE + path, {
        method: "GET",
        credentials: "include",
        headers: headers
    });

    var txt = await response.text();
    if (!response.ok) {
        throw new Error("HTTP " + response.status + ": " + txt.substring(0, 200));
    }

    try {
        return JSON.parse(txt);
    } catch (e) {
        return { raw: txt };
    }
}

async function fetchRegisteredCourses() {
    var data = null;

    // Primary: proxy through PS page content script (runs on ps.bitsathy.ac.in origin)
    var tabId = await getPsTabId();
    if (tabId) {
        await ensureContentScriptInTab(tabId);
        var pageResp = await runWithTimeout(
            sendMessageToTab(tabId, { action: "fetchRegisteredCourses" }),
            10000,
            null
        );
        if (pageResp && pageResp.ok && pageResp.data) {
            data = pageResp.data;
        } else {
            addLog("[COURSES] Page proxy failed — falling back to direct API");
        }
    }

    // Fallback: direct fetch with explicit cookies from background
    if (!data) {
        data = await apiGet("/my-course?tab=personalizedSkills");
    }

    var list = parseAnyArray(data);
    var normalized = list.map(function (item, i) {
        return normalizeCourseRecord(item, i);
    }).filter(function (c) {
        return c && c.name;
    });

    var st = await chrome.storage.local.get("courseMapByRegister");
    var map = (st && st.courseMapByRegister) || {};
    normalized.forEach(function (c) {
        if (!c.registerId) return;
        var mappedCourse = toNumString(map[c.registerId]);
        if (mappedCourse && !c.courseId) {
            c.courseId = mappedCourse;
        }
        if (mappedCourse && c.courseCandidates.indexOf(mappedCourse) === -1) {
            c.courseCandidates.push(mappedCourse);
        }
    });

    return uniq(normalized.map(function (c) { return JSON.stringify(c); })).map(function (s) { return JSON.parse(s); });
}

function parseCourseAndRegisterFromAny(data) {
    var keyMap = {};
    collectKeyValues(data, keyMap);
    var courseCandidates = getCandidatesByKeyMap(keyMap, ["course_id", "courseid", "cid", "subject_id", "skill_id"]);
    var regCandidates = getCandidatesByKeyMap(keyMap, ["register", "registration", "reg_id", "regid", "student_course", "studentcourse", "r"]);
    var idCandidates = toPositiveNumStrings((keyMap.id || []));
    var registerId = pickRegisterId(regCandidates, idCandidates);
    var courseId = pickCourseId(courseCandidates, idCandidates, registerId);
    return {
        courseId: courseId,
        registerId: registerId,
        courseCandidates: uniq(toPositiveNumStrings(courseCandidates).concat(courseId ? [courseId] : [])),
        registerCandidates: uniq(toPositiveNumStrings(regCandidates).concat(registerId ? [registerId] : []))
    };
}

async function fetchCourseDetailsViaPage(registerId) {
    var tabId = await getPsTabId();
    if (!tabId) return null;
    await ensureContentScriptInTab(tabId);
    var resp = await sendMessageToTab(tabId, { action: "getCourseDetails", registerId: String(registerId) });
    if (!resp || !resp.ok || !resp.data) return null;
    return resp.data;
}

function extractCourseIdFromDetails(data, knownRegisterId) {
    if (!data) return { courseId: "", registerId: knownRegisterId || "" };
    var keyMap = {};
    collectKeyValues(data, keyMap);

    var idCandidates = toPositiveNumStrings(keyMap.id || []);
    var regCandidates = getCandidatesByKeyMap(keyMap, ["register", "registration", "reg_id", "regid", "student_course", "studentcourse"]);
    var courseCandidates = getCandidatesByKeyMap(keyMap, ["course_id", "courseid", "cid", "subject_id", "skill_id"]);

    var rid = pickRegisterId(regCandidates, idCandidates.concat(knownRegisterId ? [knownRegisterId] : []));
    if (!rid && knownRegisterId) rid = String(knownRegisterId);

    var cid = pickCourseId(courseCandidates, idCandidates, rid);

    // fallback: pick smallest id that isn't the register id
    if (!cid && idCandidates.length) {
        var ridNum = parseInt(rid || "0", 10);
        var smalls = idCandidates
            .filter(function (v) { return parseInt(v, 10) !== ridNum && parseInt(v, 10) < 100000; })
            .sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
        if (smalls.length) cid = smalls[0];
    }

    return { courseId: cid || "", registerId: rid || knownRegisterId || "" };
}

async function resolveCourseSelection(selection) {
    var courseId = toNumString(selection && selection.courseId);
    var registerId = toNumString(selection && selection.registerId);
    var registerCandidates = uniq(toPositiveNumStrings((selection && selection.registerCandidates) || []));

    // pick register id
    var allRegIds = uniq([registerId].concat(registerCandidates).filter(Boolean));
    registerId = pickRegisterId(allRegIds, allRegIds) || registerId;

    // check cache
    if (registerId && (!courseId || !isValidCourseId(courseId))) {
        var st = await chrome.storage.local.get("courseMapByRegister");
        var map = (st && st.courseMapByRegister) || {};
        var cached = toNumString(map[registerId]);
        if (cached && isValidCourseId(cached)) courseId = cached;
    }

    // fetch course details to resolve ids
    if (!courseId || !isValidCourseId(courseId)) {
        var toTry = uniq([registerId].concat(registerCandidates).filter(Boolean));
        for (var i = 0; i < toTry.length; i++) {
            var rc = toTry[i];
            if (!rc) continue;
            try {
                var data = await fetchCourseDetailsViaPage(rc);
                if (!data) data = await apiGet("/my-course/details?id=" + rc + "&courseMaterial=1");
                var extracted = extractCourseIdFromDetails(data, rc);

                if (!registerId && extracted.registerId) registerId = extracted.registerId;
                if (extracted.courseId && isValidCourseId(extracted.courseId)) {
                    courseId = extracted.courseId;
                    var stMap = await chrome.storage.local.get("courseMapByRegister");
                    var mapByReg = (stMap && stMap.courseMapByRegister) || {};
                    mapByReg[rc] = courseId;
                    chrome.storage.local.set({ courseMapByRegister: mapByReg });
                }

                if (courseId && isValidCourseId(courseId) && registerId) break;
            } catch (e) {
                addLog("course details fetch failed for " + rc + ": " + e.message);
            }
        }
    }

    if (!registerId || !courseId || !isValidCourseId(courseId)) {
        throw new Error("Could not resolve course IDs");
    }

    return { courseId: courseId, registerId: registerId };
}

function isValidCourseId(v) {
    var n = parseInt(String(v || ""), 10);
    return !isNaN(n) && n > 0 && n < 100000;
}

function parseSlotsFromData(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
        var keys = ["data", "slots", "available_slots", "result", "items", "list"];
        for (var ki = 0; ki < keys.length; ki++) {
            if (Array.isArray(data[keys[ki]])) return data[keys[ki]];
        }
    }
    return [];
}

// If the first response is empty, refetch up to maxTries before normal retry loop
async function fetchSlotsWithEmptyRetry(courseId, maxTries, waitMs) {
    var data = null;
    var slots = [];
    var tries = 0;
    for (var i = 0; i < maxTries; i++) {
        tries = i + 1;
        data = await fetchSlots(courseId);
        slots = parseSlotsFromData(data);
        if (Array.isArray(slots) && slots.length > 0) {
            return { data: data, slots: slots, tries: tries };
        }
        if (i < maxTries - 1) {
            addLog("[EMPTY] No slots returned — retry " + tries + "/" + maxTries);
            await delay(waitMs);
        }
    }
    return { data: data, slots: slots, tries: tries };
}

// ===== Cookie Management =====
// MV3 service workers need explicit cookie headers — credentials:"include" alone is unreliable
function getCookieHeader() {
    return new Promise(function (resolve) {
        chrome.cookies.getAll({ url: "https://ps.bitsathy.ac.in" }, function (cookies) {
            if (chrome.runtime.lastError) {
                resolve("");
                return;
            }
            if (!cookies || cookies.length === 0) {
                // Fallback: try broader domain match
                chrome.cookies.getAll({ domain: ".bitsathy.ac.in" }, function (cookies2) {
                    var str = (cookies2 || []).map(function (c) { return c.name + "=" + c.value; }).join("; ");
                    resolve(str);
                });
            } else {
                var str = cookies.map(function (c) { return c.name + "=" + c.value; }).join("; ");
                resolve(str);
            }
        });
    });
}

// ===== Tab Management =====
// Opens the PS website if no tab exists, or reloads the existing one.
// This ensures a live session with fresh cookies.
function ensurePsTabOpen() {
    return new Promise(function (resolve) {
        chrome.tabs.query({ url: "https://ps.bitsathy.ac.in/*" }, function (tabs) {
            if (chrome.runtime.lastError) {
                addLog("[TAB] Error querying tabs: " + chrome.runtime.lastError.message);
                resolve(null);
                return;
            }
            if (tabs && tabs.length > 0) {
                addLog("[TAB] PS tab found (id:" + tabs[0].id + "), reloading...");
                chrome.tabs.reload(tabs[0].id, { bypassCache: true }, function () {
                    setTimeout(function () { resolve(tabs[0]); }, 3000);
                });
            } else {
                addLog("[TAB] No PS tab open — creating one...");
                chrome.tabs.create({ url: "https://ps.bitsathy.ac.in", active: true }, function (tab) {
                    if (chrome.runtime.lastError) {
                        addLog("[TAB] Error creating tab: " + chrome.runtime.lastError.message);
                        resolve(null);
                        return;
                    }
                    var checks = 0;
                    function waitLoad() {
                        checks++;
                        if (checks > 20) { addLog("[TAB] Load timeout — proceeding anyway"); resolve(tab); return; }
                        chrome.tabs.get(tab.id, function (t) {
                            if (chrome.runtime.lastError || !t) { resolve(tab); return; }
                            if (t.status === "complete") {
                                addLog("[TAB] PS tab loaded successfully");
                                chrome.tabs.reload(tab.id, { bypassCache: true }, function () {
                                    setTimeout(function () { resolve(t); }, 1500);
                                });
                            } else {
                                setTimeout(waitLoad, 1000);
                            }
                        });
                    }
                    setTimeout(waitLoad, 2000);
                });
            }
        });
    });
}

// Force reload a specific PS tab and wait until it is fully loaded
function forceReloadTab(tabId) {
    return new Promise(function (resolve) {
        if (!tabId) { resolve(false); return; }
        chrome.tabs.reload(tabId, { bypassCache: true }, function () {
            if (chrome.runtime.lastError) { resolve(false); return; }
            var tries = 0;
            (function waitComplete() {
                tries++;
                chrome.tabs.get(tabId, function (t) {
                    if (chrome.runtime.lastError || !t) { resolve(false); return; }
                    if (t.status === "complete") { resolve(true); return; }
                    if (tries > 30) { resolve(false); return; }
                    setTimeout(waitComplete, 500);
                });
            })();
        });
    });
}

function getPsTabId() {
    return new Promise(function (resolve) {
        chrome.tabs.query({ url: "https://ps.bitsathy.ac.in/*" }, function (tabs) {
            if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
                resolve(null);
                return;
            }
            resolve(tabs[0].id);
        });
    });
}

function ensureContentScriptInTab(tabId) {
    return new Promise(function (resolve) {
        if (!tabId || !chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
            resolve(false);
            return;
        }
        chrome.scripting.executeScript(
            { target: { tabId: tabId }, files: ["content/contentScript.js"] },
            function () {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                resolve(true);
            }
        );
    });
}

function sendMessageToTab(tabId, message, tries) {
    var attempt = tries || 0;
    return new Promise(function (resolve) {
        if (!tabId) { resolve(null); return; }
        chrome.tabs.sendMessage(tabId, message, function (resp) {
            if (chrome.runtime.lastError) {
                var msg = (chrome.runtime.lastError.message || "").toLowerCase();
                // If content script isn't injected yet, try injecting once and retry.
                if (attempt === 0 && (msg.indexOf("receiving end does not exist") !== -1 || msg.indexOf("could not establish connection") !== -1)) {
                    ensureContentScriptInTab(tabId).then(function () {
                        setTimeout(function () {
                            sendMessageToTab(tabId, message, attempt + 1).then(resolve);
                        }, 250);
                    });
                    return;
                }
                // Small retry window for race conditions during navigation.
                if (attempt < 2) {
                    setTimeout(function () {
                        sendMessageToTab(tabId, message, attempt + 1).then(resolve);
                    }, 250);
                    return;
                }
                resolve(null);
                return;
            }
            resolve(resp || null);
        });
    });
}

async function bookSlotViaPage(slotId, registerId) {
    var tabId = await getPsTabId();

    // No PS tab open — create one silently (active:false) and wait for it to load
    if (!tabId) {
        addLog("[TAB] No PS tab found — opening one silently for booking...");
        tabId = await new Promise(function (resolve) {
            chrome.tabs.create({ url: "https://ps.bitsathy.ac.in", active: false }, function (tab) {
                if (chrome.runtime.lastError || !tab) { resolve(null); return; }
                var tries = 0;
                (function waitLoad() {
                    tries++;
                    chrome.tabs.get(tab.id, function (t) {
                        if (chrome.runtime.lastError || !t) { resolve(tab.id); return; }
                        if (t.status === "complete") {
                            addLog("[TAB] PS tab loaded (id:" + tab.id + ")");
                            resolve(tab.id);
                        } else if (tries > 30) {
                            addLog("[TAB] Load timeout — proceeding anyway");
                            resolve(tab.id);
                        } else {
                            setTimeout(waitLoad, 500);
                        }
                    });
                })();
            });
        });
        if (!tabId) throw new Error("Could not open a PS tab for booking");
        // Give the page JS and content script time to initialize
        await delay(800);
    }

    // Guarantee content script is injected before messaging
    await ensureContentScriptInTab(tabId);
    await delay(150);

    var resp = await sendMessageToTab(tabId, {
        action: "pageBookSlot",
        payload: { slot_id: Number(slotId), register_id: Number(registerId) }
    });

    if (!resp) throw new Error("No response from content script — tab may have navigated away");
    if (!resp.ok) throw new Error(resp.error || "Page booking failed");
    return resp.data;
}

// ===== API Calls (with explicit cookies) =====
async function fetchSlots(courseId) {
    // Primary: proxy through PS page content script (runs on ps.bitsathy.ac.in origin)
    var tabId = await getPsTabId();
    if (tabId) {
        await ensureContentScriptInTab(tabId);
        var pageResp = await runWithTimeout(
            sendMessageToTab(tabId, { action: "fetchSlots", courseId: String(courseId) }),
            10000,
            null
        );
        if (pageResp && pageResp.ok) return pageResp.data;
        addLog("[SLOTS] Page proxy failed — falling back to direct API");
    }

    // Fallback: direct fetch with explicit cookies from background
    var cookieStr = await getCookieHeader();
    var headers = { "Accept": "application/json" };
    if (cookieStr) headers["Cookie"] = cookieStr;

    var response = await fetch(BASE + "/available?id=" + courseId, {
        method: "GET",
        credentials: "include",
        headers: headers
    });

    if (!response.ok) {
        var txt = await response.text();
        throw new Error("HTTP " + response.status + ": " + txt.substring(0, 200));
    }

    return response.json();
}

async function doBookSlot(slotId, registerId) {
    var sid = String(slotId || "").trim();
    var rid = String(registerId || "").trim();
    if (!/^\d+$/.test(sid) || !/^\d+$/.test(rid)) {
        throw new Error("Invalid slot/register ID");
    }

    var maxAttempts = 2;
    var lastErr = null;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await bookSlotViaPage(sid, rid);
        } catch (err) {
            lastErr = err;
            var msg = String(err && err.message || "");
            var retryable = /HTTP\s+5\d\d/i.test(msg) || /something went wrong/i.test(msg);
            if (!retryable || attempt >= maxAttempts) break;
            addLog("[BOOK] Server error on attempt " + attempt + "/" + maxAttempts + " - retrying");
            await delay(350);
        }
    }
    throw lastErr || new Error("Booking failed");
}

// ===== Auto-Book Engine =====
var retryCount = 0;
var MAX_RETRIES = 5;
var RETRY_INTERVAL = 1000;
var EMPTY_SLOT_REFETCH_TRIES = 5;
var EMPTY_SLOT_REFETCH_WAIT_MS = 900;
var isRunning = false;

function clearAutoBookAlarm() {
    return new Promise(function (resolve) {
        if (!chrome.alarms || typeof chrome.alarms.clear !== "function") {
            resolve(false);
            return;
        }
        chrome.alarms.clear("autoBookTrigger", function (ok) {
            resolve(!!ok);
        });
    });
}

function abortAutoBook(detailText, logText) {
    isRunning = false;
    stopKeepAlive();
    return clearAutoBookAlarm().then(function () {
        return chrome.storage.local.set({
            autoEnabled: false,
            autoStatus: "idle",
            autoDetail: detailText || "Stopped by user",
            targetTime: 0,
            bookResult: "",
            lastMatchedSlotId: null
        });
    }).then(function () {
        if (logText) addLog(logText);
    });
}

function setFinalStatus(status, detail, extra) {
    isRunning = false;
    stopKeepAlive();
    var data = { autoEnabled: false, autoStatus: status, autoDetail: detail };
    if (extra) { for (var k in extra) data[k] = extra[k]; }
    return chrome.storage.local.set(data);
}

function normalizePlanFromConfig(raw) {
    if (!raw) return null;
    var cid = toNumString(raw.courseId);
    var rid = toNumString(raw.registerId);
    if (!cid || !rid) return null;
    return {
        id: String(raw.id || ""),
        courseName: String(raw.courseName || ("Course " + cid)),
        courseId: cid,
        registerId: rid,
        slotTime: String(raw.slotTime || "any"),
        slotDate: String(raw.slotDate || ""),
        slotTimeCustomStart: String(raw.slotTimeCustomStart || ""),
        slotTimeCustomEnd: String(raw.slotTimeCustomEnd || ""),
        firStart: String(raw.firStart || ""),
        firEnd: String(raw.firEnd || "")
    };
}

function getEffectivePlans(cfg) {
    var plans = [];
    if (Array.isArray(cfg.bookingPlans)) {
        plans = cfg.bookingPlans.map(normalizePlanFromConfig).filter(Boolean);
    }
    if (!plans.length) {
        var single = normalizePlanFromConfig({
            courseName: "Selected Course",
            courseId: cfg.courseId,
            registerId: cfg.registerId,
            slotTime: cfg.slotTime,
            slotDate: cfg.slotDate,
            slotTimeCustomStart: cfg.slotTimeCustomStart,
            slotTimeCustomEnd: cfg.slotTimeCustomEnd,
            firStart: cfg.firStart,
            firEnd: cfg.firEnd
        });
        if (single) plans = [single];
    }
    return plans;
}

function extractSlotIdAny(slot) {
    return slot.id || slot.slot_id || slot.slotId || slot.slot_Id || slot["_id"] || slot.slotID || null;
}

function findMatchedSlotForPlan(plan, slots, attempt) {
    var matched = null;
    var hasPreference = plan.slotTime && plan.slotTime !== "any";

    if (!hasPreference) {
        matched = slots[0] || null;
        if (matched) addLog(attempt + " [" + plan.courseId + "] [FALLBACK] Using first available slot");
        return { matched: matched, error: "" };
    }

    if (plan.slotTime === "custom") {
        var startStr = (plan.slotTimeCustomStart || "").trim();
        var endStr = (plan.slotTimeCustomEnd || "").trim();
        var startMin = parseTimeToMinutes(startStr);
        var endMin = parseTimeToMinutes(endStr);
        if (!startStr || !endStr || startMin === null || endMin === null || endMin < startMin) {
            return { matched: null, error: "Invalid custom time range for course " + plan.courseId };
        }
        for (var i = 0; i < slots.length; i++) {
            if (slotMatchesCustomRange(slots[i], startStr, endStr)) {
                matched = slots[i];
                break;
            }
        }
    } else if (plan.slotTime === "first-in-range") {
        var firStartStr = (plan.firStart || "").trim();
        var firEndStr = (plan.firEnd || "").trim();
        var firStartMin = parseTimeToMinutes(firStartStr);
        var firEndMin = parseTimeToMinutes(firEndStr);
        if (!firStartStr || !firEndStr || firStartMin === null || firEndMin === null || firEndMin < firStartMin) {
            return { matched: null, error: "Invalid first-in-range window for course " + plan.courseId };
        }
        slots.sort(function (a, b) {
            var aMin = extractSlotStartMinutes(a);
            var bMin = extractSlotStartMinutes(b);
            if (aMin === null && bMin === null) return 0;
            if (aMin === null) return 1;
            if (bMin === null) return -1;
            return aMin - bMin;
        });
        for (var fi = 0; fi < slots.length; fi++) {
            if (slotMatchesCustomRange(slots[fi], firStartStr, firEndStr)) {
                matched = slots[fi];
                break;
            }
        }
    } else {
        for (var j = 0; j < slots.length; j++) {
            if (slotMatchesTime(slots[j], plan.slotTime)) {
                matched = slots[j];
                break;
            }
        }
    }

    return { matched: matched, error: "" };
}

// Single attempt — returns promise resolving to "retry", "done", or "error"
function runAutoBookOnce() {
    return chrome.storage.local.get(["courseId", "registerId", "slotTime", "slotDate", "slotTimeCustomStart", "slotTimeCustomEnd", "firStart", "firEnd", "bookingPlans", "autoEnabled"]).then(function (cfg) {
        if (!isRunning) {
            return "done";
        }
        if (!cfg.autoEnabled) {
            addLog("[STOPPED] Auto-book disabled.");
            isRunning = false;
            stopKeepAlive();
            return "done";
        }

        var plans = getEffectivePlans(cfg);
        if (!plans.length) {
            addLog("[ERROR] Missing config — no valid course/register plans");
            setFinalStatus("error", "Missing Course ID or Register ID");
            return "error";
        }

        retryCount++;
        var attempt = "[Attempt " + retryCount + "/" + MAX_RETRIES + "]";
        addLog(attempt + " Checking " + plans.length + " plan(s)");

        return chrome.storage.local.set({
            autoStatus: "running",
            autoDetail: "Checking plans... (" + retryCount + "/" + MAX_RETRIES + ")"
        }).then(function () {
            var planIndex = 0;
            var hasAnySlot = false;
            var hasAnyMatch = false;

            function nextPlan() {
                if (!isRunning) return "done";

                if (planIndex >= plans.length) {
                    if (retryCount < MAX_RETRIES) {
                        var noMatchDetail = hasAnySlot
                            ? "No preferred match yet — retry " + retryCount + "/" + MAX_RETRIES
                            : "No slots yet — retry " + retryCount + "/" + MAX_RETRIES;
                        chrome.storage.local.set({ autoStatus: "running", autoDetail: noMatchDetail });
                        return "retry";
                    }
                    if (hasAnySlot) {
                        addLog("======== FINAL: PREFERRED SLOT NOT AVAILABLE ========");
                        setFinalStatus("no_match", "Preferred slot not available after " + MAX_RETRIES + " attempts");
                    } else {
                        addLog("======== FINAL: NO SLOTS AVAILABLE ========");
                        setFinalStatus("no_slots", "No slots available after " + MAX_RETRIES + " attempts");
                    }
                    return "done";
                }

                var plan = plans[planIndex++];
                addLog(attempt + " [PLAN " + planIndex + "/" + plans.length + "] " + plan.courseName + " | C:" + plan.courseId + " R:" + plan.registerId);

                return fetchSlotsWithEmptyRetry(plan.courseId, EMPTY_SLOT_REFETCH_TRIES, EMPTY_SLOT_REFETCH_WAIT_MS).then(function (res) {
                    if (!isRunning) return "done";

                    var data = res.data;
                    var slots = Array.isArray(res.slots) ? res.slots : [];
                    addLog(attempt + " [" + plan.courseId + "] Found " + slots.length + " slot(s)");
                    if (res.tries && res.tries > 1) {
                        addLog(attempt + " [" + plan.courseId + "] Empty response retries: " + res.tries);
                    }

                    if (plan.slotDate) {
                        slots = slots.filter(function (s) { return slotDateFromSlot(s) === plan.slotDate; });
                        addLog(attempt + " [" + plan.courseId + "] Date filter: " + plan.slotDate + " | matched " + slots.length + " slot(s)");
                    }

                    chrome.storage.local.set({ lastFetchedSlots: slots.slice(0, 50), lastFetchedAt: Date.now(), lastMatchedSlotId: null });

                    if (!slots.length) {
                        addLog(attempt + " [" + plan.courseId + "] [NO SLOTS] raw: " + JSON.stringify(data).substring(0, 220));
                        return nextPlan();
                    }

                    hasAnySlot = true;
                    var matchResult = findMatchedSlotForPlan(plan, slots, attempt);
                    if (matchResult.error) {
                        addLog(attempt + " [ERROR] " + matchResult.error);
                        setFinalStatus("error", matchResult.error);
                        return "error";
                    }

                    var matched = matchResult.matched;
                    if (!matched) {
                        addLog(attempt + " [" + plan.courseId + "] [NO MATCH] Preferred slot not found");
                        return nextPlan();
                    }

                    hasAnyMatch = true;
                    var sid = extractSlotIdAny(matched);
                    chrome.storage.local.set({ lastMatchedSlotId: sid || null });
                    if (!sid) {
                        addLog(attempt + " [ERROR] No slot ID found in: " + JSON.stringify(matched));
                        setFinalStatus("error", "Slot found but no ID field in response");
                        return "error";
                    }

                    addLog(attempt + " [BOOKING] Slot #" + sid + " | register_id: " + plan.registerId + " | course_id: " + plan.courseId);
                    chrome.storage.local.set({ autoStatus: "running", autoDetail: "Booking slot #" + sid + "..." });

                    return doBookSlot(sid, plan.registerId).then(function (result) {
                        if (!isRunning) return "done";

                        var resStr = JSON.stringify(result);
                        addLog(attempt + " [BOOK RESULT] " + resStr.substring(0, 500));

                        var isError = false, errMsg = "";
                        if (result && result.error) { isError = true; errMsg = result.error; }
                        if (result && result.success === false) { isError = true; errMsg = result.message || result.error || resStr; }
                        if (result && result.status === "error") { isError = true; errMsg = result.message || resStr; }
                        if (result && result.raw && typeof result.raw === "string" && result.raw.indexOf("<!DOCTYPE") !== -1) {
                            isError = true; errMsg = "Server returned HTML page (session expired?)";
                        }

                        if (isError) {
                            addLog("[BOOK FAILED] " + errMsg);
                            // Continue to remaining plans in same attempt before retrying.
                            return nextPlan();
                        }

                        addLog("======================================");
                        addLog("========== SLOT BOOKED! ==========");
                        addLog("======================================");
                        addLog("[BOOKED] Slot #" + sid + " | Time: " + new Date().toLocaleString());
                        addLog("[BOOKED] Response: " + resStr.substring(0, 300));
                        setFinalStatus("booked", "Slot #" + sid + " booked successfully!", { bookResult: resStr });
                        return "done";
                    }).catch(function (e) {
                        addLog(attempt + " [BOOK ERROR] " + e.message);
                        return nextPlan();
                    });
                }).catch(function (e) {
                    addLog(attempt + " [" + plan.courseId + "] [FETCH ERROR] " + e.message);
                    return nextPlan();
                });
            }

            return nextPlan().then(function (result) {
                if (result === "done" || result === "error" || result === "retry") return result;
                if (hasAnyMatch && retryCount >= MAX_RETRIES) {
                    setFinalStatus("error", "Booking failed after " + MAX_RETRIES + " attempts");
                    return "done";
                }
                return "retry";
            });
        }).catch(function (e) {
            addLog(attempt + " [ERROR] " + e.message);
            if (retryCount < MAX_RETRIES) {
                chrome.storage.local.set({ autoStatus: "running", autoDetail: "Error: " + e.message + " — retrying..." });
                return "retry";
            }
            setFinalStatus("error", "Failed after " + MAX_RETRIES + " attempts: " + e.message);
            return "done";
        });
    });
}

// Retry loop — keeps promise chain alive so service worker doesn't terminate
function runAutoBookLoop() {
    if (!isRunning) return Promise.resolve();

    return runAutoBookOnce().then(function (result) {
        if (result === "retry" && isRunning) {
            return delay(RETRY_INTERVAL).then(function () {
                if (!isRunning) return;
                return runAutoBookLoop();
            });
        }
        // "done" or "error" — finished
        isRunning = false;
        stopKeepAlive();
    });
}

// Main entry point — called by alarm or Run Now
function startAutoBook() {
    if (isRunning) {
        addLog("[WARN] Auto-book already running, ignoring duplicate start");
        return;
    }

    retryCount = 0;
    isRunning = true;
    startKeepAlive();

    addLog("============================================");
    addLog("========== AUTO-BOOK STARTED ==========");
    addLog("============================================");
    addLog("[START] Time: " + new Date().toLocaleString());

    chrome.storage.local.get(["courseId", "registerId", "slotTime", "slotDate", "slotTimeCustomStart", "slotTimeCustomEnd", "firStart", "firEnd", "pageReloadEnabled", "bookingPlans"]).then(function (cfg) {
        if (!isRunning) return;

        var pageReloadEnabled = cfg.pageReloadEnabled === true;
        var plans = getEffectivePlans(cfg);
        addLog("[CONFIG] Plans: " + plans.length + " | PageReload: " + (pageReloadEnabled ? "ON" : "OFF"));
        plans.forEach(function (plan, idx) {
            var slotLabel = plan.slotTime === "custom"
                ? ("custom " + (plan.slotTimeCustomStart || "?") + "–" + (plan.slotTimeCustomEnd || "?"))
                : plan.slotTime === "first-in-range"
                    ? ("first-in-range " + (plan.firStart || "?") + "–" + (plan.firEnd || "?"))
                    : (plan.slotTime || "any");
            addLog("[CONFIG] Plan " + (idx + 1) + ": C:" + plan.courseId + " | R:" + plan.registerId + " | Slot: " + slotLabel + " | Date: " + (plan.slotDate || "any"));
        });

        if (pageReloadEnabled) {
            // Page reload mode: reload once, no waiting, then straight to booking
            return chrome.storage.local.set({ autoStatus: "running", autoDetail: "Reloading PS tab once..." })
                .then(function () {
                    return new Promise(function (resolve) {
                        chrome.tabs.query({ url: "https://ps.bitsathy.ac.in/*" }, function (tabs) {
                            if (tabs && tabs.length > 0) {
                                addLog("[TAB] Reloading PS tab once...");
                                chrome.tabs.reload(tabs[0].id, { bypassCache: true }, resolve);
                            } else {
                                addLog("[TAB] No PS tab — creating one...");
                                chrome.tabs.create({ url: "https://ps.bitsathy.ac.in", active: true }, resolve);
                            }
                        });
                    });
                })
                .then(function () { return getCookieHeader(); })
                .then(function (cookieStr) {
                    if (!isRunning) return;
                    if (!cookieStr) {
                        addLog("[WARNING] No cookies found! Make sure you are logged in at ps.bitsathy.ac.in");
                    } else {
                        addLog("[COOKIES] Found cookies: " + cookieStr.length + " chars");
                    }
                    return runAutoBookLoop();
                });
        } else {
            // Pure API mode: skip tab open/reload — use existing cookies directly
            return chrome.storage.local.set({ autoStatus: "running", autoDetail: "Starting (API mode)..." })
                .then(function () { return getCookieHeader(); })
                .then(function (cookieStr) {
                    if (!isRunning) return;
                    if (!cookieStr) {
                        addLog("[WARNING] No cookies found! Make sure you are logged in at ps.bitsathy.ac.in");
                    } else {
                        addLog("[COOKIES] Found cookies: " + cookieStr.length + " chars (no page reload)");
                    }
                    return runAutoBookLoop();
                });
        }
    }).catch(function (e) {
        addLog("[FATAL] startAutoBook error: " + e.message);
        setFinalStatus("error", "Fatal error: " + e.message);
    });
}

// ===== Alarm Handler =====
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === "autoBookTrigger") {
        addLog("[ALARM] Alarm triggered at " + new Date().toLocaleString());
        startAutoBook();
    }
});

// ===== Message Handler =====
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    function respond(payload) {
        try { sendResponse(payload); } catch (e) { /* ignored */ }
    }

    (async function () {
        try {
            if (!msg || !msg.action) {
                respond({ ok: false, error: "Invalid message" });
                return;
            }

            if (msg.action === "ping") {
                respond({ ok: true, ts: Date.now() });
                return;
            }

            if (msg.action === "checkSession") {
                try {
                    // Accurate check must run from PS origin (content script), otherwise cookies may not be sent.
                    // First, quick fail if there are no cookies at all.
                    var cookieStr = await getCookieHeader();
                    if (!cookieStr) {
                        respond({ ok: true, active: false });
                        return;
                    }

                    var tabId = await getPsTabId();
                    if (tabId) {
                        var csResp = await sendMessageToTab(tabId, { action: "checkSessionFromPage" });
                        if (csResp && csResp.ok) {
                            respond({ ok: true, active: !!csResp.active });
                            return;
                        }
                    }

                    // Last-resort fallback: try direct fetch with credentials (may work if cookies are SameSite=None).
                    try {
                        var res = await fetch("https://ps.bitsathy.ac.in/api/ps_v2/resources", {
                            method: "GET",
                            credentials: "include",
                            headers: { "Accept": "application/json" }
                        });
                        respond({ ok: true, active: res.status === 200 });
                    } catch (e2) {
                        respond({ ok: true, active: false });
                    }
                } catch (e) {
                    respond({ ok: true, active: false });
                }
                return;
            }

            if (msg.action === "fetchSlots") {
                var slots = await fetchSlots(msg.courseId);
                respond({ ok: true, data: slots });
                return;
            }

            if (msg.action === "fetchRegisteredCourses" || msg.action === "fetcRegisteredCourses" || msg.action === "fetchRegistredCourses" || msg.action === "fetchCourses") {
                var courses = await fetchRegisteredCourses();
                respond({ ok: true, data: courses });
                return;
            }

            if (msg.action === "resolveCourseSelection" || msg.action === "resolveSelectedCourse" || msg.action === "resolveCourseIds") {
                var resolved = await resolveCourseSelection(msg.selection || {});
                respond({ ok: true, data: resolved });
                return;
            }

            if (msg.action === "reportCourseMaterialMapping") {
                var data = msg.data || {};
                var cid = toNumString(data.courseId);
                var rid = toNumString(data.registerId);
                if (!cid || !rid) {
                    respond({ ok: true, ignored: true });
                    return;
                }
                var stMap = await chrome.storage.local.get("courseMapByRegister");
                var mapByReg = (stMap && stMap.courseMapByRegister) || {};
                mapByReg[rid] = cid;
                await chrome.storage.local.set({ courseMapByRegister: mapByReg, lastCourseMaterialCapture: { courseId: cid, registerId: rid, at: Date.now() } });
                addLog("[COURSE-MAP] Captured course/register from page: C:" + cid + " R:" + rid);
                respond({ ok: true });
                return;
            }

            if (msg.action === "bookSlot") {
                var booked = await doBookSlot(msg.slotId, msg.registerId);
                respond({ ok: true, data: booked });
                return;
            }

            if (msg.action === "runNow") {
                startAutoBook();
                respond({ ok: true });
                return;
            }

            if (msg.action === "setAlarm") {
                if (!chrome.alarms || typeof chrome.alarms.clear !== "function") {
                    respond({ ok: false, error: "Alarms API unavailable. Check manifest permissions." });
                    return;
                }
                await new Promise(function (resolve) { chrome.alarms.clear("autoBookTrigger", resolve); });
                if (msg.delayInMinutes !== undefined) {
                    var mins = Math.max(msg.delayInMinutes, 0.1);
                    chrome.alarms.create("autoBookTrigger", { delayInMinutes: mins });
                    addLog("Alarm set: " + mins.toFixed(2) + " min from now");
                } else if (msg.when !== undefined) {
                    chrome.alarms.create("autoBookTrigger", { when: msg.when });
                    addLog("Alarm set for: " + new Date(msg.when).toLocaleString());
                }
                respond({ ok: true });
                return;
            }

            if (msg.action === "clearAlarm") {
                if (!chrome.alarms || typeof chrome.alarms.clear !== "function") {
                    respond({ ok: false, error: "Alarms API unavailable. Check manifest permissions." });
                    return;
                }
                await abortAutoBook("Alarm cancelled", "Alarm cleared");
                respond({ ok: true });
                return;
            }

            if (msg.action === "stopAutoBook") {
                if (!chrome.alarms || typeof chrome.alarms.clear !== "function") {
                    respond({ ok: false, error: "Alarms API unavailable. Check manifest permissions." });
                    return;
                }
                await abortAutoBook("Stopped by user", "Auto-book stopped by user");
                respond({ ok: true });
                return;
            }

            respond({ ok: false, error: "Unknown action: " + msg.action });
        } catch (err) {
            addLog("[MSG ERROR] " + err.message);
            respond({ ok: false, error: err.message });
        }
    })();

    return true;
});

// ===== Service Worker Recovery =====
// Resume auto-book if the service worker was terminated mid-run
chrome.runtime.onStartup.addListener(function () {
    addLog("[STARTUP] Browser started");
    chrome.storage.local.get(["autoEnabled", "autoStatus"], function (r) {
        if (r.autoEnabled && r.autoStatus === "running") {
            addLog("[RECOVERY] Resuming interrupted auto-book...");
            startAutoBook();
        }
    });
});

chrome.runtime.onInstalled.addListener(function () {
    addLog("[INIT] Extension installed/updated at " + new Date().toLocaleString());
});
