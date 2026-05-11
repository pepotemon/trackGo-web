import {
    collection,
    getDocs,
    getCountFromServer,
    limit,
    query,
    where,
    type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    dayKeyFromDate,
    getAutoAssignLogPage,
    normalizeAutoAssignLogDoc,
} from "@/data/autoAssignLogsRepo";
import { getLeadQueuePage } from "@/data/leadsRepo";
import { listAdminUsers } from "@/data/usersRepo";
import { getWeeklyInvestment, listPaidSubscriptionsByRange } from "@/data/accountingRepo";
import { weekRangeKeysMonToSun } from "@/lib/date";
import type { AutoAssignLogDoc, LeadReviewStatus } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import type { AdminDashboardRange, AdminDashboardSnapshot } from "@/types/dashboard";
import type { WeeklyInvestmentDoc } from "@/types/accounting";

const QUEUE_STATUSES: LeadReviewStatus[] = [
    "pending_review",
    "incomplete",
    "not_suitable",
];

async function countCollection(path: string, constraints: QueryConstraint[]) {
    const snap = await getCountFromServer(
        query(collection(db, path), ...constraints)
    );

    return snap.data().count;
}

function rangeStartMs(range: AdminDashboardRange) {
    if (range === "all") return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (range === "today") return now.getTime();
    if (range === "7d") return now.getTime() - 6 * 24 * 60 * 60 * 1000;
    return now.getTime() - 29 * 24 * 60 * 60 * 1000;
}

function withUpdatedAtRange(
    constraints: QueryConstraint[],
    range: AdminDashboardRange
) {
    const startMs = rangeStartMs(range);
    return startMs == null ? constraints : [...constraints, where("updatedAt", ">=", startMs)];
}

function activeCoverageItems(user: UserDoc) {
    return Array.isArray(user.geoCoverage)
        ? user.geoCoverage.filter((item) => item.active !== false)
        : [];
}

function hasNewInbound(lead: { lastInboundMessageAt?: number | null; adminQueueLastSeenMessageAt?: number | null; adminQueueSeenAt?: number | null }) {
    const inbound = lead.lastInboundMessageAt ?? 0;
    const seen = Math.max(
        lead.adminQueueLastSeenMessageAt ?? 0,
        lead.adminQueueSeenAt ?? 0
    );

    return inbound > seen;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function getScopedUsers(users: UserDoc[], adminId?: string | null, isSuperAdmin = false) {
    if (isSuperAdmin || !adminId) return users;
    return users.filter((user) => user.sharedWith?.some((entry) => entry.adminId === adminId));
}

function adminSellerAccountingStartMs(user: UserDoc, adminId: string, adminCreatedAt?: number) {
    const share = user.sharedWith?.find((entry) => entry.adminId === adminId);
    if (!share) return null;
    const startMs = Math.max(
        typeof adminCreatedAt === "number" ? adminCreatedAt : 0,
        typeof share.assignedAt === "number" ? share.assignedAt : 0,
    );
    if (!Number.isFinite(startMs) || startMs <= 0) return 0;
    const date = new Date(startMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function safeMoney(value: unknown) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function clamp2(value: number) {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function eventAmount(data: Record<string, unknown>, user?: UserDoc) {
    return safeMoney(
        data.amount ??
        data.amountSnapshot ??
        data.rateApplied ??
        data.ratePerVisitSnapshot ??
        user?.ratePerVisit ??
        0,
    );
}

function dayStartMs(key: string) {
    return new Date(`${key}T00:00:00`).getTime();
}

function dayEndMs(key: string) {
    return new Date(`${key}T23:59:59.999`).getTime();
}

function daysInclusive(startMs: number, endMs: number) {
    const start = new Date(startMs);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endMs);
    end.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function monthWeekRanges(startKey: string, endKey: string) {
    const out: ReturnType<typeof weekRangeKeysMonToSun>[] = [];
    const endMs = dayEndMs(endKey);
    const seen = new Set<string>();
    let cursor = new Date(`${startKey}T12:00:00`);

    while (cursor.getTime() <= endMs) {
        const week = weekRangeKeysMonToSun(cursor);
        if (!seen.has(week.startKey)) {
            out.push(week);
            seen.add(week.startKey);
        }
        cursor = new Date(week.endDate);
        cursor.setDate(cursor.getDate() + 1);
    }

    return out;
}

function weeklyGroupInvestmentForUser(
    investment: WeeklyInvestmentDoc | null,
    userId: string,
    ratio: number,
) {
    if (!investment || ratio <= 0) return 0;
    const groups = Array.isArray(investment.groups) ? investment.groups : [];
    if (groups.length) {
        return groups.reduce((sum, group) => {
            if (group.status === "inactive") return sum;
            const userIds = Array.isArray(group.userIds) ? group.userIds.filter(Boolean) : [];
            if (!userIds.includes(userId) || userIds.length === 0) return sum;
            return sum + (safeMoney(group.amount) / userIds.length) * ratio;
        }, 0);
    }

    return safeMoney(investment.allocations?.[userId]) * ratio;
}

function weeklyManualInvestment(investment: WeeklyInvestmentDoc | null, ratio: number) {
    return safeMoney(investment?.amount) * ratio;
}

async function countTodayAssignmentsForUsers(dayKey: string, userIds: string[] | null) {
    if (userIds === null) {
        return countCollection("autoAssignLogs", [where("dayKey", "==", dayKey)]);
    }

    if (userIds.length === 0) return 0;

    const counts = await Promise.all(
        chunk(userIds, 10).map((ids) =>
            countCollection("autoAssignLogs", [
                where("dayKey", "==", dayKey),
                where("userId", "in", ids),
            ])
        )
    );

    return counts.reduce((sum, count) => sum + count, 0);
}

async function getRecentAssignmentsForUsers(
    dayKey: string,
    userIds: string[] | null
): Promise<AutoAssignLogDoc[]> {
    if (userIds === null) {
        return (await getAutoAssignLogPage({ pageSize: 8, startKey: dayKey, endKey: dayKey })).items;
    }

    if (userIds.length === 0) return [];

    const snapshots = await Promise.all(
        chunk(userIds, 10).map((ids) =>
            getDocs(query(
                collection(db, "autoAssignLogs"),
                where("dayKey", "==", dayKey),
                where("userId", "in", ids),
                limit(80)
            ))
        )
    );

    return snapshots
        .flatMap((snap) => snap.docs.map((doc) => normalizeAutoAssignLogDoc(doc.id, doc.data())))
        .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
        .slice(0, 8);
}

export type MonthlyChartPoint = {
    day: string;
    dayNum: number;
    assignments: number;
    visits: number;
};

export type MonthlyChartData = {
    points: MonthlyChartPoint[];
    totalAssignments: number;
    totalVisits: number;
    totalRevenue: number;
};

export async function getMonthlyChartData(
    startKey: string,
    endKey: string,
    scope?: { adminId?: string | null; adminCreatedAt?: number; isSuperAdmin?: boolean }
): Promise<MonthlyChartData> {
    const monthStartMs = dayStartMs(startKey);
    const monthEndMs = dayEndMs(endKey);
    const weekRanges = monthWeekRanges(startKey, endKey);
    const [users, logsSnap, eventsSnap, subscriptions, weeklyInvestments] = await Promise.all([
        listAdminUsers(),
        getDocs(query(
            collection(db, "autoAssignLogs"),
            where("dayKey", ">=", startKey),
            where("dayKey", "<=", endKey),
            limit(5000)
        )),
        getDocs(query(
            collection(db, "dailyEvents"),
            where("dayKey", ">=", startKey),
            where("dayKey", "<=", endKey),
            limit(10000)
        )),
        listPaidSubscriptionsByRange({ startMs: monthStartMs, endMs: monthEndMs }),
        Promise.all(weekRanges.map((week) => getWeeklyInvestment(week.startKey))),
    ]);
    const scopedUsers = getScopedUsers(users, scope?.adminId, scope?.isSuperAdmin === true);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const vendors = users.filter((user) => user.role === "user");
    const scopedUserIds = scope?.isSuperAdmin === true || !scope?.adminId
        ? null
        : new Set(scopedUsers.filter((user) => user.role === "user").map((user) => user.id));
    const accountingStartByUser = new Map<string, number>();
    if (scope?.isSuperAdmin !== true && scope?.adminId) {
        for (const user of scopedUsers) {
            const startMs = adminSellerAccountingStartMs(user, scope.adminId, scope.adminCreatedAt);
            if (startMs !== null) accountingStartByUser.set(user.id, startMs);
        }
    }

    const assignsByDay = new Map<string, number>();
    for (const d of logsSnap.docs) {
        const userId = String(d.data().userId || "");
        if (scopedUserIds && !scopedUserIds.has(userId)) continue;
        const key = String(d.data().dayKey ?? "");
        if (key) assignsByDay.set(key, (assignsByDay.get(key) ?? 0) + 1);
    }

    const visitsByDay = new Map<string, number>();
    const eventDocs = eventsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
    for (const d of eventsSnap.docs) {
        const data = d.data();
        const userId = String(data.userId || "");
        if (scopedUserIds && !scopedUserIds.has(userId)) continue;
        const key = String(data.dayKey ?? "");
        if (key && data.type === "visited") {
            visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + 1);
        }
    }

    function grossAndCostsForUser(user: UserDoc, startMs: number) {
        let gross = 0;
        let subscriptionInvestment = 0;
        let groupInvestment = 0;
        const effectiveStart = Math.max(monthStartMs, startMs);

        for (const item of eventDocs) {
            const data = item.data;
            if (data.type !== "visited") continue;
            if (String(data.userId || "") !== user.id) continue;
            const createdAt = safeMoney(data.createdAt);
            if (createdAt < effectiveStart || createdAt > monthEndMs) continue;
            gross += eventAmount(data, user);
        }

        for (const subscription of subscriptions) {
            if (subscription.userId !== user.id) continue;
            if (subscription.createdAt < effectiveStart || subscription.createdAt > monthEndMs) continue;
            gross += subscription.amount;
            subscriptionInvestment += subscription.adsBudget;
        }

        weekRanges.forEach((week, index) => {
            const overlapStart = Math.max(monthStartMs, effectiveStart, week.startDate.getTime());
            const overlapEnd = Math.min(monthEndMs, dayEndMs(week.endKey));
            if (overlapStart > overlapEnd) return;
            const ratio = daysInclusive(overlapStart, overlapEnd) / 7;
            groupInvestment += weeklyGroupInvestmentForUser(weeklyInvestments[index], user.id, ratio);
        });

        return clamp2(gross - subscriptionInvestment - groupInvestment);
    }

    const totalManualInvestment = scope?.isSuperAdmin === true
        ? weekRanges.reduce((sum, week, index) => {
            const overlapStart = Math.max(monthStartMs, week.startDate.getTime());
            const overlapEnd = Math.min(monthEndMs, dayEndMs(week.endKey));
            if (overlapStart > overlapEnd) return sum;
            return sum + weeklyManualInvestment(weeklyInvestments[index], daysInclusive(overlapStart, overlapEnd) / 7);
        }, 0)
        : 0;

    let totalRevenue = 0;
    if (scope?.isSuperAdmin === true || !scope?.adminId) {
        const totalReal = vendors.reduce((sum, user) => sum + grossAndCostsForUser(user, monthStartMs), 0) - totalManualInvestment;
        const givenAway = vendors.reduce((sum, user) => {
            return sum + (user.sharedWith ?? []).reduce((inner, share) => {
                const admin = usersById.get(share.adminId);
                const shareStart = adminSellerAccountingStartMs(user, share.adminId, admin?.createdAt);
                if (shareStart === null) return inner;
                return inner + grossAndCostsForUser(user, shareStart) * (safeMoney(share.percentage) / 100);
            }, 0);
        }, 0);
        totalRevenue = clamp2(totalReal - givenAway);
    } else {
        totalRevenue = scopedUsers.reduce((sum, user) => {
            const share = user.sharedWith?.find((entry) => entry.adminId === scope.adminId);
            const startMs = accountingStartByUser.get(user.id);
            if (!share || startMs == null) return sum;
            return sum + grossAndCostsForUser(user, startMs) * (safeMoney(share.percentage) / 100);
        }, 0);
    }

    const points: MonthlyChartPoint[] = [];
    const cur = new Date(startKey + "T12:00:00");
    const end = new Date(endKey + "T12:00:00");
    while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        points.push({
            day: key,
            dayNum: cur.getDate(),
            assignments: assignsByDay.get(key) ?? 0,
            visits: visitsByDay.get(key) ?? 0,
        });
        cur.setDate(cur.getDate() + 1);
    }

    return {
        points,
        totalAssignments: points.reduce((s, p) => s + p.assignments, 0),
        totalVisits: points.reduce((s, p) => s + p.visits, 0),
        totalRevenue,
    };
}

export async function getAdminDashboardSnapshot({
    queueRange = "all",
    adminId = null,
    isSuperAdmin = false,
}: {
    queueRange?: AdminDashboardRange;
    adminId?: string | null;
    isSuperAdmin?: boolean;
} = {}): Promise<AdminDashboardSnapshot> {
    const todayKey = dayKeyFromDate(new Date());
    const users = await listAdminUsers();
    const scopedUsers = getScopedUsers(users, adminId, isSuperAdmin);
    const scopedAssignableUserIds = isSuperAdmin || !adminId
        ? null
        : scopedUsers.filter((user) => user.role === "user").map((user) => user.id);

    const [
        pendingReview,
        incomplete,
        notSuitable,
        outOfCoverage,
        autoAssignmentsToday,
        queuePage,
        recentAssignments,
        rangeIncomplete,
        rangeNotSuitable,
        rangeOutOfCoverage,
    ] = await Promise.all([
        countCollection("clients", [
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "==", "pending_review"),
        ]),
        countCollection("clients", [
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "==", "incomplete"),
        ]),
        countCollection("clients", [
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "==", "not_suitable"),
        ]),
        countCollection("clients", [
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "in", QUEUE_STATUSES),
            where("geoOutOfCoverage", "==", true),
        ]),
        countTodayAssignmentsForUsers(todayKey, scopedAssignableUserIds),
        getLeadQueuePage({ pageSize: 8, statuses: QUEUE_STATUSES }),
        getRecentAssignmentsForUsers(todayKey, scopedAssignableUserIds),
        countCollection("clients", withUpdatedAtRange([
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "==", "incomplete"),
        ], queueRange)),
        countCollection("clients", withUpdatedAtRange([
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "==", "not_suitable"),
        ], queueRange)),
        countCollection("clients", withUpdatedAtRange([
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "in", QUEUE_STATUSES),
            where("geoOutOfCoverage", "==", true),
        ], queueRange)),
    ]);

    const activeUsers = scopedUsers.filter((user) => user.active);
    const assignableUsers = activeUsers.filter((user) => user.role === "user");

    return {
        stats: {
            queueTotal: pendingReview + incomplete + notSuitable,
            pendingReview,
            incomplete,
            notSuitable,
            outOfCoverage,
            unreadLoaded: queuePage.items.filter(hasNewInbound).length,
            autoAssignmentsToday,
            activeUsers: activeUsers.length,
            autoAssignUsers: assignableUsers.filter((user) => user.autoAssignEnabled).length,
            usersWithoutCoverage: assignableUsers.filter((user) => activeCoverageItems(user).length === 0).length,
        },
        queueRangeStats: {
            incomplete: rangeIncomplete,
            notSuitable: rangeNotSuitable,
            outOfCoverage: rangeOutOfCoverage,
        },
        queueRange,
        recentLeads: queuePage.items,
        recentAssignments,
    };
}
