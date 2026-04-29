"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    buildCoverageMatches,
    userCoverageLabel,
} from "@/features/leads/coverageMatching";
import { LeadEditModal } from "@/features/leads/LeadEditModal";
import { useAdminLeadQueue } from "@/features/leads/useAdminLeadQueue";
import type { LeadFilters, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { Badge, Button, Card, Input, Modal, PageHeader, StatCard } from "@/components/ui";

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

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Leads"
                actions={
                    <>
                        <Button onClick={() => setCoverageOpen(true)} disabled={loading || !filteredLeads.length}>
                            Asignar por cobertura
                        </Button>
                        {activeFiltersCount > 0 ? (
                            <Button onClick={resetFilters}>Limpiar filtros</Button>
                        ) : null}
                        <Button variant="primary" onClick={reloadUsers} disabled={loading}>
                            {loading ? "Cargando..." : "Actualizar usuarios"}
                        </Button>
                    </>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="mb-4 grid gap-3 md:grid-cols-2">
                <LeadAccessCard
                    href="/admin/leads/history"
                    title="Historial"
                    body="Leads incompletos o descartados fuera de la cola activa."
                />
                <LeadAccessCard
                    href="/admin/leads/assignments"
                    title="Asignaciones"
                    body="Auditoria de auto-asignacion y distribucion de trabajo."
                />
            </section>

            <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Cola activa" value={stats.total} caption="Leads Meta sin asignar" />
                <StatCard label="Por revisar" value={stats.pendingReview} caption="Listos para validar" />
                <StatCard label="Incompletos" value={stats.incomplete} caption="Falta negocio o maps" />
                <StatCard label="No aptos" value={stats.notSuitable} caption="Descartados operativos" />
            </section>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 px-4 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
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
                            className="xl:w-[340px]"
                        />
                    </div>

                    <div className="grid gap-2 md:grid-cols-3">
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
                </div>

                <LeadsTable
                    leads={filteredLeads}
                    loading={loading}
                    savingId={savingId}
                    onEdit={setEditingLead}
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
        </div>
    );
}

function LeadAccessCard({
    href,
    title,
    body,
}: {
    href: string;
    title: string;
    body: string;
}) {
    return (
        <Link
            href={href}
            className="rounded-lg border border-[#e5e7eb] bg-white px-4 py-3 shadow-sm transition hover:border-[#bfdbfe] hover:bg-[#eff6ff]"
        >
            <div className="text-[13px] font-semibold text-[#171717]">{title}</div>
            <div className="mt-1 text-[12px] font-medium text-[#71717a]">{body}</div>
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

function LeadsTable({
    leads,
    loading,
    savingId,
    onEdit,
}: {
    leads: MetaLeadDoc[];
    loading: boolean;
    savingId: string | null;
    onEdit: (lead: MetaLeadDoc) => void;
}) {
    return (
        <div className="overflow-x-auto border-t border-[#f0f1f2]">
            <table className="w-full min-w-[1180px] border-collapse">
                <thead>
                    <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                        <th className="px-4 py-3">Lead</th>
                        <th className="px-4 py-3">Estado</th>
                        <th className="px-4 py-3">Ciudad</th>
                        <th className="px-4 py-3">Mapa</th>
                        <th className="px-4 py-3">Ultimo mensaje</th>
                        <th className="px-4 py-3">Accion</th>
                        <th className="px-4 py-3 text-right">Actividad</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={7} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                Cargando leads...
                            </td>
                        </tr>
                    ) : leads.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                No hay leads con esos filtros.
                            </td>
                        </tr>
                    ) : (
                        leads.map((lead) => (
                            <LeadRow
                                key={lead.id}
                                lead={lead}
                                saving={savingId === lead.id}
                                onEdit={onEdit}
                            />
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function LeadRow({
    lead,
    saving,
    onEdit,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onEdit: (lead: MetaLeadDoc) => void;
}) {
    return (
        <tr className="border-b border-[#f0f1f2] last:border-0 hover:bg-[#fafafa]">
            <td className="px-4 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Link
                            href={`/admin/leads/${lead.id}`}
                            className="truncate text-[12px] font-semibold text-[#171717] hover:underline"
                        >
                            {displayName(lead)}
                        </Link>
                        {hasNewInbound(lead) ? <Badge tone="green">NEW</Badge> : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-[#9ca3af]">
                        <span>{lead.phone || "Sin telefono"}</span>
                        {lead.business ? <span>{lead.business}</span> : null}
                    </div>
                </div>
            </td>

            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    <Badge tone={statusTone[lead.verificationStatus]}>
                        {statusLabel[lead.verificationStatus]}
                    </Badge>
                </div>
                <div className="mt-1 max-w-[210px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {quickStatus(lead)}
                </div>
            </td>

            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-[#171717]">
                        {cityLabel(lead)}
                    </span>
                    {lead.location.outOfCoverage ? <Badge tone="yellow">Fuera</Badge> : null}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {lead.location.address || "Direccion no informada"}
                </div>
            </td>

            <td className="px-4 py-3">
                {lead.location.mapsUrl ? (
                    <a
                        href={lead.location.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Google Maps"
                        aria-label="Abrir en Google Maps"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e5e7eb] bg-white text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
                    >
                        <MapIcon />
                    </a>
                ) : (
                    <Badge tone="gray">Sin mapa</Badge>
                )}
            </td>

            <td className="px-4 py-3">
                <div className="max-w-[220px] truncate text-[12px] font-medium text-[#52525b]">
                    {lead.lastInboundText || "Sin mensaje reciente"}
                </div>
            </td>

            <td className="px-4 py-3">
                <Button onClick={() => onEdit(lead)} disabled={saving}>
                    Editar
                </Button>
            </td>

            <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#71717a]">
                {formatDate(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
            </td>
        </tr>
    );
}

function MapIcon() {
    return (
        <span aria-hidden className="relative block h-4 w-4">
            <span className="absolute left-[5px] top-[1px] h-3 w-3 rotate-45 rounded-[3px] border border-current" />
            <span className="absolute left-[8px] top-[4px] h-1.5 w-1.5 rounded-full bg-current" />
        </span>
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
