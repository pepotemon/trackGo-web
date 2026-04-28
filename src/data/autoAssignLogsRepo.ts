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
import type {
    AutoAssignLogDoc,
    AutoAssignLogPage,
    AutoAssignLogPageCursor,
    LeadAutoAssignMatchType,
} from "@/types/leads";

const DEFAULT_PAGE_SIZE = 80;

type UnknownRecord = Record<string, unknown>;

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function toMs(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (value && typeof value === "object" && "toMillis" in value) {
        const millis = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(millis) ? millis : null;
    }
    return null;
}

function normalizeMatchType(value: unknown): AutoAssignLogDoc["matchType"] {
    const raw = text(value);
    if (
        raw === "city" ||
        raw === "hub_city" ||
        raw === "state" ||
        raw === "country"
    ) {
        return raw;
    }
    return raw || null;
}

function clampPageSize(value?: number) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(Math.floor(n), 150);
}

export function dayKeyFromDate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export function normalizeAutoAssignLogDoc(
    id: string,
    data: UnknownRecord
): AutoAssignLogDoc {
    return {
        id,
        leadId: text(data.leadId) || null,
        leadName: text(data.leadName) || null,
        leadPhone: text(data.leadPhone) || null,
        leadBusiness: text(data.leadBusiness) || null,
        leadGeoAdminDisplayLabel: text(data.leadGeoAdminDisplayLabel) || null,
        leadGeoAdminCityLabel: text(data.leadGeoAdminCityLabel) || null,
        leadGeoAdminStateLabel: text(data.leadGeoAdminStateLabel) || null,
        leadGeoHubLabel: text(data.leadGeoHubLabel) || null,
        userId: text(data.userId) || null,
        userName: text(data.userName) || null,
        userCoverageLabel: text(data.userCoverageLabel) || null,
        matchType: normalizeMatchType(data.matchType),
        coverageKey: text(data.coverageKey) || null,
        createdAt: toMs(data.createdAt),
        dayKey: text(data.dayKey) || null,
        mode: text(data.mode) || null,
    };
}

export async function getAutoAssignLogPage({
    cursor,
    pageSize,
    dayKey,
    userId,
    matchType,
}: {
    cursor?: AutoAssignLogPageCursor | null;
    pageSize?: number;
    dayKey?: string;
    userId?: string;
    matchType?: LeadAutoAssignMatchType | "all";
} = {}): Promise<AutoAssignLogPage> {
    const constraints: QueryConstraint[] = [];

    if (dayKey) {
        constraints.push(where("dayKey", "==", dayKey));
    }

    if (userId) {
        constraints.push(where("userId", "==", userId));
    }

    if (matchType && matchType !== "all") {
        constraints.push(where("matchType", "==", matchType));
    }

    constraints.push(orderBy("createdAt", "desc"));

    if (cursor) {
        constraints.push(startAfter(cursor as QueryDocumentSnapshot<DocumentData>));
    }

    constraints.push(limit(clampPageSize(pageSize)));

    const snap = await getDocs(query(collection(db, "autoAssignLogs"), ...constraints));

    return {
        items: snap.docs.map((item) => normalizeAutoAssignLogDoc(item.id, item.data())),
        cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
        hasMore: snap.docs.length >= clampPageSize(pageSize),
    };
}
