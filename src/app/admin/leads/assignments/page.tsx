"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAutoAssignLogs, type AssignViewMode } from "@/features/leads/useAutoAssignLogs";
import { listAssignedClientsByRange } from "@/data/autoAssignLogsRepo";
import { useAuth } from "@/features/auth/AuthProvider";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import type {
    AutoAssignLogDoc,
    AutoAssignLogFilters,
    LeadAutoAssignMatchType,
} from "@/types/leads";
import { ActionTile, ActionTileButton, AppIcon, Badge, Button, Card, Field, Input, KpiCard, Modal, PageHeader } from "@/components/ui";

const MATCH_OPTIONS: { value: LeadAutoAssignMatchType; label: string }[] = [
    { value: "city", label: "Ciudad" },
    { value: "hub_city", label: "Hub" },
    { value: "state", label: "Estado" },
    { value: "country", label: "País" },
    { value: "campaign", label: "Campaña" },
];

const matchTone: Record<LeadAutoAssignMatchType, "green" | "purple" | "yellow" | "blue"> = {
    city: "green",
    hub_city: "purple",
    state: "yellow",
    country: "blue",
    campaign: "purple",
};

const matchLabel: Record<LeadAutoAssignMatchType, string> = {
    city: "Ciudad",
    hub_city: "Hub",
    state: "Estado",
    country: "País",
    campaign: "Campaña",
};

function selectClassName(extra = "") {
    return [
        "h-10 rounded-[15px] border border-white/[0.08] bg-[#0F172A] px-3 text-[13px] font-bold text-[#F9FAFB] outline-none transition focus:border-blue-400/35 focus:ring-2 focus:ring-blue-400/10 sm:h-9 sm:rounded-lg sm:text-[12px] xl:border-[#e5e7eb] xl:bg-white xl:font-semibold xl:text-[#52525b] xl:focus:border-[#7c3aed] xl:focus:ring-violet-100",
        extra,
    ].join(" ");
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

function safeMatchType(value: unknown): LeadAutoAssignMatchType | null {
    if (value === "city" || value === "hub_city" || value === "state" || value === "country") {
        return value;
    }
    return null;
}

function isManual(log: AutoAssignLogDoc) {
    return log.mode === "manual" || log.mode === "self_assigned";
}

function isSelfAssigned(log: AutoAssignLogDoc) {
    return log.mode === "self_assigned";
}

function leadTitle(log: AutoAssignLogDoc) {
    return log.leadName || log.leadPhone || "Lead";
}

function leadGeo(log: AutoAssignLogDoc) {
    return (
        log.leadGeoAdminDisplayLabel ||
        [log.leadGeoAdminCityLabel, log.leadGeoAdminStateLabel].filter(Boolean).join(", ") ||
        log.leadGeoHubLabel ||
        "Sin ciudad"
    );
}

export default function AutoAssignLogsPage() {
    const { profile, isSuperAdmin } = useAuth();
    const [filterModalOpen, setFilterModalOpen] = useState(false);
    const [userBreakdownOpen, setUserBreakdownOpen] = useState(false);
    const [actionLog, setActionLog] = useState<AutoAssignLogDoc | null>(null);
    const [quickLog, setQuickLog] = useState<AutoAssignLogDoc | null>(null);

    const {
        users,
        filters,
        viewMode,
        filteredLogs,
        stats,
        loading,
        loadingMore,
        hasMore,
        err,
        setFilters,
        resetFilters,
        changeViewMode,
        reloadLogs,
        loadMore,
    } = useAutoAssignLogs();

    const scopedUserIds = useMemo(() => {
        if (isSuperAdmin || !profile) return null;
        return new Set(
            users
                .filter((user) => user.sharedWith?.some((entry) => entry.adminId === profile.id))
                .map((user) => user.id)
        );
    }, [isSuperAdmin, profile, users]);

    const scopedUsers = useMemo(() => {
        if (!scopedUserIds) return users;
        return users.filter((user) => scopedUserIds.has(user.id));
    }, [scopedUserIds, users]);

    const scopedLogs = useMemo(() => {
        if (!scopedUserIds) return filteredLogs;
        return filteredLogs.filter((log) => !!log.userId && scopedUserIds.has(log.userId));
    }, [filteredLogs, scopedUserIds]);

    const scopedStats = useMemo(() => {
        const userIds = new Set(scopedLogs.map((log) => log.userId).filter(Boolean));
        return {
            total: scopedLogs.length,
            users: userIds.size,
            city: scopedLogs.filter((log) => log.matchType === "city").length,
            hubCity: scopedLogs.filter((log) => log.matchType === "hub_city").length,
            state: scopedLogs.filter((log) => log.matchType === "state").length,
            country: scopedLogs.filter((log) => log.matchType === "country").length,
        };
    }, [scopedLogs]);

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (filters.userId !== "all") total++;
        if (filters.matchType !== "all") total++;
        if (filters.search.trim()) total++;
        return total;
    }, [filters]);

    const manualCount = useMemo(() => scopedLogs.filter(isManual).length, [scopedLogs]);
    const autoCount = scopedLogs.length - manualCount;

    function patchFilters(patch: Partial<AutoAssignLogFilters>) {
        setFilters((prev) => ({ ...prev, ...patch }));
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            {/* ── MOBILE ── */}
            <div className="xl:hidden">
                <MobileAssignmentsView
                    logs={scopedLogs}
                    stats={scopedStats}
                    autoCount={autoCount}
                    manualCount={manualCount}
                    filters={filters}
                    viewMode={viewMode}
                    users={scopedUsers}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    filterModalOpen={filterModalOpen}
                    activeFiltersCount={activeFiltersCount}
                    onChangeViewMode={changeViewMode}
                    onOpenFilters={() => setFilterModalOpen(true)}
                    onCloseFilters={() => setFilterModalOpen(false)}
                    onPatchFilters={patchFilters}
                    onResetFilters={resetFilters}
                    onReload={reloadLogs}
                    onLoadMore={loadMore}
                    onOpenSheet={setActionLog}
                    onOpenUserBreakdown={() => setUserBreakdownOpen(true)}
                />
            </div>

            {/* ── DESKTOP ── */}
            <div className="hidden xl:block">
                <PageHeader
                    title="Asignaciones"
                    subtitle="Auditoría de asignaciones automáticas y manuales."
                    icon={<AppIcon name="assign" tone="green" size="sm" className="bg-transparent text-white ring-0" />}
                    actions={
                        <div className="flex items-center gap-2">
                            {activeFiltersCount > 0 ? (
                                <Button onClick={resetFilters}>Limpiar</Button>
                            ) : null}
                            <Button
                                variant="primary"
                                onClick={reloadLogs}
                                disabled={loading}
                                aria-label="Actualizar"
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

                <section className="mb-4 grid grid-cols-4 gap-4">
                    <KpiCard label="Asignaciones" value={scopedStats.total} caption="En el rango seleccionado" icon="assign" tone="green" />
                    <button
                        type="button"
                        onClick={() => setUserBreakdownOpen(true)}
                        className="block w-full cursor-pointer rounded-2xl text-left ring-2 ring-blue-100 transition hover:ring-blue-300 hover:scale-[1.01] hover:shadow-md active:scale-[0.99]"
                    >
                        <KpiCard label="Usuarios" value={scopedStats.users} caption="Ver detalle →" icon="users" tone="blue" />
                    </button>
                    <KpiCard label="Ciudad / Hub" value={scopedStats.city + scopedStats.hubCity} caption="Matches precisos" icon="map" tone="purple" />
                    <KpiCard label="Estado / País" value={scopedStats.state + scopedStats.country} caption="Matches amplios" icon="filter" tone="orange" />
                </section>

                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 bg-gradient-to-b from-white to-[#fbfaff] px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#171717]">Registros</h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                    {scopedLogs.length} asignaciones · {filters.startKey} → {filters.endKey}
                                </p>
                            </div>
                            <Input
                                value={filters.search}
                                onChange={(e) => patchFilters({ search: e.target.value })}
                                placeholder="Buscar lead, teléfono, usuario, ciudad..."
                                className="w-[360px]"
                            />
                        </div>

                        <div className="grid grid-cols-[160px_1fr_1fr_1fr] gap-2">
                            <div className="grid h-10 grid-cols-2 rounded-xl border border-[#e5e7eb] bg-[#f8fafc] p-1">
                                {(["day", "week"] as AssignViewMode[]).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => changeViewMode(mode)}
                                        className={[
                                            "rounded-lg text-[12px] font-black transition",
                                            viewMode === mode ? "bg-[#7c3aed] text-white shadow-sm" : "text-[#667085] hover:bg-white",
                                        ].join(" ")}
                                    >
                                        {mode === "day" ? "Día" : "Semana"}
                                    </button>
                                ))}
                            </div>
                            <Field label="Usuario">
                                <select
                                    value={filters.userId}
                                    onChange={(e) => patchFilters({ userId: e.target.value })}
                                    className={selectClassName("w-full")}
                                >
                                    <option value="all">Todos los usuarios</option>
                                    {scopedUsers.map((user) => (
                                        <option key={user.id} value={user.id}>
                                            {user.name || user.email || "Sin nombre"}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Match">
                                <select
                                    value={filters.matchType}
                                    onChange={(e) =>
                                        patchFilters({ matchType: e.target.value as AutoAssignLogFilters["matchType"] })
                                    }
                                    className={selectClassName("w-full")}
                                >
                                    <option value="all">Todos los matches</option>
                                    {MATCH_OPTIONS.map((item) => (
                                        <option key={item.value} value={item.value}>{item.label}</option>
                                    ))}
                                </select>
                            </Field>
                        </div>
                    </div>

                    <AssignmentsDesktopTable logs={scopedLogs} loading={loading} onQuickActions={setQuickLog} />

                    <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                        <p className="text-[12px] font-medium text-[#9ca3af]">
                            {scopedLogs.length} asignaciones cargadas
                        </p>
                        {hasMore ? (
                            <Button onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? "Cargando..." : "Cargar más"}
                            </Button>
                        ) : null}
                    </div>
                </Card>
            </div>

            {/* Mobile action sheet */}
            <AssignmentActionSheet
                log={actionLog}
                open={!!actionLog}
                onClose={() => setActionLog(null)}
            />

            {/* Desktop quick actions */}
            <AssignmentQuickActionsModal log={quickLog} onClose={() => setQuickLog(null)} />

            {/* User breakdown modal */}
            <UserBreakdownModal
                open={userBreakdownOpen}
                onClose={() => setUserBreakdownOpen(false)}
                startKey={filters.startKey}
                endKey={filters.endKey}
                users={scopedUsers}
            />
        </div>
    );
}

// ─── MOBILE VIEW ─────────────────────────────────────────────────────────────

function MobileAssignmentsView({
    logs,
    stats,
    autoCount,
    manualCount,
    filters,
    viewMode,
    users,
    loading,
    loadingMore,
    hasMore,
    filterModalOpen,
    activeFiltersCount,
    onChangeViewMode,
    onOpenFilters,
    onCloseFilters,
    onPatchFilters,
    onResetFilters,
    onReload,
    onLoadMore,
    onOpenSheet,
    onOpenUserBreakdown,
}: {
    logs: AutoAssignLogDoc[];
    stats: ReturnType<typeof useAutoAssignLogs>["stats"];
    autoCount: number;
    manualCount: number;
    filters: AutoAssignLogFilters;
    viewMode: AssignViewMode;
    users: { id: string; name?: string | null; email?: string | null }[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    filterModalOpen: boolean;
    activeFiltersCount: number;
    onChangeViewMode: (mode: AssignViewMode) => void;
    onOpenFilters: () => void;
    onCloseFilters: () => void;
    onPatchFilters: (patch: Partial<AutoAssignLogFilters>) => void;
    onResetFilters: () => void;
    onReload: () => void;
    onLoadMore: () => void;
    onOpenSheet: (log: AutoAssignLogDoc) => void;
    onOpenUserBreakdown: () => void;
}) {
    return (
        <>
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] pb-6 text-[#101936]">

            {/* STICKY HEADER */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-3 backdrop-blur-md">

                {/* TITLE ROW */}
                <div className="mb-3 flex items-center gap-2">
                    <Link
                        href="/admin/activity"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                        aria-label="Regresar"
                    >
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#7C3AED]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M19 12H5M5 12l7-7M5 12l7 7" />
                        </svg>
                    </Link>

                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Asignaciones
                        </h1>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#66739A]">
                            <span className="font-black text-[#7C3AED]">{logs.length}</span> en el rango
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => onChangeViewMode(viewMode === "day" ? "week" : "day")}
                        className="flex h-10 items-center rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[12px] font-black text-[#101936] shadow-sm transition active:bg-[#f3f0ff]"
                    >
                        {viewMode === "day" ? "Día" : "Semana"}
                    </button>

                    <button
                        type="button"
                        onClick={onReload}
                        disabled={loading}
                        className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-50"
                        aria-label="Actualizar"
                    >
                        <AppIcon name="refresh" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0" />
                    </button>
                </div>

                {/* STAT CARDS */}
                <div className="mb-3 grid grid-cols-4 gap-2">
                    <AssignStatCard label="Total" value={stats.total} color="text-violet-500" />
                    <AssignStatCard label="Usuarios" value={stats.users} color="text-blue-500" onClick={onOpenUserBreakdown} />
                    <AssignStatCard label="Auto" value={autoCount} color="text-emerald-500" />
                    <AssignStatCard label="Manual" value={manualCount} color="text-amber-500" />
                </div>

                {/* SEARCH + FILTER */}
                <div className="flex gap-2">
                    <div className="flex h-[46px] flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 shadow-[0_2px_12px_rgba(91,33,255,0.07)]">
                        <AppIcon name="search" tone="purple" size="sm" className="h-5 w-5 shrink-0 bg-transparent text-[#98A2B3] ring-0" />
                        <input
                            value={filters.search}
                            onChange={(e) => onPatchFilters({ search: e.target.value })}
                            placeholder="Buscar lead, usuario, ciudad..."
                            className="min-w-0 flex-1 bg-transparent font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            style={{ fontSize: "16px" }}
                        />
                        {filters.search ? (
                            <button
                                type="button"
                                onClick={() => onPatchFilters({ search: "" })}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f0ff] text-[16px] text-[#7C3AED] transition active:bg-violet-200"
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

            {/* LIST */}
            <div className="grid gap-2 overflow-x-hidden px-3 pt-3">
                {loading ? (
                    <AssignMobileState icon="refresh" title="Cargando asignaciones" body="Estamos consultando los registros." />
                ) : logs.length === 0 ? (
                    <AssignMobileState icon="filter" title="Sin resultados" body="No hay asignaciones con esos filtros." />
                ) : (
                    logs.map((log) => (
                        <AssignmentMobileCard key={log.id} log={log} onOpenSheet={onOpenSheet} />
                    ))
                )}

                {hasMore ? (
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="mt-1 min-h-[46px] rounded-[14px] border border-[#E8E7FB] bg-white text-[12px] font-bold text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-60"
                    >
                        {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                ) : null}
            </div>
        </div>

        {/* Filter modal outside animated container */}
        <AssignMobileFiltersModal
            open={filterModalOpen}
            onClose={onCloseFilters}
            filters={filters}
            users={users}
            onPatchFilters={onPatchFilters}
            onResetFilters={() => { onResetFilters(); onCloseFilters(); }}
        />
        </>
    );
}

function AssignStatCard({
    label,
    value,
    color,
    onClick,
}: {
    label: string;
    value: number;
    color: string;
    onClick?: () => void;
}) {
    const base = "min-w-0 rounded-[14px] border border-[#E8E7FB] bg-white px-1.5 py-2.5 text-center shadow-[0_4px_16px_rgba(91,33,255,0.06)]";
    const content = (
        <>
            <div className={`text-[13px] font-black ${color}`}>{value}</div>
            <div className="mt-0.5 truncate text-[9px] font-semibold text-[#66739A]">{label}</div>
        </>
    );

    if (onClick) {
        return (
            <button type="button" onClick={onClick} className={`${base} ring-[1.5px] ring-blue-200 transition active:opacity-70 active:scale-[0.97]`}>
                {content}
            </button>
        );
    }

    return <div className={base}>{content}</div>;
}

function AssignmentMobileCard({
    log,
    onOpenSheet,
}: {
    log: AutoAssignLogDoc;
    onOpenSheet: (log: AutoAssignLogDoc) => void;
}) {
    const matchType = safeMatchType(log.matchType);
    const manual = isManual(log);
    const selfAssigned = isSelfAssigned(log);

    return (
        <article className="min-w-0 max-w-full overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white p-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-black tracking-[-0.01em] text-[#101936]">
                        {leadTitle(log)}
                    </p>
                    {(log.leadBusiness || log.leadPhone) ? (
                        <p className="mt-0.5 truncate text-[12px] font-semibold text-[#344054]">
                            {log.leadBusiness || log.leadPhone}
                        </p>
                    ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={selfAssigned ? "yellow" : manual ? "purple" : "blue"}>
                        {selfAssigned ? "Tomado" : manual ? "Manual" : "Auto"}
                    </Badge>
                    <button
                        type="button"
                        onClick={() => onOpenSheet(log)}
                        className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
                        aria-label="Acciones"
                    >
                        <AppIcon name="more" tone="slate" size="sm" className="h-4 w-4 bg-transparent text-[#98A2B3] ring-0" />
                    </button>
                </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex items-center gap-1.5">
                    <AppIcon name="user" tone="slate" size="sm" className="h-[14px] w-[14px] shrink-0 bg-transparent text-[#7C3AED] ring-0" />
                    <span className="truncate text-[11px] font-black text-[#7C3AED]">{log.userName || "Usuario"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <AppIcon name="location" tone="slate" size="sm" className="h-[14px] w-[14px] shrink-0 bg-transparent text-[#66739A] ring-0" />
                    <span className="max-w-[140px] truncate text-[11px] font-semibold text-[#344054]">{leadGeo(log)}</span>
                </div>
                {matchType ? (
                    <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                ) : null}
            </div>

            <p className="mt-2 text-[10px] font-medium text-[#98A2B3]">{formatDate(log.createdAt)}</p>
        </article>
    );
}

function AssignMobileState({
    icon,
    title,
    body,
}: {
    icon: "filter" | "refresh";
    title: string;
    body: string;
}) {
    return (
        <div className="mt-10 flex flex-col items-center gap-3 px-4 text-center">
            {icon === "refresh" ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                    <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    </svg>
                </div>
            ) : (
                <AppIcon name="filter" tone="slate" size="lg" />
            )}
            <p className="text-[13px] font-semibold text-[#66739A]">{title}</p>
            <p className="text-[11px] font-medium text-[#98A2B3]">{body}</p>
        </div>
    );
}

function AssignMobileFiltersModal({
    open,
    onClose,
    filters,
    users,
    onPatchFilters,
    onResetFilters,
}: {
    open: boolean;
    onClose: () => void;
    filters: AutoAssignLogFilters;
    users: { id: string; name?: string | null; email?: string | null }[];
    onPatchFilters: (patch: Partial<AutoAssignLogFilters>) => void;
    onResetFilters: () => void;
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
                        <label className="grid gap-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">Desde</span>
                            <input
                                type="date"
                                value={filters.startKey}
                                onChange={(e) => onPatchFilters({ startKey: e.target.value })}
                                className="h-10 rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">Hasta</span>
                            <input
                                type="date"
                                value={filters.endKey}
                                onChange={(e) => onPatchFilters({ endKey: e.target.value })}
                                className="h-10 rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                    </div>

                    <label className="grid gap-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">Usuario</span>
                        <select
                            value={filters.userId}
                            onChange={(e) => onPatchFilters({ userId: e.target.value })}
                            className="h-10 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                            style={{ fontSize: "16px" }}
                        >
                            <option value="all">Todos</option>
                            {users.map((u) => (
                                <option key={u.id} value={u.id}>{u.name || u.email || "Usuario"}</option>
                            ))}
                        </select>
                    </label>

                    <label className="grid gap-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">Match</span>
                        <select
                            value={filters.matchType}
                            onChange={(e) =>
                                onPatchFilters({ matchType: e.target.value as AutoAssignLogFilters["matchType"] })
                            }
                            className="h-10 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                            style={{ fontSize: "16px" }}
                        >
                            <option value="all">Todos</option>
                            {MATCH_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </label>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 min-h-[52px] w-full rounded-[14px] bg-[#7C3AED] text-[14px] font-bold text-white transition active:bg-violet-700"
                >
                    Listo
                </button>
            </div>
        </>
    );
}

function AssignmentActionSheet({
    log,
    open,
    onClose,
}: {
    log: AutoAssignLogDoc | null;
    open: boolean;
    onClose: () => void;
}) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return;
        const handler = () => onClose();
        window.addEventListener("scroll", handler, { passive: true });
        return () => window.removeEventListener("scroll", handler);
    }, [open, onClose]);

    if (!open || !log) return null;

    const hasData = !!(log.leadName || log.leadPhone || log.leadBusiness);

    async function handleCopy() {
        const text = [
            log!.leadName ? `Nombre: ${log!.leadName}` : "",
            log!.leadPhone ? `Telefono: ${log!.leadPhone}` : "",
            log!.leadBusiness ? `Negocio: ${log!.leadBusiness}` : "",
        ].filter(Boolean).join("\n");
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            window.prompt("Copia los datos del cliente", text);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
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
                    <div className="flex items-center gap-2">
                        <p className="truncate text-[15px] font-black text-[#101936]">{leadTitle(log)}</p>
                        <Badge tone={isSelfAssigned(log) ? "yellow" : isManual(log) ? "purple" : "blue"}>
                            {isSelfAssigned(log) ? "Tomado" : isManual(log) ? "Manual" : "Auto"}
                        </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] font-semibold text-[#66739A]">
                        {log.userName || "Usuario"} · {leadGeo(log)}
                    </p>
                </div>

                {log.leadId ? (
                    <div className="grid gap-2">
                        <Link
                            href={`/admin/clients/${log.leadId}`}
                            onClick={onClose}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#eff6ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-blue-100"
                        >
                            <AppIcon name="users" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-blue-600 ring-0" />
                            Ver cliente
                        </Link>
                        <Link
                            href={`/admin/leads/${log.leadId}?from=assignments`}
                            onClick={onClose}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                        >
                            <AppIcon name="chat" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                            Chat / Editar
                        </Link>
                    </div>
                ) : (
                    <p className="rounded-[14px] border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-4 py-4 text-center text-[12px] font-semibold text-[#667085]">
                        Sin prospecto asociado.
                    </p>
                )}

                {hasData ? (
                    <button
                        type="button"
                        onClick={handleCopy}
                        className={copied ? "mt-2 flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100" : "mt-2 flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"}
                    >
                        <AppIcon name={copied ? "check" : "copy"} tone="slate" size="sm" className={copied ? "h-5 w-5 bg-transparent text-emerald-600 ring-0" : "h-5 w-5 bg-transparent text-[#7C3AED] ring-0"} />
                        {copied ? "Copiado" : "Copiar datos"}
                    </button>
                ) : null}

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 min-h-[48px] w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] text-[14px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                >
                    Cancelar
                </button>
            </div>
        </>
    );
}

// ─── DESKTOP TABLE ────────────────────────────────────────────────────────────

function AssignmentsDesktopTable({
    logs,
    loading,
    onQuickActions,
}: {
    logs: AutoAssignLogDoc[];
    loading: boolean;
    onQuickActions: (log: AutoAssignLogDoc) => void;
}) {
    return (
        <div className="border-t border-[#f0f1f2]">
            <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1020px] border-collapse">
                    <thead>
                        <tr className="border-b border-[#f0f1f2] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                            <th className="px-4 py-2.5">Lead</th>
                            <th className="px-4 py-2.5">Usuario</th>
                            <th className="px-4 py-2.5">Ciudad</th>
                            <th className="px-4 py-2.5">Match</th>
                            <th className="px-4 py-2.5">Cobertura</th>
                            <th className="px-4 py-2.5 text-right">Fecha</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6}>
                                    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                                            <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                                <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                            </svg>
                                        </div>
                                        <div className="mt-3 text-[13px] font-semibold text-[#66739a]">Cargando asignaciones</div>
                                    </div>
                                </td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                    No hay asignaciones con esos filtros.
                                </td>
                            </tr>
                        ) : (
                            logs.map((log) => <AssignmentRow key={log.id} log={log} onQuickActions={onQuickActions} />)
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function AssignmentRow({
    log,
    onQuickActions,
}: {
    log: AutoAssignLogDoc;
    onQuickActions: (log: AutoAssignLogDoc) => void;
}) {
    const matchType = safeMatchType(log.matchType);

    return (
        <tr
            onClick={() => onQuickActions(log)}
            className="cursor-pointer border-b border-[#f0f1f2] last:border-0 hover:bg-[#f8f7ff]"
        >
            <td className="px-4 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-semibold text-[#171717]">{leadTitle(log)}</span>
                        <Badge tone={isSelfAssigned(log) ? "yellow" : isManual(log) ? "purple" : "blue"}>
                            {isSelfAssigned(log) ? "Tomado" : isManual(log) ? "Manual" : "Auto"}
                        </Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-medium text-[#9ca3af]">
                        {log.leadPhone ? <span>{log.leadPhone}</span> : null}
                        {log.leadBusiness ? <span>{log.leadBusiness}</span> : null}
                    </div>
                </div>
            </td>
            <td className="px-4 py-3">
                <div className="text-[12px] font-semibold text-[#171717]">{log.userName || "Usuario"}</div>
                <div className="mt-0.5 max-w-[200px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {log.userCoverageLabel || "Sin cobertura visible"}
                </div>
            </td>
            <td className="px-4 py-3">
                <div className="text-[12px] font-semibold text-[#171717]">{leadGeo(log)}</div>
                {log.leadGeoHubLabel ? (
                    <div className="mt-0.5 max-w-[200px] truncate text-[11px] font-medium text-[#9ca3af]">
                        Hub: {log.leadGeoHubLabel}
                    </div>
                ) : null}
            </td>
            <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    {matchType ? (
                        <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                    ) : isManual(log) ? null : (
                        <Badge tone="gray">{log.matchType || "—"}</Badge>
                    )}
                </div>
            </td>
            <td className="px-4 py-3">
                <div className="max-w-[220px] truncate text-[12px] font-medium text-[#52525b]">
                    {log.userCoverageLabel || log.coverageKey || "—"}
                </div>
                {log.coverageKey ? (
                    <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                        {log.coverageKey}
                    </div>
                ) : null}
            </td>
            <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#71717a]">
                {formatDate(log.createdAt)}
            </td>
        </tr>
    );
}

function AssignmentQuickActionsModal({
    log,
    onClose,
}: {
    log: AutoAssignLogDoc | null;
    onClose: () => void;
}) {
    const [copied, setCopied] = useState(false);

    if (!log) return null;

    const hasData = !!(log.leadName || log.leadPhone || log.leadBusiness);

    async function handleCopy() {
        const l = log!;
        const text = [
            l.leadName ? `Nombre: ${l.leadName}` : "",
            l.leadPhone ? `Telefono: ${l.leadPhone}` : "",
            l.leadBusiness ? `Negocio: ${l.leadBusiness}` : "",
        ].filter(Boolean).join("\n");
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            window.prompt("Copia los datos del cliente", text);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    }

    return (
        <Modal
            open={!!log}
            onClose={onClose}
            title={leadTitle(log)}
            subtitle={leadGeo(log)}
            size="sm"
        >
            <div className="grid gap-2">
                {log.leadId ? (
                    <>
                        <ActionTile href={`/admin/clients/${log.leadId}`} icon="users" label="Ver cliente" tone="blue" />
                        <ActionTile href={`/admin/leads/${log.leadId}?from=assignments`} icon="chat" label="Chat / Editar" tone="purple" />
                    </>
                ) : (
                    <div className="rounded-2xl border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-4 py-6 text-center text-[12px] font-semibold text-[#667085]">
                        Esta asignación no tiene prospecto asociado.
                    </div>
                )}
                {hasData ? (
                    <ActionTileButton
                        onClick={handleCopy}
                        icon={copied ? "check" : "copy"}
                        label={copied ? "Copiado" : "Copiar datos"}
                        tone={copied ? "green" : "slate"}
                    />
                ) : null}
            </div>
        </Modal>
    );
}

type BreakdownRow = { userId: string; name: string; count: number };

function UserBreakdownModal({
    open,
    onClose,
    startKey,
    endKey,
    users,
}: {
    open: boolean;
    onClose: () => void;
    startKey: string;
    endKey: string;
    users: { id: string; name?: string | null; email?: string | null }[];
}) {
    const [loadingBreakdown, setLoadingBreakdown] = useState(false);
    const [breakdownRows, setBreakdownRows] = useState<BreakdownRow[]>([]);
    const [breakdownTotal, setBreakdownTotal] = useState(0);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoadingBreakdown(true);
        setBreakdownRows([]);
        setBreakdownTotal(0);

        listAssignedClientsByRange(startKey, endKey)
            .then((items) => {
                if (cancelled) return;
                const allowedUserIds = new Set(users.map((user) => user.id));
                const visibleItems = allowedUserIds.size > 0
                    ? items.filter((item) => allowedUserIds.has(item.userId))
                    : items;
                const map = new Map<string, number>();
                for (const item of visibleItems) {
                    map.set(item.userId, (map.get(item.userId) ?? 0) + 1);
                }
                const rows: BreakdownRow[] = Array.from(map.entries()).map(([uid, count]) => {
                    const user = users.find((u) => u.id === uid);
                    return {
                        userId: uid,
                        name: user?.name || user?.email || uid,
                        count,
                    };
                }).sort((a, b) => b.count - a.count);
                setBreakdownRows(rows);
                setBreakdownTotal(visibleItems.length);
                setLoadingBreakdown(false);
            })
            .catch(() => { if (!cancelled) setLoadingBreakdown(false); });

        return () => { cancelled = true; };
    }, [open, startKey, endKey, users]);

    const rangeLabel = startKey === endKey ? startKey : `${startKey} → ${endKey}`;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Asignaciones por usuario"
            subtitle={loadingBreakdown ? rangeLabel : `${breakdownTotal} total · ${rangeLabel}`}
            size="sm"
        >
            {loadingBreakdown ? (
                <div className="flex items-center justify-center py-10">
                    <svg className="tg-spin h-7 w-7 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    </svg>
                </div>
            ) : (
                <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                    {breakdownRows.length === 0 ? (
                        <div className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-5 text-center text-[13px] font-semibold text-[#71717a]">
                            Sin datos en este rango.
                        </div>
                    ) : (
                        breakdownRows.map((row) => (
                            <div
                                key={row.userId}
                                className="flex items-center gap-3 rounded-xl border border-[#e5e7eb] bg-white px-3 py-2.5"
                            >
                                <AppIcon name="user" tone="purple" size="sm" className="h-7 w-7 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-bold text-[#171717]">{row.name}</div>
                                </div>
                                <div className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[12px] font-black text-violet-700">
                                    {row.count}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </Modal>
    );
}

