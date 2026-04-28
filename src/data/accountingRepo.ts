import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    setDoc,
    where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
    DailyEventDoc,
    InvestmentGroupDoc,
    UserDoc,
    WeeklyInvestmentDoc,
    WeeklyInvestmentGroup,
    WeeklyInvestmentAllocations,
} from "@/types/accounting";

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeAllocations(value: unknown): WeeklyInvestmentAllocations {
    const out: WeeklyInvestmentAllocations = {};

    for (const [userId, amount] of Object.entries(record(value))) {
        const cleanUserId = String(userId || "").trim();
        if (!cleanUserId) continue;
        out[cleanUserId] = safeNumber(amount, 0);
    }

    return out;
}

function normalizeInvestmentGroup(id: string, data: Record<string, unknown>): InvestmentGroupDoc {
    const status = data.status === "inactive" ? "inactive" : "active";
    const rawUsers = Array.isArray(data.userIds) ? data.userIds : [];

    return {
        id,
        name: String(data.name || "Grupo").trim() || "Grupo",
        defaultAmount: clamp2(safeNumber(data.defaultAmount ?? data.amount, 0)),
        userIds: Array.from(
            new Set(
                rawUsers
                    .map((userId) => String(userId || "").trim())
                    .filter(Boolean)
            )
        ),
        status,
        createdAt: safeNumber(data.createdAt, undefined),
        updatedAt: safeNumber(data.updatedAt, undefined),
    };
}

export async function listAccountingUsers(): Promise<UserDoc[]> {
    const q = query(
        collection(db, "users"),
        where("role", "==", "user"),
        orderBy("createdAt", "desc"),
        limit(500)
    );

    const snap = await getDocs(q);

    return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<UserDoc, "id">),
    }));
}

export async function listInvestmentGroups(): Promise<InvestmentGroupDoc[]> {
    const q = query(
        collection(db, "investmentGroups"),
        orderBy("createdAt", "desc"),
        limit(500)
    );

    const snap = await getDocs(q);

    return snap.docs.map((d) => normalizeInvestmentGroup(d.id, record(d.data())));
}

export async function listDailyEventsByRange(
    startKey: string,
    endKey: string
): Promise<DailyEventDoc[]> {
    const q = query(
        collection(db, "dailyEvents"),
        where("dayKey", ">=", startKey),
        where("dayKey", "<=", endKey),
        orderBy("dayKey", "asc"),
        orderBy("createdAt", "asc"),
        limit(5000)
    );

    const snap = await getDocs(q);

    return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<DailyEventDoc, "id">),
    }));
}

export async function getWeeklyInvestment(
    weekStartKey: string
): Promise<WeeklyInvestmentDoc | null> {
    const snap = await getDoc(doc(db, "weeklyInvestments", weekStartKey));

    if (!snap.exists()) return null;

    const data = record(snap.data());

    return {
        id: snap.id,
        weekStartKey: typeof data.weekStartKey === "string" ? data.weekStartKey : snap.id,
        weekEndKey: typeof data.weekEndKey === "string" ? data.weekEndKey : "",
        amount: safeNumber(data.amount, 0),
        allocations: normalizeAllocations(data.allocations),
        groups: Array.isArray(data.groups) ? (data.groups as WeeklyInvestmentGroup[]) : [],
        createdAt: safeNumber(data.createdAt, undefined),
        updatedAt: safeNumber(data.updatedAt, undefined),
    };
}

function clamp2(value: number) {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function buildAllocationsFromGroups(
    groups: WeeklyInvestmentGroup[]
): WeeklyInvestmentAllocations {
    const out: WeeklyInvestmentAllocations = {};

    for (const group of groups) {
        const userIds = Array.from(
            new Set(
                (Array.isArray(group.userIds) ? group.userIds : [])
                    .map((id) => String(id || "").trim())
                    .filter(Boolean)
            )
        );
        const amount = clamp2(safeNumber(group.amount, 0));

        if (amount <= 0 || userIds.length === 0) continue;

        const share = clamp2(amount / userIds.length);
        const diff = clamp2(amount - share * userIds.length);

        userIds.forEach((userId, index) => {
            const portion = index === userIds.length - 1 ? clamp2(share + diff) : share;
            out[userId] = clamp2((out[userId] ?? 0) + portion);
        });
    }

    return out;
}

export async function upsertWeeklyInvestment(input: {
    weekStartKey: string;
    weekEndKey: string;
    amount: number;
    groups: WeeklyInvestmentGroup[];
}) {
    const now = Date.now();
    const amount = clamp2(safeNumber(input.amount, 0));
    const groups = input.groups
        .map((group, index) => {
            const userIds = Array.from(
                new Set(
                    group.userIds
                        .map((userId) => String(userId || "").trim())
                        .filter(Boolean)
                )
            );

            return {
                id: String(group.id || `group_${index + 1}`).trim() || `group_${index + 1}`,
                groupId: String(group.groupId || group.id || `group_${index + 1}`).trim() || `group_${index + 1}`,
                name: String(group.name || `Grupo ${index + 1}`).trim() || `Grupo ${index + 1}`,
                amount: clamp2(safeNumber(group.amount, 0)),
                userIds,
                status: group.status === "inactive" ? ("inactive" as const) : ("active" as const),
            };
        })
        .filter((group) => group.status === "active" && group.amount > 0 && group.userIds.length > 0);
    const allocations = buildAllocationsFromGroups(groups);

    await setDoc(
        doc(db, "weeklyInvestments", input.weekStartKey),
        {
            weekStartKey: input.weekStartKey,
            weekEndKey: input.weekEndKey,
            amount,
            groups,
            allocations,
            updatedAt: now,
            createdAt: now,
        },
        { merge: true }
    );

    return {
        id: input.weekStartKey,
        weekStartKey: input.weekStartKey,
        weekEndKey: input.weekEndKey,
        amount,
        groups,
        allocations,
        updatedAt: now,
    } satisfies WeeklyInvestmentDoc;
}

export async function upsertInvestmentGroup(input: {
    id?: string;
    name: string;
    defaultAmount: number;
    userIds: string[];
    status: "active" | "inactive";
}): Promise<InvestmentGroupDoc> {
    const now = Date.now();
    const id = String(input.id || `group_${now}`).trim() || `group_${now}`;
    const ref = doc(db, "investmentGroups", id);
    const current = await getDoc(ref);
    const createdAt = current.exists()
        ? safeNumber(record(current.data()).createdAt, now)
        : now;
    const userIds = Array.from(
        new Set(
            input.userIds
                .map((userId) => String(userId || "").trim())
                .filter(Boolean)
        )
    );
    const payload = {
        name: String(input.name || "Grupo").trim() || "Grupo",
        defaultAmount: clamp2(safeNumber(input.defaultAmount, 0)),
        userIds,
        status: input.status === "inactive" ? "inactive" : "active",
        updatedAt: now,
        createdAt,
    } satisfies Omit<InvestmentGroupDoc, "id">;

    await setDoc(ref, payload, { merge: true });

    return {
        id,
        ...payload,
    };
}
