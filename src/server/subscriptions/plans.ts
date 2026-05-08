import type { SubscriptionPlanId } from "@/types/subscriptions";
import { SUBSCRIPTION_PLANS, estimateLeadRange } from "@/lib/subscriptionPlans";

export { SUBSCRIPTION_PLANS, estimateLeadRange };

export function getPlanAmount(planId: SubscriptionPlanId, customAmount?: number) {
    if (planId === "custom") return sanitizeCustomAmount(customAmount);
    const plan = SUBSCRIPTION_PLANS.find((item) => item.id === planId);
    if (!plan) throw new Error("invalid_plan");
    return plan.amount;
}

export function sanitizeCustomAmount(amount?: number) {
    const value = Number(amount || 0);
    if (!Number.isFinite(value) || value < 300) throw new Error("invalid_amount");
    return Math.round(value * 100) / 100;
}

export function calculateAdsBudget(amount: number, adsShare = 0.5) {
    const safeShare = Number.isFinite(adsShare) ? Math.min(Math.max(adsShare, 0), 1) : 0.5;
    return Math.round(amount * safeShare * 100) / 100;
}

export function calculateCycleEnd(startDate = new Date(), cycleDays = 5) {
    const safeDays = Number.isFinite(cycleDays) ? Math.max(1, Math.round(cycleDays)) : 5;
    const end = new Date(startDate);
    end.setDate(end.getDate() + safeDays);
    return end;
}
