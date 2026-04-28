export type UserRole = "admin" | "user";
export type UserBillingMode = "per_visit" | "weekly_subscription";
export type UserGeoCoverageType = "city" | "state" | "country";

export type UserGeoCoverage = {
    id: string;
    type: UserGeoCoverageType;
    countryLabel: string;
    countryNormalized: string;
    stateLabel: string;
    stateNormalized: string;
    cityLabel: string;
    cityNormalized: string;
    displayLabel: string;
    source?: "manual" | string;
    active: boolean;
    createdAt?: number;
    updatedAt?: number;
};

export type UserDoc = {
    id: string;
    name?: string;
    email?: string;

    role: UserRole;
    active: boolean;

    ratePerVisit?: number;

    billingMode?: UserBillingMode;
    weeklySubscriptionAmount?: number;
    weeklySubscriptionCost?: number;
    weeklySubscriptionActive?: boolean;

    whatsappPhone?: string | null;
    primaryGeoCoverageLabel?: string | null;
    geoCoverage?: UserGeoCoverage[];

    autoAssignEnabled?: boolean;
    autoAssignDailyLimit?: number | null;

    createdAt?: number;
    updatedAt?: number;
};
