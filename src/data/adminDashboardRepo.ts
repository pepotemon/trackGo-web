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
import {
    getWeeklyInvestment,
    listAccountingUsers,
    listClientAssignmentsByRange,
    listDailyEventsByRange,
    listPaidSubscriptionsByRange,
} from "@/data/accountingRepo";
import { buildAccountingSummary } from "@/features/accounting/calcAccounting";
import { weekRangeKeysMonToSun } from "@/lib/date";
import type { AutoAssignLogDoc, LeadReviewStatus } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import type { AdminDashboardRange, AdminDashboardSnapshot } from "@/types/dashboard";
import type { WeeklyInvestmentDoc } from "@/types/accounting";
import type { AccountingSummary, UserDoc as AccountingUserDoc } from "@/types/accounting";

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

function adminSellerAccountingStartMs(
    user: { sharedWith?: { adminId: string; assignedAt?: number }[] },
    adminId: string,
    adminCreatedAt?: number,
) {
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

function dayEndMs(key: string) {
    return new Date(`${key}T23:59:59.999`).getTime();
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

function inKeyRange(key: string | undefined, startKey: string, endKey: string) {
    return Boolean(key && key >= startKey && key <= endKey);
}

function combineDashboardSummaries(summaries: AccountingSummary[]) {
    return {
        assignments: summaries.reduce((sum, item) => sum + item.assigned, 0),
        visits: summaries.reduce((sum, item) => sum + item.visited, 0),
    };
}

function scopeInvestmentForAdmin(
    investment: WeeklyInvestmentDoc | null,
    users: AccountingUserDoc[],
    isSuperAdmin: boolean,
) {
    if (isSuperAdmin || !investment) return investment;
    const userIds = new Set(users.map((user) => user.id));
    return {
        ...investment,
        amount: 0,
        allocations: {},
        groups: (investment.groups ?? [])
            .map((group) => {
                const originalUserIds = Array.isArray(group.userIds) ? group.userIds.filter(Boolean) : [];
                const scopedUserIds = originalUserIds.filter((id) => userIds.has(id));
                const ratio = originalUserIds.length ? scopedUserIds.length / originalUserIds.length : 0;
                return { ...group, userIds: scopedUserIds, amount: clamp2(safeMoney(group.amount) * ratio) };
            })
            .filter((group) => group.userIds.length > 0),
    };
}

function calculateMyGain(
    summary: AccountingSummary,
    users: AccountingUserDoc[],
    adminId: string | null | undefined,
    isSuperAdmin: boolean,
) {
    if (isSuperAdmin) {
        const givenAway = summary.rows.reduce((acc, row) => {
            const user = users.find((item) => item.id === row.userId);
            const totalPct = (user?.sharedWith ?? []).reduce((sum, share) => sum + safeMoney(share.percentage), 0);
            return acc + (row.real * totalPct / 100);
        }, 0);
        return givenAway === 0 ? null : summary.real - givenAway;
    }

    if (!adminId) return null;
    return summary.rows.reduce((acc, row) => {
        const user = users.find((item) => item.id === row.userId);
        const share = user?.sharedWith?.find((item) => item.adminId === adminId);
        if (!share) return acc;
        return acc + (row.real * safeMoney(share.percentage) / 100);
    }, 0);
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
    const monthEndMs = dayEndMs(endKey);
    const weekRanges = monthWeekRanges(startKey, endKey);
    const queryStartKey = weekRanges[0]?.startKey ?? startKey;
    const queryEndKey = weekRanges.at(-1)?.endKey ?? endKey;
    const queryStartDate = weekRanges[0]?.startDate ?? new Date(`${startKey}T00:00:00`);
    const queryEndDate = weekRanges.at(-1)?.endDate ?? new Date(`${endKey}T23:59:59.999`);
    const [users, accountingUsers, events, assignments, subscriptions, weeklyInvestments] = await Promise.all([
        listAdminUsers(),
        listAccountingUsers(),
        listDailyEventsByRange(queryStartKey, queryEndKey),
        listClientAssignmentsByRange({
            startKey: queryStartKey,
            endKey: queryEndKey,
            startMs: queryStartDate.getTime(),
            endMs: dayEndMs(queryEndKey),
        }),
        listPaidSubscriptionsByRange({ startMs: queryStartDate.getTime(), endMs: dayEndMs(queryEndKey) }),
        Promise.all(weekRanges.map((week) => getWeeklyInvestment(week.startKey))),
    ]);
    const isSuperAdmin = scope?.isSuperAdmin === true;
    const scopedUsers = getScopedUsers(users, scope?.adminId, isSuperAdmin);
    const accountingUserById = new Map(accountingUsers.map((user) => [user.id, user]));
    const periodEndMs = monthEndMs;
    const scopedAccountingUsers = isSuperAdmin || !scope?.adminId
        ? accountingUsers
        : scopedUsers
            .map((user) => accountingUserById.get(user.id))
            .filter((user): user is AccountingUserDoc => {
                if (!user) return false;
                const startMs = adminSellerAccountingStartMs(user, scope.adminId!, scope.adminCreatedAt);
                return startMs !== null && startMs <= periodEndMs;
            });
    const scopedUserIds = isSuperAdmin || !scope?.adminId
        ? null
        : new Set(scopedAccountingUsers.filter((user) => user.role === "user").map((user) => user.id));
    const accountingStartByUser = new Map<string, number>();
    if (!isSuperAdmin && scope?.adminId) {
        for (const user of scopedAccountingUsers) {
            const startMs = adminSellerAccountingStartMs(user, scope.adminId, scope.adminCreatedAt);
            if (startMs !== null) accountingStartByUser.set(user.id, startMs);
        }
    }

    const assignsByDay = new Map<string, number>();
    for (const assignment of assignments) {
        const userId = String(assignment.userId || "");
        if (scopedUserIds && !scopedUserIds.has(userId)) continue;
        const startMs = accountingStartByUser.get(userId) ?? 0;
        if (!isSuperAdmin && assignment.assignedAt < startMs) continue;
        const key = String(assignment.assignedDayKey ?? "");
        if (key < startKey || key > endKey) continue;
        if (key) assignsByDay.set(key, (assignsByDay.get(key) ?? 0) + 1);
    }

    const visitsByDay = new Map<string, number>();
    const scopedEvents = isSuperAdmin
        ? events
        : events.filter((event) => event.createdAt >= (accountingStartByUser.get(event.userId) ?? Number.POSITIVE_INFINITY));
    const scopedAssignments = isSuperAdmin
        ? assignments
        : assignments.filter((assignment) => assignment.assignedAt >= (accountingStartByUser.get(assignment.userId) ?? Number.POSITIVE_INFINITY));
    const scopedSubscriptions = isSuperAdmin
        ? subscriptions
        : subscriptions.filter((subscription) => subscription.createdAt >= (accountingStartByUser.get(subscription.userId) ?? Number.POSITIVE_INFINITY));

    for (const event of scopedEvents) {
        const userId = String(event.userId || "");
        if (scopedUserIds && !scopedUserIds.has(userId)) continue;
        const key = String(event.dayKey ?? "");
        if (key < startKey || key > endKey) continue;
        if (key && event.type === "visited") {
            visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + 1);
        }
    }

    const weeklySummaries = weekRanges.map((week, index) => {
        const weekEndMs = dayEndMs(week.endKey);
        const weekUsers = isSuperAdmin || !scope?.adminId
            ? scopedAccountingUsers
            : scopedAccountingUsers.filter((user) => {
                const startMs = accountingStartByUser.get(user.id);
                return startMs !== undefined && startMs <= weekEndMs;
            });
        const scopedWeekInvestment = scopeInvestmentForAdmin(weeklyInvestments[index] ?? null, weekUsers, isSuperAdmin);
        return buildAccountingSummary({
            startKey: week.startKey,
            endKey: week.endKey,
            users: weekUsers,
            events: scopedEvents.filter((event) => inKeyRange(event.dayKey, week.startKey, week.endKey)),
            assignments: scopedAssignments.filter((assignment) => inKeyRange(assignment.assignedDayKey, week.startKey, week.endKey)),
            subscriptions: scopedSubscriptions.filter((subscription) =>
                subscription.createdAt >= week.startDate.getTime() && subscription.createdAt <= dayEndMs(week.endKey)
            ),
            investment: scopedWeekInvestment,
        });
    });
    const monthlyTotals = combineDashboardSummaries(weeklySummaries);
    const gainValues = weeklySummaries
        .map((summary) => calculateMyGain(summary, scopedAccountingUsers, scope?.adminId, isSuperAdmin))
        .filter((value): value is number => value !== null);
    const totalRevenue = clamp2(gainValues.reduce((sum, value) => sum + value, 0));

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
        totalAssignments: monthlyTotals.assignments,
        totalVisits: monthlyTotals.visits,
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
