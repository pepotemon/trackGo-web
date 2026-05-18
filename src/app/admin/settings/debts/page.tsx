"use client";

import { useEffect, useMemo, useState } from "react";
import { AppIcon, Badge, Button, Card, CardContent, CardHeader, Field, Input, KpiCard, Modal, PageHeader } from "@/components/ui";
import {
    debtToDraft,
    deleteDebt,
    deleteDebtPayment,
    listDebtPayments,
    listDebts,
    registerDebtPayment,
    saveDebt,
    todayInputValue,
    updateDebtStatus,
} from "@/data/debtsRepo";
import { useAuth } from "@/features/auth/AuthProvider";
import type { DebtCurrency, DebtDoc, DebtDraft, DebtPaymentDoc, DebtPaymentDraft, DebtPaymentMethod, DebtStatus } from "@/types/debts";

type DebtFilter = "all" | DebtStatus;
type DebtSort = "recent" | "balance" | "late";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const moneyUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const moneyEur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const dateFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" });

const emptyDraft: DebtDraft = {
    clientName: "",
    phone: "",
    businessName: "",
    originalAmount: 0,
    interestAmount: 0,
    currency: "BRL",
    paymentFrequency: "weekly",
    installmentAmount: 0,
    startDate: todayInputValue(),
    dueDate: "",
    notes: "",
};

const emptyPaymentDraft: DebtPaymentDraft = {
    amount: 0,
    method: "cash",
    paymentDate: todayInputValue(),
    notes: "",
};

export default function AdminDebtsPage() {
    const { firebaseUser } = useAuth();
    const ownerId = firebaseUser?.uid ?? "";
    const [debts, setDebts] = useState<DebtDoc[]>([]);
    const [payments, setPayments] = useState<DebtPaymentDoc[]>([]);
    const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<DebtFilter>("all");
    const [sort, setSort] = useState<DebtSort>("recent");
    const [debtModalOpen, setDebtModalOpen] = useState(false);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [editingDebt, setEditingDebt] = useState<DebtDoc | null>(null);
    const [debtDraft, setDebtDraft] = useState<DebtDraft>(emptyDraft);
    const [paymentDraft, setPaymentDraft] = useState<DebtPaymentDraft>(emptyPaymentDraft);
    const [saving, setSaving] = useState(false);

    const selectedDebt = useMemo(
        () => debts.find((item) => item.id === selectedDebtId) ?? null,
        [debts, selectedDebtId],
    );

    const stats = useMemo(() => buildStats(debts, payments), [debts, payments]);

    const visibleDebts = useMemo(() => {
        const needle = normalize(query);
        const filtered = debts.filter((debt) => {
            const matchesFilter = filter === "all" || debt.status === filter;
            const hay = normalize(`${debt.clientName} ${debt.businessName ?? ""} ${debt.phone ?? ""}`);
            return matchesFilter && (!needle || hay.includes(needle));
        });
        return filtered.sort((a, b) => {
            if (sort === "balance") return b.remainingAmount - a.remainingAmount;
            if (sort === "late") return (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER);
            return b.updatedAt - a.updatedAt;
        });
    }, [debts, query, filter, sort]);

    async function load() {
        if (!ownerId) return;
        setLoading(true);
        setError("");
        try {
            const items = await listDebts(ownerId);
            setDebts(items);
            if (!selectedDebtId && items.length) setSelectedDebtId(items[0].id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo cargar cartera.");
        } finally {
            setLoading(false);
        }
    }

    async function loadPayments(debtId: string | null) {
        if (!ownerId || !debtId) {
            setPayments([]);
            return;
        }
        setPaymentsLoading(true);
        try {
            setPayments(await listDebtPayments(debtId, ownerId));
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudieron cargar abonos.");
        } finally {
            setPaymentsLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, [ownerId]);

    useEffect(() => {
        void loadPayments(selectedDebtId);
    }, [ownerId, selectedDebtId]);

    function openCreate() {
        setEditingDebt(null);
        setDebtDraft(emptyDraft);
        setDebtModalOpen(true);
    }

    function openEdit(debt: DebtDoc) {
        setEditingDebt(debt);
        setDebtDraft(debtToDraft(debt));
        setDebtModalOpen(true);
    }

    async function handleSaveDebt() {
        if (!ownerId) return;
        setSaving(true);
        setError("");
        try {
            const id = await saveDebt(ownerId, debtDraft, editingDebt?.id);
            setDebtModalOpen(false);
            setSelectedDebtId(id);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo guardar la deuda.");
        } finally {
            setSaving(false);
        }
    }

    async function handleRegisterPayment() {
        if (!ownerId || !selectedDebt) return;
        setSaving(true);
        setError("");
        try {
            await registerDebtPayment(ownerId, selectedDebt.id, paymentDraft);
            setPaymentModalOpen(false);
            setPaymentDraft(emptyPaymentDraft);
            await Promise.all([load(), loadPayments(selectedDebt.id)]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo registrar el abono.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDeletePayment(payment: DebtPaymentDoc) {
        if (!ownerId || !selectedDebt) return;
        if (!window.confirm("Eliminar este abono y devolver el saldo a la deuda?")) return;
        setSaving(true);
        setError("");
        try {
            await deleteDebtPayment(ownerId, selectedDebt.id, payment.id);
            await Promise.all([load(), loadPayments(selectedDebt.id)]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo eliminar el abono.");
        } finally {
            setSaving(false);
        }
    }

    async function handleCancelDebt(debt: DebtDoc) {
        if (!ownerId) return;
        if (!window.confirm(`Cancelar la deuda de ${debt.clientName}?`)) return;
        setSaving(true);
        setError("");
        try {
            await updateDebtStatus(ownerId, debt.id, debt.status === "cancelled" ? "active" : "cancelled");
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteDebt(debt: DebtDoc) {
        if (!ownerId) return;
        if (!window.confirm(`Eliminar de tu cartera la deuda de ${debt.clientName}?`)) return;
        setSaving(true);
        setError("");
        try {
            await deleteDebt(ownerId, debt.id);
            setSelectedDebtId((current) => current === debt.id ? null : current);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo eliminar la deuda.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 pb-4">
            <PageHeader
                icon={<AppIcon name="wallet" plain className="h-5 w-5 text-current" />}
                title="Cartera de Cobros"
                subtitle="Control privado de deudas, abonos y saldos por administrador."
                actions={
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={load} disabled={loading}>
                            <AppIcon name="refresh" plain className="h-4 w-4 text-current" />
                            Actualizar
                        </Button>
                        <Button variant="primary" onClick={openCreate}>
                            <AppIcon name="plus" plain className="h-4 w-4 text-current" />
                            Nueva deuda
                        </Button>
                    </div>
                }
            />

            {error ? <Notice tone="red">{error}</Notice> : null}

            <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                <KpiCard label="Prestado" value={formatMoney(stats.original, stats.currency)} caption="Capital registrado" icon="wallet" tone="blue" />
                <KpiCard label="Recuperado" value={formatMoney(stats.paid, stats.currency)} caption="Abonos recibidos" icon="check" tone="green" />
                <KpiCard label="Pendiente" value={formatMoney(stats.remaining, stats.currency)} caption="Saldo por cobrar" icon="clock" tone="orange" />
                <KpiCard label="Intereses" value={formatMoney(stats.interest, stats.currency)} caption="Ganancia estimada" icon="activity" tone="purple" />
                <KpiCard label="Activas" value={stats.active} caption={`${stats.late} vencidas`} icon="alert" tone={stats.late ? "red" : "green"} />
                <KpiCard label="Pagadas" value={stats.paidCount} caption="Cerradas correctamente" icon="check" tone="green" />
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.96fr_1.04fr]">
                <Card>
                    <CardHeader
                        title="Deudas"
                        subtitle="Busca, filtra y abre una deuda para gestionar abonos."
                        action={<Badge tone="purple">{visibleDebts.length}</Badge>}
                    />
                    <CardContent className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-[1fr_150px_150px]">
                            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, negocio o telefono" />
                            <select value={filter} onChange={(e) => setFilter(e.target.value as DebtFilter)} className={selectClass}>
                                <option value="all">Todas</option>
                                <option value="active">Activas</option>
                                <option value="late">Vencidas</option>
                                <option value="paid">Pagadas</option>
                                <option value="cancelled">Canceladas</option>
                            </select>
                            <select value={sort} onChange={(e) => setSort(e.target.value as DebtSort)} className={selectClass}>
                                <option value="recent">Recientes</option>
                                <option value="balance">Mayor deuda</option>
                                <option value="late">Mas atrasadas</option>
                            </select>
                        </div>

                        {loading ? <EmptyState text="Cargando cartera..." /> : null}
                        {!loading && visibleDebts.length === 0 ? <EmptyState text="Aun no hay deudas en esta vista." /> : null}

                        <div className="grid gap-2">
                            {visibleDebts.map((debt) => (
                                <DebtCard
                                    key={debt.id}
                                    debt={debt}
                                    selected={debt.id === selectedDebtId}
                                    onClick={() => setSelectedDebtId(debt.id)}
                                    onEdit={() => openEdit(debt)}
                                />
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader
                        title={selectedDebt ? selectedDebt.clientName : "Detalle"}
                        subtitle={selectedDebt ? selectedDebt.businessName || selectedDebt.phone || "Deuda seleccionada" : "Selecciona una deuda para ver historial."}
                        action={selectedDebt ? <StatusBadge status={selectedDebt.status} /> : null}
                    />
                    <CardContent>
                        {selectedDebt ? (
                            <div className="space-y-4">
                                <DebtDetail debt={selectedDebt} />
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="primary" disabled={selectedDebt.status === "cancelled" || selectedDebt.remainingAmount <= 0} onClick={() => setPaymentModalOpen(true)}>
                                        <AppIcon name="plus" plain className="h-4 w-4 text-current" />
                                        Registrar abono
                                    </Button>
                                    <Button variant="secondary" onClick={() => openEdit(selectedDebt)}>
                                        <AppIcon name="edit" plain className="h-4 w-4 text-current" />
                                        Editar
                                    </Button>
                                    <Button variant="secondary" onClick={() => handleCancelDebt(selectedDebt)} disabled={saving || selectedDebt.status === "paid"}>
                                        {selectedDebt.status === "cancelled" ? "Reactivar" : "Cancelar"}
                                    </Button>
                                    <Button variant="danger" onClick={() => handleDeleteDebt(selectedDebt)} disabled={saving}>
                                        <AppIcon name="trash" plain className="h-4 w-4 text-current" />
                                        Eliminar
                                    </Button>
                                </div>
                                <PaymentSummary payments={payments} currency={selectedDebt.currency} />
                                <PaymentHistory
                                    payments={payments}
                                    currency={selectedDebt.currency}
                                    loading={paymentsLoading}
                                    onDelete={handleDeletePayment}
                                />
                            </div>
                        ) : (
                            <EmptyState text="Selecciona o crea una deuda para empezar." />
                        )}
                    </CardContent>
                </Card>
            </section>

            <DebtFormModal
                open={debtModalOpen}
                draft={debtDraft}
                editing={Boolean(editingDebt)}
                saving={saving}
                onChange={setDebtDraft}
                onSave={handleSaveDebt}
                onClose={() => setDebtModalOpen(false)}
            />

            <PaymentFormModal
                open={paymentModalOpen}
                debt={selectedDebt}
                draft={paymentDraft}
                saving={saving}
                onChange={setPaymentDraft}
                onSave={handleRegisterPayment}
                onClose={() => setPaymentModalOpen(false)}
            />
        </main>
    );
}

const selectClass = "h-10 w-full rounded-[14px] border border-[#e4e7ec] bg-white px-3 text-[12px] font-bold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100 sm:h-9 sm:rounded-md";

function DebtCard({ debt, selected, onClick, onEdit }: { debt: DebtDoc; selected: boolean; onClick: () => void; onEdit: () => void }) {
    const progress = debt.finalAmount && debt.finalAmount > 0 ? Math.min(100, Math.round((debt.totalPaid / debt.finalAmount) * 100)) : 0;
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full rounded-2xl border bg-white p-3 text-left transition active:scale-[0.99] ${selected ? "border-[#7c3aed] shadow-[0_12px_28px_rgba(124,58,237,0.14)]" : "border-[#eef1f5] hover:border-[#ded8ff]"}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[14px] font-black text-[#101936]">{debt.clientName}</p>
                        <StatusBadge status={debt.status} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739a]">
                        {[debt.businessName, debt.phone].filter(Boolean).join(" · ") || "Sin negocio registrado"}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onEdit();
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#e8e7fb] bg-[#f8f7ff]"
                >
                    <AppIcon name="edit" plain className="h-4 w-4 text-[#66739a]" />
                </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniValue label="Prestado" value={formatMoney(debt.finalAmount || debt.originalAmount, debt.currency)} />
                <MiniValue label="Pagado" value={formatMoney(debt.totalPaid, debt.currency)} tone="green" />
                <MiniValue label="Saldo" value={formatMoney(debt.remainingAmount, debt.currency)} tone={debt.remainingAmount > 0 ? "orange" : "green"} />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eef1f5]">
                <div className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-[#7c3aed]" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-[#98a2b3]">
                <span>{progress}% recuperado</span>
                <span>{debt.dueDate ? `Vence ${formatDate(debt.dueDate)}` : "Sin vencimiento"}</span>
            </div>
        </button>
    );
}

function DebtDetail({ debt }: { debt: DebtDoc }) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <DetailTile label="Monto final" value={formatMoney(debt.finalAmount || debt.originalAmount, debt.currency)} />
            <DetailTile label="Saldo pendiente" value={formatMoney(debt.remainingAmount, debt.currency)} tone={debt.remainingAmount > 0 ? "orange" : "green"} />
            <DetailTile label="Interes" value={formatMoney(debt.interestAmount || 0, debt.currency)} />
            <DetailTile label="Cuota estimada" value={debt.installmentAmount ? formatMoney(debt.installmentAmount, debt.currency) : "Sin definir"} />
            <DetailTile label="Frecuencia" value={frequencyLabel(debt.paymentFrequency)} />
            <DetailTile label="Vencimiento" value={debt.dueDate ? formatDate(debt.dueDate) : "Sin fecha"} />
            {debt.notes ? (
                <div className="rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3 sm:col-span-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#8a7ac8]">Notas</p>
                    <p className="mt-1 text-[12px] font-semibold leading-relaxed text-[#344054]">{debt.notes}</p>
                </div>
            ) : null}
        </div>
    );
}

function PaymentSummary({ payments, currency }: { payments: DebtPaymentDoc[]; currency: DebtCurrency }) {
    const now = new Date();
    const todayKey = dayKey(now.getTime());
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const today = payments.filter((item) => dayKey(item.paymentDate) === todayKey).reduce((sum, item) => sum + item.amount, 0);
    const week = payments.filter((item) => item.paymentDate >= weekStart.getTime()).reduce((sum, item) => sum + item.amount, 0);
    const month = payments.filter((item) => item.paymentDate >= monthStart).reduce((sum, item) => sum + item.amount, 0);

    return (
        <div className="grid grid-cols-3 gap-2">
            <MiniValue label="Hoy" value={formatMoney(today, currency)} tone="green" />
            <MiniValue label="Semana" value={formatMoney(week, currency)} tone="green" />
            <MiniValue label="Mes" value={formatMoney(month, currency)} tone="green" />
        </div>
    );
}

function PaymentHistory({ payments, currency, loading, onDelete }: { payments: DebtPaymentDoc[]; currency: DebtCurrency; loading: boolean; onDelete: (payment: DebtPaymentDoc) => void }) {
    return (
        <div className="rounded-2xl border border-[#eef1f5] bg-white">
            <div className="flex items-center justify-between border-b border-[#eef1f5] px-3 py-3">
                <div>
                    <p className="text-[13px] font-black text-[#101936]">Historial de abonos</p>
                    <p className="text-[11px] font-semibold text-[#66739a]">Movimientos cronologicos de esta deuda.</p>
                </div>
                <Badge tone="blue">{payments.length}</Badge>
            </div>
            <div className="divide-y divide-[#f0f2f5]">
                {loading ? <EmptyState text="Cargando abonos..." compact /> : null}
                {!loading && payments.length === 0 ? <EmptyState text="Sin abonos registrados." compact /> : null}
                {payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-3 px-3 py-3">
                        <div className="min-w-0">
                            <p className="text-[13px] font-black text-[#101936]">{formatMoney(payment.amount, currency)}</p>
                            <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739a]">
                                {formatDate(payment.paymentDate)} · {methodLabel(payment.method)}
                                {payment.notes ? ` · ${payment.notes}` : ""}
                            </p>
                        </div>
                        <button type="button" onClick={() => onDelete(payment)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                            <AppIcon name="trash" plain className="h-4 w-4 text-current" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DebtFormModal({ open, draft, editing, saving, onChange, onSave, onClose }: {
    open: boolean;
    draft: DebtDraft;
    editing: boolean;
    saving: boolean;
    onChange: (draft: DebtDraft) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    const finalAmount = Math.max(0, Number(draft.originalAmount || 0) + Number(draft.interestAmount || 0));
    return (
        <Modal open={open} title={editing ? "Editar deuda" : "Nueva deuda"} subtitle="Registra capital, interes y condiciones de cobro." size="md" onClose={onClose}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cliente"><Input value={draft.clientName} onChange={(e) => onChange({ ...draft, clientName: e.target.value })} /></Field>
                <Field label="Telefono"><Input value={draft.phone} onChange={(e) => onChange({ ...draft, phone: e.target.value })} /></Field>
                <Field label="Negocio"><Input value={draft.businessName} onChange={(e) => onChange({ ...draft, businessName: e.target.value })} /></Field>
                <Field label="Moneda">
                    <select className={selectClass} value={draft.currency} onChange={(e) => onChange({ ...draft, currency: e.target.value as DebtCurrency })}>
                        <option value="BRL">BRL</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                    </select>
                </Field>
                <Field label="Monto prestado"><Input type="number" min={0} value={draft.originalAmount} onChange={(e) => onChange({ ...draft, originalAmount: parseInputMoney(e.target.value) })} /></Field>
                <Field label="Interes opcional"><Input type="number" min={0} value={draft.interestAmount} onChange={(e) => onChange({ ...draft, interestAmount: parseInputMoney(e.target.value) })} /></Field>
                <Field label="Frecuencia">
                    <select className={selectClass} value={draft.paymentFrequency} onChange={(e) => onChange({ ...draft, paymentFrequency: e.target.value as DebtDraft["paymentFrequency"] })}>
                        <option value="daily">Diaria</option>
                        <option value="weekly">Semanal</option>
                        <option value="biweekly">Quincenal</option>
                        <option value="monthly">Mensual</option>
                    </select>
                </Field>
                <Field label="Cuota estimada"><Input type="number" min={0} value={draft.installmentAmount} onChange={(e) => onChange({ ...draft, installmentAmount: parseInputMoney(e.target.value) })} /></Field>
                <Field label="Inicio"><Input type="date" value={draft.startDate} onChange={(e) => onChange({ ...draft, startDate: e.target.value })} /></Field>
                <Field label="Vencimiento"><Input type="date" value={draft.dueDate} onChange={(e) => onChange({ ...draft, dueDate: e.target.value })} /></Field>
                <div className="rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-3 sm:col-span-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#8a7ac8]">Monto final</p>
                    <p className="mt-1 text-[22px] font-black text-[#6d28d9]">{formatMoney(finalAmount, draft.currency)}</p>
                </div>
                <div className="sm:col-span-2">
                    <Field label="Notas">
                        <textarea value={draft.notes} onChange={(e) => onChange({ ...draft, notes: e.target.value })} className="min-h-24 w-full rounded-[14px] border border-[#e4e7ec] bg-white px-3 py-2 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100" />
                    </Field>
                </div>
                <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-3 sm:col-span-2">
                    <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button variant="primary" disabled={saving} onClick={onSave}>{saving ? "Guardando..." : "Guardar deuda"}</Button>
                </div>
            </div>
        </Modal>
    );
}

function PaymentFormModal({ open, debt, draft, saving, onChange, onSave, onClose }: {
    open: boolean;
    debt: DebtDoc | null;
    draft: DebtPaymentDraft;
    saving: boolean;
    onChange: (draft: DebtPaymentDraft) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        <Modal open={open} title="Registrar abono" subtitle={debt ? `${debt.clientName} · saldo ${formatMoney(debt.remainingAmount, debt.currency)}` : ""} size="sm" onClose={onClose}>
            <div className="space-y-3">
                <Field label="Monto"><Input type="number" min={0} max={debt?.remainingAmount} value={draft.amount} onChange={(e) => onChange({ ...draft, amount: parseInputMoney(e.target.value) })} /></Field>
                <Field label="Metodo">
                    <select className={selectClass} value={draft.method} onChange={(e) => onChange({ ...draft, method: e.target.value as DebtPaymentMethod })}>
                        <option value="cash">Efectivo</option>
                        <option value="pix">Pix</option>
                        <option value="transfer">Transferencia</option>
                        <option value="card">Tarjeta</option>
                        <option value="other">Otro</option>
                    </select>
                </Field>
                <Field label="Fecha"><Input type="date" value={draft.paymentDate} onChange={(e) => onChange({ ...draft, paymentDate: e.target.value })} /></Field>
                <Field label="Notas"><Input value={draft.notes} onChange={(e) => onChange({ ...draft, notes: e.target.value })} /></Field>
                <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-3">
                    <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button variant="primary" disabled={saving || !debt} onClick={onSave}>{saving ? "Registrando..." : "Registrar abono"}</Button>
                </div>
            </div>
        </Modal>
    );
}

function MiniValue({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "orange" }) {
    const color = tone === "green" ? "text-emerald-700" : tone === "orange" ? "text-amber-700" : "text-[#101936]";
    return (
        <div className="rounded-xl border border-[#eef1f5] bg-[#fbfaff] px-2.5 py-2">
            <p className="text-[9px] font-black uppercase tracking-[0.08em] text-[#98a2b3]">{label}</p>
            <p className={`mt-0.5 truncate text-[12px] font-black ${color}`}>{value}</p>
        </div>
    );
}

function DetailTile({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "orange" }) {
    return <MiniValue label={label} value={value} tone={tone} />;
}

function StatusBadge({ status }: { status: DebtStatus }) {
    const tone = status === "paid" ? "green" : status === "late" ? "red" : status === "cancelled" ? "gray" : "blue";
    return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function Notice({ children, tone }: { children: string; tone: "red" | "green" }) {
    return (
        <div className={`rounded-2xl border px-4 py-3 text-[13px] font-bold ${tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {children}
        </div>
    );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
    return (
        <div className={`rounded-2xl border border-dashed border-[#ded8ff] bg-[#fbfaff] text-center text-[13px] font-semibold text-[#66739a] ${compact ? "m-3 p-3" : "p-6"}`}>
            {text}
        </div>
    );
}

function buildStats(debts: DebtDoc[], payments: DebtPaymentDoc[]) {
    const activeDebts = debts.filter((item) => item.status !== "cancelled");
    const original = activeDebts.reduce((sum, item) => sum + item.originalAmount, 0);
    const paid = activeDebts.reduce((sum, item) => sum + item.totalPaid, 0);
    const remaining = activeDebts.reduce((sum, item) => sum + item.remainingAmount, 0);
    const interest = activeDebts.reduce((sum, item) => sum + (item.interestAmount || 0), 0);
    return {
        original,
        paid,
        remaining,
        interest,
        active: debts.filter((item) => item.status === "active").length,
        late: debts.filter((item) => item.status === "late").length,
        paidCount: debts.filter((item) => item.status === "paid").length,
        paymentsCount: payments.length,
        currency: debts[0]?.currency ?? "BRL" as DebtCurrency,
    };
}

function formatMoney(value: number, currency: DebtCurrency) {
    if (currency === "USD") return moneyUsd.format(value);
    if (currency === "EUR") return moneyEur.format(value);
    return money.format(value);
}

function formatDate(ms: number) {
    return dateFmt.format(new Date(ms));
}

function dayKey(ms: number) {
    const date = new Date(ms);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function normalize(value: string) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseInputMoney(value: string) {
    if (value === "") return "";
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : "";
}

function statusLabel(status: DebtStatus) {
    if (status === "paid") return "Pagada";
    if (status === "late") return "Vencida";
    if (status === "cancelled") return "Cancelada";
    return "Activa";
}

function frequencyLabel(value: DebtDoc["paymentFrequency"]) {
    if (value === "daily") return "Diaria";
    if (value === "biweekly") return "Quincenal";
    if (value === "monthly") return "Mensual";
    return "Semanal";
}

function methodLabel(value: DebtPaymentMethod) {
    if (value === "pix") return "Pix";
    if (value === "transfer") return "Transferencia";
    if (value === "card") return "Tarjeta";
    if (value === "other") return "Otro";
    return "Efectivo";
}
