import type { SubscriptionPlanId } from "@/types/subscriptions";

export type SubscriptionPlanDefinition = {
    id: Exclude<SubscriptionPlanId, "custom">;
    name: string;
    amount: number;
    adsBudget: number;
    estimatedLeads: string;
    description: string;
};

export const SUBSCRIPTION_PLANS: SubscriptionPlanDefinition[] = [
    {
        id: "base",
        name: "Acesso",
        amount: 300,
        adsBudget: 150,
        estimatedLeads: "10-35",
        description: "Acceso inicial para recibir clientes durante 5 dias y gestionarlos por 7 dias.",
    },
    {
        id: "crecimiento",
        name: "Impulso",
        amount: 400,
        adsBudget: 200,
        estimatedLeads: "25-50",
        description: "Plan recomendado para trabajar una ciudad con mayor volumen de oportunidades.",
    },
    {
        id: "dominio",
        name: "Dominio",
        amount: 600,
        adsBudget: 300,
        estimatedLeads: "35-80",
        description: "Mayor volumen para ciudades con alta capacidad de atencion.",
    },
];

export function estimateLeadRange(adsBudget: number) {
    if (adsBudget <= 0) return "0-0";
    if (adsBudget <= 100) return "10-25";
    if (adsBudget <= 150) return "10-35";
    if (adsBudget <= 200) return "25-50";
    const min = Math.round(adsBudget * 0.115);
    const max = Math.round(adsBudget * 0.27);
    return `${min}-${max}`;
}
