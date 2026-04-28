import {
    collection,
    getCountFromServer,
    query,
    where,
    type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { dayKeyFromDate, getAutoAssignLogPage } from "@/data/autoAssignLogsRepo";
import { getLeadQueuePage } from "@/data/leadsRepo";
import { listAdminUsers } from "@/data/usersRepo";
import type { LeadReviewStatus } from "@/types/leads";
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

export async function getAdminDashboardSnapshot({
    queueRange = "all",
}: {
    queueRange?: AdminDashboardRange;
} = {}): Promise<AdminDashboardSnapshot> {
    const todayKey = dayKeyFromDate(new Date());

    const [
        pendingReview,
        incomplete,
        notSuitable,
        outOfCoverage,
        autoAssignmentsToday,
        queuePage,
        assignmentPage,
        users,
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
        countCollection("autoAssignLogs", [
            where("dayKey", "==", todayKey),
        ]),
        getLeadQueuePage({ pageSize: 8, statuses: QUEUE_STATUSES }),
        getAutoAssignLogPage({ pageSize: 8, dayKey: todayKey }),
        listAdminUsers(),
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

    const activeUsers = users.filter((user) => user.active);
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
        recentAssignments: assignmentPage.items,
    };
}
