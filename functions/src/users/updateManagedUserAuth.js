const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, admin } = require("../core/firebase");

function cleanString(v) {
    return String(v ?? "").trim();
}

async function assertSuperAdmin(uid) {
    const snap = await db.doc(`users/${uid}`).get();
    const user = snap.exists ? snap.data() : null;

    if (!user || user.role !== "admin" || user.active !== true || user.isSuperAdmin !== true) {
        throw new HttpsError("permission-denied", "Solo el superadmin puede cambiar credenciales.");
    }
}

exports.updateManagedUserAuth = onCall(
    {
        region: "us-central1",
    },
    async (request) => {
        if (!request.auth?.uid) {
            throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
        }

        await assertSuperAdmin(request.auth.uid);

        const data = request.data || {};
        const uid = cleanString(data.uid);
        const profileId = cleanString(data.profileId) || uid;
        const email = cleanString(data.email).toLowerCase();
        const currentEmail = cleanString(data.currentEmail).toLowerCase();
        const password = cleanString(data.password);

        if (!uid) {
            throw new HttpsError("invalid-argument", "UID requerido.");
        }

        const patch = {};

        if (email) {
            patch.email = email;
            patch.emailVerified = false;
        }

        if (password) {
            if (password.length < 6) {
                throw new HttpsError("invalid-argument", "La contraseña debe tener mínimo 6 caracteres.");
            }
            patch.password = password;
        }

        if (!Object.keys(patch).length) {
            return { ok: true, changed: false };
        }

        let authUid = uid;
        try {
            await admin.auth().getUser(authUid);
        } catch (error) {
            if (!currentEmail) {
                throw error;
            }
            const foundUser = await admin.auth().getUserByEmail(currentEmail);
            authUid = foundUser.uid;
        }

        const authUser = await admin.auth().updateUser(authUid, patch);

        const profilePatch = {
            authUid,
            updatedAt: Date.now(),
        };

        if (email) {
            profilePatch.email = authUser.email || email;
        }

        await db.doc(`users/${profileId}`).set(profilePatch, { merge: true });

        return {
            ok: true,
            changed: true,
            uid,
            authUid,
            email: authUser.email || email || null,
        };
    }
);
