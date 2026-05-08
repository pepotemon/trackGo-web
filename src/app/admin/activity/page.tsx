// src/app/admin/activity/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    listActivityEventsPage,
    listPendingClientsForActivity,
    type ActivityCursor,
} from "@/data/activityRepo";
import { listAccountingUsers } from "@/data/accountingRepo";
import { assignLeadToUser, deleteLead, getClientCurrentStates } from "@/data/leadsRepo";
import { listAllAutoAssignLogsForRange, writeManualAssignLog } from "@/data/autoAssignLogsRepo";
import { AssignUserModal } from "@/features/leads/AssignUserModal";
import { dayKeyFromDate, weekRangeKeysMonToSun } from "@/lib/date";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import type {
    ActivityEventRow,
    ActivityEventType,
    ActivityFilters,
    ActivityStats,
    ActivityUserOption,
} from "@/types/activity";
import { useCan } from "@/features/auth/usePermissions";
import { useAuth } from "@/features/auth/AuthProvider";
import type { DailyEventDoc, UserDoc } from "@/types/accounting";
import type { AutoAssignLogDoc } from "@/types/leads";
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
const PENDING_START_KEY = "0000-01-01";

type ActivityViewMode = "day" | "week";

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
        "h-10 rounded-[15px] border border-white/[0.08] bg-[#0F172A] px-3 text-[13px] font-bold text-[#101936] outline-none transition focus:border-blue-400/35 focus:ring-2 focus:ring-blue-400/10 sm:h-9 sm:rounded-lg sm:text-[12px] xl:border-[#e5e7eb] xl:bg-white xl:font-semibold xl:text-[#52525b] xl:focus:border-[#7c3aed] xl:focus:ring-violet-100",
        extra,
    ].join(" ");
}

function defaultFilters(): ActivityFilters {
    const { startKey, endKey } = weekRangeKeysMonToSun();
    return {
        startKey,
        endKey,
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

function stripEmojis(str: string): string {
    if (!str) return "";
    return str
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
        .replace(/[\u{2600}-\u{27BF}]/gu, "")
        .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
        .replace(/[\u{200D}]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
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
    const raw = event.name || event.business || event.phone || event.clientId || "Cliente";
    return stripEmojis(raw);
}

function eventSubtitle(event: ActivityEventRow) {
    const business = stripEmojis(String(event.business || "").trim());
    const address = String(event.address || "").trim();
    const cleanAddress = /^https?:\/\//i.test(address) ? "" : address;

    return business || cleanAddress || event.phone || event.clientId;
}

function whatsappUrl(phone?: string | null) {
    const fixedUrl = buildWhatsAppUrl(phone, "Olá! Estou entrando em contato sobre seu cadastro");
    if (fixedUrl) return fixedUrl;
    const clean = String(phone ?? "").replace(/\D+/g, "");
    if (!clean) return "";
    return `https://wa.me/${clean}?text=${encodeURIComponent("Olá! Estou entrando em contato sobre seu cadastro 🙌")}`;
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

function viewModeLabel(mode: ActivityViewMode) {
    return mode === "day" ? "Día" : "Semana";
}

export default function ActivityPage() {
    const { profile, isSuperAdmin } = useAuth();
    const canActividad = useCan("actividad");
    const canAssignmentsView = useCan("assignmentsView");
    const [viewMode, setViewMode] = useState<ActivityViewMode>("week");
    const [filters, setFilters] = useState<ActivityFilters>(() => defaultFilters());
    const [users, setUsers] = useState<ActivityUserOption[]>([]);
    const [rawUsers, setRawUsers] = useState<UserDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [assignmentLogs, setAssignmentLogs] = useState<AutoAssignLogDoc[]>([]);
    const [cursor, setCursor] = useState<ActivityCursor>(null);
    const [hasMore, setHasMore] = useState(false);
    const [quickRow, setQuickRow] = useState<ActivityEventRow | null>(null);
    const [listMode, setListMode] = useState<Exclude<ActivityEventType, "all"> | null>(null);
    const [earningsOpen, setEarningsOpen] = useState(false);
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
    const [mobileSheetRow, setMobileSheetRow] = useState<ActivityEventRow | null>(null);
    const [mobileAssigningRow, setMobileAssigningRow] = useState<ActivityEventRow | null>(null);
    const [mobileAssigning, setMobileAssigning] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const myUserIds = useMemo(() => {
        if (isSuperAdmin || !profile) return null;
        return new Set(
            rawUsers
                .filter((u) => u.sharedWith?.some((s) => s.adminId === profile.id))
                .map((u) => u.id)
        );
    }, [rawUsers, isSuperAdmin, profile]);

    const visibleUsers = useMemo(() => {
        if (!myUserIds) return users;
        return users.filter((u) => myUserIds.has(u.id));
    }, [users, myUserIds]);

    const userMap = useMemo(() => new Map(visibleUsers.map((user) => [user.id, user])), [visibleUsers]);

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
        const { startKey, endKey } = filters;

        return rows.filter((row) => {
            if (myUserIds && !myUserIds.has(row.userId)) return false;
            if (filters.userId !== "all" && row.userId !== filters.userId) return false;
            if (filters.type !== "all" && row.type !== filters.type) return false;

            if (row.type !== "pending") {
                const dk = String(row.dayKey || "");
                if (startKey && dk < startKey) return false;
                if (endKey && dk > endKey) return false;
            }

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
    }, [filters.endKey, filters.search, filters.startKey, filters.type, filters.userId, rows]);

    // Deduplicate by clientId so a client counted as both visited+rejected
    // doesn't inflate stats. pending_client rows (current status) win over events.
    const deduplicatedRows = useMemo<ActivityEventRow[]>(() => {
        const byClient = new Map<string, ActivityEventRow>();

        for (const row of filteredRows) {
            if (row.source !== "daily_event") continue;
            const existing = byClient.get(row.clientId);
            if (!existing || row.createdAt > existing.createdAt) {
                byClient.set(row.clientId, row);
            }
        }

        for (const row of filteredRows) {
            if (row.source !== "pending_client") continue;
            byClient.set(row.clientId, row);
        }

        return Array.from(byClient.values());
    }, [filteredRows]);

    const stats = useMemo<ActivityStats>(() => {
        const { startKey, endKey } = filters;
        return {
            total: deduplicatedRows.length,
            visited: deduplicatedRows.filter((row) => row.type === "visited").length,
            rejected: deduplicatedRows.filter((row) => row.type === "rejected").length,
            pending: deduplicatedRows.filter((row) => row.type === "pending").length,
            // Count assignments within the selected date range (pending rows bypass filteredRows date-check,
            // so we apply the range check here manually so the counter respects the filter)
            users: assignmentLogs.filter((log) => {
                if (myUserIds && (!log.userId || !myUserIds.has(log.userId))) return false;
                if (filters.userId !== "all" && log.userId !== filters.userId) return false;
                const dk = String(log.dayKey || "");
                if (startKey && dk < startKey) return false;
                if (endKey && dk > endKey) return false;
                return true;
            }).length,
        };
    }, [assignmentLogs, deduplicatedRows, filters, myUserIds]);

    const activityRowsByType = useMemo(() => {
        return {
            visited: deduplicatedRows.filter((row) => row.type === "visited"),
            rejected: deduplicatedRows.filter((row) => row.type === "rejected"),
            pending: deduplicatedRows.filter((row) => row.type === "pending"),
        };
    }, [deduplicatedRows]);

    const earningsRows = useMemo(() => {
        const byUser = new Map<
            string,
            { userId: string; name: string; email?: string; visited: number; amount: number; rate: number }
        >();

        for (const row of activityRowsByType.visited) {
            const user = userMap.get(row.userId);
            // Prefer frozen rate stored in the event over current user rate
            const frozenRate = row.rateApplied ?? row.amountSnapshot ?? row.ratePerVisitSnapshot;
            const rate = typeof frozenRate === "number" && Number.isFinite(frozenRate)
                ? frozenRate
                : getRatePerVisit(user);

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

    const MAX_SAFETY_PAGES = 30;

    const loadInitial = useCallback(async (nextFilters: ActivityFilters) => {
        setLoading(true);
        setErr(null);

        try {
            const [userDocs, pendingClients, nextAssignmentLogs] = await Promise.all([
                listAccountingUsers(),
                listPendingClientsForActivity({
                    startKey: PENDING_START_KEY,
                    endKey: "9999-12-31",
                    pageSize: 2000,
                }),
                listAllAutoAssignLogsForRange(nextFilters.startKey, nextFilters.endKey),
            ]);

            let allEvents: DailyEventDoc[] = [];
            let nextCursor: ActivityCursor = null;
            let nextHasMore = true;
            let pages = 0;

            // Load all pages for the date range so stats are accurate
            while (nextHasMore && pages < MAX_SAFETY_PAGES) {
                const page = await listActivityEventsPage({
                    startKey: nextFilters.startKey,
                    endKey: nextFilters.endKey,
                    pageSize: PAGE_SIZE,
                    cursor: nextCursor ?? undefined,
                });
                allEvents = [...allEvents, ...page.events];
                nextCursor = page.cursor;
                nextHasMore = page.hasMore;
                pages++;
            }

            setRawUsers(userDocs);
            setUsers(userDocs.map(userToOption));
            setAssignmentLogs(nextAssignmentLogs);
            setEvents(mergeActivityEvents(allEvents, pendingClients));
            setCursor(nextCursor);
            setHasMore(nextHasMore);
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
            const next = defaultFilters();
            setViewMode("week");
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

    function changeViewMode(mode: ActivityViewMode) {
        const next = mode === "day" ? todayFilters() : defaultFilters();
        setViewMode(mode);
        setMobileFiltersOpen(false);
        setFilters(next);
        void loadInitial(next);
    }

    function resetFilters() {
        const base = viewMode === "day" ? todayFilters() : defaultFilters();
        const next = {
            ...base,
            userId: "all",
            type: "all" as const,
            search: "",
        };

        setFilters(next);
        void loadInitial(next);
    }

    if (!canActividad) return <NoPermission />;

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <div className="xl:hidden">
                <MobileActivityView
                    viewMode={viewMode}
                    rows={filteredRows}
                    stats={stats}
                    filters={filters}
                    users={visibleUsers}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    canAssignmentsView={canAssignmentsView}
                    activeFiltersCount={activeFiltersCount}
                    amountTotal={amountTotal}
                    filterModalOpen={mobileFiltersOpen}
                    onChangeViewMode={changeViewMode}
                    onOpenFilters={() => setMobileFiltersOpen(true)}
                    onCloseFilters={() => setMobileFiltersOpen(false)}
                    onPatchFilters={patchFilters}
                    onApplyRange={applyRange}
                    onResetFilters={resetFilters}
                    onRefresh={() => void loadInitial(filters)}
                    onLoadMore={loadMore}
                    onOpenList={setListMode}
                    onOpenEarnings={() => setEarningsOpen(true)}
                    onOpenSheet={setMobileSheetRow}
                />
            </div>

            <div className="hidden xl:block">
                <PageHeader
                    title="Actividad"
                    subtitle="Auditoría de visitas, rechazos, pendientes y asignaciones del equipo."
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

                <section className={["mb-4 grid gap-4", canAssignmentsView ? "grid-cols-5" : "grid-cols-4"].join(" ")}>
                    <KpiCard label="Actividad" value={stats.total} caption={`${viewModeLabel(viewMode)} · eventos + pendientes`} icon="activity" tone="purple" />
                    <KpiCard label="Visitados" value={stats.visited} caption="Clientes trabajados" icon="check" tone="green" />
                    <KpiCard label="Rechazados" value={stats.rejected} caption="No concretados" icon="close" tone="red" />
                    <KpiCard label="Pendientes" value={stats.pending} caption="Todos los pendientes activos" icon="alert" tone="orange" />
                    {canAssignmentsView ? (
                        <Link href="/admin/leads/assignments" className="block transition hover:opacity-90 hover:scale-[1.01]">
                            <KpiCard label="Asignaciones" value={stats.users} caption="Ver historial de asignaciones" icon="assign" tone="blue" />
                        </Link>
                    ) : (
                        <KpiCard label="Asignaciones" value={stats.users} caption="En el rango seleccionado" icon="assign" tone="blue" />
                    )}
                </section>

                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 bg-gradient-to-b from-white to-[#fbfaff] px-4 py-4">
                        <div className="flex flex-row items-center justify-between gap-3">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#171717]">
                                    Registros
                                </h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#66739A]">
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

                        <p className="text-[11px] font-semibold text-[#98a2b3]">
                            Pendientes incluye todos los clientes activos sin respetar rango de fechas.
                        </p>
                    </div>

                    <ActivityTable rows={filteredRows} loading={loading} onQuickActions={setQuickRow} />

                    <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                        <p className="text-[12px] font-medium text-[#66739A]">
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
                users={visibleUsers}
                onClose={() => setListMode(null)}
                onOpenSheet={setMobileSheetRow}
                onChanged={() => loadInitial(filters)}
            />

            <EarningsModal
                open={earningsOpen}
                rows={earningsRows}
                total={amountTotal}
                onClose={() => setEarningsOpen(false)}
            />

            <ActivityActionSheet
                row={mobileSheetRow}
                open={!!mobileSheetRow}
                onClose={() => setMobileSheetRow(null)}
                onOpenAssign={(row) => { setMobileSheetRow(null); setMobileAssigningRow(row); }}
                onDelete={(clientId) => {
                    setMobileSheetRow(null);
                    setEvents((prev) => prev.filter((e) => e.clientId !== clientId));
                }}
            />
            <AssignUserModal
                open={!!mobileAssigningRow}
                onClose={() => setMobileAssigningRow(null)}
                users={users}
                title="Reasignar a usuario"
                saving={mobileAssigning}
                onAssign={async (userId) => {
                    if (!mobileAssigningRow) return;
                    setMobileAssigning(true);
                    try {
                        await assignLeadToUser(mobileAssigningRow.clientId, userId);
                        const assignedUser = users.find((u) => u.id === userId);
                        writeManualAssignLog({
                            leadId: mobileAssigningRow.clientId,
                            leadName: mobileAssigningRow.name,
                            leadPhone: mobileAssigningRow.phone,
                            leadBusiness: mobileAssigningRow.business,
                            userId,
                            userName: assignedUser?.name || assignedUser?.email || null,
                        }).catch(() => {});
                        setMobileAssigningRow(null);
                    } finally {
                        setMobileAssigning(false);
                    }
                }}
            />
        </div>
    );
}

function ViewModeSwitch({
    value,
    onChange,
}: {
    value: ActivityViewMode;
    onChange: (mode: ActivityViewMode) => void;
}) {
    return (
        <div className="grid h-10 w-[180px] grid-cols-2 rounded-2xl border border-[#e5e7eb] bg-[#f8fafc] p-1">
            {(["day", "week"] as ActivityViewMode[]).map((mode) => {
                const active = value === mode;

                return (
                    <button
                        key={mode}
                        type="button"
                        onClick={() => onChange(mode)}
                        className={[
                            "rounded-xl text-[12px] font-black transition",
                            active
                                ? "bg-[#7c3aed] text-white shadow-sm"
                                : "text-[#667085] hover:bg-white",
                        ].join(" ")}
                    >
                        {mode === "day" ? "Día" : "Semana"}
                    </button>
                );
            })}
        </div>
    );
}

function MobileActivityView({
    viewMode,
    rows,
    stats,
    filters,
    users,
    loading,
    loadingMore,
    hasMore,
    canAssignmentsView,
    activeFiltersCount,
    amountTotal,
    filterModalOpen,
    onChangeViewMode,
    onOpenFilters,
    onCloseFilters,
    onPatchFilters,
    onApplyRange,
    onResetFilters,
    onRefresh,
    onLoadMore,
    onOpenList,
    onOpenEarnings,
    onOpenSheet,
}: {
    viewMode: ActivityViewMode;
    rows: ActivityEventRow[];
    stats: ActivityStats;
    filters: ActivityFilters;
    users: ActivityUserOption[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    canAssignmentsView: boolean;
    activeFiltersCount: number;
    amountTotal: number;
    filterModalOpen: boolean;
    onChangeViewMode: (mode: ActivityViewMode) => void;
    onOpenFilters: () => void;
    onCloseFilters: () => void;
    onPatchFilters: (patch: Partial<ActivityFilters>) => void;
    onApplyRange: () => void;
    onResetFilters: () => void;
    onRefresh: () => void;
    onLoadMore: () => void;
    onOpenList: (mode: Exclude<ActivityEventType, "all">) => void;
    onOpenEarnings: () => void;
    onOpenSheet: (row: ActivityEventRow) => void;
}) {
    const done = stats.visited + stats.rejected;
    const pct = stats.total <= 0 ? 0 : Math.round((done / Math.max(1, stats.total)) * 100);

    return (
        <>
        <div className="tg-screen-enter -mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.16),transparent_34%),linear-gradient(180deg,#FBFAFF_0%,#F6F3FF_48%,#FFFFFF_100%)] pb-6 text-[#101936]">

            {/* STICKY HEADER */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-3 backdrop-blur-md">

                {/* TITLE ROW */}
                <div className="mb-3 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black text-[#101936]">Actividad</h1>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#66739A]">
                            <span className="font-black text-[#7C3AED]">{done}</span> / {stats.total} completados
                        </p>
                    </div>

                    {/* ingresos */}
                    <button
                        type="button"
                        onClick={onOpenEarnings}
                        className="inline-flex h-9 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-600"
                    >
                        R$ {Number(amountTotal || 0).toFixed(2)}
                    </button>

                    {/* Day/Week single toggle */}
                    <button
                        type="button"
                        onClick={() => onChangeViewMode(viewMode === "day" ? "week" : "day")}
                        className="flex h-9 items-center rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[12px] font-black text-[#101936] transition active:bg-[#f3f0ff]"
                    >
                        {viewMode === "day" ? "Día" : "Semana"}
                    </button>

                    {/* Refresh */}
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white transition active:bg-[#f3f0ff]"
                    >
                        <AppIcon name="refresh" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0" />
                    </button>
                </div>

                {/* STAT BUTTONS */}
                <div className="mb-3 grid grid-cols-4 gap-2">
                    <MobileStatButton
                        label="Visitados"
                        value={stats.visited}
                        icon="check"
                        color="text-green-600"
                        onClick={() => onOpenList("visited")}
                        disabled={stats.visited <= 0}
                    />
                    <MobileStatButton
                        label="Rechazados"
                        value={stats.rejected}
                        icon="close"
                        color="text-red-500"
                        onClick={() => onOpenList("rejected")}
                        disabled={stats.rejected <= 0}
                    />
                    <MobileStatButton
                        label="Pendientes"
                        value={stats.pending}
                        icon="alert"
                        color="text-yellow-500"
                        onClick={() => onOpenList("pending")}
                        disabled={stats.pending <= 0}
                    />
                    <MobileStatButton
                        label="Asignados"
                        value={stats.users}
                        icon="assign"
                        color="text-blue-600"
                        href={canAssignmentsView ? "/admin/leads/assignments" : undefined}
                        featured
                    />
                </div>

                {/* SEARCH + FILTER */}
                <div className="flex gap-2">
                    <div className="flex h-[46px] flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 shadow-[0_2px_12px_rgba(91,33,255,0.07)]">
                        <AppIcon name="search" tone="purple" size="sm" className="h-5 w-5 shrink-0 bg-transparent text-[#98A2B3] ring-0" />
                        <input
                            value={filters.search}
                            onChange={(e) => onPatchFilters({ search: e.target.value })}
                            placeholder="Buscar..."
                            className="min-w-0 flex-1 bg-transparent font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            style={{ fontSize: "16px" }}
                        />
                        {filters.search ? (
                            <button
                                type="button"
                                onClick={() => onPatchFilters({ search: "" })}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f0ff] text-[16px] text-[#7C3AED]"
                            >
                                ×
                            </button>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onOpenFilters}
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
            </div>

            {/* PROGRESS BAR (outside sticky, scrolls with content) */}
            <div className="px-3 pt-3">
                <div className="rounded-xl border border-[#E8E7FB] bg-white px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-[#66739A]">
                        {filters.startKey} → {filters.endKey}
                    </p>
                    <div className="mt-2 h-2 rounded-full bg-[#EEF2FF]">
                        <div className="h-full rounded-full bg-[#7C3AED]" style={{ width: `${pct}%` }} />
                    </div>
                </div>
            </div>

            {/* LIST */}
            <div className="grid gap-2 overflow-x-hidden px-3 pt-3">
                {loading ? (
                    <ActivityTableState icon="refresh" title="Cargando" body="Estamos preparando la actividad." />
                ) : rows.length === 0 ? (
                    <ActivityTableState icon="filter" title="Sin resultados" body="No hay actividad con esos filtros." />
                ) : (
                    rows.map((row) => (
                        <ActivityMobileCard key={row.id} row={row} onOpenSheet={onOpenSheet} />
                    ))
                )}

                {hasMore && (
                    <button
                        type="button"
                        onClick={onLoadMore}
                        className="mt-2 h-12 rounded-xl border border-[#E8E7FB] bg-white text-[12px] font-bold text-[#7C3AED]"
                    >
                        {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                )}
            </div>
        </div>

        {/* Modals rendered outside the animated container to avoid stacking context issues */}
        <MobileActivityFiltersModal
            open={filterModalOpen}
            onClose={onCloseFilters}
            filters={filters}
            users={users}
            onPatchFilters={onPatchFilters}
            onResetFilters={() => { onResetFilters(); onCloseFilters(); }}
            onApply={() => { onApplyRange(); onCloseFilters(); }}
        />
        </>
    );
}

function MobileStatButton({
    label,
    value,
    icon,
    color,
    onClick,
    disabled,
    href,
    featured,
}: {
    label: string;
    value: number;
    icon: "check" | "close" | "alert" | "users" | "assign";
    color: string;
    onClick?: () => void;
    disabled?: boolean;
    href?: string;
    featured?: boolean;
}) {
    const content = (
        <>
            <div className="flex items-center justify-center gap-1">
                <AppIcon name={icon} tone="slate" size="sm" className={`h-4 w-4 bg-transparent ring-0 ${color}`} />
                <span className="text-[13px] font-black text-[#101936]">{value}</span>
            </div>
            <div className="mt-1 truncate text-center text-[9px] font-black text-[#66739A]">{label}</div>
        </>
    );

    const base = featured
        ? "min-w-0 rounded-[14px] border border-blue-200 bg-gradient-to-br from-blue-50 to-violet-50 px-1.5 py-2.5 shadow-[0_8px_22px_rgba(91,33,255,0.12)] transition active:bg-[#f3f0ff]"
        : "min-w-0 rounded-[14px] border border-[#E8E7FB] bg-white px-1.5 py-2.5 shadow-[0_4px_16px_rgba(91,33,255,0.07)] transition active:bg-[#f3f0ff]";

    if (href) {
        return (
            <Link href={href} className={base}>
                {content}
            </Link>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick || disabled}
            className={`${base} disabled:opacity-50`}
        >
            {content}
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
            <span className="text-[11px] font-black text-[#66739A]">{label}</span>
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
    compact = false,
    onOpenSheet,
}: {
    row: ActivityEventRow;
    compact?: boolean;
    onOpenSheet?: (row: ActivityEventRow) => void;
}) {
    const reason = rejectedReasonText(row);

    return (
        <>
            <article className={[
                "block w-full max-w-full overflow-hidden rounded-[15px] border border-[#E8E7FB] bg-white text-left shadow-[0_4px_18px_rgba(91,33,255,0.06)]",
                compact ? "px-2.5 py-2.5" : "px-3 py-3",
            ].join(" ")}>
                <div className="flex items-start justify-between gap-2">
                    <Link href={`/admin/clients/${row.clientId}`} className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-black text-[#101936]">
                            {eventTitle(row)}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                            {eventSubtitle(row)}
                        </div>
                    </Link>

                    <div className="flex shrink-0 items-center gap-1.5">
                        {row.type === "rejected" ? (
                            reason ? (
                                <span className="max-w-[120px] truncate rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                                    {reason}
                                </span>
                            ) : null
                        ) : (
                            <Badge tone={typeTone[row.type]}>{typeLabel[row.type]}</Badge>
                        )}
                        <button
                            type="button"
                            onClick={() => onOpenSheet?.(row)}
                            className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
                            aria-label="Acciones"
                        >
                            <AppIcon name="more" tone="slate" size="sm" className="h-[14px] w-[14px] bg-transparent text-[#98A2B3] ring-0" />
                        </button>
                    </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <AppIcon name="user" tone="slate" size="sm" className="h-3.5 w-3.5 shrink-0 bg-transparent text-[#7C3AED] ring-0" />
                        <span className="truncate text-[12px] font-black text-[#7C3AED]">
                            {row.userName}
                        </span>
                    </div>
                    <div className="shrink-0 text-right text-[10px] font-semibold text-[#98A2B3]">
                        {formatDate(row.createdAt)}
                    </div>
                </div>

                {row.source === "pending_client" && row.type !== "pending" ? (
                    <div className="mt-2">
                        <Badge tone="yellow">Actual</Badge>
                    </div>
                ) : null}
            </article>
        </>
    );
}

function ActivityActionSheet({
    row,
    open,
    onClose,
    onOpenAssign,
    onDelete,
}: {
    row: ActivityEventRow | null;
    open: boolean;
    onClose: () => void;
    onOpenAssign?: (row: ActivityEventRow) => void;
    onDelete?: (clientId: string) => void;
}) {
    const canAssign = useCan("leadsAssign");
    const canDelete = useCan("leadsDelete");
    const canWhatsapp = useCan("leadsWhatsapp");
    const canClientView = useCan("activityClientView");
    const canActivityMaps = useCan("activityMaps");
    const canActivityChat = useCan("activityChat");
    const canActivityEdit = useCan("activityEdit");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!open) { setConfirmDelete(false); setDeleting(false); }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = () => onClose();
        window.addEventListener("scroll", handler, { passive: true });
        return () => window.removeEventListener("scroll", handler);
    }, [open, onClose]);
    useBackButtonDismiss(open, onClose);

    if (!open || !row) return null;

    const waUrl = whatsappUrl(row.phone);

    async function handleDelete() {
        if (!onDelete) return;
        setDeleting(true);
        try {
            await deleteLead(row!.clientId);
            onDelete(row!.clientId);
        } catch {
            setDeleting(false);
            setConfirmDelete(false);
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={onClose}
                className="fixed inset-0 z-40 bg-black/40 xl:hidden"
                aria-label="Cerrar"
            />
            <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] xl:hidden">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB]" />

                <div className="mb-4 min-w-0">
                    <p className="truncate text-[15px] font-black text-[#101936]">{eventTitle(row)}</p>
                    {eventSubtitle(row) ? (
                        <p className="mt-0.5 truncate text-[12px] font-semibold text-[#66739A]">{eventSubtitle(row)}</p>
                    ) : null}
                </div>

                {confirmDelete ? (
                    <div className="grid gap-2">
                        <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
                            ¿Eliminar este prospecto? Esta acción no se puede deshacer.
                        </div>
                        <button
                            type="button"
                            disabled={deleting}
                            onClick={handleDelete}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-red-600 px-4 text-[14px] font-bold text-white transition active:bg-red-700 disabled:opacity-60"
                        >
                            {deleting ? "Eliminando..." : "Sí, eliminar"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="min-h-[48px] w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] text-[14px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                        >
                            Cancelar
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="grid gap-2">
                            {canClientView ? (
                                <Link
                                    href={`/admin/clients/${row.clientId}`}
                                    className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#eff6ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-blue-100"
                                >
                                    <AppIcon name="users" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-blue-600 ring-0" />
                                    Ver cliente
                                </Link>
                            ) : null}

                            {(canActivityChat || canActivityEdit) ? (
                                <Link
                                    href={`/admin/leads/${row.clientId}?from=activity`}
                                    className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                                >
                                    <AppIcon name={canActivityChat ? "chat" : "edit"} tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                                    {canActivityChat && canActivityEdit ? "Chat / Editar" : canActivityChat ? "Chat" : "Editar"}
                                </Link>
                            ) : null}

                            {canAssign && onOpenAssign ? (
                                <button
                                    type="button"
                                    onClick={() => onOpenAssign(row)}
                                    className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                                >
                                    <AppIcon name="assign" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                                    Reasignar
                                </button>
                            ) : null}

                            {row.mapsUrl && canActivityMaps ? (
                                <a
                                    href={row.mapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100"
                                >
                                    <AppIcon name="map" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-emerald-600 ring-0" />
                                    Maps
                                </a>
                            ) : null}

                            {waUrl && canWhatsapp ? (
                                <a
                                    href={waUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100"
                                >
                                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-emerald-600 stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92Z" />
                                    </svg>
                                    WhatsApp
                                </a>
                            ) : null}

                            {canDelete && onDelete ? (
                                <button
                                    type="button"
                                    onClick={() => setConfirmDelete(true)}
                                    className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-red-50 px-4 text-[14px] font-bold text-red-600 transition active:bg-red-100"
                                >
                                    <AppIcon name="close" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-red-500 ring-0" />
                                    Eliminar prospecto
                                </button>
                            ) : null}
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-3 min-h-[48px] w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] text-[14px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                        >
                            Cancelar
                        </button>
                    </>
                )}
            </div>
        </>
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
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#66739A]">
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
                <div className="flex max-w-[220px] items-center gap-1.5">
                    <AppIcon name="user" tone="slate" size="sm" className="h-3.5 w-3.5 shrink-0 bg-transparent text-[#66739A] ring-0" />
                    <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-[#52525b]">
                            {row.userName}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] font-medium text-[#66739A]">
                            {row.billingMode === "weekly_subscription" ? "Suscripción" : "Por visita"}
                        </div>
                    </div>
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="text-[12px] font-semibold text-[#52525b]">{row.dayKey}</div>
                <div className="mt-0.5 text-[11px] font-medium text-[#66739A]">
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
            {icon === "refresh" ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                    <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    </svg>
                </div>
            ) : (
                <AppIcon name="filter" tone="slate" size="lg" />
            )}
            <div className="mt-3 text-[13px] font-semibold text-[#66739a]">
                {title}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[#98a2b3]">
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
    const canClientView = useCan("activityClientView");
    const canMaps = useCan("activityMaps");
    const canChat = useCan("activityChat");
    const canEdit = useCan("activityEdit");

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
                {canClientView ? (
                    <ActionTile href={`/admin/clients/${row.clientId}`} label="Ver cliente" icon="users" tone="blue" />
                ) : null}
                {row.mapsUrl && canMaps ? (
                    <ActionTile href={row.mapsUrl} label="Abrir Maps" icon="map" tone="green" external />
                ) : null}
                {(canChat || canEdit) ? (
                    <ActionTile href={`/admin/leads/${row.clientId}?from=activity`} label={canChat && canEdit ? "Chat / Editar" : canChat ? "Chat" : "Editar"} icon={canChat ? "chat" : "edit"} tone="orange" />
                ) : null}
                {!canClientView && !canMaps && !canChat && !canEdit ? (
                    <div className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-4 text-center text-[12px] font-semibold text-[#667085]">
                        No tienes permisos para acciones sobre este cliente.
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}

type ClientFollowUp = { status: string; assignedTo: string | null; takenFromIncompleteAt?: number | null };

function followUpBadge(state: ClientFollowUp | undefined, originalUserId: string, mode?: string | null) {
    if (!state) return null;
    if (state.status === "visited") {
        return <Badge tone="green">Visitado ✓</Badge>;
    }
    if (state.assignedTo && state.assignedTo !== originalUserId) {
        return <Badge tone="yellow">Reasignado</Badge>;
    }
    if (mode === "pending" && state.takenFromIncompleteAt) {
        return <Badge tone="yellow">Tomado</Badge>;
    }
    if (state.status === "pending") {
        return <Badge tone="blue">Pendiente</Badge>;
    }
    return null;
}

function ActivityListModal({
    mode,
    rows,
    users,
    onClose,
    onOpenSheet,
    onChanged,
}: {
    mode: Exclude<ActivityEventType, "all"> | null;
    rows: ActivityEventRow[];
    users: ActivityUserOption[];
    onClose: () => void;
    onOpenSheet?: (row: ActivityEventRow) => void;
    onChanged?: () => void;
}) {
    const canAssign = useCan("leadsAssign");
    const canDelete = useCan("leadsDelete");
    const [q, setQ] = useState("");
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
    const [clientStates, setClientStates] = useState<Map<string, ClientFollowUp>>(new Map());
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
    const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
    const [bulkSaving, setBulkSaving] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setSelectionMode(false);
        setSelectedClientIds(new Set());
        setBulkAssignOpen(false);
    }, [mode]);

    useEffect(() => {
        if ((mode !== "rejected" && mode !== "pending") || !rows.length) {
            setClientStates(new Map());
            return;
        }
        const ids = [...new Set(rows.map((r) => r.clientId).filter(Boolean))];
        getClientCurrentStates(ids).then(setClientStates).catch(() => {});
    }, [mode, rows]);

    function rowKey(row: ActivityEventRow) {
        return row.clientId || row.id;
    }

    function toggleUser(userId: string) {
        setExpandedUsers((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    }

    function toggleRow(row: ActivityEventRow) {
        const key = rowKey(row);
        if (!key) return;

        setSelectedClientIds((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            if (next.size === 0) setSelectionMode(false);
            return next;
        });
    }

    function startLongPress(row: ActivityEventRow) {
        if (!canAssign && !canDelete) return;
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = setTimeout(() => {
            setSelectionMode(true);
            setSelectedClientIds((prev) => new Set(prev).add(rowKey(row)));
        }, 430);
    }

    function clearLongPress() {
        if (!longPressTimer.current) return;
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
    }

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

    const selectedRows = useMemo(() => {
        const seen = new Set<string>();
        const selected: ActivityEventRow[] = [];

        for (const row of visibleRows) {
            const key = rowKey(row);
            if (!key || !selectedClientIds.has(key) || seen.has(key)) continue;
            seen.add(key);
            selected.push(row);
        }

        return selected;
    }, [selectedClientIds, visibleRows]);

    const groupedRows = useMemo(() => {
        const map = new Map<string, { userId: string; userName: string; rows: ActivityEventRow[] }>();

        for (const row of visibleRows) {
            const existing = map.get(row.userId);
            if (existing) {
                existing.rows.push(row);
            } else {
                map.set(row.userId, { userId: row.userId, userName: row.userName, rows: [row] });
            }
        }

        return Array.from(map.values()).sort((a, b) => a.userName.localeCompare(b.userName));
    }, [visibleRows]);

    async function bulkAssign(userId: string) {
        const targetUser = users.find((user) => user.id === userId);
        setBulkSaving(true);

        try {
            for (const row of selectedRows) {
                await assignLeadToUser(row.clientId, userId);
                writeManualAssignLog({
                    leadId: row.clientId,
                    leadName: row.name,
                    leadPhone: row.phone,
                    leadBusiness: row.business,
                    userId,
                    userName: targetUser?.name || targetUser?.email || null,
                }).catch(() => {});
            }

            setBulkAssignOpen(false);
            setSelectedClientIds(new Set());
            setSelectionMode(false);
            onChanged?.();
        } finally {
            setBulkSaving(false);
        }
    }

    async function bulkDelete() {
        if (!selectedRows.length) return;
        const ok = window.confirm(`Eliminar ${selectedRows.length} prospecto(s)? Esta accion no se puede deshacer.`);
        if (!ok) return;

        setBulkSaving(true);
        try {
            for (const row of selectedRows) {
                await deleteLead(row.clientId);
            }
            setSelectedClientIds(new Set());
            setSelectionMode(false);
            onChanged?.();
        } finally {
            setBulkSaving(false);
        }
    }

    if (!mode) return null;

    const modalTitle = mode === "visited" ? "Visitados" : mode === "rejected" ? "Rechazados" : "Pendientes";

    return (
        <>
            <Modal
                open={!!mode}
                onClose={onClose}
                title={modalTitle}
                subtitle={selectionMode ? `${selectedRows.length} seleccionado(s)` : `${visibleRows.length} cliente(s) · ${groupedRows.length} usuario(s)`}
                size="lg"
            >
                <div className="space-y-3">
                    <Input
                        value={q}
                        onChange={(event) => setQ(event.target.value)}
                        placeholder="Buscar cliente, negocio, teléfono..."
                    />

                    {selectionMode ? (
                        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#ded8ff] bg-[#f8f7ff] p-2 shadow-sm">
                            <div className="text-[12px] font-black text-[#101936]">
                                {selectedRows.length} seleccionado(s)
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canAssign ? (
                                    <Button type="button" variant="primary" disabled={!selectedRows.length || bulkSaving} onClick={() => setBulkAssignOpen(true)}>
                                        Reasignar
                                    </Button>
                                ) : null}
                                {canDelete ? (
                                    <Button type="button" variant="danger" disabled={!selectedRows.length || bulkSaving} onClick={bulkDelete}>
                                        Eliminar
                                    </Button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setSelectionMode(false);
                                        setSelectedClientIds(new Set());
                                    }}
                                >
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[11px] font-semibold text-[#98A2B3]">
                            Mantén presionado un cliente para seleccionar varios.
                        </p>
                    )}

                    <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                        {groupedRows.length === 0 ? (
                            <div className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-5 text-center text-[13px] font-semibold text-[#71717a]">
                                No hay clientes aquí.
                            </div>
                        ) : (
                            groupedRows.map((group) => {
                                const isExpanded = expandedUsers.has(group.userId);

                                return (
                                    <div key={group.userId} className="overflow-hidden rounded-[14px] border border-[#E8E7FB] bg-white">
                                        <button
                                            type="button"
                                            onClick={() => toggleUser(group.userId)}
                                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-[#f8f7ff]"
                                        >
                                            <div className="flex items-center gap-2">
                                                <AppIcon name="users" tone="purple" size="sm" className="h-4 w-4 bg-transparent text-[#7C3AED] ring-0" />
                                                <span className="text-[13px] font-black text-[#101936]">
                                                    {group.userName}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge tone="blue">{group.rows.length}</Badge>
                                                <AppIcon
                                                    name={isExpanded ? "close" : "plus"}
                                                    tone="slate"
                                                    size="sm"
                                                    className="h-[14px] w-[14px] bg-transparent text-[#98A2B3] ring-0"
                                                />
                                            </div>
                                        </button>

                                        {isExpanded ? (
                                            <div className="divide-y divide-[#f0f1f2] border-t border-[#f0f1f2]">
                                                {group.rows.map((row) => {
                                                    const selected = selectedClientIds.has(rowKey(row));

                                                    return (
                                                        <div
                                                            key={row.id}
                                                            onPointerDown={() => startLongPress(row)}
                                                            onPointerUp={clearLongPress}
                                                            onPointerCancel={clearLongPress}
                                                            onPointerLeave={clearLongPress}
                                                            onClick={(event) => {
                                                                if (!selectionMode) return;
                                                                event.preventDefault();
                                                                toggleRow(row);
                                                            }}
                                                            className={[
                                                                "flex items-center gap-2 px-3 py-2.5 transition hover:bg-[#f8f7ff]",
                                                                selected ? "bg-[#f3f0ff]" : "",
                                                            ].join(" ")}
                                                        >
                                                            {selectionMode ? (
                                                                <span
                                                                    className={[
                                                                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                                                                        selected ? "border-[#7C3AED] bg-[#7C3AED]" : "border-[#D0D5DD] bg-white",
                                                                    ].join(" ")}
                                                                >
                                                                    {selected ? <AppIcon name="check" tone="slate" size="sm" className="h-3 w-3 bg-transparent text-white ring-0" /> : null}
                                                                </span>
                                                            ) : null}
                                                            <Link
                                                                href={`/admin/clients/${row.clientId}`}
                                                                onClick={(event) => {
                                                                    if (!selectionMode) return;
                                                                    event.preventDefault();
                                                                }}
                                                                className="min-w-0 flex-1"
                                                            >
                                                                <div className="truncate text-[13px] font-bold text-[#101936]">
                                                                    {eventTitle(row)}
                                                                </div>
                                                                {eventSubtitle(row) ? (
                                                                    <div className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                                                                        {eventSubtitle(row)}
                                                                    </div>
                                                                ) : null}
                                                            </Link>
                                                            {(() => {
                                                                const fb = followUpBadge(clientStates.get(row.clientId), row.userId, mode);
                                                                return fb ?? (
                                                                    <Badge tone={typeTone[row.type]}>
                                                                        {row.type === "rejected" ? rejectedReasonText(row) || "Sin motivo" : typeLabel[row.type]}
                                                                    </Badge>
                                                                );
                                                            })()}
                                                            {onOpenSheet ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { onClose(); onOpenSheet(row); }}
                                                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff] xl:hidden"
                                                                    aria-label="Acciones"
                                                                >
                                                                    <AppIcon name="more" tone="slate" size="sm" className="h-[14px] w-[14px] bg-transparent text-[#98A2B3] ring-0" />
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </Modal>

            <Modal
                open={bulkAssignOpen}
                onClose={() => setBulkAssignOpen(false)}
                title="Reasignar seleccionados"
                subtitle={`${selectedRows.length} prospecto(s) seleccionados`}
                size="sm"
            >
                <div className="grid gap-2">
                    {users.length === 0 ? (
                        <p className="rounded-2xl border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-4 py-6 text-center text-[12px] font-semibold text-[#667085]">
                            No hay usuarios disponibles.
                        </p>
                    ) : (
                        users.map((user) => (
                            <button
                                key={user.id}
                                type="button"
                                disabled={bulkSaving}
                                onClick={() => bulkAssign(user.id)}
                                className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-[#E8E7FB] bg-white px-3 text-left transition hover:bg-[#f8f7ff] disabled:opacity-60"
                            >
                                <AppIcon name="user" tone="purple" size="sm" />
                                <span className="min-w-0 flex-1 truncate text-[13px] font-black text-[#101936]">
                                    {user.name || user.email || "Usuario"}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </Modal>
        </>
    );
}

function MobileActivityFiltersModal({
    open,
    onClose,
    filters,
    users,
    onPatchFilters,
    onResetFilters,
    onApply,
}: {
    open: boolean;
    onClose: () => void;
    filters: ActivityFilters;
    users: ActivityUserOption[];
    onPatchFilters: (patch: Partial<ActivityFilters>) => void;
    onResetFilters: () => void;
    onApply: () => void;
}) {
    useBackButtonDismiss(open, onClose);

    if (!open) return null;

    return (
        <>
            <button
                type="button"
                onClick={onClose}
                className="fixed inset-0 z-40 bg-black/40 xl:hidden"
                aria-label="Cerrar filtros"
            />
            <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.15)] xl:hidden">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB]" />

                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AppIcon name="filter" tone="purple" size="sm" className="h-4 w-4 bg-transparent text-[#7C3AED] ring-0" />
                        <h3 className="text-[15px] font-black text-[#101936]">Filtros</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onResetFilters}
                        className="text-[12px] font-bold text-[#7C3AED] transition active:opacity-70"
                    >
                        Limpiar
                    </button>
                </div>

                <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2">
                        <MobileField label="Desde">
                            <input
                                type="date"
                                value={filters.startKey}
                                onChange={(e) => onPatchFilters({ startKey: e.target.value })}
                                className="h-10 w-full rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-2 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                                style={{ fontSize: "16px" }}
                            />
                        </MobileField>
                        <MobileField label="Hasta">
                            <input
                                type="date"
                                value={filters.endKey}
                                onChange={(e) => onPatchFilters({ endKey: e.target.value })}
                                className="h-10 w-full rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-2 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                                style={{ fontSize: "16px" }}
                            />
                        </MobileField>
                    </div>

                    <MobileField label="Usuario">
                        <select
                            value={filters.userId}
                            onChange={(e) => onPatchFilters({ userId: e.target.value })}
                            className="h-10 w-full rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                            style={{ fontSize: "16px" }}
                        >
                            <option value="all">Todos</option>
                            {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.name}
                                </option>
                            ))}
                        </select>
                    </MobileField>

                    <MobileField label="Estado">
                        <select
                            value={filters.type}
                            onChange={(e) =>
                                onPatchFilters({ type: e.target.value as ActivityEventType })
                            }
                            className="h-10 w-full rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                            style={{ fontSize: "16px" }}
                        >
                            <option value="all">Todos</option>
                            <option value="visited">Visitados</option>
                            <option value="rejected">Rechazados</option>
                            <option value="pending">Pendientes</option>
                        </select>
                    </MobileField>
                </div>

                <button
                    type="button"
                    onClick={onApply}
                    className="mt-4 min-h-[52px] w-full rounded-[14px] bg-[#7C3AED] text-[14px] font-bold text-white transition active:bg-violet-700"
                >
                    Aplicar
                </button>
            </div>
        </>
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
                                <div className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
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

function NoPermission() {
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
