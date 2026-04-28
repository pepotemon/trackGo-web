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
