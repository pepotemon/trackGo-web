"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LeadQuickAccessCards } from "@/features/leads/LeadQuickAccessCards";
import { useAdminLeadHistory } from "@/features/leads/useAdminLeadHistory";
import type { LeadHistoryBucket, LeadHistoryFilters, MetaLeadDoc } from "@/types/leads";
import { ActionTile, ActionTileButton, AppIcon, Badge, Button, Card, Input, KpiCard, Modal, PageHeader } from "@/components/ui";

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
    const [quickLead, setQuickLead] = useState<MetaLeadDoc | null>(null);
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
        if (filters.startKey) total++;
        if (filters.endKey) total++;
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
                subtitle="Consulta leads archivados, incompletos y no aptos."
                icon={<AppIcon name="history" tone="slate" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <Button
                        variant="primary"
                        onClick={reloadHistory}
                        disabled={loading}
                        aria-label="Actualizar historial"
                        title="Actualizar historial"
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

            <section className="mb-4 grid gap-4 md:grid-cols-3">
                <KpiCard label="Historial cargado" value={stats.total} caption="Leads fuera de la cola activa" icon="history" tone="slate" />
                <KpiCard label="Incompletos" value={stats.incomplete} caption="Sin datos suficientes" icon="alert" tone="orange" />
                <KpiCard label="No aptos" value={stats.notSuitable} caption="Descartados operativos" icon="close" tone="red" />
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

                    <div className="grid gap-2 md:grid-cols-4">
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-[#71717a]">Desde</span>
                            <Input
                                type="date"
                                value={filters.startKey}
                                onChange={(event) => patchFilters({ startKey: event.target.value })}
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-[#71717a]">Hasta</span>
                            <Input
                                type="date"
                                value={filters.endKey}
                                onChange={(event) => patchFilters({ endKey: event.target.value })}
                            />
                        </label>

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

                    {activeFiltersCount > 0 ? (
                        <div className="flex justify-end">
                            <Button onClick={resetFilters}>Limpiar filtros</Button>
                        </div>
                    ) : null}
                </div>

                <HistoryTable
                    leads={filteredLeads}
                    loading={loading}
                    savingId={savingId}
                    onQuickActions={setQuickLead}
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

            <HistoryQuickActionsModal
                lead={quickLead}
                saving={quickLead ? savingId === quickLead.id : false}
                onClose={() => setQuickLead(null)}
                onReopen={async (lead) => {
                    await reopenLead(lead);
                    setQuickLead(null);
                }}
            />
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
    onQuickActions,
}: {
    leads: MetaLeadDoc[];
    loading: boolean;
    savingId: string | null;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    return (
        <div className="border-t border-[#f0f1f2]">
            <div className="divide-y divide-[#f0f1f2] lg:hidden">
                {loading ? (
                    <div className="p-6 text-center text-[13px] font-semibold text-[#71717a]">
                        Cargando historial...
                    </div>
                ) : leads.length === 0 ? (
                    <div className="p-6 text-center text-[13px] font-semibold text-[#71717a]">
                        No hay leads historicos con esos filtros.
                    </div>
                ) : (
                    leads.map((lead) => (
                        <HistoryMobileCard
                            key={lead.id}
                            lead={lead}
                            saving={savingId === lead.id}
                            onQuickActions={onQuickActions}
                        />
                    ))
                )}
            </div>

            <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1080px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                        <th className="px-4 py-3">Lead</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Ciudad</th>
                        <th className="px-4 py-3">Motivo</th>
                        <th className="px-4 py-3 text-right">Ultima actividad</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                Cargando historial...
                            </td>
                        </tr>
                    ) : leads.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                No hay leads historicos con esos filtros.
                            </td>
                        </tr>
                    ) : (
                        leads.map((lead) => (
                            <HistoryRow
                                key={lead.id}
                                lead={lead}
                                saving={savingId === lead.id}
                                onQuickActions={onQuickActions}
                            />
                        ))
                    )}
                </tbody>
            </table>
            </div>
        </div>
    );
}

function HistoryMobileCard({
    lead,
    saving,
    onQuickActions,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    const bucket = lead.verificationStatus === "not_suitable" ? "not_suitable" : "incomplete";

    return (
        <button
            type="button"
            onClick={() => {
                if (!saving) onQuickActions(lead);
            }}
            className="w-full bg-white px-3 py-3 text-left transition active:bg-[#f8f7ff]"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-[#101936]">
                        {displayName(lead)}
                    </div>
                    <div className="mt-1 truncate text-[11px] font-semibold text-[#66739a]">
                        {lead.business || lead.phone || "Sin informacion comercial"}
                    </div>
                </div>
                <Badge tone={bucketTone[bucket]}>{bucketLabel[bucket]}</Badge>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-[#344054]">
                        {cityLabel(lead)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#98a2b3]">
                        {lead.notSuitableReason || quickStatus(lead) || lead.location.address || "Sin motivo"}
                    </div>
                </div>
                <div className="text-right text-[11px] font-bold text-[#66739a]">
                    {formatDate(historyActivityAt(lead))}
                </div>
            </div>
        </button>
    );
}

function HistoryRow({
    lead,
    saving,
    onQuickActions,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    const bucket = lead.verificationStatus === "not_suitable" ? "not_suitable" : "incomplete";

    return (
        <tr
            onClick={() => {
                if (!saving) onQuickActions(lead);
            }}
            className="cursor-pointer border-b border-[#f0f1f2] last:border-0 hover:bg-[#f8f7ff]"
        >
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

            <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#71717a]">
                {formatDate(historyActivityAt(lead))}
            </td>
        </tr>
    );
}

function HistoryQuickActionsModal({
    lead,
    saving,
    onClose,
    onReopen,
}: {
    lead: MetaLeadDoc | null;
    saving: boolean;
    onClose: () => void;
    onReopen: (lead: MetaLeadDoc) => Promise<void>;
}) {
    if (!lead) return null;

    return (
        <Modal
            open={!!lead}
            onClose={onClose}
            title={displayName(lead)}
            subtitle={lead.business || lead.location.address || lead.phone || "Acciones rapidas"}
            size="sm"
        >
            <div className="grid gap-2">
                <ActionTile href={`/admin/leads/${lead.id}`} icon="chat" label="Chat" tone="purple" />
                {lead.location.mapsUrl ? (
                    <ActionTile href={lead.location.mapsUrl} icon="map" label="Maps" tone="green" external />
                ) : null}
                <ActionTileButton
                    onClick={() => void onReopen(lead)}
                    disabled={saving}
                    icon="history"
                    label={saving ? "Reabriendo" : "Reabrir"}
                    tone="orange"
                />
            </div>
        </Modal>
    );
}
