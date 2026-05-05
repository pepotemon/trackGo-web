import {
    collection,
    doc,
    limit,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    type Unsubscribe,
} from "firebase/firestore";
import { auth, db, app } from "@/lib/firebase";
import { normalizeLeadDoc } from "@/data/leadsRepo";
import type { LeadChatMode, LeadMessageDoc, MetaLeadDoc } from "@/types/leads";

type UnknownRecord = Record<string, unknown>;

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function toMs(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    if (value && typeof value === "object" && "toMillis" in value) {
        const millis = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(millis) ? millis : null;
    }
    return null;
}

function normalizeMessageDoc(id: string, data: UnknownRecord): LeadMessageDoc {
    const direction = text(data.direction) === "outbound" ? "outbound" : "inbound";
    const senderTypeRaw = text(data.senderType);
    const senderType =
        senderTypeRaw === "bot" || senderTypeRaw === "admin" ? senderTypeRaw : "client";

    return {
        id,
        clientId: text(data.clientId),
        direction,
        senderType,
        senderId: text(data.senderId) || null,
        text: text(data.text),
        messageType: text(data.messageType) || null,
        whatsappMessageId: text(data.whatsappMessageId) || null,
        status: text(data.status) || null,
        createdAt: toMs(data.createdAt),
        source: text(data.source) || null,
        stage: text(data.stage) || null,
        profileName: text(data.profileName) || null,
        mapsUrl: text(data.mapsUrl) || null,
        locationCaptured: typeof data.locationCaptured === "boolean" ? data.locationCaptured : null,
        lat: typeof data.lat === "number" ? data.lat : null,
        lng: typeof data.lng === "number" ? data.lng : null,
    };
}

export function subscribeLeadClient(
    clientId: string,
    callback: (lead: MetaLeadDoc | null) => void,
    onError: (message: string) => void
): Unsubscribe {
    const cleanId = clientId.trim();
    if (!cleanId) {
        callback(null);
        return () => {};
    }

    return onSnapshot(
        doc(db, "clients", cleanId),
        (snap) => {
            callback(snap.exists() ? normalizeLeadDoc(snap.id, snap.data()) : null);
        },
        (error) => {
            onError(error.message || "No se pudo cargar el lead.");
            callback(null);
        }
    );
}

export function subscribeLeadMessages(
    clientId: string,
    callback: (messages: LeadMessageDoc[]) => void,
    onError: (message: string) => void
): Unsubscribe {
    const cleanId = clientId.trim();
    if (!cleanId) {
        callback([]);
        return () => {};
    }

    const q = query(
        collection(db, "clients", cleanId, "messages"),
        orderBy("createdAt", "desc"),
        limit(300)
    );

    return onSnapshot(
        q,
        (snap) => {
            const messages = snap.docs
                .map((item) => normalizeMessageDoc(item.id, item.data()))
                .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

            callback(messages);
        },
        (error) => {
            onError(error.message || "No se pudieron cargar los mensajes.");
            callback([]);
        }
    );
}

function functionsBaseUrl() {
    const projectId = app.options.projectId;
    if (!projectId) throw new Error("missing_project_id");
    return `https://us-central1-${projectId}.cloudfunctions.net`;
}

async function postAuthedJson(path: string, body: Record<string, unknown>) {
    const user = auth.currentUser;
    if (!user) throw new Error("not_authenticated");

    const token = await user.getIdToken();
    const res = await fetch(`${functionsBaseUrl()}/${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
        throw new Error(String(json?.error || `request_failed_${res.status}`));
    }

    return json;
}

export async function sendManualLeadMessage(clientId: string, text: string) {
    return postAuthedJson("sendManualLeadMessage", {
        clientId,
        text,
        markHumanTakeover: true,
    });
}

export async function resumeLeadBot(clientId: string) {
    return postAuthedJson("resumeBotLead", { clientId });
}

export async function setLeadChatMode(clientId: string, mode: Exclude<LeadChatMode, "hybrid">) {
    if (mode === "bot") {
        await resumeLeadBot(clientId);
        return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("not_authenticated");

    const now = Date.now();
    await updateDoc(doc(db, "clients", clientId), {
        chatMode: "human",
        botPausedAt: now,
        botPausedBy: uid,
        humanTakeoverAt: now,
        humanTakeoverBy: uid,
        updatedAt: now,
    });
}

export async function markLeadMessagesSeen(clientId: string, lastInboundAt: number) {
    if (!clientId || !lastInboundAt) return;

    await updateDoc(doc(db, "clients", clientId), {
        adminQueueLastSeenMessageAt: lastInboundAt,
        adminQueueSeenAt: Date.now(),
        updatedAt: Date.now(),
    });
}

export async function markUserLeadMessagesSeen(clientId: string, lastInboundAt: number) {
    if (!clientId || !lastInboundAt) return;

    await updateDoc(doc(db, "clients", clientId), {
        userChatLastSeenMessageAt: lastInboundAt,
        userChatSeenAt: Date.now(),
        userUnreadMessageCount: 0,
        updatedAt: Date.now(),
    });
}
