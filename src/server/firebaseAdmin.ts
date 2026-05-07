import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function stripWrappingQuotes(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed) return trimmed;
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function normalizePrivateKey(value?: string) {
    return stripWrappingQuotes(value)?.replace(/\\n/g, "\n");
}

function initializeAdminApp() {
    if (getApps().length) return getApps()[0];

    const projectId = stripWrappingQuotes(process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    const clientEmail = stripWrappingQuotes(process.env.FIREBASE_CLIENT_EMAIL);
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (projectId && clientEmail && privateKey) {
        if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
            throw new Error("FIREBASE_PRIVATE_KEY_INVALID_FORMAT");
        }

        return initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        });
    }

    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        throw new Error("FIREBASE_ADMIN_ENV_MISSING");
    }

    return initializeApp({
        credential: applicationDefault(),
        projectId,
    });
}

export const adminApp = initializeAdminApp();
export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
