import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    orderBy,
    query,
    setDoc,
    where,
    limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WeeklyExpenseDoc } from "@/types/accounting";

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp2(value: number) {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeExpense(id: string, data: Record<string, unknown>): WeeklyExpenseDoc {
    return {
        id,
        weekStartKey: text(data.weekStartKey),
        name: text(data.name) || "Gasto",
        description: typeof data.description === "string" ? data.description.trim() || null : null,
        amount: clamp2(safeNumber(data.amount, 0)),
        createdAt: safeNumber(data.createdAt, 0),
        createdBy: typeof data.createdBy === "string" ? data.createdBy : null,
    };
}

export async function listWeeklyExpenses(weekStartKey: string): Promise<WeeklyExpenseDoc[]> {
    const q = query(
        collection(db, "weeklyExpenses"),
        where("weekStartKey", "==", weekStartKey),
        orderBy("createdAt", "asc"),
        limit(500)
    );

    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeExpense(d.id, record(d.data())));
}

export async function createWeeklyExpense(input: {
    weekStartKey: string;
    name: string;
    description?: string | null;
    amount: number;
    createdBy?: string | null;
}): Promise<WeeklyExpenseDoc> {
    const now = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const id = `expense_${now}_${randomSuffix}`;
    const ref = doc(db, "weeklyExpenses", id);

    const payload: Omit<WeeklyExpenseDoc, "id"> = {
        weekStartKey: input.weekStartKey,
        name: String(input.name || "Gasto").trim() || "Gasto",
        description: typeof input.description === "string" ? input.description.trim() || null : null,
        amount: clamp2(safeNumber(input.amount, 0)),
        createdAt: now,
        createdBy: input.createdBy ?? null,
    };

    await setDoc(ref, payload);

    return { id, ...payload };
}

export async function deleteWeeklyExpense(id: string): Promise<void> {
    const cleanId = String(id || "").trim();
    if (!cleanId) throw new Error("ID de gasto inválido.");
    await deleteDoc(doc(db, "weeklyExpenses", cleanId));
}
