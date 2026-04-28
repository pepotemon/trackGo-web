import type { AutoAssignLogDoc, MetaLeadDoc } from "@/types/leads";

export type AdminDashboardRange = "today" | "7d" | "30d" | "all";

export type AdminDashboardQueueRangeStats = {
    incomplete: number;
    notSuitable: number;
    outOfCoverage: number;
};

export type AdminDashboardStats = {
    queueTotal: number;
    pendingReview: number;
    incomplete: number;
    notSuitable: number;
    outOfCoverage: number;
    unreadLoaded: number;
    autoAssignmentsToday: number;
    activeUsers: number;
    autoAssignUsers: number;
    usersWithoutCoverage: number;
};

export type AdminDashboardSnapshot = {
    stats: AdminDashboardStats;
    queueRangeStats: AdminDashboardQueueRangeStats;
    queueRange: AdminDashboardRange;
    recentLeads: MetaLeadDoc[];
    recentAssignments: AutoAssignLogDoc[];
};
