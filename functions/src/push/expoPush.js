const { admin, db } = require("../core/firebase");

async function sendExpoPush(expoPushToken, title, body, data) {
    const message = {
        to: expoPushToken,
        sound: "default",
        title,
        body,
        data: data || {},
    };

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Accept-encoding": "gzip, deflate",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
    });

    return await res.json();
}

function cleanString(value) {
    return String(value || "").trim();
}

function notificationText(after) {
    const name = cleanString(after.name || after.phone || "Cliente");
    const business = cleanString(after.business || after.businessRaw || "");
    const city = cleanString(
        after.geoAdminCityLabel ||
        after.geoCityLabel ||
        after.geoAdminStateLabel ||
        after.address
    );

    return {
        title: business ? `Cliente nuevo - ${business}` : "Cliente nuevo",
        body: city ? `${name} - ${city}` : name,
    };
}

async function getWebPushTokens(uid) {
    const snap = await db.collection(`users/${uid}/webPushTokens`).get();
    return snap.docs
        .map((doc) => ({
            id: doc.id,
            ref: doc.ref,
            token: cleanString(doc.data()?.token),
        }))
        .filter((item) => item.token);
}

async function sendWebPush({ uid, clientId, title, body }) {
    const tokens = await getWebPushTokens(uid);
    if (!tokens.length) {
        console.log("[PUSH] user has no webPushTokens", uid);
        return;
    }

    const appUrl = cleanString(process.env.TRACKGO_APP_URL) || "https://trackgo.co";
    const link = `${appUrl}/user/leads?clientId=${encodeURIComponent(clientId)}`;
    const messages = tokens.map((item) => ({
        token: item.token,
        notification: { title, body },
        data: {
            type: "client_assigned",
            clientId,
            link,
        },
        webpush: {
            fcmOptions: { link },
            notification: {
                icon: "/icons/icon-192.png",
                badge: "/icons/favicon-32.png",
                tag: `client_${clientId}`,
                renotify: true,
            },
        },
    }));

    const result = await admin.messaging().sendEach(messages);
    const deletes = [];

    result.responses.forEach((response, index) => {
        if (response.success) return;

        const code = response.error?.code || "";
        console.log("[PUSH] web token error", uid, code, response.error?.message);

        if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
        ) {
            deletes.push(tokens[index].ref.delete());
        }
    });

    if (deletes.length) await Promise.all(deletes);
    console.log("[PUSH] web sent:", {
        uid,
        success: result.successCount,
        failure: result.failureCount,
    });
}

async function notifyAssignedUser({ clientId, after }) {
    const afterUid = after.assignedTo || null;
    if (!afterUid) return;

    const userSnap = await db.doc(`users/${afterUid}`).get();
    if (!userSnap.exists) return;

    const user = userSnap.data() || {};
    const expoToken = user.expoPushToken;
    const { title, body } = notificationText(after);

    await sendWebPush({ uid: afterUid, clientId, title, body });

    if (expoToken) {
        const result = await sendExpoPush(expoToken, title, body, {
            type: "client_assigned",
            clientId,
        });

        console.log("[PUSH] expo sent:", result);
    }
}

module.exports = {
    sendExpoPush,
    sendWebPush,
    notifyAssignedUser,
};
