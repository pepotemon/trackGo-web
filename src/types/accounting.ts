export type UserRole = "admin" | "user";

export type UserBillingMode = "per_visit" | "weekly_subscription";

export type UserDoc = {
    id: string;
    name?: string;
    email?: string;
    role: UserRole;
    active: boolean;
    createdAt?: number;
    updatedAt?: number;

    ratePerVisit?: number;

    billingMode?: UserBillingMode;
    weeklySubscriptionAmount?: number;
    weeklySubscriptionCost?: number;
    weeklySubscriptionActive?: boolean;
    weeklySubscriptionWeeks?: Record<
        string,
        {
            paid?: boolean;
            amount?: number;
            cost?: number;
            updatedAt?: number;
            updatedBy?: string | null;
        }
    >;
};

export type DailyEventType = "visited" | "rejected" | "pending";

export type DailyEventDoc = {
    id: string;
    type: DailyEventType;
    userId: string;
    clientId: string;
    createdAt: number;
    dayKey: string;

    phone?: string;
    name?: string;
    business?: string;
    address?: string;
    mapsUrl?: string;

    ratePerVisitSnapshot?: number;
    billingModeSnapshot?: UserBillingMode;
    amountSnapshot?: number;

    rateApplied?: number;
    amount?: number;

    rejectedReason?: string | null;
    rejectedReasonText?: string | null;
    note?: string | null;
};

export type WeeklyInvestmentAllocations = Record<string, number>;

export type InvestmentGroupStatus = "active" | "inactive";
export type WeeklyAccountingStatus = "draft" | "review" | "closed";

export type InvestmentGroupDoc = {
    id: string;
    name: string;
    defaultAmount: number;
    userIds: string[];
    status: InvestmentGroupStatus;
    createdAt?: number;
    updatedAt?: number;
};

export type WeeklyInvestmentGroup = {
    id: string;
    name: string;
    amount: number;
    userIds: string[];
    groupId?: string;
    status?: InvestmentGroupStatus;
};

export type WeeklyInvestmentDoc = {
    id: string;
    weekStartKey: string;
    weekEndKey: string;
    amount: number;
    allocations?: WeeklyInvestmentAllocations;
    groups?: WeeklyInvestmentGroup[];
    status?: WeeklyAccountingStatus;
    finalSummary?: AccountingFinalSummary;
    closedAt?: number | null;
    closedBy?: string | null;
    reopenedAt?: number | null;
    reopenedBy?: string | null;
    createdAt?: number;
    updatedAt?: number;
};

export type AccountingFinalSummary = {
    visited: number;
    rejected: number;
    gross: number;
    grossVisits: number;
    grossSubscriptions: number;
    subscriptionsPaid: number;
    investment: number;
    subscriptionInvestment: number;
    groupInvestment: number;
    manualAdjustment: number;
    real: number;
    roi: number | null;
    rowsCount: number;
    closedAt: number;
    closedBy?: string | null;
};

export type AccountingUserRow = {
    userId: string;
    name: string;
    email?: string;

    billingMode: UserBillingMode;

    visited: number;
    rejected: number;

    gross: number;
    cost: number;
    real: number;

    subscriptionPaid?: boolean;
};

export type AccountingSummary = {
    startKey: string;
    endKey: string;

    visited: number;
    rejected: number;

    gross: number;
    grossVisits: number;
    grossSubscriptions: number;
    subscriptionsPaid: number;

    investment: number;
    subscriptionInvestment: number;
    groupInvestment: number;
    manualAdjustment: number;
    real: number;
    roi: number | null;

    rows: AccountingUserRow[];
};
