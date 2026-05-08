"use client";

import { deleteToken, getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import { app } from "@/lib/firebase";
import { removeWebPushToken, saveWebPushToken } from "@/data/webPushTokensRepo";

const TOKEN_ID_PREFIX = "trackgo_web_push_token_id_";

export type WebPushState =
    | "unsupported"
    | "missing_vapid"
    | "default"
    | "granted"
    | "denied";

export async function getWebPushState(): Promise<WebPushState> {
    if (typeof window === "undefined") return "unsupported";
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        return "unsupported";
    }
    if (!(await isSupported().catch(() => false))) return "unsupported";
    if (!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY) return "missing_vapid";
    return Notification.permission as WebPushState;
}

async function sha256(input: string) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tokenIdStorageKey(userId: string) {
    return `${TOKEN_ID_PREFIX}${userId}`;
}

export function getSavedWebPushTokenId(userId: string) {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(tokenIdStorageKey(userId));
}

function platformLabel() {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) return "ios_web";
    if (/android/i.test(ua)) return "android_web";
    return "web";
}

async function messagingInstance(): Promise<Messaging> {
    return getMessaging(app);
}

export async function enableWebPushForUser(userId: string) {
    const state = await getWebPushState();
    if (state === "unsupported") throw new Error("unsupported");
    if (state === "missing_vapid") throw new Error("missing_vapid");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("permission_denied");

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = await messagingInstance();
    const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
    });

    if (!token) throw new Error("missing_token");

    const tokenId = await sha256(token);
    window.localStorage.setItem(tokenIdStorageKey(userId), tokenId);

    await saveWebPushToken(userId, tokenId, {
        token,
        platform: platformLabel(),
        userAgent: navigator.userAgent,
        endpoint: registration.pushManager ? "fcm" : "",
    });

    return tokenId;
}

export async function disableWebPushForUser(userId: string) {
    const tokenId = getSavedWebPushTokenId(userId);

    try {
        if ((await getWebPushState()) === "granted") {
            const messaging = await messagingInstance();
            await deleteToken(messaging).catch(() => false);
        }
    } finally {
        if (tokenId) await removeWebPushToken(userId, tokenId);
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(tokenIdStorageKey(userId));
        }
    }
}

export async function refreshWebPushTokenForUser(userId: string) {
    if ((await getWebPushState()) !== "granted") return null;
    try {
        return await enableWebPushForUser(userId);
    } catch (error) {
        console.warn("[webPush] token refresh failed", error);
        return null;
    }
}

export async function listenForForegroundPush(onIncoming: (payload: unknown) => void) {
    if ((await getWebPushState()) !== "granted") return () => {};
    const messaging = await messagingInstance();
    return onMessage(messaging, onIncoming);
}
