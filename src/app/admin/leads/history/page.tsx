"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAdminLeadHistory } from "@/features/leads/useAdminLeadHistory";
import type { LeadHistoryBucket, LeadHistoryFilters, MetaLeadDoc } from "@/types/leads";
import { Badge, Button, Card, Input, PageHeader, PageTab, StatCard } from "@/components/ui";

const bucketLabel: Record<LeadHistoryBucket, string> = {
    incomplete: "Incompleto",
    not_suitable: "No apto",
};

const bucketTone: Record<LeadHistoryBucket, "gray" | "red"> = {
    incomplete: "gray",
    not_suitable: "red",
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

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.phone || "Lead";
}

function cityLabel(lead: MetaLeadDoc) {
    return (
        lead.location.displayLabel ||
        lead.location.adminCityLabel ||
        lead.location.cityLabel ||
        lead.location.adminStateLabel ||
        "Sin ciudad"
    );
}

function quickStatus(lead: MetaLeadDoc) {
    return typeof lead.raw.quickStatusText === "string" ? lead.raw.quickStatusText : "";
}

function historyActivityAt(lead: MetaLeadDoc) {
    return lead.lastInboundMessageAt || lead.verificationStatusChangedAt || lead.updatedAt || lead.createdAt;
}

export default function LeadHistoryPage() {
    const {
        filters,
        filteredLeads,
        cityOptions,
        stats,
        loading,
        loadingMore,
        hasMore,
        savingId,
        err,
        setFilters,
        resetFilters,
        reloadHistory,
        loadMore,
        reopenLead,
    } = useAdminLeadHistory();

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (filters.bucket !== "all") total++;
        if (filters.city !== "all") total++;
        if (filters.search.trim()) total++;
        return total;
    }, [filters]);

    function patchFilters(patch: Partial<LeadHistoryFilters>) {
        setFilters((prev) => ({ ...prev, ...patch }));
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Historial de leads"
                tabs={
                    <>
                        <PageTab
                            active={filters.bucket === "all"}
                            onClick={() => patchFilters({ bucket: "all" })}
                        >
                            Todos
                        </PageTab>
                        <PageTab
                            active={filters.bucket === "incomplete"}
                            onClick={() => patchFilters({ bucket: "incomplete" })}
                        >
                            Incompletos
                        </PageTab>
                        <PageTab
                            active={filters.bucket === "not_suitable"}
                            onClick={() => patchFilters({ bucket: "not_suitable" })}
                        >
                            No aptos
                        </PageTab>
                    </>
                }
                actions={
                    <>
                        <Link
                            href="/admin/leads"
                            className="inline-flex items-center justify-center rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-semibold text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
                        >
                            Cola activa
                        </Link>
                        {activeFiltersCount > 0 ? (
                            <Button onClick={resetFilters}>Limpiar filtros</Button>
                        ) : null}
                        <Button variant="primary" onClick={reloadHistory} disabled={loading}>
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

            <section className="mb-4 grid gap-4 md:grid-cols-3">
                <StatCard label="Historial cargado" value={stats.total} caption="Leads fuera de la cola activa" />
                <StatCard label="Incompletos" value={stats.incomplete} caption="Sin datos suficientes" />
                <StatCard label="No aptos" value={stats.notSuitable} caption="Descartados operativos" />
            </section>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 px-4 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <h2 className="text-[14px] font-semibold text-[#171717]">
                                Archivo operativo
                            </h2>
                            <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                {filteredLeads.length} visibles de {stats.total}
                            </p>
                        </div>

                        <Input
                            value={filters.search}
                            onChange={(e) => patchFilters({ search: e.target.value })}
                            placeholder="Buscar lead, telefono, negocio, ciudad..."
                            className="xl:w-[340px]"
                        />
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                        <FilterSelect
                            label="Ciudad"
                            value={filters.city}
                            onChange={(value) => patchFilters({ city: value })}
                        >
                            <option value="all">Todas las ciudades</option>
                            {cityOptions.map((city) => (
                                <option key={city.value} value={city.value}>
                                    {city.label}
                                </option>
                            ))}
                        </FilterSelect>

                        <FilterSelect
                            label="Tipo"
                            value={filters.bucket}
                            onChange={(value) =>
                                patchFilters({ bucket: value as LeadHistoryFilters["bucket"] })
                            }
                        >
                            <option value="all">Todos</option>
                            <option value="incomplete">Incompletos</option>
                            <option value="not_suitable">No aptos</option>
                        </FilterSelect>
                    </div>
                </div>

                <HistoryTable
                    leads={filteredLeads}
                    loading={loading}
                    savingId={savingId}
                    onReopen={reopenLead}
                />

                <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                    <p className="text-[12px] font-medium text-[#9ca3af]">
                        {filteredLeads.length} leads cargados en esta vista
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

function FilterSelect({
    label,
    value,
    onChange,
    children,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: React.ReactNode;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#71717a]">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={selectClassName("w-full")}
            >
                {children}
            </select>
        </label>
    );
}

function HistoryTable({
    leads,
    loading,
    savingId,
    onReopen,
}: {
    leads: MetaLeadDoc[];
    loading: boolean;
    savingId: string | null;
    onReopen: (lead: MetaLeadDoc) => Promise<void>;
}) {
    return (
        <div className="overflow-x-auto border-t border-[#f0f1f2]">
            <table className="w-full min-w-[1080px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                        <th className="px-4 py-3">Lead</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Ciudad</th>
                        <th className="px-4 py-3">Motivo</th>
                        <th className="px-4 py-3">Chat</th>
                        <th className="px-4 py-3">Accion</th>
                        <th className="px-4 py-3 text-right">Ultima actividad</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={7} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                Cargando historial...
                            </td>
                        </tr>
                    ) : leads.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                No hay leads historicos con esos filtros.
                            </td>
                        </tr>
                    ) : (
                        leads.map((lead) => (
                            <HistoryRow
                                key={lead.id}
                                lead={lead}
                                saving={savingId === lead.id}
                                onReopen={onReopen}
                            />
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function HistoryRow({
    lead,
    saving,
    onReopen,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onReopen: (lead: MetaLeadDoc) => Promise<void>;
}) {
    const bucket = lead.verificationStatus === "not_suitable" ? "not_suitable" : "incomplete";

    return (
        <tr className="border-b border-[#f0f1f2] last:border-0 hover:bg-[#fafafa]">
            <td className="px-4 py-3">
                <div className="min-w-0">
                    <Link
                        href={`/admin/leads/${lead.id}`}
                        className="truncate text-[12px] font-semibold text-[#171717] hover:underline"
                    >
                        {displayName(lead)}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-[#9ca3af]">
                        <span>{lead.phone || "Sin telefono"}</span>
                        {lead.business ? <span>{lead.business}</span> : null}
                    </div>
                </div>
            </td>

            <td className="px-4 py-3">
                <Badge tone={bucketTone[bucket]}>{bucketLabel[bucket]}</Badge>
            </td>

            <td className="px-4 py-3">
                <div className="text-[12px] font-semibold text-[#171717]">
                    {cityLabel(lead)}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {lead.location.address || "Direccion no informada"}
                </div>
            </td>

            <td className="px-4 py-3">
                <div className="max-w-[240px] truncate text-[12px] font-medium text-[#52525b]">
                    {lead.notSuitableReason || quickStatus(lead) || "Sin motivo"}
                </div>
            </td>

            <td className="px-4 py-3">
                <Link
                    href={`/admin/leads/${lead.id}`}
                    className="inline-flex h-8 items-center rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
                >
                    Ver chat
                </Link>
            </td>

            <td className="px-4 py-3">
                <Button onClick={() => onReopen(lead)} disabled={saving}>
                    {saving ? "Reabriendo..." : "Reabrir"}
                </Button>
            </td>

            <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#71717a]">
                {formatDate(historyActivityAt(lead))}
            </td>
        </tr>
    );
}
