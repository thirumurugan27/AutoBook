// contentScript.js
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;

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
        return true;
    }

    if (msg.action !== "pageBookSlot") return;

    var payload = msg.payload || {};

    fetch("https://ps.bitsathy.ac.in/api/ps_v2/slots/register", {
        method: "PUT",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify(payload)
    })
        .then(function (response) {
            return response.text().then(function (bodyText) {
                if (!response.ok) {
                    throw new Error("HTTP " + response.status + ": " + bodyText.substring(0, 200));
                }
                try {
                    return JSON.parse(bodyText);
                } catch (e) {
                    return { raw: bodyText, status: response.status };
                }
            });
        })
        .then(function (data) {
            sendResponse({ ok: true, data: data });
        })
        .catch(function (err) {
            sendResponse({ ok: false, error: err.message });
        });

    return true;
});


