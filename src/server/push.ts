import { getMessaging } from "firebase-admin/messaging";
import { adminApp, adminDb } from "@/server/firebaseAdmin";

export async function sendPushToUser(
    userId: string,
    notification: { title: string; body: string },
    data?: Record<string, string>,
): Promise<void> {
    const tokensSnap = await adminDb
        .collection("users")
        .doc(userId)
        .collection("webPushTokens")
        .get();

    if (tokensSnap.empty) return;

    const tokens = tokensSnap.docs
        .map((doc) => String(doc.data().token || ""))
        .filter(Boolean);

    if (!tokens.length) return;

    const messaging = getMessaging(adminApp);

    await messaging.sendEachForMulticast({
        tokens,
        notification,
        data,
        webpush: {
            fcmOptions: data?.link || data?.url ? { link: data.link || data.url } : undefined,
            notification: {
                icon: "/icons/icon-192.png",
                badge: "/icons/favicon-32.png",
                tag: data?.clientId ? `client_${data.clientId}` : undefined,
                renotify: Boolean(data?.clientId),
            },
        },
    });
}
