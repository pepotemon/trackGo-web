import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type WebPushTokenPayload = {
    token: string;
    platform: string;
    userAgent?: string;
    endpoint?: string;
};

export async function saveWebPushToken(userId: string, tokenId: string, payload: WebPushTokenPayload) {
    const now = Date.now();

    await setDoc(doc(db, "users", userId, "webPushTokens", tokenId), {
        token: payload.token,
        platform: payload.platform,
        userAgent: payload.userAgent ?? "",
        endpoint: payload.endpoint ?? "",
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
    }, { merge: true });
}

export async function removeWebPushToken(userId: string, tokenId: string) {
    await deleteDoc(doc(db, "users", userId, "webPushTokens", tokenId));
}
