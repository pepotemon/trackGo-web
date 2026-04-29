import {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
    type DocumentData,
    type QueryConstraint,
    type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DailyEventDoc } from "@/types/accounting";

export type ActivityCursor = QueryDocumentSnapshot<DocumentData> | null;

export type ActivityPage = {
    events: DailyEventDoc[];
    cursor: ActivityCursor;
    hasMore: boolean;
};

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function dayKeyFromMs(ms: number) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export async function listActivityEventsPage(input: {
    startKey: string;
    endKey: string;
    pageSize: number;
    cursor?: ActivityCursor;
}): Promise<ActivityPage> {
    const constraints: QueryConstraint[] = [
        where("dayKey", ">=", input.startKey),
        where("dayKey", "<=", input.endKey),
        orderBy("dayKey", "desc"),
        orderBy("createdAt", "desc"),
        limit(input.pageSize + 1),
    ];

    if (input.cursor) {
        constraints.push(startAfter(input.cursor));
    }

    const snap = await getDocs(query(collection(db, "dailyEvents"), ...constraints));
    const docs = snap.docs;
    const pageDocs = docs.slice(0, input.pageSize);

    return {
        events: pageDocs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<DailyEventDoc, "id">),
        })),
        cursor: pageDocs.at(-1) ?? input.cursor ?? null,
        hasMore: docs.length > input.pageSize || snap.docs.length > input.pageSize,
    };
}

export async function listPendingClientsForActivity(input: {
    startKey: string;
    endKey: string;
    pageSize: number;
}): Promise<DailyEventDoc[]> {
    const snap = await getDocs(
        query(
            collection(db, "clients"),
            where("status", "==", "pending"),
            orderBy("updatedAt", "desc"),
            limit(input.pageSize)
        )
    );

    return snap.docs
        .map((docSnap) => {
            const data = docSnap.data();
            const assignedAt = safeNumber(data.assignedAt, 0);
            const updatedAt = safeNumber(data.updatedAt, 0);
            const createdAt = assignedAt || updatedAt || Date.now();
            const dayKey = text(data.assignedDayKey) || dayKeyFromMs(createdAt);

            return {
                id: `pending_${docSnap.id}`,
                type: "pending",
                userId: text(data.assignedTo),
                clientId: docSnap.id,
                createdAt,
                dayKey,
                phone: text(data.phone),
                name: text(data.name),
                business: text(data.business),
                address: text(data.address),
                mapsUrl: text(data.mapsUrl),
            } satisfies DailyEventDoc;
        })
        .filter((event) => {
            return event.userId && event.dayKey >= input.startKey && event.dayKey <= input.endKey;
        });
}
