import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
    writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
    AccountingFinalSummary,
    AccountingAssignmentDoc,
    AccountingSubscriptionDoc,
    AccountingSummary,
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

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function withoutUndefined<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function toMs(value: unknown): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (value && typeof value === "object" && "toMillis" in value) {
        const maybeTimestamp = value as { toMillis?: () => number };
        const ms = maybeTimestamp.toMillis?.();
        return Number.isFinite(ms) ? (ms ?? 0) : 0;
    }
    return 0;
}

function normalizeAssignment(id: string, data: Record<string, unknown>): AccountingAssignmentDoc | null {
    const userId = text(data.assignedTo);
    const assignedAt = toMs(data.assignedAt);
    const assignedDayKey = text(data.assignedDayKey);

    if (!userId) return null;

    return {
        id,
        userId,
        assignedAt,
        assignedDayKey,
    };
}

function normalizeSubscription(id: string, data: Record<string, unknown>): AccountingSubscriptionDoc | null {
    const userId = text(data.userId);
    const status = text(data.status) || null;
    const createdAt = safeNumber(data.createdAt, toMs(data.startDate));
    const amount = clamp2(safeNumber(data.amount, 0));
    const adsBudget = clamp2(safeNumber(data.adsBudget, 0));
    const reservedBudget = clamp2(safeNumber(data.reservedBudget, 0));
    const operatingBudget = clamp2(
        safeNumber(
            data.operatingBudget,
            adsBudget > 0 ? Math.max(0, adsBudget - reservedBudget) : 0
        )
    );
    const totalBudget = clamp2(safeNumber(data.totalBudget, adsBudget));

    if (["released", "cancelled", "refunded", "voided"].includes(String(status || ""))) return null;
    if (!userId || !createdAt || amount <= 0) return null;

    return {
        id,
        userId,
        cityId: text(data.cityId) || null,
        city: text(data.city) || text(data.cityName) || null,
        plan: text(data.plan) || null,
        status,
        amount,
        adsBudget,
        operatingBudget,
        reservedBudget,
        totalBudget,
        createdAt,
        updatedAt: data.updatedAt == null ? null : safeNumber(data.updatedAt, 0),
    };
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

function normalizeFinalSummary(value: unknown): AccountingFinalSummary | undefined {
    const data = record(value);
    if (!Object.keys(data).length) return undefined;

    return {
        visited: safeNumber(data.visited, 0),
        rejected: safeNumber(data.rejected, 0),
        assigned: safeNumber(data.assigned, 0),
        gross: clamp2(safeNumber(data.gross, 0)),
        grossVisits: clamp2(safeNumber(data.grossVisits, 0)),
        grossSubscriptions: clamp2(safeNumber(data.grossSubscriptions, 0)),
        subscriptionsPaid: safeNumber(data.subscriptionsPaid, 0),
        investment: clamp2(safeNumber(data.investment, 0)),
        subscriptionInvestment: clamp2(safeNumber(data.subscriptionInvestment, 0)),
        groupInvestment: clamp2(safeNumber(data.groupInvestment, 0)),
        manualAdjustment: clamp2(safeNumber(data.manualAdjustment, 0)),
        real: clamp2(safeNumber(data.real, 0)),
        roi: data.roi == null ? null : safeNumber(data.roi, 0),
        rowsCount: safeNumber(data.rowsCount, 0),
        closedAt: safeNumber(data.closedAt, 0),
        closedBy: typeof data.closedBy === "string" ? data.closedBy : null,
        rows: Array.isArray(data.rows)
            ? (data.rows as AccountingFinalSummary["rows"])
            : undefined,
        subscriptionRows: Array.isArray(data.subscriptionRows)
            ? (data.subscriptionRows as AccountingFinalSummary["subscriptionRows"])
            : undefined,
    };
}

function normalizeWeeklyInvestment(id: string, data: Record<string, unknown>): WeeklyInvestmentDoc {
    const status =
        data.status === "closed" || data.status === "review" || data.status === "draft"
            ? data.status
            : "draft";

    return {
        id,
        weekStartKey: typeof data.weekStartKey === "string" ? data.weekStartKey : id,
        weekEndKey: typeof data.weekEndKey === "string" ? data.weekEndKey : "",
        amount: safeNumber(data.amount, 0),
        allocations: normalizeAllocations(data.allocations),
        groups: Array.isArray(data.groups) ? (data.groups as WeeklyInvestmentGroup[]) : [],
        status,
        finalSummary: normalizeFinalSummary(data.finalSummary),
        closedAt: data.closedAt == null ? null : safeNumber(data.closedAt, 0),
        closedBy: typeof data.closedBy === "string" ? data.closedBy : null,
        reopenedAt: data.reopenedAt == null ? null : safeNumber(data.reopenedAt, 0),
        reopenedBy: typeof data.reopenedBy === "string" ? data.reopenedBy : null,
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

export async function listClientAssignmentsByRange(input: {
    startKey: string;
    endKey: string;
    startMs: number;
    endMs: number;
}): Promise<AccountingAssignmentDoc[]> {
    const byId = new Map<string, AccountingAssignmentDoc>();

    const byDaySnap = await getDocs(
        query(
            collection(db, "clients"),
            where("assignedDayKey", ">=", input.startKey),
            where("assignedDayKey", "<=", input.endKey),
            orderBy("assignedDayKey", "asc"),
            limit(10000)
        )
    );

    for (const docSnap of byDaySnap.docs) {
        const assignment = normalizeAssignment(docSnap.id, record(docSnap.data()));
        if (assignment) byId.set(assignment.id, assignment);
    }

    const byMsSnap = await getDocs(
        query(
            collection(db, "clients"),
            where("assignedAt", ">=", input.startMs),
            where("assignedAt", "<=", input.endMs),
            orderBy("assignedAt", "asc"),
            limit(10000)
        )
    );

    for (const docSnap of byMsSnap.docs) {
        const assignment = normalizeAssignment(docSnap.id, record(docSnap.data()));
        if (assignment) byId.set(assignment.id, assignment);
    }

    return Array.from(byId.values());
}

export async function listPaidSubscriptionsByRange(input: {
    startMs: number;
    endMs: number;
}): Promise<AccountingSubscriptionDoc[]> {
    const snap = await getDocs(
        query(
            collection(db, "subscriptions"),
            where("createdAt", ">=", input.startMs),
            where("createdAt", "<=", input.endMs),
            orderBy("createdAt", "asc"),
            limit(1000)
        )
    );

    return snap.docs
        .map((docSnap) => normalizeSubscription(docSnap.id, record(docSnap.data())))
        .filter((subscription): subscription is AccountingSubscriptionDoc => Boolean(subscription));
}

export async function getWeeklyInvestment(
    weekStartKey: string
): Promise<WeeklyInvestmentDoc | null> {
    const snap = await getDoc(doc(db, "weeklyInvestments", weekStartKey));

    if (!snap.exists()) return null;

    return normalizeWeeklyInvestment(snap.id, record(snap.data()));
}

function clamp2(value: number) {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function buildAllocationsFromGroups(
    groups: WeeklyInvestmentGroup[]
): WeeklyInvestmentAllocations {
    const out: WeeklyInvestmentAllocations = {};

    for (const group of groups) {
        if (group.status === "inactive") continue;

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
    const ref = doc(db, "weeklyInvestments", input.weekStartKey);
    const currentSnap = await getDoc(ref);
    const current = currentSnap.exists()
        ? normalizeWeeklyInvestment(currentSnap.id, record(currentSnap.data()))
        : null;

    if (current?.status === "closed") {
        throw new Error("La semana esta cerrada. Reabre la semana para editarla.");
    }

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
        .filter((group) => group.amount > 0 && group.userIds.length > 0);
    const allocations = buildAllocationsFromGroups(groups);

    await setDoc(
        ref,
        {
            weekStartKey: input.weekStartKey,
            weekEndKey: input.weekEndKey,
            amount,
            groups,
            allocations,
            status: current?.status ?? "draft",
            updatedAt: now,
            createdAt: current?.createdAt ?? now,
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
        status: current?.status ?? "draft",
        finalSummary: current?.finalSummary,
        closedAt: current?.closedAt,
        closedBy: current?.closedBy,
        reopenedAt: current?.reopenedAt,
        reopenedBy: current?.reopenedBy,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
    } satisfies WeeklyInvestmentDoc;
}

export async function closeWeeklyInvestment(input: {
    weekStartKey: string;
    weekEndKey: string;
    summary: AccountingSummary;
    closedBy?: string | null;
}) {
    const now = Date.now();
    const ref = doc(db, "weeklyInvestments", input.weekStartKey);
    const currentSnap = await getDoc(ref);
    const current = currentSnap.exists()
        ? normalizeWeeklyInvestment(currentSnap.id, record(currentSnap.data()))
        : null;

    const finalSummary: AccountingFinalSummary = withoutUndefined({
        visited: input.summary.visited,
        rejected: input.summary.rejected,
        assigned: input.summary.assigned,
        gross: clamp2(input.summary.gross),
        grossVisits: clamp2(input.summary.grossVisits),
        grossSubscriptions: clamp2(input.summary.grossSubscriptions),
        subscriptionsPaid: input.summary.subscriptionsPaid,
        investment: clamp2(input.summary.investment),
        subscriptionInvestment: clamp2(input.summary.subscriptionInvestment),
        groupInvestment: clamp2(input.summary.groupInvestment),
        manualAdjustment: clamp2(input.summary.manualAdjustment),
        real: clamp2(input.summary.real),
        roi: input.summary.roi == null ? null : input.summary.roi,
        rowsCount: input.summary.rows.length,
        closedAt: now,
        closedBy: input.closedBy ?? null,
        rows: input.summary.rows,
        subscriptionRows: input.summary.subscriptionRows,
    });

    await setDoc(
        ref,
        {
            weekStartKey: input.weekStartKey,
            weekEndKey: input.weekEndKey,
            status: "closed",
            finalSummary,
            closedAt: now,
            closedBy: input.closedBy ?? null,
            updatedAt: now,
            createdAt: current?.createdAt ?? now,
        },
        { merge: true }
    );

    return {
        ...(current ?? {
            id: input.weekStartKey,
            weekStartKey: input.weekStartKey,
            weekEndKey: input.weekEndKey,
            amount: 0,
            groups: [],
            allocations: {},
        }),
        weekEndKey: input.weekEndKey,
        status: "closed" as const,
        finalSummary,
        closedAt: now,
        closedBy: input.closedBy ?? null,
        updatedAt: now,
        createdAt: current?.createdAt ?? now,
    } satisfies WeeklyInvestmentDoc;
}

export async function reopenWeeklyInvestment(input: {
    weekStartKey: string;
    reopenedBy?: string | null;
}) {
    const now = Date.now();
    const ref = doc(db, "weeklyInvestments", input.weekStartKey);
    const currentSnap = await getDoc(ref);
    const current = currentSnap.exists()
        ? normalizeWeeklyInvestment(currentSnap.id, record(currentSnap.data()))
        : null;

    if (!current) {
        throw new Error("No existe historial para esta semana.");
    }

    await setDoc(
        ref,
        {
            status: "draft",
            reopenedAt: now,
            reopenedBy: input.reopenedBy ?? null,
            updatedAt: now,
        },
        { merge: true }
    );

    return {
        ...current,
        status: "draft" as const,
        reopenedAt: now,
        reopenedBy: input.reopenedBy ?? null,
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

export async function deleteInvestmentGroup(groupId: string) {
    const cleanId = String(groupId || "").trim();
    if (!cleanId) throw new Error("Grupo invalido.");

    await deleteDoc(doc(db, "investmentGroups", cleanId));
}

export async function updateWeeklySubscriptionPayment(input: {
    userId: string;
    weekStartKey: string;
    paid: boolean;
    amount: number;
    cost: number;
    updatedBy?: string | null;
}) {
    const now = Date.now();
    const weekSnap = await getDoc(doc(db, "weeklyInvestments", input.weekStartKey));

    if (weekSnap.exists() && record(weekSnap.data()).status === "closed") {
        throw new Error("La semana esta cerrada. Reabre la semana para editar pagos.");
    }

    await setDoc(
        doc(db, "users", input.userId),
        {
            weeklySubscriptionWeeks: {
                [input.weekStartKey]: {
                    paid: input.paid,
                    amount: clamp2(safeNumber(input.amount, 0)),
                    cost: clamp2(safeNumber(input.cost, 0)),
                    updatedAt: now,
                    updatedBy: input.updatedBy ?? null,
                },
            },
            updatedAt: now,
        },
        { merge: true }
    );
}

// Returns how many visited events a user has in a week (for UI counter)
export async function countWeekVisitedEvents(
    userId: string,
    weekStartKey: string,
    weekEndKey: string
): Promise<number> {
    const snap = await getDocs(query(
        collection(db, "dailyEvents"),
        where("userId", "==", userId),
        where("dayKey", ">=", weekStartKey),
        where("dayKey", "<=", weekEndKey),
        where("type", "==", "visited"),
        limit(500)
    ));
    return snap.docs.length;
}

// Batch-updates rateApplied + amount for all visited events of a user in the current week
export async function batchUpdateWeekEventRates(
    userId: string,
    weekStartKey: string,
    weekEndKey: string,
    newRate: number
): Promise<number> {
    const snap = await getDocs(query(
        collection(db, "dailyEvents"),
        where("userId", "==", userId),
        where("dayKey", ">=", weekStartKey),
        where("dayKey", "<=", weekEndKey),
        where("type", "==", "visited"),
        limit(500)
    ));

    if (snap.empty) return 0;

    const batch = writeBatch(db);
    for (const d of snap.docs) {
        batch.update(d.ref, { rateApplied: newRate, amount: newRate });
    }
    await batch.commit();
    return snap.docs.length;
}

// Updates the rate of a single visited event
export async function updateDailyEventRate(eventId: string, newRate: number): Promise<void> {
    await updateDoc(doc(db, "dailyEvents", eventId), {
        rateApplied: newRate,
        amount: newRate,
    });
}
