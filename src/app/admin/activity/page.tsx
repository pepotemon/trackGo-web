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
import { ActionTile, AppIcon, Badge, Button, Card, Field, Input, KpiCard, Modal, PageHeader } from "@/components/ui";

const PAGE_SIZE = 120;

const typeLabel: Record<Exclude<ActivityEventType, "all">, string> = {
    visited: "Visitado",
    rejected: "Rechazado",
    pending: "Pendiente",
};

const typeTone: Record<Exclude<ActivityEventType, "all">, "green" | "red" | "gray"> = {
    visited: "green",
    rejected: "red",
    pending: "gray",
};

const rejectReasonLabel: Record<string, string> = {
    clavo: "Clavo",
    localizacion: "Localizacion",
    zona_riesgosa: "Zona riesgosa",
    ingresos_insuficientes: "Ingresos insuficientes",
    muy_endeudado: "Muy endeudado",
    informacion_dudosa: "Informacion dudosa",
    no_le_interesa: "No le interesa",
    no_estaba_cerrado: "No estaba cerrado",
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

function norm(value: unknown) {
    return String(value ?? "").toLowerCase().trim();
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

export default function ActivityPage() {
    const [filters, setFilters] = useState<ActivityFilters>(() => defaultFilters());
    const [users, setUsers] = useState<ActivityUserOption[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [cursor, setCursor] = useState<ActivityCursor>(null);
    const [hasMore, setHasMore] = useState(false);
    const [quickRow, setQuickRow] = useState<ActivityEventRow | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

    const rows = useMemo<ActivityEventRow[]>(() => {
        return events.map((event) => {
            const user = userMap.get(event.userId);
            return {
                ...event,
                source: String(event.id || "").startsWith("pending_") ? "pending_client" : "daily_event",
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
            setErr(error instanceof Error ? error.message : "No se pudo cargar mas actividad.");
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        queueMicrotask(() => {
            void loadInitial(defaultFilters());
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
            <PageHeader
                title="Actividad"
                subtitle="Auditoria de visitas, rechazos y pendientes del equipo."
                icon={<AppIcon name="activity" tone="purple" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <div className="grid w-full grid-cols-[1fr_44px] gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
                        {activeFiltersCount > 0 ? (
                            <Button onClick={resetFilters}>Limpiar</Button>
                        ) : null}
                        <Button
                            variant="primary"
                            onClick={() => void loadInitial(filters)}
                            disabled={loading}
                            aria-label="Actualizar actividad"
                            title="Actualizar actividad"
                            className="h-10 w-10 px-0 py-0"
                        >
                            <AppIcon name="refresh" tone="purple" size="sm" className="bg-transparent text-white ring-0" />
                        </Button>
                    </div>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="mb-3 grid grid-cols-2 gap-2 md:gap-4 xl:mb-4 xl:grid-cols-5">
                <KpiCard label="Actividad" value={stats.total} caption="Eventos + pendientes" icon="activity" tone="purple" />
                <KpiCard label="Visitados" value={stats.visited} caption="Clientes trabajados" icon="check" tone="green" />
                <KpiCard label="Rechazados" value={stats.rejected} caption="No concretados" icon="close" tone="red" />
                <KpiCard label="Pendientes" value={stats.pending} caption="Sin cierre" icon="alert" tone="orange" />
                <KpiCard label="Usuarios" value={stats.users} caption="Con actividad" icon="users" tone="blue" />
            </section>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-3 bg-[#111827] px-3 py-3 xl:bg-gradient-to-b xl:from-white xl:to-[#fbfaff] xl:px-4 xl:py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="hidden xl:block">
                            <h2 className="text-[14px] font-semibold text-[#171717]">
                                Auditoria diaria
                            </h2>
                            <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                {filteredRows.length} visibles de {events.length} cargados
                            </p>
                        </div>

                        <Input
                            value={filters.search}
                            onChange={(event) => patchFilters({ search: event.target.value })}
                            placeholder="Buscar cliente, telefono, usuario..."
                            className="xl:w-[360px]"
                        />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.25fr_1fr_150px]">
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

                <div className="flex flex-col gap-3 border-t border-white/[0.08] px-3 py-3 sm:flex-row sm:items-center sm:justify-between xl:border-[#f0f1f2] xl:px-4">
                    <p className="text-[12px] font-extrabold text-[#9CA3AF] xl:font-medium xl:text-[#9ca3af]">
                        Consulta paginada en bloques de {PAGE_SIZE}
                    </p>
                    {hasMore ? (
                        <Button onClick={loadMore} disabled={loadingMore} className="w-full sm:w-auto">
                            {loadingMore ? "Cargando..." : "Cargar mas"}
                        </Button>
                    ) : null}
                </div>
            </Card>

            <ActivityQuickActionsModal
                row={quickRow}
                onClose={() => setQuickRow(null)}
            />
        </div>
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
        <div className="border-t border-white/[0.08] xl:border-[#f0f1f2]">
            <div className="divide-y divide-white/[0.08] lg:hidden">
                {loading ? (
                    <ActivityTableState icon="refresh" title="Cargando actividad" body="Estamos consultando eventos y pendientes." />
                ) : rows.length === 0 ? (
                    <ActivityTableState icon="filter" title="Sin resultados" body="No hay actividad con esos filtros." />
                ) : (
                    rows.map((row) => (
                        <ActivityMobileCard key={row.id} row={row} onQuickActions={onQuickActions} />
                    ))
                )}
            </div>

            <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[900px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                        <th className="px-3 py-2.5">Cliente</th>
                        <th className="px-3 py-2.5">Estado</th>
                        <th className="px-3 py-2.5">Usuario</th>
                        <th className="px-3 py-2.5">Dia</th>
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
}: {
    row: ActivityEventRow;
    onQuickActions: (row: ActivityEventRow) => void;
}) {
    const reason = rejectedReasonText(row);

    return (
        <button
            type="button"
            onClick={() => onQuickActions(row)}
            className="block w-full bg-[#111827] px-3 py-3 text-left transition active:bg-[#0F172A] sm:px-4 xl:bg-white xl:active:bg-[#f8f7ff]"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[14px] font-black text-[#F9FAFB] xl:text-[13px] xl:font-bold xl:text-[#101936]">
                        {eventTitle(row)}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] font-extrabold text-[#9CA3AF] xl:text-[11px] xl:font-semibold xl:text-[#8a93ad]">
                        {eventSubtitle(row)}
                    </div>
                </div>
                <Badge tone={typeTone[row.type]}>
                    {typeLabel[row.type]}
                </Badge>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-black text-[#93C5FD] xl:font-bold xl:text-[#344054]">
                        {row.userName}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-[#CBD5E1] xl:font-medium xl:text-[#98a2b3]">
                        {row.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita"}
                    </div>
                </div>
                <div className="text-right text-[11px] font-black text-[#9CA3AF] xl:font-bold xl:text-[#66739a]">
                    {formatDate(row.createdAt)}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                {reason ? (
                    <span className="max-w-full truncate rounded-md bg-red-400/10 px-2 py-1 text-[11px] font-bold text-[#FCA5A5] xl:bg-red-50 xl:font-semibold xl:text-red-600">
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
                                        <Badge tone={typeTone[row.type]}>
                                            {typeLabel[row.type]}
                                        </Badge>
                                        {reason ? (
                                            <span className="max-w-[190px] truncate rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600">
                                                {reason}
                                            </span>
                                        ) : null}
                                        {row.source === "pending_client" ? (
                                            <Badge tone="yellow">Actual</Badge>
                                        ) : null}
                                    </div>
                                </td>

            <td className="px-3 py-2.5">
                                    <div className="max-w-[220px]">
                                        <div className="truncate text-[12px] font-semibold text-[#52525b]">
                                            {row.userName}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                            {row.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita"}
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
            <div className="mt-3 text-[13px] font-black text-[#F9FAFB] xl:font-bold xl:text-[#101936]">{title}</div>
            <div className="mt-1 text-[12px] font-bold text-[#9CA3AF] xl:font-medium xl:text-[#66739a]">{body}</div>
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

function userToOption(user: UserDoc): ActivityUserOption {
    return {
        id: user.id,
        name: user.name || user.email || user.id,
        email: user.email,
        billingMode: user.billingMode || "per_visit",
    };
}
