"use client";

import Link from "next/link";
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
import { Badge, Button, Card, Field, Input, PageHeader, StatCard } from "@/components/ui";

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
        "h-9 rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none transition focus:border-[#171717]",
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
                userName: user?.name || event.userId || "Usuario",
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
                actions={
                    <>
                        {activeFiltersCount > 0 ? (
                            <Button onClick={resetFilters}>Limpiar</Button>
                        ) : null}
                        <Button onClick={() => void loadInitial(filters)} disabled={loading}>
                            {loading ? "Cargando..." : "Actualizar"}
                        </Button>
                    </>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Eventos" value={stats.total} caption="Visibles en la vista" />
                <StatCard label="Visitados" value={stats.visited} caption="Clientes trabajados" />
                <StatCard label="Rechazados" value={stats.rejected} caption="No concretados" />
                <StatCard label="Pendientes" value={stats.pending} caption="Sin cierre" />
                <StatCard label="Usuarios" value={stats.users} caption="Con actividad" />
            </section>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 px-4 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
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

                    <div className="grid gap-2 md:grid-cols-5">
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
                                        {user.name || user.email || user.id}
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

                <ActivityTable rows={filteredRows} loading={loading} />

                <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                    <p className="text-[12px] font-medium text-[#9ca3af]">
                        Consulta paginada en bloques de {PAGE_SIZE}
                    </p>
                    {hasMore ? (
                        <Button onClick={loadMore} disabled={loadingMore}>
                            {loadingMore ? "Cargando..." : "Cargar mas"}
                        </Button>
                    ) : null}
                </div>
            </Card>
        </div>
    );
}

function ActivityTable({ rows, loading }: { rows: ActivityEventRow[]; loading: boolean }) {
    return (
        <div className="overflow-x-auto border-t border-[#f0f1f2]">
            <table className="w-full min-w-[1120px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Estado</th>
                        <th className="px-4 py-3">Usuario</th>
                        <th className="px-4 py-3">Dia</th>
                        <th className="px-4 py-3 text-right">Accion</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                                <td colSpan={5} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                Cargando actividad...
                            </td>
                        </tr>
                    ) : rows.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                No hay actividad con esos filtros.
                            </td>
                        </tr>
                    ) : (
                        rows.map((row) => (
                            <ActivityRow key={row.id} row={row} />
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function ActivityRow({ row }: { row: ActivityEventRow }) {
    const reason = rejectedReasonText(row);

    return (
        <tr className="border-b border-[#f0f1f2] last:border-0 hover:bg-[#fafafa]">
                                <td className="px-4 py-3">
                                    <div className="max-w-[360px]">
                                        <div className="truncate text-[12px] font-semibold text-[#171717]">
                                            {eventTitle(row)}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                            {eventSubtitle(row)}
                                        </div>
                                    </div>
                                </td>

                                <td className="px-4 py-3">
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

                                <td className="px-4 py-3">
                                    <div className="max-w-[220px]">
                                        <div className="truncate text-[12px] font-semibold text-[#52525b]">
                                            {row.userName}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                            {row.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita"}
                                        </div>
                                    </div>
                                </td>

                                <td className="px-4 py-3">
                                    <div className="text-[12px] font-semibold text-[#52525b]">{row.dayKey}</div>
                                    <div className="mt-0.5 text-[11px] font-medium text-[#9ca3af]">
                                        {formatDate(row.createdAt)}
                                    </div>
                                </td>

                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <ActionIconLink href={`/admin/clients/${row.clientId}`} label="Ver cliente">
                                            Ver
                                        </ActionIconLink>
                                        {row.mapsUrl ? (
                                            <ActionIconLink href={row.mapsUrl} label="Abrir maps" external>
                                                Map
                                            </ActionIconLink>
                                        ) : null}
                                        <ActionIconLink href={`/admin/leads/${row.clientId}`} label="Editar lead">
                                            Edit
                                        </ActionIconLink>
                                    </div>
                                </td>
        </tr>
    );
}

function ActionIconLink({
    href,
    label,
    external,
    children,
}: {
    href: string;
    label: string;
    external?: boolean;
    children: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            title={label}
            aria-label={label}
            className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-[#e5e7eb] bg-white px-2 text-[11px] font-semibold text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
        >
            {children}
        </Link>
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
