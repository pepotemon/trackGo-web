"use client";

import { useMemo, useState } from "react";
import { useAutoAssignLogs } from "@/features/leads/useAutoAssignLogs";
import { LeadQuickAccessCards } from "@/features/leads/LeadQuickAccessCards";
import type {
    AutoAssignLogDoc,
    AutoAssignLogFilters,
    LeadAutoAssignMatchType,
} from "@/types/leads";
import { ActionTile, AppIcon, Badge, Button, Card, Field, Input, KpiCard, Modal, PageHeader } from "@/components/ui";

const MATCH_OPTIONS: { value: LeadAutoAssignMatchType; label: string }[] = [
    { value: "city", label: "Ciudad" },
    { value: "hub_city", label: "Hub" },
    { value: "state", label: "Estado" },
    { value: "country", label: "Pais" },
];

const matchTone: Record<LeadAutoAssignMatchType, "green" | "purple" | "yellow" | "blue"> = {
    city: "green",
    hub_city: "purple",
    state: "yellow",
    country: "blue",
};

const matchLabel: Record<LeadAutoAssignMatchType, string> = {
    city: "Ciudad",
    hub_city: "Hub",
    state: "Estado",
    country: "Pais",
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
    if (
        value === "city" ||
        value === "hub_city" ||
        value === "state" ||
        value === "country"
    ) {
        return value;
    }
    return null;
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
    const [quickLog, setQuickLog] = useState<AutoAssignLogDoc | null>(null);
    const {
        users,
        filters,
        filteredLogs,
        stats,
        loading,
        loadingMore,
        hasMore,
        err,
        setFilters,
        resetFilters,
        reloadLogs,
        loadMore,
    } = useAutoAssignLogs();

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (filters.userId !== "all") total++;
        if (filters.matchType !== "all") total++;
        if (filters.search.trim()) total++;
        return total;
    }, [filters]);

    function patchFilters(patch: Partial<AutoAssignLogFilters>) {
        setFilters((prev) => ({ ...prev, ...patch }));
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Asignaciones"
                subtitle="Auditoria de auto-asignacion y distribucion de trabajo."
                icon={<AppIcon name="assign" tone="green" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <Button
                        variant="primary"
                        onClick={reloadLogs}
                        disabled={loading}
                        aria-label="Actualizar asignaciones"
                        title="Actualizar asignaciones"
                        className="h-10 w-10 px-0 py-0"
                    >
                        <AppIcon name="refresh" tone="purple" size="sm" className="bg-transparent text-white ring-0" />
                    </Button>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <LeadQuickAccessCards />

            <section className="mb-3 grid grid-cols-2 gap-2 md:gap-4 xl:mb-4 xl:grid-cols-4">
                <KpiCard label="Asignaciones" value={stats.total} caption="Logs cargados" icon="assign" tone="green" />
                <KpiCard label="Usuarios" value={stats.users} caption="Recibieron leads" icon="users" tone="blue" />
                <KpiCard label="Ciudad / Hub" value={stats.city + stats.hubCity} caption="Matches precisos" icon="map" tone="purple" />
                <KpiCard label="Estado / Pais" value={stats.state + stats.country} caption="Matches amplios" icon="filter" tone="orange" />
            </section>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-3 bg-[#111827] px-3 py-3 xl:bg-white xl:px-4 xl:py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="hidden xl:block">
                            <h2 className="text-[14px] font-semibold text-[#171717]">
                                Auditoria de auto-asignacion
                            </h2>
                            <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                {filteredLogs.length} visibles de {stats.total}
                            </p>
                        </div>

                        <Input
                            value={filters.search}
                            onChange={(e) => patchFilters({ search: e.target.value })}
                            placeholder="Buscar lead, telefono, usuario, ciudad..."
                            className="xl:w-[360px]"
                        />
                    </div>

                    <div className="grid gap-2 md:grid-cols-3">
                        <Field label="Dia">
                            <Input
                                type="date"
                                value={filters.dayKey}
                                onChange={(e) => patchFilters({ dayKey: e.target.value })}
                            />
                        </Field>

                        <Field label="Usuario">
                            <select
                                value={filters.userId}
                                onChange={(e) => patchFilters({ userId: e.target.value })}
                                className={selectClassName("w-full")}
                            >
                                <option value="all">Todos los usuarios</option>
                                {users.map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.name || user.email || "Usuario sin nombre"}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Match">
                            <select
                                value={filters.matchType}
                                onChange={(e) =>
                                    patchFilters({
                                        matchType: e.target.value as AutoAssignLogFilters["matchType"],
                                    })
                                }
                                className={selectClassName("w-full")}
                            >
                                <option value="all">Todos los matches</option>
                                {MATCH_OPTIONS.map((item) => (
                                    <option key={item.value} value={item.value}>
                                        {item.label}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    {activeFiltersCount > 0 ? (
                        <div className="flex justify-end">
                            <Button onClick={resetFilters}>Limpiar filtros</Button>
                        </div>
                    ) : null}
                </div>

                <AssignmentsTable logs={filteredLogs} loading={loading} onQuickActions={setQuickLog} />

                <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-3 py-3 xl:border-[#f0f1f2] xl:px-4">
                    <p className="text-[12px] font-extrabold text-[#9CA3AF] xl:font-medium xl:text-[#9ca3af]">
                        {filteredLogs.length} asignaciones cargadas en esta vista
                    </p>
                    {hasMore ? (
                        <Button onClick={loadMore} disabled={loadingMore}>
                            {loadingMore ? "Cargando..." : "Cargar mas"}
                        </Button>
                    ) : null}
                </div>
            </Card>

            <AssignmentQuickActionsModal
                log={quickLog}
                onClose={() => setQuickLog(null)}
            />
        </div>
    );
}

function AssignmentsTable({
    logs,
    loading,
    onQuickActions,
}: {
    logs: AutoAssignLogDoc[];
    loading: boolean;
    onQuickActions: (log: AutoAssignLogDoc) => void;
}) {
    return (
        <div className="border-t border-white/[0.08] xl:border-[#f0f1f2]">
            <div className="divide-y divide-white/[0.08] lg:hidden">
                {loading ? (
                    <div className="p-6 text-center text-[13px] font-semibold text-[#71717a]">
                        Cargando asignaciones...
                    </div>
                ) : logs.length === 0 ? (
                    <div className="p-6 text-center text-[13px] font-semibold text-[#71717a]">
                        No hay asignaciones con esos filtros.
                    </div>
                ) : (
                    logs.map((log) => (
                        <AssignmentMobileCard key={log.id} log={log} onQuickActions={onQuickActions} />
                    ))
                )}
            </div>

            <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1120px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                        <th className="px-4 py-3">Lead</th>
                        <th className="px-4 py-3">Usuario</th>
                        <th className="px-4 py-3">Ciudad</th>
                        <th className="px-4 py-3">Match</th>
                        <th className="px-4 py-3">Cobertura usada</th>
                        <th className="px-4 py-3 text-right">Fecha</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={6} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                Cargando asignaciones...
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

function AssignmentMobileCard({
    log,
    onQuickActions,
}: {
    log: AutoAssignLogDoc;
    onQuickActions: (log: AutoAssignLogDoc) => void;
}) {
    const matchType = safeMatchType(log.matchType);

    return (
        <button
            type="button"
            onClick={() => onQuickActions(log)}
            className="w-full bg-[#111827] px-3 py-3 text-left transition active:bg-[#0F172A] xl:bg-white xl:active:bg-[#f8f7ff]"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[14px] font-black text-[#F9FAFB] xl:text-[13px] xl:font-bold xl:text-[#101936]">
                        {leadTitle(log)}
                    </div>
                    <div className="mt-1 truncate text-[12px] font-extrabold text-[#9CA3AF] xl:text-[11px] xl:font-semibold xl:text-[#66739a]">
                        {log.leadBusiness || log.leadPhone || "Lead asignado"}
                    </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone="blue">Auto</Badge>
                    {matchType ? (
                        <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                    ) : (
                        <Badge tone="gray">{log.matchType || "Match"}</Badge>
                    )}
                </div>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-black text-[#93C5FD] xl:font-bold xl:text-[#344054]">
                        {log.userName || "Usuario"}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-[#CBD5E1] xl:font-medium xl:text-[#98a2b3]">
                        {leadGeo(log)}
                    </div>
                </div>
                <div className="text-right text-[11px] font-black text-[#9CA3AF] xl:font-bold xl:text-[#66739a]">
                    {formatDate(log.createdAt)}
                </div>
            </div>
        </button>
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
                    <div className="truncate text-[12px] font-semibold text-[#171717]">
                        {leadTitle(log)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-[#9ca3af]">
                        {log.leadPhone ? <span>{log.leadPhone}</span> : null}
                        {log.leadBusiness ? <span>{log.leadBusiness}</span> : null}
                    </div>
                </div>
            </td>

            <td className="px-4 py-3">
                <div className="text-[12px] font-semibold text-[#171717]">
                    {log.userName || "Usuario"}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {log.userCoverageLabel || "Sin cobertura visible"}
                </div>
            </td>

            <td className="px-4 py-3">
                <div className="text-[12px] font-semibold text-[#171717]">
                    {leadGeo(log)}
                </div>
                {log.leadGeoHubLabel ? (
                    <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                        Hub: {log.leadGeoHubLabel}
                    </div>
                ) : null}
            </td>

            <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="blue">Auto</Badge>
                    {matchType ? (
                        <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                    ) : (
                        <Badge tone="gray">{log.matchType || "Match"}</Badge>
                    )}
                </div>
            </td>

            <td className="px-4 py-3">
                <div className="max-w-[260px] truncate text-[12px] font-medium text-[#52525b]">
                    {log.userCoverageLabel || log.coverageKey || "Sin cobertura visible"}
                </div>
                {log.coverageKey ? (
                    <div className="mt-0.5 max-w-[260px] truncate text-[11px] font-medium text-[#9ca3af]">
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
    if (!log) return null;

    return (
        <Modal
            open={!!log}
            onClose={onClose}
            title={leadTitle(log)}
            subtitle={leadGeo(log)}
            size="sm"
        >
            {log.leadId ? (
                <div className="grid gap-2">
                    <ActionTile href={`/admin/leads/${log.leadId}`} icon="chat" label="Chat" tone="purple" />
                    <ActionTile href={`/admin/leads/${log.leadId}`} icon="edit" label="Editar lead" tone="orange" />
                </div>
            ) : (
                <div className="rounded-2xl border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-4 py-6 text-center text-[12px] font-semibold text-[#667085]">
                    Esta asignacion no tiene lead asociado.
                </div>
            )}
        </Modal>
    );
}
