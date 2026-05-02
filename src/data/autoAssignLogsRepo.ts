import {
    addDoc,
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

export async function writeManualAssignLog({
    leadId,
    leadName,
    leadPhone,
    leadBusiness,
    leadGeoAdminDisplayLabel,
    leadGeoAdminCityLabel,
    leadGeoAdminStateLabel,
    userId,
    userName,
}: {
    leadId: string;
    leadName?: string | null;
    leadPhone?: string | null;
    leadBusiness?: string | null;
    leadGeoAdminDisplayLabel?: string | null;
    leadGeoAdminCityLabel?: string | null;
    leadGeoAdminStateLabel?: string | null;
    userId: string;
    userName?: string | null;
}) {
    const now = Date.now();
    await addDoc(collection(db, "autoAssignLogs"), {
        leadId: leadId || null,
        leadName: leadName || null,
        leadPhone: leadPhone || null,
        leadBusiness: leadBusiness || null,
        leadGeoAdminDisplayLabel: leadGeoAdminDisplayLabel || null,
        leadGeoAdminCityLabel: leadGeoAdminCityLabel || null,
        leadGeoAdminStateLabel: leadGeoAdminStateLabel || null,
        userId: userId || null,
        userName: userName || null,
        userCoverageLabel: null,
        matchType: null,
        coverageKey: null,
        createdAt: now,
        dayKey: dayKeyFromDate(new Date(now)),
        mode: "manual",
    });
}

export async function listAssignedClientsByRange(
    startKey: string,
    endKey: string,
): Promise<{ clientId: string; userId: string }[]> {
    const isSingleDay = startKey === endKey;
    const constraints: QueryConstraint[] = [];

    if (isSingleDay) {
        constraints.push(where("assignedDayKey", "==", startKey));
    } else {
        constraints.push(where("assignedDayKey", ">=", startKey));
        constraints.push(where("assignedDayKey", "<=", endKey));
        constraints.push(orderBy("assignedDayKey", "asc"));
    }

    constraints.push(limit(10000));

    const snap = await getDocs(query(collection(db, "clients"), ...constraints));
    return snap.docs
        .map((doc) => ({
            clientId: doc.id,
            userId: String(doc.data().assignedTo ?? ""),
        }))
        .filter((item) => item.userId);
}

export async function listAllAutoAssignLogsForRange(
    startKey: string,
    endKey: string,
): Promise<AutoAssignLogDoc[]> {
    const constraints: QueryConstraint[] = [];
    const isSingleDay = startKey === endKey;

    if (isSingleDay) {
        constraints.push(where("dayKey", "==", startKey));
        constraints.push(orderBy("createdAt", "desc"));
    } else {
        constraints.push(where("dayKey", ">=", startKey));
        constraints.push(where("dayKey", "<=", endKey));
        constraints.push(orderBy("dayKey", "desc"));
    }

    constraints.push(limit(2000));

    const snap = await getDocs(query(collection(db, "autoAssignLogs"), ...constraints));
    return snap.docs.map((doc) => normalizeAutoAssignLogDoc(doc.id, doc.data()));
}

export async function getAutoAssignLogPage({
    cursor,
    pageSize,
    startKey,
    endKey,
    userId,
    matchType,
}: {
    cursor?: AutoAssignLogPageCursor | null;
    pageSize?: number;
    startKey?: string;
    endKey?: string;
    userId?: string;
    matchType?: LeadAutoAssignMatchType | "all";
} = {}): Promise<AutoAssignLogPage> {
    const constraints: QueryConstraint[] = [];

    const isSingleDay = startKey && endKey && startKey === endKey;

    if (isSingleDay) {
        constraints.push(where("dayKey", "==", startKey));
    } else {
        if (startKey) constraints.push(where("dayKey", ">=", startKey));
        if (endKey) constraints.push(where("dayKey", "<=", endKey));
        if (startKey || endKey) {
            constraints.push(orderBy("dayKey", "desc"));
        }
    }

    if (userId) {
        constraints.push(where("userId", "==", userId));
    }

    if (matchType && matchType !== "all") {
        constraints.push(where("matchType", "==", matchType));
    }

    if (isSingleDay || (!startKey && !endKey)) {
        constraints.push(orderBy("createdAt", "desc"));
    }

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
