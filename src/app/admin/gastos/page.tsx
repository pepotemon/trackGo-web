"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { weekRangeKeysMonToSun, addDays, money } from "@/lib/date";
import { listWeeklyExpenses, createWeeklyExpense, deleteWeeklyExpense } from "@/data/gastosRepo";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCan } from "@/features/auth/usePermissions";
import type { WeeklyExpenseDoc } from "@/types/accounting";
import {
    Button,
    Card,
    Field,
    Input,
    KpiCard,
    Modal,
    PageHeader,
} from "@/components/ui";

function shiftWeek(base: Date, offset: number) {
    return addDays(base, offset * 7);
}

function formatDate(ms: number) {
    if (!ms) return "-";
    return new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export default function GastosPage() {
    const { firebaseUser } = useAuth();
    const canView = useCan("gastosView");
    const canEdit = useCan("gastosEdit");

    const [weekOffset, setWeekOffset] = useState(0);
    const week = useMemo(() => weekRangeKeysMonToSun(shiftWeek(new Date(), weekOffset)), [weekOffset]);

    const [expenses, setExpenses] = useState<WeeklyExpenseDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const [addOpen, setAddOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [amount, setAmount] = useState("");

    const [deleteTarget, setDeleteTarget] = useState<WeeklyExpenseDoc | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!canView) return;
        let cancelled = false;
        setLoading(true);
        setErr(null);
        listWeeklyExpenses(week.startKey)
            .then((data) => { if (!cancelled) setExpenses(data); })
            .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "No se pudieron cargar los gastos."); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [week.startKey, canView, refreshNonce]);

    const total = useMemo(() => clamp2(expenses.reduce((acc, e) => acc + e.amount, 0)), [expenses]);

    function resetForm() {
        setName("");
        setDescription("");
        setAmount("");
    }

    async function handleAdd() {
        const parsedAmount = parseFloat(amount.replace(",", "."));
        if (!name.trim()) { setErr("El nombre es requerido."); return; }
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { setErr("Monto inválido."); return; }

        setSaving(true);
        setErr(null);
        try {
            const expense = await createWeeklyExpense({
                weekStartKey: week.startKey,
                name: name.trim(),
                description: description.trim() || null,
                amount: parsedAmount,
                createdBy: firebaseUser?.uid ?? null,
            });
            setExpenses((prev) => [...prev, expense]);
            setAddOpen(false);
            resetForm();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "No se pudo guardar el gasto.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!deleteTarget) return;
        setDeleting(true);
        setErr(null);
        try {
            await deleteWeeklyExpense(deleteTarget.id);
            setExpenses((prev) => prev.filter((e) => e.id !== deleteTarget.id));
            setDeleteTarget(null);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "No se pudo eliminar el gasto.");
        } finally {
            setDeleting(false);
        }
    }

    if (!canView) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fef2f2]">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                    </svg>
                </div>
                <p className="text-[16px] font-black text-[#101936]">Sin permisos</p>
                <p className="max-w-xs text-[13px] font-semibold text-[#66739A]">No tienes acceso a esta pantalla. Contacta al superadmin.</p>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-[860px]">
            <PageHeader
                title="Gastos Semanales"
                subtitle="Gastos de mantenimiento de plataforma que reducen la ganancia real."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            href="/admin/accounting"
                            className="flex h-9 items-center gap-1.5 rounded-xl border border-[#d9d2ff] bg-white px-3 text-[12px] font-bold text-[#4f46e5] shadow-sm transition hover:bg-[#f3f0ff]"
                        >
                            Ver Contabilidad
                        </Link>
                        {canEdit ? (
                            <Button
                                variant="primary"
                                onClick={() => { resetForm(); setErr(null); setAddOpen(true); }}
                            >
                                Agregar gasto
                            </Button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => setRefreshNonce((n) => n + 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e4e7ec] bg-white shadow-sm transition hover:bg-[#f9fafb]"
                            aria-label="Actualizar"
                        >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#667085]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                        </button>
                    </div>
                }
            />

            {/* Week selector */}
            <section className="mb-4 flex items-center gap-2 rounded-2xl border border-[#e4e7ec] bg-white px-3 py-3 shadow-sm">
                <button
                    type="button"
                    onClick={() => setWeekOffset((v) => v - 1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e4e7ec] bg-[#f9fafb] text-[#4f46e5] transition hover:bg-[#f3f0ff]"
                    aria-label="Semana anterior"
                >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>

                <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[12px] font-bold text-[#344054]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#7c3aed]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                    </svg>
                    <span>{week.startKey}</span>
                    <span className="text-[#98a2b3]">–</span>
                    <span>{week.endKey}</span>
                </div>

                <button
                    type="button"
                    onClick={() => setWeekOffset((v) => v + 1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e4e7ec] bg-[#f9fafb] text-[#4f46e5] transition hover:bg-[#f3f0ff]"
                    aria-label="Semana siguiente"
                >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>

                {weekOffset !== 0 ? (
                    <button
                        type="button"
                        onClick={() => setWeekOffset(0)}
                        className="shrink-0 rounded-lg border border-[#e4e7ec] bg-white px-3 py-1.5 text-[11px] font-bold text-[#344054] shadow-sm transition hover:bg-[#f9fafb]"
                    >
                        Actual
                    </button>
                ) : null}
            </section>

            {/* KPI */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <KpiCard label="Total gastos" value={money(total)} icon="wallet" tone="red" />
                <KpiCard label="Gastos registrados" value={String(expenses.length)} icon="activity" tone="purple" />
                <div className="col-span-2 sm:col-span-1 flex items-center justify-center rounded-2xl border border-[#e8e7fb] bg-gradient-to-br from-[#f3f0ff] to-[#e8e7fb] p-4 shadow-sm">
                    <div className="text-center">
                        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#7c3aed]">Semana</div>
                        <div className="mt-1 text-[13px] font-black text-[#172033]">{weekOffset === 0 ? "Actual" : weekOffset < 0 ? `Hace ${Math.abs(weekOffset)} sem.` : `+${weekOffset} sem.`}</div>
                    </div>
                </div>
            </div>

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            {/* Expense list */}
            <Card className="p-4">
                <div className="mb-3 flex items-center justify-between px-1">
                    <span className="text-[13px] font-black text-[#101936]">Gastos de la semana</span>
                    <span className="text-[12px] font-semibold text-[#667085]">{expenses.length} registro{expenses.length !== 1 ? "s" : ""}</span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <svg className="h-6 w-6 animate-spin text-[#7c3aed]" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                    </div>
                ) : expenses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                            <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#7c3aed]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
                            </svg>
                        </div>
                        <p className="text-[13px] font-bold text-[#344054]">Sin gastos esta semana</p>
                        <p className="text-[12px] font-medium text-[#98a2b3]">
                            {canEdit ? 'Presiona "Agregar gasto" para registrar un gasto.' : "No hay gastos registrados para esta semana."}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {expenses.map((expense) => (
                            <div
                                key={expense.id}
                                className="flex items-center gap-3 rounded-xl border border-[#e8e7fb] bg-[#fafafe] px-3 py-3"
                            >
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f3f0ff]">
                                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7c3aed]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
                                    </svg>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-bold text-[#172033]">{expense.name}</div>
                                    {expense.description ? (
                                        <div className="truncate text-[11px] font-medium text-[#667085]">{expense.description}</div>
                                    ) : null}
                                    <div className="text-[10px] font-medium text-[#98a2b3]">{formatDate(expense.createdAt)}</div>
                                </div>
                                <div className="shrink-0 text-[14px] font-black text-[#172033]">{money(expense.amount)}</div>
                                {canEdit ? (
                                    <button
                                        type="button"
                                        onClick={() => { setErr(null); setDeleteTarget(expense); }}
                                        className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-500 transition hover:bg-red-100"
                                        aria-label="Eliminar gasto"
                                    >
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                        </svg>
                                    </button>
                                ) : null}
                            </div>
                        ))}
                        <div className="flex items-center justify-between rounded-xl border border-[#d9d2ff] bg-[#f3f0ff] px-4 py-3">
                            <span className="text-[13px] font-black text-[#4f46e5]">Total gastos</span>
                            <span className="text-[15px] font-black text-[#4f46e5]">{money(total)}</span>
                        </div>
                    </div>
                )}
            </Card>

            {/* Add expense modal */}
            <Modal
                open={addOpen}
                onClose={() => { setAddOpen(false); setErr(null); }}
                title="Agregar gasto"
                subtitle={`Semana ${week.startKey} a ${week.endKey}`}
            >
                <div className="space-y-4">
                    <Field label="Nombre *">
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej: Servidor AWS"
                        />
                    </Field>
                    <Field label="Descripción (opcional)">
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Detalle adicional..."
                        />
                    </Field>
                    <Field label="Monto *">
                        <Input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                        />
                    </Field>

                    {err ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                            {err}
                        </div>
                    ) : null}

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <Button variant="ghost" onClick={() => { setAddOpen(false); setErr(null); }} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button variant="primary" onClick={handleAdd} disabled={saving}>
                            {saving ? "Guardando..." : "Guardar gasto"}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Delete confirm modal */}
            <Modal
                open={Boolean(deleteTarget)}
                onClose={() => { setDeleteTarget(null); setErr(null); }}
                title="Eliminar gasto"
            >
                <div className="space-y-4">
                    <p className="text-[13px] font-semibold text-[#344054]">
                        ¿Confirmas que deseas eliminar <span className="font-black text-[#172033]">{deleteTarget?.name}</span>?
                    </p>
                    <p className="text-[12px] font-medium text-[#667085]">
                        Monto: <span className="font-black text-[#172033]">{money(deleteTarget?.amount ?? 0)}</span>
                    </p>

                    {err ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                            {err}
                        </div>
                    ) : null}

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <Button variant="ghost" onClick={() => { setDeleteTarget(null); setErr(null); }} disabled={deleting}>
                            Cancelar
                        </Button>
                        <Button variant="danger" onClick={handleDelete} disabled={deleting}>
                            {deleting ? "Eliminando..." : "Eliminar"}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
