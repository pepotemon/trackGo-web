"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAutoAssignLogs } from "@/features/leads/useAutoAssignLogs";
import { LeadSectionNav } from "@/features/leads/LeadSectionNav";
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
        "h-9 rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none transition focus:border-[#171717]",
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
    return log.leadName || log.leadPhone || log.leadId || "Lead";
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
                    <>
                        <Link
                            href="/admin/settings/users"
                            className="inline-flex items-center justify-center rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-semibold text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
                        >
                            Usuarios y cobertura
                        </Link>
                        {activeFiltersCount > 0 ? (
                            <Button onClick={resetFilters}>Limpiar filtros</Button>
                        ) : null}
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
                    </>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <LeadSectionNav />

            <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Asignaciones" value={stats.total} caption="Logs cargados" icon="assign" tone="green" />
                <KpiCard label="Usuarios" value={stats.users} caption="Recibieron leads" icon="users" tone="blue" />
                <KpiCard label="Ciudad / Hub" value={stats.city + stats.hubCity} caption="Matches precisos" icon="map" tone="purple" />
                <KpiCard label="Estado / Pais" value={stats.state + stats.country} caption="Matches amplios" icon="filter" tone="orange" />
            </section>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 px-4 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
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
                                        {user.name || user.email || user.id}
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
                </div>

                <AssignmentsTable logs={filteredLogs} loading={loading} onQuickActions={setQuickLog} />

                <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                    <p className="text-[12px] font-medium text-[#9ca3af]">
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
        <div className="overflow-x-auto border-t border-[#f0f1f2]">
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
                    {log.userName || log.userId || "Usuario"}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {log.userId || "Sin UID"}
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
                {matchType ? (
                    <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                ) : (
                    <Badge tone="gray">{log.matchType || "Match"}</Badge>
                )}
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
        >
            {log.leadId ? (
                <div className="grid gap-3 sm:grid-cols-2">
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
