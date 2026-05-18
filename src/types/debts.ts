export type DebtCurrency = "BRL" | "USD" | "EUR";

export type DebtStatus = "active" | "paid" | "late" | "cancelled";

export type DebtPaymentFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export type DebtPaymentMethod = "cash" | "pix" | "transfer" | "card" | "other";

export type DebtDoc = {
    id: string;
    clientId?: string | null;
    clientName: string;
    phone?: string | null;
    businessName?: string | null;
    originalAmount: number;
    remainingAmount: number;
    totalPaid: number;
    interestAmount?: number | null;
    finalAmount?: number | null;
    currency: DebtCurrency;
    status: DebtStatus;
    paymentFrequency: DebtPaymentFrequency;
    installmentAmount?: number | null;
    startDate: number;
    dueDate?: number | null;
    notes?: string | null;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
    deleted?: boolean;
};

export type DebtPaymentDoc = {
    id: string;
    debtId: string;
    amount: number;
    paymentDate: number;
    method: DebtPaymentMethod;
    notes?: string | null;
    createdAt: number;
    createdBy: string;
};

export type DebtDraft = {
    clientName: string;
    phone: string;
    businessName: string;
    originalAmount: number | "";
    interestAmount: number | "";
    currency: DebtCurrency;
    paymentFrequency: DebtPaymentFrequency;
    installmentAmount: number | "";
    startDate: string;
    dueDate: string;
    notes: string;
};

export type DebtPaymentDraft = {
    amount: number | "";
    method: DebtPaymentMethod;
    paymentDate: string;
    notes: string;
};
