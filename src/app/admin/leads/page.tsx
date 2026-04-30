"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    buildCoverageMatches,
    userCoverageLabel,
} from "@/features/leads/coverageMatching";
import { LeadQuickAccessCards } from "@/features/leads/LeadQuickAccessCards";
import { LeadEditModal } from "@/features/leads/LeadEditModal";
import { useAdminLeadQueue } from "@/features/leads/useAdminLeadQueue";
import type { LeadFilters, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { ActionTile, ActionTileButton, AppIcon, Badge, Button, Card, Input, KpiCard, Modal, PageHeader } from "@/components/ui";

const STATUS_OPTIONS: { value: LeadReviewStatus; label: string }[] = [
    { value: "pending_review", label: "Por revisar" },
    { value: "incomplete", label: "Incompleto" },
    { value: "not_suitable", label: "No apto" },
    { value: "verified", label: "Verificado" },
];

const statusLabel: Record<LeadReviewStatus, string> = {
    pending_review: "Por revisar",
    incomplete: "Incompleto",
    not_suitable: "No apto",
    verified: "Verificado",
};

const statusTone: Record<LeadReviewStatus, "yellow" | "gray" | "red" | "green"> = {
    pending_review: "yellow",
    incomplete: "gray",
    not_suitable: "red",
    verified: "green",
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

function hasNewInbound(lead: MetaLeadDoc) {
    const inbound = lead.lastInboundMessageAt ?? 0;
    const seen = Math.max(
        lead.adminQueueLastSeenMessageAt ?? 0,
        lead.adminQueueSeenAt ?? 0
    );

    return inbound > seen;
}

export default function AdminLeadsPage() {
    const [coverageOpen, setCoverageOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<MetaLeadDoc | null>(null);
    const [quickLead, setQuickLead] = useState<MetaLeadDoc | null>(null);
    const {
        users,
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
        reloadUsers,
        reloadLeads,
        loadMore,
        assignLead,
    } = useAdminLeadQueue();

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (filters.status !== "pending_review") total++;
        if (filters.city !== "all") total++;
        if (filters.assignment !== "all") total++;
        if (filters.search.trim()) total++;
        return total;
    }, [filters]);

    function patchFilters(patch: Partial<LeadFilters>) {
        setFilters((prev) => ({ ...prev, ...patch }));
    }

    useEffect(() => {
        const query = new URLSearchParams(window.location.search).get("search")?.trim();
        if (!query) return;
        setFilters((prev) => ({ ...prev, search: query }));
    }, [setFilters]);

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Leads"
                subtitle="Gestiona, valida y asigna leads de forma eficiente."
                icon={<AppIcon name="lead" tone="purple" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <div className="grid w-full grid-cols-[1fr_44px] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                        <Button onClick={() => setCoverageOpen(true)} disabled={loading || !filteredLeads.length} className="w-full sm:w-auto">
                            <AppIcon name="assign" tone="purple" size="sm" className="h-5 w-5 rounded-md bg-transparent text-current ring-0" />
                            <span className="sm:inline">Asignar por cobertura</span>
                        </Button>
                        <Button
                            variant="primary"
                            onClick={reloadUsers}
                            disabled={loading}
                            aria-label="Actualizar usuarios"
                            title="Actualizar usuarios"
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

            <div className="hidden xl:block">
                <LeadQuickAccessCards />
            </div>

            <section className="mb-3 grid grid-cols-2 gap-2 md:gap-4 xl:mb-4 xl:grid-cols-4">
                <KpiCard label="Cola activa" value={stats.total} caption="Leads Meta sin asignar" icon="users" tone="blue" />
                <KpiCard label="Por revisar" value={stats.pendingReview} caption="Listos para validar" icon="lead" tone="purple" />
                <KpiCard label="Incompletos" value={stats.incomplete} caption="Falta negocio o maps" icon="alert" tone="orange" />
                <KpiCard label="No aptos" value={stats.notSuitable} caption="Descartados operativos" icon="close" tone="red" />
            </section>

            <Card className="overflow-hidden xl:overflow-hidden">
                <div className="flex flex-col gap-3 bg-[#111827] px-3 py-3 xl:bg-gradient-to-b xl:from-white xl:to-[#fbfaff] xl:px-4 xl:py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="hidden xl:block">
                            <h2 className="text-[14px] font-semibold text-[#171717]">
                                Cola de revision
                            </h2>
                            <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                {filteredLeads.length} visibles de {stats.total}
                            </p>
                        </div>

                        <Input
                            value={filters.search}
                            onChange={(e) => patchFilters({ search: e.target.value })}
                            placeholder="Buscar lead, telefono, negocio, ciudad..."
                            className="xl:w-[360px]"
                        />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        <FilterSelect
                            label="Estado"
                            value={filters.status}
                            onChange={(value) => patchFilters({ status: value as LeadFilters["status"] })}
                        >
                            <option value="all">Todos los estados</option>
                            {STATUS_OPTIONS.filter((status) => status.value !== "verified").map((status) => (
                                <option key={status.value} value={status.value}>
                                    {status.label}
                                </option>
                            ))}
                        </FilterSelect>

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
                            label="Asignacion"
                            value={filters.assignment}
                            onChange={(value) =>
                                patchFilters({ assignment: value as LeadFilters["assignment"] })
                            }
                        >
                            <option value="all">Manual y auto</option>
                            <option value="auto">Auto-asignados</option>
                            <option value="manual">Manuales</option>
                        </FilterSelect>
                    </div>
                    {activeFiltersCount > 0 ? (
                        <div className="flex justify-end">
                            <Button onClick={resetFilters}>Limpiar filtros</Button>
                        </div>
                    ) : null}
                </div>

                <LeadsTable
                    leads={filteredLeads}
                    loading={loading}
                    savingId={savingId}
                    onQuickActions={setQuickLead}
                />

                <div className="flex flex-col gap-3 border-t border-white/[0.08] px-3 py-3 sm:flex-row sm:items-center sm:justify-between xl:border-[#f0f1f2] xl:px-4">
                    <p className="text-[12px] font-extrabold text-[#9CA3AF] xl:font-medium xl:text-[#9ca3af]">
                        {filteredLeads.length} leads cargados en esta vista
                    </p>
                    {hasMore ? (
                        <Button onClick={loadMore} disabled={loadingMore} className="w-full sm:w-auto">
                            {loadingMore ? "Cargando..." : "Cargar mas"}
                        </Button>
                    ) : null}
                </div>
            </Card>

            <LeadMobileStatusBar
                value={filters.status}
                stats={stats}
                total={stats.total}
                onChange={(status) => patchFilters({ status })}
            />

            <CoverageAssignModal
                open={coverageOpen}
                onClose={() => setCoverageOpen(false)}
                leads={filteredLeads}
                users={users}
                savingId={savingId}
                onAssign={assignLead}
            />

            <LeadEditModal
                open={!!editingLead}
                lead={editingLead}
                onClose={() => setEditingLead(null)}
                onSaved={reloadLeads}
                users={users}
                onAssign={assignLead}
            />

            <LeadQuickActionsModal
                lead={quickLead}
                onClose={() => setQuickLead(null)}
                onEdit={(lead) => {
                    setQuickLead(null);
                    setEditingLead(lead);
                }}
            />
        </div>
    );
}

// Kept temporarily while the lead section access cards are being consolidated.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LeadAccessCard({
    href,
    title,
    body,
    icon,
    tone,
}: {
    href: string;
    title: string;
    body: string;
    icon: "history" | "assign";
    tone: "slate" | "green";
}) {
    return (
        <Link
            href={href}
            className="group flex items-center gap-4 rounded-2xl border border-[#e7e8f0] bg-white px-4 py-4 shadow-[0_16px_42px_rgba(16,25,54,0.06)] transition hover:border-[#c4b5fd] hover:bg-[#fbfaff]"
        >
            <AppIcon name={icon} tone={tone} size="lg" />
            <div className="min-w-0">
                <div className="text-[14px] font-bold text-[#101936]">{title}</div>
                <div className="mt-1 max-w-[360px] text-[12px] font-medium leading-snug text-[#66739a]">{body}</div>
            </div>
            <span className="ml-auto text-[18px] font-bold text-[#a78bfa] transition group-hover:translate-x-0.5">›</span>
        </Link>
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

function LeadMobileStatusBar({
    value,
    stats,
    total,
    onChange,
}: {
    value: LeadFilters["status"];
    stats: ReturnType<typeof useAdminLeadQueue>["stats"];
    total: number;
    onChange: (status: LeadFilters["status"]) => void;
}) {
    const items: {
        value: LeadFilters["status"];
        label: string;
        count: number;
        icon: "lead" | "alert" | "close" | "filter";
        color: string;
    }[] = [
        { value: "pending_review", label: "Revisar", count: stats.pendingReview, icon: "lead", color: "text-[#93C5FD]" },
        { value: "incomplete", label: "Incompletos", count: stats.incomplete, icon: "alert", color: "text-[#FDE68A]" },
        { value: "not_suitable", label: "No aptos", count: stats.notSuitable, icon: "close", color: "text-[#FCA5A5]" },
        { value: "all", label: "Todos", count: total, icon: "filter", color: "text-[#C4B5FD]" },
    ];

    return (
        <div className="fixed bottom-[72px] left-0 right-0 z-30 border-t border-white/[0.06] bg-[#0B1220]/94 px-3 pb-2 pt-2 backdrop-blur-xl xl:hidden">
            <div className="grid grid-cols-4 gap-2">
                {items.map((item) => {
                    const active = value === item.value;
                    return (
                        <button
                            key={item.value}
                            type="button"
                            onClick={() => onChange(item.value)}
                            className={[
                                "min-h-[62px] rounded-[18px] border px-2 py-2 text-left transition",
                                active
                                    ? "border-white/18 bg-blue-500/16"
                                    : "border-white/[0.08] bg-[#0F172A]",
                            ].join(" ")}
                        >
                            <div className="flex items-center justify-between gap-1">
                                <AppIcon name={item.icon} tone="slate" size="sm" className={`h-5 w-5 rounded-lg bg-transparent ring-0 ${item.color}`} />
                                <span className={active ? "rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-black text-[#F9FAFB]" : "rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-black text-[#CBD5E1]"}>
                                    {item.count}
                                </span>
                            </div>
                            <div className={active ? "mt-2 truncate text-[10px] font-black text-[#F9FAFB]" : "mt-2 truncate text-[10px] font-black text-[#9CA3AF]"}>
                                {item.label}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function LeadsTable({
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
                    <TableState icon="refresh" title="Cargando leads" body="Estamos preparando la cola operativa." />
                ) : leads.length === 0 ? (
                    <TableState icon="filter" title="Sin resultados" body="No hay leads con esos filtros." />
                ) : (
                    leads.map((lead) => (
                        <LeadMobileCard
                            key={lead.id}
                            lead={lead}
                            saving={savingId === lead.id}
                            onQuickActions={onQuickActions}
                        />
                    ))
                )}
            </div>

            <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[960px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                        <th className="px-3 py-2.5">Lead</th>
                        <th className="px-3 py-2.5">Estado</th>
                        <th className="px-3 py-2.5">Ciudad</th>
                        <th className="px-3 py-2.5">Ultimo mensaje</th>
                        <th className="px-3 py-2.5 text-right">Actividad</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={5}>
                                <TableState icon="refresh" title="Cargando leads" body="Estamos preparando la cola operativa." />
                            </td>
                        </tr>
                    ) : leads.length === 0 ? (
                        <tr>
                            <td colSpan={5}>
                                <TableState icon="filter" title="Sin resultados" body="No hay leads con esos filtros." />
                            </td>
                        </tr>
                    ) : (
                        leads.map((lead) => (
                            <LeadRow
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

function LeadMobileCard({
    lead,
    saving,
    onQuickActions,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => {
                if (!saving) onQuickActions(lead);
            }}
            className="block w-full bg-[#111827] px-3 py-3 text-left transition active:bg-[#0F172A] disabled:opacity-60 sm:px-4 xl:bg-white xl:hover:bg-[#f8f7ff]"
            disabled={saving}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-black text-[#F9FAFB] xl:text-[13px] xl:font-bold xl:text-[#101936]">
                            {displayName(lead)}
                        </span>
                        {hasNewInbound(lead) ? <Badge tone="green">NEW</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] font-extrabold text-[#9CA3AF] xl:text-[11px] xl:font-semibold xl:text-[#8a93ad]">
                        {[lead.phone, lead.business].filter(Boolean).join(" - ") || "Sin datos de contacto"}
                    </div>
                </div>
                <Badge tone={statusTone[lead.verificationStatus]}>
                    {statusLabel[lead.verificationStatus]}
                </Badge>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 text-[11px] font-medium text-[#66739a]">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-black text-[#93C5FD] xl:font-bold xl:text-[#344054]">{cityLabel(lead)}</span>
                        {lead.location.outOfCoverage ? <Badge tone="yellow">Fuera</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-[#CBD5E1] xl:font-medium xl:text-[#98a2b3]">
                        {lead.lastInboundText || quickStatus(lead) || "Sin mensaje reciente"}
                    </div>
                </div>
                <div className="text-right text-[11px] font-black text-[#9CA3AF] xl:font-bold xl:text-[#66739a]">
                    {formatDate(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
                </div>
            </div>

            {quickStatus(lead) ? (
                <div className="mt-2 truncate rounded-xl border border-white/[0.08] bg-[#0F172A] px-3 py-2 text-[11px] font-black text-[#CBD5E1] xl:border-[#eef1f5] xl:bg-[#fbfaff] xl:font-semibold xl:text-[#66739a]">
                    {quickStatus(lead)}
                </div>
            ) : null}
        </button>
    );
}

function LeadRow({
    lead,
    saving,
    onQuickActions,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    return (
        <tr
            onClick={() => {
                if (!saving) onQuickActions(lead);
            }}
            className="cursor-pointer border-b border-[#f0f1f2] last:border-0 hover:bg-[#f8f7ff]"
        >
            <td className="px-3 py-2.5">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-semibold text-[#171717]">
                            {displayName(lead)}
                        </span>
                        {hasNewInbound(lead) ? <Badge tone="green">NEW</Badge> : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-[#9ca3af]">
                        <span>{lead.phone || "Sin telefono"}</span>
                        {lead.business ? <span>{lead.business}</span> : null}
                    </div>
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <Badge tone={statusTone[lead.verificationStatus]}>
                        {statusLabel[lead.verificationStatus]}
                    </Badge>
                </div>
                <div className="mt-1 max-w-[210px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {quickStatus(lead)}
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <span className="max-w-[190px] truncate text-[12px] font-semibold text-[#171717]">
                        {cityLabel(lead)}
                    </span>
                    {lead.location.outOfCoverage ? <Badge tone="yellow">Fuera</Badge> : null}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {lead.location.address || "Direccion no informada"}
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="max-w-[250px] truncate text-[12px] font-medium text-[#52525b]">
                    {lead.lastInboundText || "Sin mensaje reciente"}
                </div>
            </td>

            <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#71717a]">
                {formatDate(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
            </td>
        </tr>
    );
}

function TableState({
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
            <div className="mt-3 text-[13px] font-bold text-[#101936]">{title}</div>
            <div className="mt-1 text-[12px] font-medium text-[#66739a]">{body}</div>
        </div>
    );
}

function LeadQuickActionsModal({
    lead,
    onClose,
    onEdit,
}: {
    lead: MetaLeadDoc | null;
    onClose: () => void;
    onEdit: (lead: MetaLeadDoc) => void;
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
                    onClick={() => onEdit(lead)}
                    icon="edit"
                    label="Editar"
                    tone="orange"
                />
            </div>
        </Modal>
    );
}

function CoverageAssignModal({
    open,
    onClose,
    leads,
    users,
    savingId,
    onAssign,
}: {
    open: boolean;
    onClose: () => void;
    leads: MetaLeadDoc[];
    users: UserDoc[];
    savingId: string | null;
    onAssign: (lead: MetaLeadDoc, userId: string) => Promise<void>;
}) {
    const [query, setQuery] = useState("");
    const [running, setRunning] = useState(false);

    const matches = useMemo(() => {
        const q = query.toLowerCase().trim();
        const base = buildCoverageMatches(leads, users);

        if (!q) return base;

        return base
            .map((match) => {
                const userHaystack = [
                    match.user.name,
                    match.user.email,
                    userCoverageLabel(match.user),
                ]
                    .join(" ")
                    .toLowerCase();

                const filteredLeads = match.leads.filter((lead) =>
                    [
                        displayName(lead),
                        lead.phone,
                        lead.business,
                        cityLabel(lead),
                        lead.location.address,
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(q)
                );

                return {
                    ...match,
                    leads: userHaystack.includes(q) ? match.leads : filteredLeads,
                };
            })
            .filter((match) => match.leads.length > 0);
    }, [leads, query, users]);

    const plan = useMemo(() => {
        const used = new Set<string>();
        const rows: Array<{ lead: MetaLeadDoc; user: UserDoc }> = [];

        for (const match of matches) {
            for (const lead of match.leads) {
                if (used.has(lead.id)) continue;
                used.add(lead.id);
                rows.push({ lead, user: match.user });
            }
        }

        return rows;
    }, [matches]);

    async function assignAll() {
        if (!plan.length) return;
        const ok = window.confirm(`Asignar ${plan.length} lead(s) por cobertura?`);
        if (!ok) return;

        setRunning(true);
        try {
            for (const item of plan) {
                await onAssign(item.lead, item.user.id);
            }
            onClose();
        } finally {
            setRunning(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Asignar por cobertura"
            subtitle={`${plan.length} sugerencias sobre ${leads.length} leads visibles`}
        >
            <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar usuario, ciudad o lead..."
                    />
                    <Button variant="primary" onClick={assignAll} disabled={running || !plan.length}>
                        {running ? "Asignando..." : "Asignar visibles"}
                    </Button>
                </div>

                <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                    {!matches.length ? (
                        <div className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] p-5 text-center text-[13px] font-medium text-[#71717a]">
                            No hay coincidencias de cobertura en los leads cargados.
                        </div>
                    ) : (
                        matches.map((match) => (
                            <div
                                key={match.user.id}
                                className="rounded-lg border border-[#e5e7eb] bg-white"
                            >
                                <div className="flex items-center justify-between gap-3 border-b border-[#f0f1f2] px-3 py-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-[12px] font-semibold text-[#171717]">
                                            {match.user.name || match.user.email || match.user.id}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                            {userCoverageLabel(match.user)}
                                        </div>
                                    </div>
                                    <Badge tone="blue">{match.leads.length}</Badge>
                                </div>

                                <div className="divide-y divide-[#f0f1f2]">
                                    {match.leads.slice(0, 8).map((lead) => (
                                        <div
                                            key={`${match.user.id}-${lead.id}`}
                                            className="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_auto]"
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate text-[12px] font-semibold text-[#171717]">
                                                    {displayName(lead)}
                                                </div>
                                                <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                                    {cityLabel(lead)} - {lead.business || lead.phone}
                                                </div>
                                            </div>
                                            <Button
                                                onClick={() => onAssign(lead, match.user.id)}
                                                disabled={running || savingId === lead.id}
                                            >
                                                Asignar
                                            </Button>
                                        </div>
                                    ))}

                                    {match.leads.length > 8 ? (
                                        <div className="px-3 py-2 text-[11px] font-medium text-[#9ca3af]">
                                            +{match.leads.length - 8} mas
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Modal>
    );
}
