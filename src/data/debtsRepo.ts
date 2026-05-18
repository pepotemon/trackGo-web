import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    runTransaction,
    setDoc,
    where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DebtCurrency, DebtDoc, DebtDraft, DebtPaymentDoc, DebtPaymentDraft, DebtPaymentFrequency, DebtPaymentMethod, DebtStatus } from "@/types/debts";

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function dateToMs(value: string) {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : null;
}

function msToDateInput(ms?: number | null) {
    if (!ms) return "";
    const date = new Date(ms);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function clampMoney(value: unknown) {
    const n = safeNumber(value, 0);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}

function normalizeStatus(value: unknown): DebtStatus {
    return value === "paid" || value === "late" || value === "cancelled" ? value : "active";
}

function normalizeCurrency(value: unknown): DebtCurrency {
    return value === "USD" || value === "EUR" ? value : "BRL";
}

function normalizeFrequency(value: unknown): DebtPaymentFrequency {
    return value === "daily" || value === "biweekly" || value === "monthly" ? value : "weekly";
}

function normalizeMethod(value: unknown): DebtPaymentMethod {
    return value === "pix" || value === "transfer" || value === "card" || value === "other" ? value : "cash";
}

function normalizeDebt(id: string, data: Record<string, unknown>): DebtDoc {
    const remainingAmount = clampMoney(data.remainingAmount);
    const dueDate = data.dueDate == null ? null : safeNumber(data.dueDate, 0);
    const status = normalizeStatus(data.status);
    const late = status === "active" && dueDate !== null && dueDate > 0 && dueDate < startOfToday();

    return {
        id,
        clientId: text(data.clientId) || null,
        clientName: text(data.clientName) || "Cliente",
        phone: text(data.phone) || null,
        businessName: text(data.businessName) || null,
        originalAmount: clampMoney(data.originalAmount),
        remainingAmount,
        totalPaid: clampMoney(data.totalPaid),
        interestAmount: data.interestAmount == null ? null : clampMoney(data.interestAmount),
        finalAmount: data.finalAmount == null ? null : clampMoney(data.finalAmount),
        currency: normalizeCurrency(data.currency),
        status: late ? "late" : status,
        paymentFrequency: normalizeFrequency(data.paymentFrequency),
        installmentAmount: data.installmentAmount == null ? null : clampMoney(data.installmentAmount),
        startDate: safeNumber(data.startDate, Date.now()),
        dueDate,
        notes: text(data.notes) || null,
        createdAt: safeNumber(data.createdAt, 0),
        updatedAt: safeNumber(data.updatedAt, 0),
        createdBy: text(data.createdBy),
        deleted: data.deleted === true,
    };
}

function normalizePayment(id: string, debtId: string, data: Record<string, unknown>): DebtPaymentDoc {
    return {
        id,
        debtId,
        amount: clampMoney(data.amount),
        paymentDate: safeNumber(data.paymentDate, Date.now()),
        method: normalizeMethod(data.method),
        notes: text(data.notes) || null,
        createdAt: safeNumber(data.createdAt, 0),
        createdBy: text(data.createdBy),
    };
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

export function todayInputValue() {
    return msToDateInput(Date.now());
}

export function debtToDraft(debt?: DebtDoc | null): DebtDraft {
    return {
        clientName: debt?.clientName ?? "",
        phone: debt?.phone ?? "",
        businessName: debt?.businessName ?? "",
        originalAmount: debt?.originalAmount ?? 0,
        interestAmount: debt?.interestAmount ?? 0,
        currency: debt?.currency ?? "BRL",
        paymentFrequency: debt?.paymentFrequency ?? "weekly",
        installmentAmount: debt?.installmentAmount ?? 0,
        startDate: msToDateInput(debt?.startDate) || todayInputValue(),
        dueDate: msToDateInput(debt?.dueDate),
        notes: debt?.notes ?? "",
    };
}

export async function listDebts(ownerId: string): Promise<DebtDoc[]> {
    const q = query(
        collection(db, "debts"),
        where("createdBy", "==", ownerId),
        limit(500),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map((item) => normalizeDebt(item.id, record(item.data())))
        .filter((item) => item.deleted !== true)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listDebtPayments(debtId: string, ownerId: string): Promise<DebtPaymentDoc[]> {
    const debtRef = doc(db, "debts", debtId);
    const debtSnap = await getDoc(debtRef);
    const debt = debtSnap.exists() ? normalizeDebt(debtSnap.id, record(debtSnap.data())) : null;
    if (!debt || debt.createdBy !== ownerId) throw new Error("No tienes acceso a esta deuda.");

    const snap = await getDocs(collection(db, "debts", debtId, "payments"));
    return snap.docs
        .map((item) => normalizePayment(item.id, debtId, record(item.data())))
        .sort((a, b) => b.paymentDate - a.paymentDate || b.createdAt - a.createdAt);
}

export async function saveDebt(ownerId: string, draft: DebtDraft, debtId?: string) {
    const clientName = draft.clientName.trim();
    const originalAmount = clampMoney(draft.originalAmount);
    const interestAmount = clampMoney(draft.interestAmount);
    const finalAmount = clampMoney(originalAmount + interestAmount);
    const startDate = dateToMs(draft.startDate) ?? Date.now();
    const dueDate = dateToMs(draft.dueDate);
    const now = Date.now();

    if (!clientName) throw new Error("El nombre del cliente es obligatorio.");
    if (originalAmount <= 0) throw new Error("El monto prestado debe ser mayor a cero.");

    const ref = debtId ? doc(db, "debts", debtId) : doc(collection(db, "debts"));
    const existing = debtId ? await getDoc(ref) : null;
    if (existing?.exists() && normalizeDebt(existing.id, record(existing.data())).createdBy !== ownerId) {
        throw new Error("No tienes acceso a esta deuda.");
    }

    const current = existing?.exists() ? normalizeDebt(existing.id, record(existing.data())) : null;
    const totalPaid = current?.totalPaid ?? 0;
    const remainingAmount = Math.max(0, Math.round((finalAmount - totalPaid) * 100) / 100);

    await setDoc(
        ref,
        {
            id: ref.id,
            clientName,
            phone: draft.phone.trim() || null,
            businessName: draft.businessName.trim() || null,
            originalAmount,
            interestAmount,
            finalAmount,
            remainingAmount,
            totalPaid,
            currency: draft.currency,
            status: remainingAmount <= 0 ? "paid" : current?.status === "cancelled" ? "cancelled" : "active",
            paymentFrequency: draft.paymentFrequency,
            installmentAmount: clampMoney(draft.installmentAmount) || null,
            startDate,
            dueDate,
            notes: draft.notes.trim() || null,
            createdBy: ownerId,
            deleted: false,
            createdAt: current?.createdAt || now,
            updatedAt: now,
        },
        { merge: true },
    );

    return ref.id;
}

export async function registerDebtPayment(ownerId: string, debtId: string, draft: DebtPaymentDraft) {
    const amount = clampMoney(draft.amount);
    if (amount <= 0) throw new Error("El abono debe ser mayor a cero.");

    const debtRef = doc(db, "debts", debtId);
    const paymentRef = doc(collection(db, "debts", debtId, "payments"));
    const now = Date.now();
    const paymentDate = dateToMs(draft.paymentDate) ?? now;

    await runTransaction(db, async (tx) => {
        const debtSnap = await tx.get(debtRef);
        if (!debtSnap.exists()) throw new Error("La deuda no existe.");
        const debt = normalizeDebt(debtSnap.id, record(debtSnap.data()));
        if (debt.createdBy !== ownerId) throw new Error("No tienes acceso a esta deuda.");
        if (debt.status === "cancelled") throw new Error("No puedes abonar una deuda cancelada.");
        if (amount > debt.remainingAmount + 0.01) throw new Error("El abono no puede ser mayor al saldo pendiente.");

        const totalPaid = clampMoney(debt.totalPaid + amount);
        const remainingAmount = clampMoney(Math.max(0, debt.remainingAmount - amount));

        tx.set(paymentRef, {
            id: paymentRef.id,
            debtId,
            amount,
            paymentDate,
            method: draft.method,
            notes: draft.notes.trim() || null,
            createdAt: now,
            createdBy: ownerId,
        });

        tx.update(debtRef, {
            totalPaid,
            remainingAmount,
            status: remainingAmount <= 0 ? "paid" : "active",
            updatedAt: now,
        });
    });
}

export async function deleteDebtPayment(ownerId: string, debtId: string, paymentId: string) {
    const debtRef = doc(db, "debts", debtId);
    const paymentRef = doc(db, "debts", debtId, "payments", paymentId);
    const now = Date.now();

    await runTransaction(db, async (tx) => {
        const [debtSnap, paymentSnap] = await Promise.all([tx.get(debtRef), tx.get(paymentRef)]);
        if (!debtSnap.exists()) throw new Error("La deuda no existe.");
        if (!paymentSnap.exists()) throw new Error("El abono no existe.");
        const debt = normalizeDebt(debtSnap.id, record(debtSnap.data()));
        const payment = normalizePayment(paymentSnap.id, debtId, record(paymentSnap.data()));
        if (debt.createdBy !== ownerId || payment.createdBy !== ownerId) throw new Error("No tienes acceso a este abono.");

        const totalPaid = clampMoney(Math.max(0, debt.totalPaid - payment.amount));
        const remainingAmount = clampMoney(debt.remainingAmount + payment.amount);

        tx.update(debtRef, {
            totalPaid,
            remainingAmount,
            status: remainingAmount <= 0 ? "paid" : "active",
            updatedAt: now,
        });
        tx.delete(paymentRef);
    });
}

export async function updateDebtStatus(ownerId: string, debtId: string, status: DebtStatus) {
    const ref = doc(db, "debts", debtId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("La deuda no existe.");
    const debt = normalizeDebt(snap.id, record(snap.data()));
    if (debt.createdBy !== ownerId) throw new Error("No tienes acceso a esta deuda.");
    await setDoc(ref, { status, updatedAt: Date.now() }, { merge: true });
}

export async function deleteDebt(ownerId: string, debtId: string) {
    const ref = doc(db, "debts", debtId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const debt = normalizeDebt(snap.id, record(snap.data()));
    if (debt.createdBy !== ownerId) throw new Error("No tienes acceso a esta deuda.");
    await setDoc(ref, { deleted: true, updatedAt: Date.now(), status: "cancelled" }, { merge: true });
}

export async function hardDeleteEmptyDebt(ownerId: string, debtId: string) {
    const ref = doc(db, "debts", debtId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const debt = normalizeDebt(snap.id, record(snap.data()));
    if (debt.createdBy !== ownerId) throw new Error("No tienes acceso a esta deuda.");
    if (debt.totalPaid > 0) throw new Error("Esta deuda ya tiene abonos. Se cancelara en lugar de borrarse.");
    await deleteDoc(ref);
}
