// content/contentScript.js
if (window.__autoBookListenerRegistered) {
} else {
    window.__autoBookListenerRegistered = true;

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg) return false;

        if (msg.action === "checkSessionFromPage") {
            fetch("https://ps.bitsathy.ac.in/api/ps_v2/resources", {
                method: "GET",
                credentials: "include",
                headers: { "Accept": "application/json" }
            })
                .then(function (res) {
                    sendResponse({ ok: true, active: res.status === 200 });
                })
                .catch(function () {
                    sendResponse({ ok: true, active: false });
                });
            return true; // keep channel open for async response
        }

        if (msg.action === "getCourseDetails") {
            var rid = String(msg.registerId || "").trim();
            if (!rid || !/^\d+$/.test(rid)) {
                sendResponse({ ok: false, error: "Invalid registerId" });
                return false;
            }
            fetch("https://ps.bitsathy.ac.in/api/ps_v2/my-course/details?id=" + rid + "&courseMaterial=1", {
                method: "GET",
                credentials: "include",
                headers: { "Accept": "application/json" }
            })
                .then(function (res) {
                    return res.text().then(function (body) {
                        if (!res.ok) throw new Error("HTTP " + res.status + ": " + body.substring(0, 200));
                        try { return JSON.parse(body); } catch (e) { return { raw: body }; }
                    });
                })
                .then(function (data) { sendResponse({ ok: true, data: data }); })
                .catch(function (err) { sendResponse({ ok: false, error: err.message }); });
            return true;
        }

        if (msg.action === "fetchSlots") {
            var courseId = String(msg.courseId || "").trim();
            if (!courseId || !/^\d+$/.test(courseId)) {
                sendResponse({ ok: false, error: "Invalid courseId" });
                return false;
            }
            fetch("https://ps.bitsathy.ac.in/api/ps_v2/slots/available?id=" + encodeURIComponent(courseId), {
                method: "GET",
                credentials: "include",
                headers: { "Accept": "application/json" }
            })
                .then(function (res) {
                    return res.text().then(function (body) {
                        if (!res.ok) throw new Error("HTTP " + res.status + ": " + body.substring(0, 200));
                        try { return JSON.parse(body); } catch (e) { return { raw: body }; }
                    });
                })
                .then(function (data) { sendResponse({ ok: true, data: data }); })
                .catch(function (err) { sendResponse({ ok: false, error: err.message }); });
            return true;
        }

        if (msg.action === "fetchRegisteredCourses") {
            fetch("https://ps.bitsathy.ac.in/api/ps_v2/my-course?tab=personalizedSkills", {
                method: "GET",
                credentials: "include",
                headers: { "Accept": "application/json" }
            })
                .then(function (res) {
                    return res.text().then(function (body) {
                        if (!res.ok) throw new Error("HTTP " + res.status + ": " + body.substring(0, 200));
                        try { return JSON.parse(body); } catch (e) { return { raw: body }; }
                    });
                })
                .then(function (data) { sendResponse({ ok: true, data: data }); })
                .catch(function (err) { sendResponse({ ok: false, error: err.message }); });
            return true;
        }

        if (msg.action !== "pageBookSlot") return false;

        var payload = msg.payload || {};
        fetch("https://ps.bitsathy.ac.in/api/ps_v2/slots/register", {
            method: "PUT",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            },
            body: JSON.stringify(payload)
        })
            .then(function (response) {
                return response.text().then(function (bodyText) {
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + bodyText.substring(0, 200));
                    }
                    try { return JSON.parse(bodyText); }
                    catch (e) { return { raw: bodyText, status: response.status }; }
                });
            })
            .then(function (data) { sendResponse({ ok: true, data: data }); })
            .catch(function (err) { sendResponse({ ok: false, error: err.message }); });
        return true; // keep channel open for async response
    });
}
