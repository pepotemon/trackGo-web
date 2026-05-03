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

/** Granular permissions for sub-admin users (role === "admin" && !isSuperAdmin). */
export type AdminPermissions = {
    /** Can view Prospectos, Actividad and Asignaciones screens. */
    leads: boolean;
    /** Can use "Asignar por cobertura" and reassign in modals. */
    leadsAssign: boolean;
    /** Can open WhatsApp links for clients. */
    leadsWhatsapp: boolean;
    /** Can edit a prospecto. */
    leadsEdit: boolean;
    /** Can delete a prospecto. */
    leadsDelete: boolean;
    /** Can view their own accounting (filtered to assigned users). */
    accountingView: boolean;
    /** Can view Configuración de inversión in read-only mode. */
    accountingInvestmentView: boolean;
    /** Can modify Configuración de inversión (manual adjust, groups, etc.). */
    accountingInvestmentEdit: boolean;
    /** Can view the Usuarios screen (filtered to assigned users). */
    usersView: boolean;
    /** Can create a new user. */
    usersCreate: boolean;
    /** Can edit or deactivate a user. */
    usersEdit: boolean;
};

/** Returns a safe default with all permissions disabled. */
export function defaultAdminPermissions(): AdminPermissions {
    return {
        leads: false,
        leadsAssign: false,
        leadsWhatsapp: false,
        leadsEdit: false,
        leadsDelete: false,
        accountingView: false,
        accountingInvestmentView: false,
        accountingInvestmentEdit: false,
        usersView: false,
        usersCreate: false,
        usersEdit: false,
    };
}

/** Returns a permissions object with everything enabled (used for superadmin). */
export function fullAdminPermissions(): AdminPermissions {
    return {
        leads: true,
        leadsAssign: true,
        leadsWhatsapp: true,
        leadsEdit: true,
        leadsDelete: true,
        accountingView: true,
        accountingInvestmentView: true,
        accountingInvestmentEdit: true,
        usersView: true,
        usersCreate: true,
        usersEdit: true,
    };
}

/**
 * Entry on a seller (role === "user") indicating that an admin shares
 * their results, with a configured profit percentage.
 */
export type UserSharedAdmin = {
    adminId: string;
    adminName: string;
    /** 0–100. The percentage of this user's profit that belongs to this admin. */
    percentage: number;
};

export type UserDoc = {
    id: string;
    name?: string;
    email?: string;

    role: UserRole;
    active: boolean;

    /**
     * True only for the superadmin account.
     * Set manually in Firestore — never through the app UI.
     * When true, all permissions are implicitly granted and `permissions` is ignored.
     */
    isSuperAdmin?: boolean;

    /**
     * Granular permissions for sub-admin users (role === "admin", isSuperAdmin !== true).
     * Undefined means all permissions are denied.
     */
    permissions?: AdminPermissions;

    /**
     * For seller users (role === "user"): which admins share this user's profits,
     * and at what percentage each.
     */
    sharedWith?: UserSharedAdmin[];

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
