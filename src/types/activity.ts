import type { DailyEventDoc, DailyEventType, UserBillingMode } from "@/types/accounting";

export type ActivityEventType = DailyEventType | "all";

export type ActivityFilters = {
    startKey: string;
    endKey: string;
    userId: string;
    type: ActivityEventType;
    search: string;
};

export type ActivityUserOption = {
    id: string;
    name: string;
    email?: string;
    billingMode: UserBillingMode;
};

export type ActivityEventRow = DailyEventDoc & {
    userName: string;
    userEmail?: string;
    billingMode: UserBillingMode;
    amountResolved: number;
};

export type ActivityStats = {
    total: number;
    visited: number;
    rejected: number;
    pending: number;
    users: number;
};
