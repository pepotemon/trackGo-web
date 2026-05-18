"use client";

import { useEffect, useMemo, useState } from "react";
import { AppIcon, Badge, Button, Card, CardContent, CardHeader, Field, Input, Modal } from "@/components/ui";
import {
    debtToDraft,
    deleteDebt,
    deleteDebtPayment,
    listDeletedDebts,
    listDebtPayments,
    listDebts,
    purgeDebtPermanently,
    purgeDeletedDebts,
    registerDebtPayment,
    restoreDebt,
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
    originalAmount: "",
    interestAmount: "",
    currency: "BRL",
    paymentFrequency: "weekly",
    installmentAmount: "",
    startDate: todayInputValue(),
    dueDate: "",
    notes: "",
};

const emptyPaymentDraft: DebtPaymentDraft = {
    amount: "",
    method: "cash",
    paymentDate: todayInputValue(),
    notes: "",
};

export default function AdminDebtsPage() {
    const { firebaseUser } = useAuth();
    const ownerId = firebaseUser?.uid ?? "";
    const [debts, setDebts] = useState<DebtDoc[]>([]);
    const [deletedDebts, setDeletedDebts] = useState<DebtDoc[]>([]);
    const [payments, setPayments] = useState<DebtPaymentDoc[]>([]);
    const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<DebtFilter>("all");
    const [sort, setSort] = useState<DebtSort>("recent");
    const [filterModalOpen, setFilterModalOpen] = useState(false);
    const [trashOpen, setTrashOpen] = useState(false);
    const [debtModalOpen, setDebtModalOpen] = useState(false);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [editingDebt, setEditingDebt] = useState<DebtDoc | null>(null);
    const [debtDraft, setDebtDraft] = useState<DebtDraft>(emptyDraft);
    const [paymentDraft, setPaymentDraft] = useState<DebtPaymentDraft>(emptyPaymentDraft);
    const [actionDebt, setActionDebt] = useState<DebtDoc | null>(null);
    const [paymentDebt, setPaymentDebt] = useState<DebtDoc | null>(null);
    const [historyDebt, setHistoryDebt] = useState<DebtDoc | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [confirmAction, setConfirmAction] = useState<null | {
        title: string;
        body: string;
        confirmLabel: string;
        tone: "red" | "orange";
        onConfirm: () => Promise<void>;
    }>(null);
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

    const activeFiltersCount = (filter !== "all" ? 1 : 0) + (sort !== "recent" ? 1 : 0);

    async function load() {
        if (!ownerId) return;
        setLoading(true);
        setError("");
        try {
            const items = await listDebts(ownerId);
            const deleted = await listDeletedDebts(ownerId);
            setDebts(items);
            setDeletedDebts(deleted);
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
        if (!ownerId || !paymentDebt) return;
        setSaving(true);
        setError("");
        try {
            await registerDebtPayment(ownerId, paymentDebt.id, paymentDraft);
            setPaymentModalOpen(false);
            setPaymentDebt(null);
            setPaymentDraft(emptyPaymentDraft);
            await Promise.all([load(), loadPayments(paymentDebt.id)]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo registrar el abono.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDeletePayment(payment: DebtPaymentDoc) {
        const debt = historyDebt ?? selectedDebt;
        if (!ownerId || !debt) return;
        setConfirmAction({
            title: "Eliminar abono",
            body: "Se borrara este abono y el saldo volvera a la deuda. Esta accion ajusta la contabilidad de la deuda.",
            confirmLabel: "Eliminar abono",
            tone: "red",
            onConfirm: async () => {
                setSaving(true);
                setError("");
                try {
                    await deleteDebtPayment(ownerId, debt.id, payment.id);
                    await Promise.all([load(), loadPayments(debt.id)]);
                } catch (err) {
                    setError(err instanceof Error ? err.message : "No se pudo eliminar el abono.");
                } finally {
                    setSaving(false);
                }
            },
        });
    }

    async function handleCancelDebt(debt: DebtDoc) {
        if (!ownerId) return;
        const reactivating = debt.status === "cancelled";
        setConfirmAction({
            title: reactivating ? "Reactivar deuda" : "Cancelar deuda",
            body: reactivating
                ? `La deuda de ${debt.clientName} volvera a quedar activa.`
                : `La deuda de ${debt.clientName} quedara cancelada y no aceptara abonos.`,
            confirmLabel: reactivating ? "Reactivar" : "Cancelar deuda",
            tone: reactivating ? "orange" : "red",
            onConfirm: async () => {
                setSaving(true);
                setError("");
                try {
                    await updateDebtStatus(ownerId, debt.id, reactivating ? "active" : "cancelled");
                    setActionDebt(null);
                    await load();
                } catch (err) {
                    setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
                } finally {
                    setSaving(false);
                }
            },
        });
    }

    async function handleDeleteDebt(debt: DebtDoc) {
        if (!ownerId) return;
        setConfirmAction({
            title: "Eliminar deuda",
            body: `La deuda de ${debt.clientName} saldra de tu cartera. Los datos quedan protegidos como registro cancelado.`,
            confirmLabel: "Eliminar",
            tone: "red",
            onConfirm: async () => {
                setSaving(true);
                setError("");
                try {
                    await deleteDebt(ownerId, debt.id);
                    setSelectedDebtId((current) => current === debt.id ? null : current);
                    setActionDebt(null);
                    await load();
                } catch (err) {
                    setError(err instanceof Error ? err.message : "No se pudo eliminar la deuda.");
                } finally {
                    setSaving(false);
                }
            },
        });
    }

    async function handleRestoreDebt(debt: DebtDoc) {
        if (!ownerId) return;
        setSaving(true);
        setError("");
        try {
            await restoreDebt(ownerId, debt.id);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo restaurar el prestamo.");
        } finally {
            setSaving(false);
        }
    }

    function requestPurgeDebt(debt: DebtDoc) {
        if (!ownerId) return;
        setConfirmAction({
            title: "Borrar definitivamente",
            body: `Se eliminara para siempre el prestamo de ${debt.clientName}, incluyendo sus abonos. Esta accion no se puede deshacer.`,
            confirmLabel: "Borrar",
            tone: "red",
            onConfirm: async () => {
                setSaving(true);
                setError("");
                try {
                    await purgeDebtPermanently(ownerId, debt.id);
                    await load();
                } catch (err) {
                    setError(err instanceof Error ? err.message : "No se pudo limpiar este prestamo.");
                } finally {
                    setSaving(false);
                }
            },
        });
    }

    function requestEmptyTrash() {
        if (!ownerId) return;
        setConfirmAction({
            title: "Vaciar papelera",
            body: "Se eliminaran definitivamente todos los prestamos de la papelera y sus abonos. Esta accion no se puede deshacer.",
            confirmLabel: "Vaciar papelera",
            tone: "red",
            onConfirm: async () => {
                setSaving(true);
                setError("");
                try {
                    await purgeDeletedDebts(ownerId);
                    await load();
                    setTrashOpen(false);
                } catch (err) {
                    setError(err instanceof Error ? err.message : "No se pudo vaciar la papelera.");
                } finally {
                    setSaving(false);
                }
            },
        });
    }

    return (
        <main className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_54%,#f8fafc_100%)] pb-6 text-[#101936] sm:-mx-5 lg:-mx-7 xl:mx-auto xl:mt-0 xl:w-full xl:max-w-6xl xl:bg-none xl:pb-4">
            <div className="sticky top-0 z-20 border-b border-[#eee9ff] bg-[#fbfaff]/96 px-3 pb-3 pt-3 backdrop-blur-md sm:px-5 lg:px-7 xl:static xl:border-0 xl:bg-transparent xl:p-0 xl:backdrop-blur-0">
                <div className="mb-3 flex items-center gap-2 xl:rounded-2xl xl:border xl:border-[#e8e7fb] xl:bg-white/88 xl:p-4 xl:shadow-[0_14px_34px_rgba(36,30,86,0.07)]">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">Cartera</h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">Cobros privados · {visibleDebts.length} registros</p>
                    </div>

                    <button
                        type="button"
                        onClick={openCreate}
                        aria-label="Crear deuda"
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                    >
                        <AppIcon name="plus" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-current ring-0" />
                    </button>

                    <button
                        type="button"
                        onClick={() => setTrashOpen(true)}
                        aria-label="Papelera"
                        className="relative flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                    >
                        <AppIcon name="trash" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-current ring-0" />
                        {deletedDebts.length > 0 ? (
                            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                                {deletedDebts.length}
                            </span>
                        ) : null}
                    </button>

                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        aria-label="Actualizar"
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-50"
                    >
                        <AppIcon name="refresh" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-current ring-0" />
                    </button>
                </div>

                <section className="mt-3 grid grid-cols-3 gap-2 xl:grid-cols-6">
                    <CompactStat label="Prestado" value={formatMoney(stats.original, stats.currency)} tone="blue" />
                    <CompactStat label="Recuperado" value={formatMoney(stats.paid, stats.currency)} tone="green" />
                    <CompactStat label="Pendiente" value={formatMoney(stats.remaining, stats.currency)} tone="orange" />
                    <CompactStat label="Intereses" value={formatMoney(stats.interest, stats.currency)} tone="purple" />
                    <CompactStat label="Activas" value={String(stats.active)} tone={stats.late ? "red" : "green"} />
                    <CompactStat label="Pagadas" value={String(stats.paidCount)} tone="green" />
                </section>
            </div>

            <div className="px-3 pt-3 sm:px-5 lg:px-7 xl:px-0">
                {error ? <Notice tone="red">{error}</Notice> : null}

                <Card>
                    <CardHeader
                        title="Deudas"
                        subtitle="Busca, filtra y abre una deuda para gestionar abonos."
                        action={<Badge tone="purple">{visibleDebts.length}</Badge>}
                    />
                    <CardContent className="space-y-3">
                        <div className="flex gap-2">
                            <div className="flex h-[46px] flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 shadow-[0_2px_12px_rgba(91,33,255,0.07)]">
                                <AppIcon name="search" tone="purple" size="sm" className="h-5 w-5 shrink-0 bg-transparent text-[#98A2B3] ring-0" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Buscar..."
                                    className="min-w-0 flex-1 bg-transparent font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                                    style={{ fontSize: "16px" }}
                                />
                                {query ? (
                                    <button
                                        type="button"
                                        onClick={() => setQuery("")}
                                        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f0ff] text-[16px] text-[#7C3AED]"
                                    >
                                        ×
                                    </button>
                                ) : null}
                            </div>

                            <button
                                type="button"
                                onClick={() => setFilterModalOpen(true)}
                                className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.07)] transition active:bg-[#f3f0ff]"
                                aria-label="Filtros"
                            >
                                <AppIcon name="filter" tone="purple" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                                {activeFiltersCount > 0 ? (
                                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#7C3AED] text-[9px] font-black text-white">
                                        {activeFiltersCount}
                                    </span>
                                ) : null}
                            </button>
                        </div>

                        {loading ? <EmptyState text="Cargando cartera..." /> : null}
                        {!loading && visibleDebts.length === 0 ? <EmptyState text="Aun no hay deudas en esta vista." /> : null}

                        <div className="grid gap-2">
                            {visibleDebts.map((debt) => (
                                <DebtCard
                                    key={debt.id}
                                    debt={debt}
                                    onClick={() => {
                                        setSelectedDebtId(debt.id);
                                        setActionDebt(debt);
                                    }}
                                />
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <DebtActionsModal
                debt={actionDebt}
                onClose={() => setActionDebt(null)}
                onPayment={() => {
                    if (!actionDebt) return;
                    setSelectedDebtId(actionDebt.id);
                    setPaymentDebt(actionDebt);
                    setPaymentDraft(emptyPaymentDraft);
                    setActionDebt(null);
                    setPaymentModalOpen(true);
                }}
                onEdit={() => {
                    if (!actionDebt) return;
                    openEdit(actionDebt);
                    setActionDebt(null);
                }}
                onHistory={() => {
                    if (!actionDebt) return;
                    setSelectedDebtId(actionDebt.id);
                    setHistoryDebt(actionDebt);
                    setActionDebt(null);
                    setHistoryOpen(true);
                }}
                onCancel={() => {
                    if (!actionDebt) return;
                    void handleCancelDebt(actionDebt);
                    setActionDebt(null);
                }}
                onDelete={() => {
                    if (!actionDebt) return;
                    void handleDeleteDebt(actionDebt);
                    setActionDebt(null);
                }}
                saving={saving}
            />

            <HistoryModal
                open={historyOpen}
                debt={historyDebt ?? selectedDebt}
                payments={payments}
                loading={paymentsLoading}
                onDelete={handleDeletePayment}
                onClose={() => { setHistoryOpen(false); setHistoryDebt(null); }}
            />

            <ConfirmActionModal
                action={confirmAction}
                saving={saving}
                onClose={() => setConfirmAction(null)}
            />

            <DebtFiltersModal
                open={filterModalOpen}
                filter={filter}
                sort={sort}
                onFilter={setFilter}
                onSort={setSort}
                onReset={() => {
                    setFilter("all");
                    setSort("recent");
                    setFilterModalOpen(false);
                }}
                onClose={() => setFilterModalOpen(false)}
            />

            <DebtTrashModal
                open={trashOpen}
                debts={deletedDebts}
                saving={saving}
                onRestore={handleRestoreDebt}
                onPurge={requestPurgeDebt}
                onEmpty={requestEmptyTrash}
                onClose={() => setTrashOpen(false)}
            />

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
                debt={paymentDebt}
                draft={paymentDraft}
                saving={saving}
                onChange={setPaymentDraft}
                onSave={handleRegisterPayment}
                onClose={() => { setPaymentModalOpen(false); setPaymentDebt(null); }}
            />
        </main>
    );
}

const selectClass = "h-10 w-full rounded-[14px] border border-[#e4e7ec] bg-white px-3 text-[12px] font-bold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100 sm:h-9 sm:rounded-md";

function DebtCard({ debt, onClick }: { debt: DebtDoc; onClick: () => void }) {
    const progress = debt.finalAmount && debt.finalAmount > 0 ? Math.min(100, Math.round((debt.totalPaid / debt.finalAmount) * 100)) : 0;
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full rounded-2xl border border-[#eef1f5] bg-white p-3 text-left shadow-sm transition hover:border-[#ded8ff] active:scale-[0.99] active:border-[#7c3aed]"
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
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#e8e7fb] bg-[#f8f7ff]">
                    <AppIcon name="more" plain className="h-4 w-4 text-[#66739a]" />
                </span>
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

function DebtActionsModal({
    debt,
    saving,
    onClose,
    onPayment,
    onEdit,
    onHistory,
    onCancel,
    onDelete,
}: {
    debt: DebtDoc | null;
    saving: boolean;
    onClose: () => void;
    onPayment: () => void;
    onEdit: () => void;
    onHistory: () => void;
    onCancel: () => void;
    onDelete: () => void;
}) {
    if (!debt) return null;
    const canPay = debt.status !== "cancelled" && debt.remainingAmount > 0;

    return (
        <>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="fixed inset-0 z-40 bg-black/40" />
            <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(430px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-4 sm:shadow-[0_28px_80px_rgba(16,25,54,0.24)]">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#e8e7fb]" />
                <div className="mb-4 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="truncate text-[15px] font-black text-[#101936]">{debt.clientName}</p>
                            <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739a]">
                                {[debt.businessName, debt.phone].filter(Boolean).join(" · ") || "Cartera de cobros"}
                            </p>
                        </div>
                        <StatusBadge status={debt.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        <MiniValue label="Prestado" value={formatMoney(debt.finalAmount || debt.originalAmount, debt.currency)} />
                        <MiniValue label="Pagado" value={formatMoney(debt.totalPaid, debt.currency)} tone="green" />
                        <MiniValue label="Saldo" value={formatMoney(debt.remainingAmount, debt.currency)} tone={debt.remainingAmount > 0 ? "orange" : "green"} />
                    </div>
                </div>
                <div className="grid gap-2">
                    <ActionButton icon="plus" label="Registrar abono" disabled={!canPay || saving} onClick={onPayment} tone="purple" />
                    <ActionButton icon="edit" label="Editar" disabled={saving} onClick={onEdit} tone="slate" />
                    <ActionButton icon="history" label="Historial de abonos" disabled={saving} onClick={onHistory} tone="blue" />
                    {debt.status !== "paid" ? (
                        <ActionButton
                            icon={debt.status === "cancelled" ? "play" : "ban"}
                            label={debt.status === "cancelled" ? "Reactivar deuda" : "Cancelar deuda"}
                            disabled={saving}
                            onClick={onCancel}
                            tone="orange"
                        />
                    ) : null}
                    <ActionButton icon="trash" label="Eliminar" disabled={saving} onClick={onDelete} tone="red" />
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 min-h-[48px] w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] text-[14px] font-bold text-[#66739a] transition active:bg-[#f3f0ff]"
                >
                    Cerrar
                </button>
            </div>
        </>
    );
}

function ActionButton({
    icon,
    label,
    tone,
    disabled,
    onClick,
}: {
    icon: "plus" | "edit" | "history" | "trash" | "ban" | "play";
    label: string;
    tone: "purple" | "blue" | "orange" | "red" | "slate";
    disabled?: boolean;
    onClick: () => void;
}) {
    const toneClass =
        tone === "red"
            ? "bg-red-50 text-red-700 active:bg-red-100"
            : tone === "orange"
                ? "bg-amber-50 text-amber-700 active:bg-amber-100"
                : tone === "blue"
                    ? "bg-blue-50 text-blue-700 active:bg-blue-100"
                    : tone === "purple"
                        ? "bg-[#f3f0ff] text-[#6d28d9] active:bg-violet-100"
                        : "bg-[#f8f7ff] text-[#101936] active:bg-[#f3f0ff]";
    const iconClass =
        tone === "red"
            ? "text-red-500"
            : tone === "orange"
                ? "text-amber-600"
                : tone === "blue"
                    ? "text-blue-600"
                    : tone === "purple"
                        ? "text-[#7c3aed]"
                        : "text-[#66739a]";
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`flex min-h-[52px] items-center gap-3 rounded-[14px] px-4 text-[14px] font-bold transition disabled:opacity-50 ${toneClass}`}
        >
            <AppIcon name={icon} size="sm" plain className={`h-5 w-5 ${iconClass}`} />
            {label}
        </button>
    );
}

function HistoryModal({
    open,
    debt,
    payments,
    loading,
    onDelete,
    onClose,
}: {
    open: boolean;
    debt: DebtDoc | null;
    payments: DebtPaymentDoc[];
    loading: boolean;
    onDelete: (payment: DebtPaymentDoc) => void;
    onClose: () => void;
}) {
    if (!open || !debt) return null;
    return (
        <Modal open title="Historial de abonos" subtitle={debt.clientName} size="md" onClose={onClose}>
            <div className="space-y-3">
                <PaymentSummary payments={payments} currency={debt.currency} />
                <PaymentHistory
                    payments={payments}
                    currency={debt.currency}
                    loading={loading}
                    onDelete={onDelete}
                />
            </div>
        </Modal>
    );
}

function ConfirmActionModal({
    action,
    saving,
    onClose,
}: {
    action: null | {
        title: string;
        body: string;
        confirmLabel: string;
        tone: "red" | "orange";
        onConfirm: () => Promise<void>;
    };
    saving: boolean;
    onClose: () => void;
}) {
    if (!action) return null;
    return (
        <Modal open title={action.title} subtitle="Confirma antes de continuar." size="sm" onClose={onClose}>
            <div className="space-y-4">
                <div className={`rounded-2xl border px-4 py-3 text-[13px] font-semibold leading-relaxed ${action.tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    {action.body}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
                    <Button
                        variant={action.tone === "red" ? "danger" : "secondary"}
                        disabled={saving}
                        onClick={async () => {
                            await action.onConfirm();
                            onClose();
                        }}
                    >
                        {saving ? "Procesando..." : action.confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function DebtFiltersModal({
    open,
    filter,
    sort,
    onFilter,
    onSort,
    onReset,
    onClose,
}: {
    open: boolean;
    filter: DebtFilter;
    sort: DebtSort;
    onFilter: (filter: DebtFilter) => void;
    onSort: (sort: DebtSort) => void;
    onReset: () => void;
    onClose: () => void;
}) {
    if (!open) return null;
    return (
        <Modal open title="Filtros" subtitle="Organiza tu cartera de cobros." size="sm" onClose={onClose}>
            <div className="space-y-4">
                <Field label="Estado">
                    <select value={filter} onChange={(e) => onFilter(e.target.value as DebtFilter)} className={selectClass}>
                        <option value="all">Todas</option>
                        <option value="active">Activas</option>
                        <option value="late">Vencidas</option>
                        <option value="paid">Pagadas</option>
                        <option value="cancelled">Canceladas</option>
                    </select>
                </Field>
                <Field label="Ordenar">
                    <select value={sort} onChange={(e) => onSort(e.target.value as DebtSort)} className={selectClass}>
                        <option value="recent">Recientes</option>
                        <option value="balance">Mayor deuda</option>
                        <option value="late">Mas atrasadas</option>
                    </select>
                </Field>
                <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-3 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={onReset}>Limpiar</Button>
                    <Button variant="primary" onClick={onClose}>Aplicar</Button>
                </div>
            </div>
        </Modal>
    );
}

function DebtTrashModal({
    open,
    debts,
    saving,
    onRestore,
    onPurge,
    onEmpty,
    onClose,
}: {
    open: boolean;
    debts: DebtDoc[];
    saving: boolean;
    onRestore: (debt: DebtDoc) => void;
    onPurge: (debt: DebtDoc) => void;
    onEmpty: () => void;
    onClose: () => void;
}) {
    if (!open) return null;
    const currency = debts[0]?.currency ?? "BRL";
    const totalDeleted = debts.reduce((sum, debt) => sum + debt.remainingAmount, 0);

    return (
        <Modal open title="Papelera" subtitle="Prestamos eliminados de tu cartera." size="md" onClose={onClose}>
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#8a7ac8]">Eliminados</p>
                        <p className="mt-1 text-[15px] font-black text-[#101936]">
                            {debts.length} prestamos · {formatMoney(totalDeleted, currency)}
                        </p>
                    </div>
                    {debts.length > 0 ? (
                        <Button variant="danger" disabled={saving} onClick={onEmpty}>
                            Vaciar
                        </Button>
                    ) : null}
                </div>

                {debts.length === 0 ? <EmptyState text="La papelera esta vacia." compact /> : null}

                <div className="grid max-h-[58vh] gap-2 overflow-y-auto pr-1">
                    {debts.map((debt) => (
                        <div key={debt.id} className="rounded-2xl border border-[#e8e7fb] bg-white p-3 shadow-[0_10px_24px_rgba(36,30,86,0.06)]">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-[15px] font-black text-[#101936]">{debt.clientName}</p>
                                    <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739a]">
                                        {debt.businessName || debt.phone || "Sin negocio registrado"}
                                    </p>
                                </div>
                                <StatusBadge status={debt.status} />
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-2">
                                <MiniValue label="Prestado" value={formatMoney(debt.originalAmount, debt.currency)} />
                                <MiniValue label="Pagado" value={formatMoney(debt.totalPaid, debt.currency)} tone="green" />
                                <MiniValue label="Saldo" value={formatMoney(debt.remainingAmount, debt.currency)} tone="orange" />
                            </div>

                            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <Button variant="ghost" disabled={saving} onClick={() => onPurge(debt)}>
                                    Borrar definitivo
                                </Button>
                                <Button variant="primary" disabled={saving} onClick={() => onRestore(debt)}>
                                    Restaurar
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
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

function CompactStat({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "orange" | "purple" | "red" }) {
    const color =
        tone === "green"
            ? "text-emerald-700 bg-emerald-50 border-emerald-100"
            : tone === "orange"
                ? "text-amber-700 bg-amber-50 border-amber-100"
                : tone === "red"
                    ? "text-red-700 bg-red-50 border-red-100"
                    : tone === "blue"
                        ? "text-blue-700 bg-blue-50 border-blue-100"
                        : "text-[#6d28d9] bg-[#f3f0ff] border-[#ded8ff]";
    return (
        <div className={`min-w-0 rounded-[14px] border px-2.5 py-2 shadow-sm ${color}`}>
            <p className="truncate text-[9px] font-black uppercase tracking-[0.06em] opacity-80">{label}</p>
            <p className="mt-0.5 truncate text-[12px] font-black leading-tight sm:text-[13px]">{value}</p>
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
    const normalized = value.replace(",", ".").replace(/^0+(?=\d)/, "");
    if (normalized === "") return "";
    const parsed = Number(normalized);
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
