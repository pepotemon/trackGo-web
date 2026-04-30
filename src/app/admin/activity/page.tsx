// src/app/admin/activity/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    listActivityEventsPage,
    listPendingClientsForActivity,
    type ActivityCursor,
} from "@/data/activityRepo";
import { listAccountingUsers } from "@/data/accountingRepo";
import { dayKeyFromDate, addDays } from "@/lib/date";
import type {
    ActivityEventRow,
    ActivityEventType,
    ActivityFilters,
    ActivityStats,
    ActivityUserOption,
} from "@/types/activity";
import type { DailyEventDoc, UserDoc } from "@/types/accounting";
import {
    ActionTile,
    AppIcon,
    Badge,
    Button,
    Card,
    Field,
    Input,
    KpiCard,
    Modal,
    PageHeader,
} from "@/components/ui";

const PAGE_SIZE = 120;

const typeLabel: Record<Exclude<ActivityEventType, "all">, string> = {
    visited: "Visitado",
    rejected: "Rechazado",
    pending: "Pendiente",
};

const typeTone: Record<Exclude<ActivityEventType, "all">, "green" | "red" | "yellow"> = {
    visited: "green",
    rejected: "red",
    pending: "yellow",
};

const rejectReasonLabel: Record<string, string> = {
    clavo: "Clavo",
    localizacion: "Localización",
    zona_riesgosa: "Zona riesgosa",
    ingresos_insuficientes: "Ingresos insuficientes",
    muy_endeudado: "Muy endeudado",
    informacion_dudosa: "Información dudosa",
    no_le_interesa: "No le interesa",
    no_estaba_cerrado: "No estaba / cerrado",
    fuera_de_ruta: "Fuera de ruta",
    otro: "Otro",
};

function selectClassName(extra = "") {
    return [
        "h-10 rounded-[15px] border border-white/[0.08] bg-[#0F172A] px-3 text-[13px] font-bold text-[#F9FAFB] outline-none transition focus:border-blue-400/35 focus:ring-2 focus:ring-blue-400/10 sm:h-9 sm:rounded-lg sm:text-[12px] xl:border-[#e5e7eb] xl:bg-white xl:font-semibold xl:text-[#52525b] xl:focus:border-[#7c3aed] xl:focus:ring-violet-100",
        extra,
    ].join(" ");
}

function defaultFilters(): ActivityFilters {
    const today = new Date();

    return {
        startKey: dayKeyFromDate(addDays(today, -6)),
        endKey: dayKeyFromDate(today),
        userId: "all",
        type: "all",
        search: "",
    };
}

function todayFilters(): ActivityFilters {
    const today = dayKeyFromDate(new Date());

    return {
        startKey: today,
        endKey: today,
        userId: "all",
        type: "all",
        search: "",
    };
}

function norm(value: unknown) {
    return String(value ?? "").toLowerCase().trim();
}

function money(value: number) {
    return `R$ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value?: number | null) {
    if (!value) return "Sin fecha";

    return new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function eventTitle(event: ActivityEventRow) {
    return event.name || event.business || event.phone || event.clientId || "Cliente";
}

function eventSubtitle(event: ActivityEventRow) {
    const business = String(event.business || "").trim();
    const address = String(event.address || "").trim();
    const cleanAddress = /^https?:\/\//i.test(address) ? "" : address;

    return business || cleanAddress || event.phone || event.clientId;
}

function rejectedReasonText(event: ActivityEventRow) {
    if (event.type !== "rejected") return "";

    const reason = String(event.rejectedReason || event.note || "").trim();
    const custom = String(event.rejectedReasonText || "").trim();

    if (reason === "otro" && custom) return custom;
    if (reason) return rejectReasonLabel[reason] || reason;
    if (custom) return custom;
    return "";
}

function mergeActivityEvents(events: DailyEventDoc[], pendingClients: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();

    for (const event of events) {
        map.set(`${event.type}_${event.clientId}`, event);
    }

    for (const event of pendingClients) {
        map.set(`pending_${event.clientId}`, event);
    }

    return Array.from(map.values()).sort((a, b) => {
        const dayCompare = String(b.dayKey || "").localeCompare(String(a.dayKey || ""));
        if (dayCompare !== 0) return dayCompare;
        return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
}

function getRatePerVisit(user?: ActivityUserOption) {
    const raw = (user as any)?.ratePerVisit ?? (user as any)?.visitFee ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

export default function ActivityPage() {
    const [filters, setFilters] = useState<ActivityFilters>(() => defaultFilters());
    const [users, setUsers] = useState<ActivityUserOption[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [cursor, setCursor] = useState<ActivityCursor>(null);
    const [hasMore, setHasMore] = useState(false);
    const [quickRow, setQuickRow] = useState<ActivityEventRow | null>(null);
    const [listMode, setListMode] = useState<Exclude<ActivityEventType, "all"> | null>(null);
    const [earningsOpen, setEarningsOpen] = useState(false);
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

    const rows = useMemo<ActivityEventRow[]>(() => {
        return events.map((event) => {
            const user = userMap.get(event.userId);

            return {
                ...event,
                source: String(event.id || "").startsWith("pending_")
                    ? "pending_client"
                    : "daily_event",
                userName: user?.name || "Usuario",
                userEmail: user?.email,
                billingMode: user?.billingMode || event.billingModeSnapshot || "per_visit",
            };
        });
    }, [events, userMap]);

    const filteredRows = useMemo(() => {
        const q = norm(filters.search);

        return rows.filter((row) => {
            if (filters.userId !== "all" && row.userId !== filters.userId) return false;
            if (filters.type !== "all" && row.type !== filters.type) return false;

            if (!q) return true;

            return [
                row.id,
                row.clientId,
                row.userName,
                row.userEmail,
                row.name,
                row.business,
                row.phone,
                row.address,
                row.rejectedReason,
                row.rejectedReasonText,
                row.note,
                row.type,
                row.dayKey,
            ]
                .map(norm)
                .join(" ")
                .includes(q);
        });
    }, [filters.search, filters.type, filters.userId, rows]);

    const stats = useMemo<ActivityStats>(() => {
        const visibleUsers = new Set(filteredRows.map((row) => row.userId).filter(Boolean));

        return {
            total: filteredRows.length,
            visited: filteredRows.filter((row) => row.type === "visited").length,
            rejected: filteredRows.filter((row) => row.type === "rejected").length,
            pending: filteredRows.filter((row) => row.type === "pending").length,
            users: visibleUsers.size,
        };
    }, [filteredRows]);

    const activityRowsByType = useMemo(() => {
        return {
            visited: filteredRows.filter((row) => row.type === "visited"),
            rejected: filteredRows.filter((row) => row.type === "rejected"),
            pending: filteredRows.filter((row) => row.type === "pending"),
        };
    }, [filteredRows]);

    const earningsRows = useMemo(() => {
        const byUser = new Map<
            string,
            { userId: string; name: string; email?: string; visited: number; amount: number; rate: number }
        >();

        for (const row of activityRowsByType.visited) {
            const user = userMap.get(row.userId);
            const rate = getRatePerVisit(user);
            const current = byUser.get(row.userId) ?? {
                userId: row.userId,
                name: row.userName || user?.name || "Usuario",
                email: row.userEmail || user?.email,
                visited: 0,
                amount: 0,
                rate,
            };

            current.visited += 1;
            current.amount += rate;
            byUser.set(row.userId, current);
        }

        return Array.from(byUser.values()).sort((a, b) => b.amount - a.amount);
    }, [activityRowsByType.visited, userMap]);

    const amountTotal = useMemo(() => {
        return earningsRows.reduce((sum, row) => sum + row.amount, 0);
    }, [earningsRows]);

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (filters.userId !== "all") total++;
        if (filters.type !== "all") total++;
        if (filters.search.trim()) total++;
        return total;
    }, [filters]);

    const loadInitial = useCallback(async (nextFilters: ActivityFilters) => {
        setLoading(true);
        setErr(null);

        try {
            const [userDocs, page, pendingClients] = await Promise.all([
                listAccountingUsers(),
                listActivityEventsPage({
                    startKey: nextFilters.startKey,
                    endKey: nextFilters.endKey,
                    pageSize: PAGE_SIZE,
                }),
                listPendingClientsForActivity({
                    startKey: nextFilters.startKey,
                    endKey: nextFilters.endKey,
                    pageSize: 500,
                }),
            ]);

            setUsers(userDocs.map(userToOption));
            setEvents(mergeActivityEvents(page.events, pendingClients));
            setCursor(page.cursor);
            setHasMore(page.hasMore);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cargar la actividad.");
        } finally {
            setLoading(false);
        }
    }, []);

    async function loadMore() {
        if (!cursor || loadingMore) return;

        setLoadingMore(true);
        setErr(null);

        try {
            const page = await listActivityEventsPage({
                startKey: filters.startKey,
                endKey: filters.endKey,
                pageSize: PAGE_SIZE,
                cursor,
            });

            setEvents((prev) => mergeActivityEvents([...prev, ...page.events], []));
            setCursor(page.cursor);
            setHasMore(page.hasMore);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cargar más actividad.");
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        queueMicrotask(() => {
            const next = todayFilters();
            setFilters(next);
            void loadInitial(next);
        });
    }, [loadInitial]);

    function patchFilters(patch: Partial<ActivityFilters>) {
        setFilters((prev) => ({ ...prev, ...patch }));
    }

    function applyRange() {
        void loadInitial(filters);
    }

    function resetFilters() {
        const next = {
            ...filters,
            userId: "all",
            type: "all" as const,
            search: "",
        };
        setFilters(next);
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <div className="xl:hidden">
                <MobileActivityView
                    rows={filteredRows}
                    stats={stats}
                    filters={filters}
                    users={users}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    activeFiltersCount={activeFiltersCount}
                    amountTotal={amountTotal}
                    filtersOpen={mobileFiltersOpen}
                    onToggleFilters={() => setMobileFiltersOpen((value) => !value)}
                    onPatchFilters={patchFilters}
                    onApplyRange={applyRange}
                    onResetFilters={resetFilters}
                    onRefresh={() => void loadInitial(filters)}
                    onLoadMore={loadMore}
                    onOpenRow={setQuickRow}
                    onOpenList={setListMode}
                    onOpenEarnings={() => setEarningsOpen(true)}
                />
            </div>

            <div className="hidden xl:block">
                <PageHeader
                    title="Actividad"
                    subtitle="Auditoría de visitas, rechazos y pendientes del equipo."
                    icon={
                        <AppIcon
                            name="activity"
                            tone="purple"
                            size="sm"
                            className="bg-transparent text-white ring-0"
                        />
                    }
                    actions={
                        <div className="grid w-full grid-cols-[1fr_44px] gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
                            {activeFiltersCount > 0 ? <Button onClick={resetFilters}>Limpiar</Button> : null}
                            <Button
                                variant="primary"
                                onClick={() => void loadInitial(filters)}
                                disabled={loading}
                                aria-label="Actualizar actividad"
                                title="Actualizar actividad"
                                className="h-10 w-10 px-0 py-0"
                            >
                                <AppIcon
                                    name="refresh"
                                    tone="purple"
                                    size="sm"
                                    className="bg-transparent text-white ring-0"
                                />
                            </Button>
                        </div>
                    }
                />

                {err ? (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                        {err}
                    </div>
                ) : null}

                <section className="mb-4 grid grid-cols-5 gap-4">
                    <KpiCard label="Actividad" value={stats.total} caption="Eventos + pendientes" icon="activity" tone="purple" />
                    <KpiCard label="Visitados" value={stats.visited} caption="Clientes trabajados" icon="check" tone="green" />
                    <KpiCard label="Rechazados" value={stats.rejected} caption="No concretados" icon="close" tone="red" />
                    <KpiCard label="Pendientes" value={stats.pending} caption="Sin cierre" icon="alert" tone="orange" />
                    <KpiCard label="Usuarios" value={stats.users} caption="Con actividad" icon="users" tone="blue" />
                </section>

                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 bg-gradient-to-b from-white to-[#fbfaff] px-4 py-4">
                        <div className="flex flex-row items-center justify-between gap-3">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#171717]">
                                    Auditoría diaria
                                </h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                    {filteredRows.length} visibles de {events.length} cargados
                                </p>
                            </div>

                            <Input
                                value={filters.search}
                                onChange={(event) => patchFilters({ search: event.target.value })}
                                placeholder="Buscar cliente, teléfono, usuario..."
                                className="w-[360px]"
                            />
                        </div>

                        <div className="grid grid-cols-[1fr_1fr_1.25fr_1fr_150px] gap-2">
                            <Field label="Desde">
                                <Input
                                    type="date"
                                    value={filters.startKey}
                                    onChange={(event) => patchFilters({ startKey: event.target.value })}
                                />
                            </Field>

                            <Field label="Hasta">
                                <Input
                                    type="date"
                                    value={filters.endKey}
                                    onChange={(event) => patchFilters({ endKey: event.target.value })}
                                />
                            </Field>

                            <Field label="Usuario">
                                <select
                                    value={filters.userId}
                                    onChange={(event) => patchFilters({ userId: event.target.value })}
                                    className={selectClassName("w-full")}
                                >
                                    <option value="all">Todos</option>
                                    {users.map((user) => (
                                        <option key={user.id} value={user.id}>
                                            {user.name || user.email || "Usuario sin nombre"}
                                        </option>
                                    ))}
                                </select>
                            </Field>

                            <Field label="Estado">
                                <select
                                    value={filters.type}
                                    onChange={(event) =>
                                        patchFilters({ type: event.target.value as ActivityEventType })
                                    }
                                    className={selectClassName("w-full")}
                                >
                                    <option value="all">Todos</option>
                                    <option value="visited">Visitados</option>
                                    <option value="rejected">Rechazados</option>
                                    <option value="pending">Pendientes</option>
                                </select>
                            </Field>

                            <div className="flex items-end">
                                <Button variant="primary" onClick={applyRange} disabled={loading} className="w-full">
                                    Aplicar rango
                                </Button>
                            </div>
                        </div>
                    </div>

                    <ActivityTable rows={filteredRows} loading={loading} onQuickActions={setQuickRow} />

                    <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                        <p className="text-[12px] font-medium text-[#9ca3af]">
                            Consulta paginada en bloques de {PAGE_SIZE}
                        </p>
                        {hasMore ? (
                            <Button onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? "Cargando..." : "Cargar más"}
                            </Button>
                        ) : null}
                    </div>
                </Card>
            </div>

            <ActivityQuickActionsModal row={quickRow} onClose={() => setQuickRow(null)} />

            <ActivityListModal
                mode={listMode}
                rows={listMode ? activityRowsByType[listMode] : []}
                onClose={() => setListMode(null)}
                onOpenRow={(row) => {
                    setListMode(null);
                    setQuickRow(row);
                }}
            />

            <EarningsModal
                open={earningsOpen}
                rows={earningsRows}
                total={amountTotal}
                onClose={() => setEarningsOpen(false)}
            />
        </div>
    );
}

function MobileActivityView({
    rows,
    stats,
    filters,
    users,
    loading,
    loadingMore,
    hasMore,
    activeFiltersCount,
    amountTotal,
    filtersOpen,
    onToggleFilters,
    onPatchFilters,
    onApplyRange,
    onResetFilters,
    onRefresh,
    onLoadMore,
    onOpenRow,
    onOpenList,
    onOpenEarnings,
}: {
    rows: ActivityEventRow[];
    stats: ActivityStats;
    filters: ActivityFilters;
    users: ActivityUserOption[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    activeFiltersCount: number;
    amountTotal: number;
    filtersOpen: boolean;
    onToggleFilters: () => void;
    onPatchFilters: (patch: Partial<ActivityFilters>) => void;
    onApplyRange: () => void;
    onResetFilters: () => void;
    onRefresh: () => void;
    onLoadMore: () => void;
    onOpenRow: (row: ActivityEventRow) => void;
    onOpenList: (mode: Exclude<ActivityEventType, "all">) => void;
    onOpenEarnings: () => void;
}) {
    const done = stats.visited + stats.rejected;
    const pct = stats.total <= 0 ? 0 : Math.round((done / Math.max(1, stats.total)) * 100);

    return (
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] overflow-x-hidden bg-[#0B1220] bg-[linear-gradient(rgba(3,10,20,0.62),rgba(3,10,20,0.62)),url('/brand/trackgo-bg-map.png')] bg-cover bg-center px-3 pb-4 pt-2 text-[#F9FAFB]">
            <div className="mb-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-[19px] font-black text-white">Actividad</h1>
                    <p className="mt-0.5 truncate text-[11px] font-extrabold text-[#9CA3AF]">
                        <span className="font-black text-white">{done}</span> / {stats.total} completados
                    </p>
                </div>

                <button
                    type="button"
                    onClick={onOpenEarnings}
                    className="inline-flex h-9 max-w-[130px] items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 text-[11px] font-black text-[#A7F3D0]"
                >
                    <span>R$</span>
                    <span className="truncate">{Number(amountTotal || 0).toFixed(2)}</span>
                </button>

                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#1F2937] bg-[#0F172A] text-white disabled:opacity-50"
                >
                    <AppIcon name="refresh" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-white ring-0" />
                </button>
            </div>

            <div className="mb-2 grid grid-cols-4 gap-1.5">
                <MobileStatButton
                    label="Visitados"
                    value={stats.visited}
                    icon="check"
                    color="text-[#86EFAC]"
                    onClick={() => onOpenList("visited")}
                    disabled={stats.visited <= 0}
                />
                <MobileStatButton
                    label="Rechazados"
                    value={stats.rejected}
                    icon="close"
                    color="text-[#FCA5A5]"
                    onClick={() => onOpenList("rejected")}
                    disabled={stats.rejected <= 0}
                />
                <MobileStatButton
                    label="Pendientes"
                    value={stats.pending}
                    icon="alert"
                    color="text-[#FDE68A]"
                    onClick={() => onOpenList("pending")}
                    disabled={stats.pending <= 0}
                />
                <MobileStatButton
                    label="Usuarios"
                    value={stats.users}
                    icon="users"
                    color="text-[#CBD5E1]"
                />
            </div>

            <div className="mb-2 flex h-[40px] items-center gap-2 rounded-[13px] border border-[#1F2937] bg-[#0F172A] px-3">
                <AppIcon name="search" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#9CA3AF] ring-0" />
                <input
                    value={filters.search}
                    onChange={(event) => onPatchFilters({ search: event.target.value })}
                    placeholder="Buscar..."
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-white outline-none placeholder:text-[#9CA3AF]"
                />
                {filters.search ? (
                    <button
                        type="button"
                        onClick={() => onPatchFilters({ search: "" })}
                        className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/[0.06] text-white"
                    >
                        ×
                    </button>
                ) : null}
            </div>

            <div className="mb-2 rounded-[14px] border border-[#1F2937] bg-[#0F172A]/90 p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <AppIcon name="activity" tone="blue" size="sm" className="h-5 w-5 bg-transparent text-[#93C5FD] ring-0" />
                        <p className="truncate text-[12px] font-black text-[#CBD5E1]">
                            Rango {filters.startKey} → {filters.endKey}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onToggleFilters}
                        className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-black text-[#DDEAFE]"
                    >
                        {filtersOpen ? "Ocultar" : "Filtros"}
                    </button>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.04]">
                    <div className="h-full rounded-full bg-emerald-400/55" style={{ width: `${pct}%` }} />
                </div>

                {filtersOpen ? (
                    <div className="mt-3 grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                            <MobileField label="Desde">
                                <input
                                    type="date"
                                    value={filters.startKey}
                                    onChange={(event) => onPatchFilters({ startKey: event.target.value })}
                                    className="h-10 min-w-0 rounded-[13px] border border-[#1F2937] bg-[#111827] px-3 text-[12px] font-black text-white outline-none"
                                />
                            </MobileField>

                            <MobileField label="Hasta">
                                <input
                                    type="date"
                                    value={filters.endKey}
                                    onChange={(event) => onPatchFilters({ endKey: event.target.value })}
                                    className="h-10 min-w-0 rounded-[13px] border border-[#1F2937] bg-[#111827] px-3 text-[12px] font-black text-white outline-none"
                                />
                            </MobileField>
                        </div>

                        <MobileField label="Usuario">
                            <select
                                value={filters.userId}
                                onChange={(event) => onPatchFilters({ userId: event.target.value })}
                                className="h-10 rounded-[13px] border border-[#1F2937] bg-[#111827] px-3 text-[12px] font-black text-white outline-none"
                            >
                                <option value="all">Todos</option>
                                {users.map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.name || user.email || "Usuario"}
                                    </option>
                                ))}
                            </select>
                        </MobileField>

                        <MobileField label="Estado">
                            <select
                                value={filters.type}
                                onChange={(event) => onPatchFilters({ type: event.target.value as ActivityEventType })}
                                className="h-10 rounded-[13px] border border-[#1F2937] bg-[#111827] px-3 text-[12px] font-black text-white outline-none"
                            >
                                <option value="all">Todos</option>
                                <option value="visited">Visitados</option>
                                <option value="rejected">Rechazados</option>
                                <option value="pending">Pendientes</option>
                            </select>
                        </MobileField>

                        <div className="grid grid-cols-2 gap-2">
                            {activeFiltersCount > 0 ? (
                                <Button onClick={onResetFilters}>Limpiar</Button>
                            ) : (
                                <div />
                            )}
                            <Button variant="primary" onClick={onApplyRange} disabled={loading}>
                                Aplicar
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="grid min-w-0 gap-1.5 overflow-x-hidden">
                {loading ? (
                    <ActivityTableState icon="refresh" title="Cargando actividad" body="Estamos consultando eventos y pendientes." />
                ) : rows.length === 0 ? (
                    <ActivityTableState icon="filter" title="Sin resultados" body="No hay actividad con esos filtros." />
                ) : (
                    rows.map((row) => (
                        <ActivityMobileCard key={row.id} row={row} onQuickActions={onOpenRow} compact />
                    ))
                )}

                {hasMore ? (
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="mt-1 min-h-12 rounded-[16px] border border-white/[0.08] bg-[#0F172A] px-4 text-[13px] font-black text-white disabled:opacity-60"
                    >
                        {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function MobileStatButton({
    label,
    value,
    icon,
    color,
    onClick,
    disabled,
}: {
    label: string;
    value: number;
    icon: "check" | "close" | "alert" | "users";
    color: string;
    onClick?: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick || disabled}
            className="min-w-0 rounded-[13px] border border-white/[0.08] bg-white/[0.035] px-1.5 py-2 disabled:opacity-50"
        >
            <div className="flex items-center justify-center gap-1">
                <AppIcon name={icon} tone="slate" size="sm" className={`h-4 w-4 bg-transparent ring-0 ${color}`} />
                <span className="text-[12px] font-black text-white">{value}</span>
            </div>
            <div className="mt-1 truncate text-center text-[9px] font-black text-[#9CA3AF]">{label}</div>
        </button>
    );
}

function MobileField({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <label className="grid gap-1">
            <span className="text-[11px] font-black text-[#9CA3AF]">{label}</span>
            {children}
        </label>
    );
}

function ActivityTable({
    rows,
    loading,
    onQuickActions,
}: {
    rows: ActivityEventRow[];
    loading: boolean;
    onQuickActions: (row: ActivityEventRow) => void;
}) {
    return (
        <div className="border-t border-[#f0f1f2]">
            <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[900px] border-collapse">
                    <thead>
                        <tr className="border-b border-[#f0f1f2] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                            <th className="px-3 py-2.5">Cliente</th>
                            <th className="px-3 py-2.5">Estado</th>
                            <th className="px-3 py-2.5">Usuario</th>
                            <th className="px-3 py-2.5">Día</th>
                        </tr>
                    </thead>

                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={4}>
                                    <ActivityTableState icon="refresh" title="Cargando actividad" body="Estamos consultando eventos y pendientes." />
                                </td>
                            </tr>
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={4}>
                                    <ActivityTableState icon="filter" title="Sin resultados" body="No hay actividad con esos filtros." />
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => (
                                <ActivityRow key={row.id} row={row} onQuickActions={onQuickActions} />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ActivityMobileCard({
    row,
    onQuickActions,
    compact = false,
}: {
    row: ActivityEventRow;
    onQuickActions: (row: ActivityEventRow) => void;
    compact?: boolean;
}) {
    const reason = rejectedReasonText(row);

    return (
        <button
            type="button"
            onClick={() => onQuickActions(row)}
            className={[
                "block w-full max-w-full overflow-hidden rounded-[15px] border border-[#1F2937] bg-[#111827] text-left transition active:bg-[#0F172A]",
                compact ? "px-2.5 py-2.5" : "px-3 py-3",
            ].join(" ")}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-black text-[#F9FAFB]">
                        {eventTitle(row)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-extrabold text-[#9CA3AF]">
                        {eventSubtitle(row)}
                    </div>
                </div>

                <Badge tone={typeTone[row.type]}>{typeLabel[row.type]}</Badge>
            </div>

            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-black text-[#93C5FD]">
                        {row.userName}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] font-bold text-[#CBD5E1]">
                        {row.billingMode === "weekly_subscription" ? "Suscripción" : "Por visita"}
                    </div>
                </div>

                <div className="text-right text-[10px] font-black text-[#9CA3AF]">
                    {formatDate(row.createdAt)}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {reason ? (
                    <span className="max-w-full truncate rounded-full border border-red-300/20 bg-red-400/10 px-2 py-1 text-[10px] font-black text-[#FCA5A5]">
                        {reason}
                    </span>
                ) : null}
                {row.source === "pending_client" ? <Badge tone="yellow">Actual</Badge> : null}
            </div>
        </button>
    );
}

function ActivityRow({
    row,
    onQuickActions,
}: {
    row: ActivityEventRow;
    onQuickActions: (row: ActivityEventRow) => void;
}) {
    const reason = rejectedReasonText(row);

    return (
        <tr
            onClick={() => onQuickActions(row)}
            className="cursor-pointer border-b border-[#f0f1f2] last:border-0 hover:bg-[#f8f7ff]"
        >
            <td className="px-3 py-2.5">
                <div className="max-w-[340px]">
                    <div className="truncate text-[12px] font-semibold text-[#171717]">
                        {eventTitle(row)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                        {eventSubtitle(row)}
                    </div>
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={typeTone[row.type]}>{typeLabel[row.type]}</Badge>
                    {reason ? (
                        <span className="max-w-[190px] truncate rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600">
                            {reason}
                        </span>
                    ) : null}
                    {row.source === "pending_client" ? <Badge tone="yellow">Actual</Badge> : null}
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="max-w-[220px]">
                    <div className="truncate text-[12px] font-semibold text-[#52525b]">
                        {row.userName}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                        {row.billingMode === "weekly_subscription" ? "Suscripción" : "Por visita"}
                    </div>
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="text-[12px] font-semibold text-[#52525b]">{row.dayKey}</div>
                <div className="mt-0.5 text-[11px] font-medium text-[#9ca3af]">
                    {formatDate(row.createdAt)}
                </div>
            </td>
        </tr>
    );
}

function ActivityTableState({
    icon,
    title,
    body,
}: {
    icon: "filter" | "refresh";
    title: string;
    body: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <AppIcon name={icon} tone={icon === "refresh" ? "purple" : "slate"} size="lg" />
            <div className="mt-3 text-[13px] font-black text-[#F9FAFB] xl:font-bold xl:text-[#101936]">
                {title}
            </div>
            <div className="mt-1 text-[12px] font-bold text-[#9CA3AF] xl:font-medium xl:text-[#66739a]">
                {body}
            </div>
        </div>
    );
}

function ActivityQuickActionsModal({
    row,
    onClose,
}: {
    row: ActivityEventRow | null;
    onClose: () => void;
}) {
    if (!row) return null;

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            title={eventTitle(row)}
            subtitle={eventSubtitle(row)}
            size="sm"
        >
            <div className="grid gap-2">
                <ActionTile href={`/admin/clients/${row.clientId}`} label="Ver cliente" icon="users" tone="blue" />
                {row.mapsUrl ? (
                    <ActionTile href={row.mapsUrl} label="Abrir Maps" icon="map" tone="green" external />
                ) : null}
                <ActionTile href={`/admin/leads/${row.clientId}`} label="Editar lead" icon="edit" tone="orange" />
            </div>
        </Modal>
    );
}

function ActivityListModal({
    mode,
    rows,
    onClose,
    onOpenRow,
}: {
    mode: Exclude<ActivityEventType, "all"> | null;
    rows: ActivityEventRow[];
    onClose: () => void;
    onOpenRow: (row: ActivityEventRow) => void;
}) {
    const [q, setQ] = useState("");

    const visibleRows = useMemo(() => {
        const query = norm(q);
        if (!query) return rows;

        return rows.filter((row) =>
            [
                eventTitle(row),
                eventSubtitle(row),
                row.userName,
                row.phone,
                row.address,
                row.business,
                row.name,
                row.clientId,
            ]
                .map(norm)
                .join(" ")
                .includes(query)
        );
    }, [q, rows]);

    if (!mode) return null;

    return (
        <Modal
            open={!!mode}
            onClose={onClose}
            title={
                mode === "visited"
                    ? "Visitados"
                    : mode === "rejected"
                        ? "Rechazados"
                        : "Pendientes"
            }
            subtitle={`${visibleRows.length} cliente(s)`}
            size="lg"
        >
            <div className="space-y-3">
                <Input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    placeholder="Buscar cliente, negocio, teléfono..."
                />

                <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                    {visibleRows.length === 0 ? (
                        <div className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-5 text-center text-[13px] font-semibold text-[#71717a]">
                            No hay clientes aquí.
                        </div>
                    ) : (
                        visibleRows.map((row) => (
                            <button
                                key={row.id}
                                type="button"
                                onClick={() => onOpenRow(row)}
                                className="block w-full rounded-xl border border-[#e5e7eb] bg-white p-3 text-left transition hover:bg-[#fafafa]"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-[13px] font-bold text-[#171717]">
                                            {eventTitle(row)}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] font-semibold text-[#9ca3af]">
                                            {eventSubtitle(row)}
                                        </div>
                                        <div className="mt-1 truncate text-[11px] font-semibold text-[#71717a]">
                                            {row.userName}
                                        </div>
                                    </div>
                                    <Badge tone={typeTone[row.type]}>{typeLabel[row.type]}</Badge>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </Modal>
    );
}

function EarningsModal({
    open,
    rows,
    total,
    onClose,
}: {
    open: boolean;
    rows: Array<{ userId: string; name: string; email?: string; visited: number; amount: number; rate: number }>;
    total: number;
    onClose: () => void;
}) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Visitados e ingresos"
            subtitle={`${rows.reduce((sum, row) => sum + row.visited, 0)} visitado(s) · ${money(total)}`}
            size="lg"
        >
            <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                {rows.length === 0 ? (
                    <div className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-5 text-center text-[13px] font-semibold text-[#71717a]">
                        Aún no hay ingresos.
                    </div>
                ) : (
                    rows.map((row) => (
                        <div
                            key={row.userId}
                            className="flex items-center gap-3 rounded-xl border border-[#e5e7eb] bg-white p-3"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold text-[#171717]">
                                    {row.name}
                                </div>
                                <div className="mt-0.5 truncate text-[11px] font-semibold text-[#9ca3af]">
                                    {row.visited} visita(s) · {money(row.rate)}/visita
                                </div>
                            </div>
                            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-black text-emerald-600">
                                {money(row.amount)}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Modal>
    );
}

function userToOption(user: UserDoc): ActivityUserOption {
    return {
        id: user.id,
        name: user.name || user.email || user.id,
        email: user.email,
        billingMode: user.billingMode || "per_visit",
        ...(user as any),
    };
}