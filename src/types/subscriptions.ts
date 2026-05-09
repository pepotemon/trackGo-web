export type SubscriptionPlanId = "base" | "crecimiento" | "dominio" | "custom";

export type SubscriptionCityStatus = "available" | "reserved" | "occupied";

export type SubscriptionCheckoutStatus = "pending" | "approved" | "failed" | "expired" | "cancelled";

export type SubscriptionActivationStatus =
    | "waiting_payment"
    | "processing"
    | "active"
    | "meta_failed"
    | "city_occupied"
    | "city_released";

export type SubscriptionCity = {
    id: string;
    name: string;
    state?: string | null;
    country?: string | null;
    status: SubscriptionCityStatus;
    ownerUserId?: string | null;
    campaignId?: string | null;
    activeCampaignId?: string | null;
    baseCampaignId?: string | null;
    reservedByCheckoutId?: string | null;
    reservationExpiresAt?: number | null;
    updatedAt?: number | null;
};

export type SubscriptionCheckout = {
    id: string;
    userId: string;
    cityId: string;
    cityName: string;
    plan: SubscriptionPlanId;
    amount: number;
    adsBudget: number;
    paymentId: string;
    status: SubscriptionCheckoutStatus;
    activationStatus: SubscriptionActivationStatus;
    createdAt: number;
    updatedAt: number;
};

export type PixCheckoutResponse = {
    checkoutId: string;
    paymentId: string;
    status: SubscriptionCheckoutStatus;
    qrCode: string;
    qrCodeBase64: string;
    ticketUrl?: string | null;
    expiresAt?: string | null;
};
