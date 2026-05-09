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
import type { AutoAssignLogDoc, LeadReviewStatus } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import type { AdminDashboardRange, AdminDashboardSnapshot } from "@/types/dashboard";

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
    endKey: string
): Promise<MonthlyChartData> {
    const [logsSnap, eventsSnap] = await Promise.all([
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
            limit(20000)
        )),
    ]);

    const assignsByDay = new Map<string, number>();
    for (const d of logsSnap.docs) {
        const key = String(d.data().dayKey ?? "");
        if (key) assignsByDay.set(key, (assignsByDay.get(key) ?? 0) + 1);
    }

    const visitsByDay = new Map<string, number>();
    let totalRevenue = 0;
    for (const d of eventsSnap.docs) {
        const data = d.data();
        const key = String(data.dayKey ?? "");
        const amount = typeof data.amount === "number" ? data.amount : 0;
        if (key && data.type === "visited") {
            visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + 1);
            totalRevenue += amount;
        }
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
