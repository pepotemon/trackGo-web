import type { SubscriptionPlanId } from "@/types/subscriptions";
import { SUBSCRIPTION_PLANS, estimateLeadRange } from "@/lib/subscriptionPlans";

export { SUBSCRIPTION_PLANS, estimateLeadRange };

export const DEFAULT_ADS_BUDGET_RESERVE_PERCENT = 0;

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

export function calculateAdsBudgetAllocation(
    adsBudget: number,
    cycleDays = 5,
    reservePercent = 0,
) {
    const totalBudgetMinorUnits = Math.max(0, Math.round(Number(adsBudget || 0) * 100));
    const safeDays = Number.isFinite(cycleDays) ? Math.max(1, Math.round(cycleDays)) : 5;
    const safeReservePercent = Number.isFinite(reservePercent) ? Math.min(Math.max(reservePercent, 0), 90) : 0;
    const reservedBudgetMinorUnits = Math.round(totalBudgetMinorUnits * (safeReservePercent / 100));
    const operatingBudgetMinorUnits = Math.max(0, totalBudgetMinorUnits - reservedBudgetMinorUnits);
    const dailyBudgetMinorUnits = Math.floor(operatingBudgetMinorUnits / safeDays);

    return {
        reservePercent: safeReservePercent,
        cycleDays: safeDays,
        totalBudget: totalBudgetMinorUnits / 100,
        operatingBudget: operatingBudgetMinorUnits / 100,
        reservedBudget: reservedBudgetMinorUnits / 100,
        dailyBudget: dailyBudgetMinorUnits / 100,
        totalBudgetMinorUnits,
        operatingBudgetMinorUnits,
        reservedBudgetMinorUnits,
        dailyBudgetMinorUnits,
    };
}

export function calculateCycleEnd(startDate = new Date(), cycleDays = 5) {
    const safeDays = Number.isFinite(cycleDays) ? Math.max(1, Math.round(cycleDays)) : 5;
    const end = new Date(startDate);
    end.setDate(end.getDate() + safeDays);
    return end;
}
