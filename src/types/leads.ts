export type LeadReviewStatus =
    | "pending_review"
    | "incomplete"
    | "not_suitable"
    | "verified";

export type LeadParseStatus = "empty" | "partial" | "ready";
export type LeadHistoryBucket = "incomplete" | "not_suitable";
export type LeadAutoAssignmentFilter = "all" | "auto" | "manual";
export type LeadAutoAssignMatchType = "city" | "hub_city" | "state" | "country";
export type LeadQueueCityField =
    | "geoAdminCityNormalized"
    | "geoCityNormalized"
    | "geoAdminStateNormalized";

export type LeadLocation = {
    cityLabel?: string;
    cityNormalized?: string;
    displayLabel?: string;
    adminCityLabel?: string;
    adminCityNormalized?: string;
    adminStateLabel?: string;
    adminStateNormalized?: string;
    adminCountryLabel?: string;
    adminCountryNormalized?: string;
    address?: string;
    lat?: number | null;
    lng?: number | null;
    mapsUrl?: string;
    outOfCoverage: boolean;
};

export type MetaLeadDoc = {
    id: string;
    name?: string;
    business?: string;
    phone: string;
    waId?: string | null;
    status?: "pending" | "visited" | "rejected";
    source?: "manual" | "whatsapp_meta";
    parseStatus: LeadParseStatus;
    verificationStatus: LeadReviewStatus;
    leadQuality?: "unknown" | "valid" | "review" | "not_suitable";
    notSuitableReason?: string | null;
    assignedTo: string;
    assignedAt?: number | null;
    assignedDayKey?: string | number | null;
    autoAssignedAt?: number | null;
    autoAssignMatchType?: LeadAutoAssignMatchType | null;
    autoAssignCoverageKey?: string | null;
    currentLeadMapsConfirmedAt?: number | null;
    verifiedAt?: number | null;
    verifiedBy?: string | null;
    verificationStatusChangedAt?: number | null;
    leadHistoryArchivedAt?: number | null;
    leadHistoryBucket?: LeadHistoryBucket | null;
    lastInboundMessageAt?: number | null;
    lastInboundText?: string | null;
    adminQueueLastSeenMessageAt?: number | null;
    adminQueueSeenAt?: number | null;
    createdAt?: number | null;
    updatedAt?: number | null;
    location: LeadLocation;
    raw: Record<string, unknown>;
};

export type LeadFilters = {
    status: LeadReviewStatus | "all";
    city: string;
    assignment: LeadAutoAssignmentFilter;
    search: string;
};

export type LeadHistoryFilters = {
    bucket: LeadHistoryBucket | "all";
    city: string;
    search: string;
};

export type LeadCityOption = {
    value: string;
    label: string;
};

export type LeadQueueCityFilter = {
    field: LeadQueueCityField;
    value: string;
};

export type LeadQueueStats = {
    total: number;
    pendingReview: number;
    incomplete: number;
    notSuitable: number;
    verified: number;
    outOfCoverage: number;
};

export type LeadQueuePageCursor = unknown;

export type LeadQueuePage = {
    items: MetaLeadDoc[];
    cursor: LeadQueuePageCursor | null;
    hasMore: boolean;
};

export type LeadStatusPatch = {
    verificationStatus: LeadReviewStatus;
    leadQuality?: MetaLeadDoc["leadQuality"];
    notSuitableReason?: string | null;
    verifiedAt?: number | null;
    verifiedBy?: string | null;
};

export type LeadDetailsPatch = {
    name?: string;
    business?: string;
    businessRaw?: string;
    phone?: string;
    waId?: string;
    mapsUrl?: string;
    address?: string;
    lat?: number | null;
    lng?: number | null;
    currentLeadMapsConfirmedAt?: number | null;
    parseStatus?: LeadParseStatus;
    verificationStatus?: LeadReviewStatus;
    leadQuality?: MetaLeadDoc["leadQuality"];
    notSuitableReason?: string | null;
    verifiedAt?: number | null;
};

export type LeadChatMode = "bot" | "human" | "hybrid";

export type AutoAssignLogDoc = {
    id: string;
    leadId?: string | null;
    leadName?: string | null;
    leadPhone?: string | null;
    leadBusiness?: string | null;
    leadGeoAdminDisplayLabel?: string | null;
    leadGeoAdminCityLabel?: string | null;
    leadGeoAdminStateLabel?: string | null;
    leadGeoHubLabel?: string | null;
    userId?: string | null;
    userName?: string | null;
    userCoverageLabel?: string | null;
    matchType?: LeadAutoAssignMatchType | string | null;
    coverageKey?: string | null;
    createdAt: number | null;
    dayKey?: string | null;
    mode?: string | null;
};

export type AutoAssignLogFilters = {
    dayKey: string;
    userId: string;
    matchType: LeadAutoAssignMatchType | "all";
    search: string;
};

export type AutoAssignLogPageCursor = unknown;

export type AutoAssignLogPage = {
    items: AutoAssignLogDoc[];
    cursor: AutoAssignLogPageCursor | null;
    hasMore: boolean;
};

export type LeadMessageDirection = "inbound" | "outbound";
export type LeadMessageSenderType = "client" | "bot" | "admin";

export type LeadMessageDoc = {
    id: string;
    clientId: string;
    direction: LeadMessageDirection;
    senderType: LeadMessageSenderType;
    senderId?: string | null;
    text: string;
    messageType?: string | null;
    whatsappMessageId?: string | null;
    status?: "received" | "sent" | "error" | string | null;
    createdAt: number | null;
    source?: string | null;
    stage?: string | null;
    profileName?: string | null;
    mapsUrl?: string | null;
    locationCaptured?: boolean | null;
    lat?: number | null;
    lng?: number | null;
};
