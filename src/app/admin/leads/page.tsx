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
import {
    ActionTile,
    ActionTileButton,
    AppIcon,
    Badge,
    Button,
    Card,
    Input,
    KpiCard,
    Modal,
    PageHeader,
} from "@/components/ui";

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

function formatDateShort(value?: number | null) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "2-digit",
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
    return typeof lead.raw.quickStatusText === "string"
        ? lead.raw.quickStatusText
        : "";
}

function hasNewInbound(lead: MetaLeadDoc) {
    const inbound = lead.lastInboundMessageAt ?? 0;
    const seen = Math.max(
        lead.adminQueueLastSeenMessageAt ?? 0,
        lead.adminQueueSeenAt ?? 0
    );

    return inbound > seen;
}

function whatsappUrl(phone?: string | null) {
    const clean = String(phone ?? "").replace(/\D+/g, "");
    if (!clean) return "";
    return `https://wa.me/${clean}?text=${encodeURIComponent(
        "Olá! Estou entrando em contato sobre seu cadastro 🙌"
    )}`;
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
        const query = new URLSearchParams(window.location.search)
            .get("search")
            ?.trim();

        if (!query) return;
        setFilters((prev) => ({ ...prev, search: query }));
    }, [setFilters]);

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <div className="xl:hidden">
                <MobileLeadQueue
                    leads={filteredLeads}
                    stats={stats}
                    filters={filters}
                    cityOptions={cityOptions}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    savingId={savingId}
                    activeFiltersCount={activeFiltersCount}
                    onPatchFilters={patchFilters}
                    onResetFilters={resetFilters}
                    onReloadUsers={reloadUsers}
                    onLoadMore={loadMore}
                    onOpenCoverage={() => setCoverageOpen(true)}
                    onOpenEdit={setEditingLead}
                    onOpenQuick={setQuickLead}
                />
            </div>

            <div className="hidden xl:block">
                <PageHeader
                    title="Leads"
                    subtitle="Gestiona, valida y asigna leads de forma eficiente."
                    icon={
                        <AppIcon
                            name="lead"
                            tone="purple"
                            size="sm"
                            className="bg-transparent text-white ring-0"
                        />
                    }
                    actions={
                        <div className="grid w-full grid-cols-[1fr_44px] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                            <Button
                                onClick={() => setCoverageOpen(true)}
                                disabled={loading || !filteredLeads.length}
                                className="w-full sm:w-auto"
                            >
                                <AppIcon
                                    name="assign"
                                    tone="purple"
                                    size="sm"
                                    className="h-5 w-5 rounded-md bg-transparent text-current ring-0"
                                />
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

                <LeadQuickAccessCards />

                <section className="mb-4 grid grid-cols-4 gap-4">
                    <KpiCard label="Cola activa" value={stats.total} caption="Leads Meta sin asignar" icon="users" tone="blue" />
                    <KpiCard label="Por revisar" value={stats.pendingReview} caption="Listos para validar" icon="lead" tone="purple" />
                    <KpiCard label="Incompletos" value={stats.incomplete} caption="Falta negocio o maps" icon="alert" tone="orange" />
                    <KpiCard label="No aptos" value={stats.notSuitable} caption="Descartados operativos" icon="close" tone="red" />
                </section>

                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 bg-gradient-to-b from-white to-[#fbfaff] px-4 py-4">
                        <div className="flex flex-row items-center justify-between gap-3">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#171717]">
                                    Cola de revisión
                                </h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                    {filteredLeads.length} visibles de {stats.total}
                                </p>
                            </div>

                            <Input
                                value={filters.search}
                                onChange={(e) => patchFilters({ search: e.target.value })}
                                placeholder="Buscar lead, teléfono, negocio, ciudad..."
                                className="w-[360px]"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <FilterSelect
                                label="Estado"
                                value={filters.status}
                                onChange={(value) =>
                                    patchFilters({ status: value as LeadFilters["status"] })
                                }
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
                                label="Asignación"
                                value={filters.assignment}
                                onChange={(value) =>
                                    patchFilters({
                                        assignment: value as LeadFilters["assignment"],
                                    })
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

                    <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                        <p className="text-[12px] font-medium text-[#9ca3af]">
                            {filteredLeads.length} leads cargados en esta vista
                        </p>
                        {hasMore ? (
                            <Button onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? "Cargando..." : "Cargar más"}
                            </Button>
                        ) : null}
                    </div>
                </Card>
            </div>

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

function MobileLeadQueue({
    leads,
    stats,
    filters,
    cityOptions,
    loading,
    loadingMore,
    hasMore,
    savingId,
    activeFiltersCount,
    onPatchFilters,
    onResetFilters,
    onReloadUsers,
    onLoadMore,
    onOpenCoverage,
    onOpenEdit,
    onOpenQuick,
}: {
    leads: MetaLeadDoc[];
    stats: ReturnType<typeof useAdminLeadQueue>["stats"];
    filters: LeadFilters;
    cityOptions: { value: string; label: string }[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    savingId: string | null;
    activeFiltersCount: number;
    onPatchFilters: (patch: Partial<LeadFilters>) => void;
    onResetFilters: () => void;
    onReloadUsers: () => void;
    onLoadMore: () => void;
    onOpenCoverage: () => void;
    onOpenEdit: (lead: MetaLeadDoc) => void;
    onOpenQuick: (lead: MetaLeadDoc) => void;
}) {
    const [filtersOpen, setFiltersOpen] = useState(false);

    return (
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] px-3 pb-[136px] pt-3 text-[#101936]">

            {/* HEADER */}
            <div className="mb-3 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                        Leads Meta
                    </h1>
                    <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                        <span className="font-black text-[#7C3AED]">{leads.length}</span> visibles
                        {" · "}total <span className="font-black text-[#101936]">{stats.total}</span>
                    </p>
                </div>

                <MobileHeaderButton
                    onClick={onOpenCoverage}
                    disabled={loading || !leads.length}
                    icon="assign"
                    label="Cobertura"
                />
                <MobileHeaderLink
                    href="/admin/leads/history"
                    icon="history"
                    label="Historial"
                />
                <MobileHeaderButton
                    onClick={onReloadUsers}
                    disabled={loading}
                    icon="users"
                    label="Usuarios"
                />
            </div>

            {/* BÚSQUEDA */}
            <div className="mb-3 flex h-[46px] items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 shadow-[0_2px_12px_rgba(91,33,255,0.07)]">
                <AppIcon
                    name="search"
                    tone="purple"
                    size="sm"
                    className="h-5 w-5 shrink-0 bg-transparent text-[#98A2B3] ring-0"
                />
                <input
                    value={filters.search}
                    onChange={(e) => onPatchFilters({ search: e.target.value })}
                    placeholder="Buscar lead, teléfono, negocio..."
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

            {/* FILTROS */}
            <div className="mb-3 rounded-[14px] border border-[#E8E7FB] bg-white p-3 shadow-[0_2px_12px_rgba(91,33,255,0.05)]">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <AppIcon
                            name="filter"
                            tone="purple"
                            size="sm"
                            className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0"
                        />
                        <p className="truncate text-[12px] font-bold text-[#66739A]">
                            Filtros operativos
                            {activeFiltersCount > 0 && (
                                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#7C3AED] text-[9px] font-black text-white">
                                    {activeFiltersCount}
                                </span>
                            )}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => setFiltersOpen((v) => !v)}
                        className="rounded-full border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-1.5 text-[11px] font-bold text-[#7C3AED] transition active:bg-[#f3f0ff]"
                    >
                        {filtersOpen ? "Ocultar" : "Mostrar"}
                    </button>
                </div>

                {filtersOpen ? (
                    <div className="mt-3 grid gap-2.5">
                        <MobileFilterSelect
                            label="Ciudad"
                            value={filters.city}
                            onChange={(value) => onPatchFilters({ city: value })}
                        >
                            <option value="all">Todas las ciudades</option>
                            {cityOptions.map((city) => (
                                <option key={city.value} value={city.value}>
                                    {city.label}
                                </option>
                            ))}
                        </MobileFilterSelect>

                        <MobileFilterSelect
                            label="Asignación"
                            value={filters.assignment}
                            onChange={(value) =>
                                onPatchFilters({
                                    assignment: value as LeadFilters["assignment"],
                                })
                            }
                        >
                            <option value="all">Manual y auto</option>
                            <option value="auto">Auto-asignados</option>
                            <option value="manual">Manuales</option>
                        </MobileFilterSelect>

                        {activeFiltersCount > 0 ? (
                            <button
                                type="button"
                                onClick={onResetFilters}
                                className="h-9 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] text-[12px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                            >
                                Limpiar filtros
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {/* LISTA */}
            <div className="grid min-w-0 gap-2 overflow-x-hidden">
                {loading ? (
                    <MobileState
                        icon="refresh"
                        title="Cargando leads"
                        body="Estamos preparando la cola operativa."
                    />
                ) : leads.length === 0 ? (
                    <MobileState
                        icon="filter"
                        title="Sin resultados"
                        body="No hay leads para ese filtro."
                    />
                ) : (
                    leads.map((lead) => (
                        <MobileLeadCard
                            key={lead.id}
                            lead={lead}
                            saving={savingId === lead.id}
                            onQuickActions={onOpenQuick}
                            onEdit={onOpenEdit}
                        />
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

            <LeadMobileStatusBar
                value={filters.status}
                stats={stats}
                total={stats.total}
                onChange={(status) => onPatchFilters({ status })}
            />
        </div>
    );
}

function MobileLeadCard({
    lead,
    saving,
    onQuickActions,
    onEdit,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onQuickActions: (lead: MetaLeadDoc) => void;
    onEdit: (lead: MetaLeadDoc) => void;
}) {
    const status = lead.verificationStatus;

    const statusBox =
        status === "pending_review"
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : status === "not_suitable"
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-amber-200 bg-amber-50 text-amber-700";

    const statusIcon =
        status === "pending_review" ? "🔍"
            : status === "not_suitable" ? "⊘"
                : "!";

    return (
        <article className="min-w-0 max-w-full overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white p-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)]">

            {/* FILA SUPERIOR */}
            <div className="flex items-start justify-between gap-2">
                <button
                    type="button"
                    onClick={() => onQuickActions(lead)}
                    disabled={saving}
                    className="min-w-0 flex-1 text-left disabled:opacity-60"
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[14px] font-black tracking-[-0.01em] text-[#101936]">
                            {lead.phone || displayName(lead)}
                        </p>
                        {hasNewInbound(lead) ? <Badge tone="green">NEW</Badge> : null}
                    </div>
                    {lead.name ? (
                        <p className="mt-0.5 truncate text-[12px] font-semibold text-[#344054]">
                            {lead.name}
                        </p>
                    ) : null}
                    {lead.business ? (
                        <p className="mt-0.5 truncate text-[11px] font-medium text-[#66739A]">
                            {lead.business}
                        </p>
                    ) : null}
                </button>

                <button
                    type="button"
                    onClick={() => onQuickActions(lead)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] text-[15px] font-black text-[#66739A] transition active:bg-[#f3f0ff]"
                >
                    ···
                </button>
            </div>

            {/* CIUDAD */}
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                    className={[
                        "inline-flex min-h-5 max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
                        lead.location.outOfCoverage
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-violet-200 bg-violet-50 text-violet-700",
                    ].join(" ")}
                >
                    <span>{lead.location.outOfCoverage ? "⚠" : "📍"}</span>
                    <span className="truncate">{cityLabel(lead)}</span>
                </span>
            </div>

            {/* STATUS */}
            <div
                className={[
                    "mt-2 flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[11px] font-semibold",
                    statusBox,
                ].join(" ")}
            >
                <span>{statusIcon}</span>
                <span className="min-w-0 flex-1 truncate">
                    {quickStatus(lead) || statusLabel[status]}
                </span>
            </div>

            {/* DIRECCIÓN */}
            {lead.location.address ? (
                <p className="mt-1.5 line-clamp-1 text-[11px] font-medium text-[#66739A]">
                    {lead.location.address}
                </p>
            ) : null}

            {/* META */}
            <p className="mt-1 truncate text-[10px] font-medium text-[#98A2B3]">
                Creado {formatDateShort(lead.createdAt)}
                {" · "}
                Activo {formatDateShort(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
            </p>

            {/* MENSAJE / CTA CHAT */}
            {lead.lastInboundText ? (
                <Link
                    href={`/admin/leads/${lead.id}`}
                    className="mt-2.5 block rounded-[12px] border border-[#E8E7FB] bg-[#fafafa] p-2.5 transition active:bg-[#f3f0ff]"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-[11px]">💬</span>
                        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#66739A]">
                            Último mensaje
                        </span>
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700">
                            Chat
                        </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-[#101936]">
                        {lead.lastInboundText}
                    </p>
                </Link>
            ) : (
                <Link
                    href={`/admin/leads/${lead.id}`}
                    className="mt-2.5 flex min-h-[44px] items-center justify-center gap-2 rounded-[12px] border border-violet-200 bg-violet-50 px-3 text-[12px] font-bold text-violet-700 transition active:bg-violet-100"
                >
                    💬 Abrir chat
                </Link>
            )}

            {/* ACCIONES */}
            <div className="mt-2.5 flex items-center gap-2">
                {lead.location.mapsUrl ? (
                    <a
                        href={lead.location.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] text-[15px] transition active:bg-[#f3f0ff]"
                    >
                        🗺️
                    </a>
                ) : null}

                {whatsappUrl(lead.phone) ? (
                    <a
                        href={whatsappUrl(lead.phone)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-emerald-200 bg-emerald-50 text-[15px] transition active:bg-emerald-100"
                    >
                        ☎
                    </a>
                ) : null}

                <button
                    type="button"
                    onClick={() => onEdit(lead)}
                    className="ml-auto min-h-[36px] rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-1.5 text-[11px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                >
                    Editar
                </button>
            </div>

            {saving ? (
                <p className="mt-1.5 text-[11px] font-medium text-[#98A2B3]">
                    Procesando…
                </p>
            ) : null}
        </article>
    );
}

function MobileHeaderButton({
    icon,
    label,
    onClick,
    disabled,
}: {
    icon: "assign" | "users";
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-50"
        >
            <AppIcon
                name={icon}
                tone="purple"
                size="sm"
                className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0"
            />
        </button>
    );
}

function MobileHeaderLink({
    href,
    icon,
    label,
}: {
    href: string;
    icon: "history";
    label: string;
}) {
    return (
        <Link
            href={href}
            title={label}
            aria-label={label}
            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-violet-200 bg-violet-50 transition active:bg-violet-100"
        >
            <AppIcon
                name={icon}
                tone="purple"
                size="sm"
                className="h-[18px] w-[18px] bg-transparent text-violet-700 ring-0"
            />
        </Link>
    );
}

function MobileFilterSelect({
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
        <label className="grid gap-1">
            <span className="text-[10px] font-bold text-[#98A2B3]">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-10 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                style={{ fontSize: "16px" }}
            >
                {children}
            </select>
        </label>
    );
}

function MobileState({
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
            <AppIcon
                name={icon}
                tone={icon === "refresh" ? "purple" : "slate"}
                size="lg"
                className="bg-[#f3f0ff]"
            />
            <p className="text-[14px] font-black text-[#101936]">{title}</p>
            <p className="text-[12px] font-medium text-[#66739A]">{body}</p>
        </div>
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
            {
                value: "pending_review",
                label: "Revisar",
                count: stats.pendingReview,
                icon: "lead",
                color: "text-blue-500",
            },
            {
                value: "incomplete",
                label: "Incompletos",
                count: stats.incomplete,
                icon: "alert",
                color: "text-amber-500",
            },
            {
                value: "not_suitable",
                label: "No aptos",
                count: stats.notSuitable,
                icon: "close",
                color: "text-red-500",
            },
            {
                value: "all",
                label: "Todos",
                count: total,
                icon: "filter",
                color: "text-violet-500",
            },
        ];

    return (
        <div className="fixed bottom-[72px] left-0 right-0 z-30 max-w-[100vw] overflow-hidden border-t border-[#E8E7FB] bg-white/95 px-2.5 pb-2 pt-2 shadow-[0_-8px_24px_rgba(91,33,255,0.08)] backdrop-blur-xl xl:hidden">
            <div className="grid grid-cols-4 gap-1.5">
                {items.map((item) => {
                    const active = value === item.value;

                    return (
                        <button
                            key={item.value}
                            type="button"
                            onClick={() => onChange(item.value)}
                            className={[
                                "relative min-h-[52px] rounded-[14px] border px-2 py-1.5 text-left transition active:opacity-80",
                                active
                                    ? "border-violet-200 bg-violet-50"
                                    : "border-[#E8E7FB] bg-[#fafafa]",
                            ].join(" ")}
                        >
                            {active && (
                                <span className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-gradient-to-r from-[#7c3aed] to-[#4f46e5]" />
                            )}
                            <div className="flex items-center justify-between gap-1">
                                <AppIcon
                                    name={item.icon}
                                    tone="slate"
                                    size="sm"
                                    className={`h-4 w-4 rounded-lg bg-transparent ring-0 ${item.color}`}
                                />
                                <span
                                    className={
                                        active
                                            ? "rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-black text-violet-700"
                                            : "rounded-full bg-[#f2f4f7] px-1.5 py-0.5 text-[9px] font-semibold text-[#98A2B3]"
                                    }
                                >
                                    {item.count}
                                </span>
                            </div>
                            <div
                                className={
                                    active
                                        ? "mt-1.5 truncate text-[9px] font-bold text-violet-700"
                                        : "mt-1.5 truncate text-[9px] font-medium text-[#98A2B3]"
                                }
                            >
                                {item.label}
                            </div>
                        </button>
                    );
                })}
            </div>
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
            <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[960px] border-collapse">
                    <thead>
                        <tr className="border-b border-[#f0f1f2] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                            <th className="px-3 py-2.5">Lead</th>
                            <th className="px-3 py-2.5">Estado</th>
                            <th className="px-3 py-2.5">Ciudad</th>
                            <th className="px-3 py-2.5">Último mensaje</th>
                            <th className="px-3 py-2.5 text-right">Actividad</th>
                        </tr>
                    </thead>

                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={5}>
                                    <TableState
                                        icon="refresh"
                                        title="Cargando leads"
                                        body="Estamos preparando la cola operativa."
                                    />
                                </td>
                            </tr>
                        ) : leads.length === 0 ? (
                            <tr>
                                <td colSpan={5}>
                                    <TableState
                                        icon="filter"
                                        title="Sin resultados"
                                        body="No hay leads con esos filtros."
                                    />
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
                        <span>{lead.phone || "Sin teléfono"}</span>
                        {lead.business ? <span>{lead.business}</span> : null}
                    </div>
                </div>
            </td>

            <td className="px-3 py-2.5">
                <Badge tone={statusTone[lead.verificationStatus]}>
                    {statusLabel[lead.verificationStatus]}
                </Badge>
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
                    {lead.location.address || "Dirección no informada"}
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
            <AppIcon
                name={icon}
                tone={icon === "refresh" ? "purple" : "slate"}
                size="lg"
            />
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
            subtitle={lead.business || lead.location.address || lead.phone || "Acciones rápidas"}
            size="sm"
        >
            <div className="grid gap-2">
                <ActionTile
                    href={`/admin/leads/${lead.id}`}
                    icon="chat"
                    label="Chat"
                    tone="purple"
                />
                {lead.location.mapsUrl ? (
                    <ActionTile
                        href={lead.location.mapsUrl}
                        icon="map"
                        label="Maps"
                        tone="green"
                        external
                    />
                ) : null}
                {whatsappUrl(lead.phone) ? (
                    <ActionTile
                        href={whatsappUrl(lead.phone)}
                        icon="chat"
                        label="WhatsApp"
                        tone="green"
                        external
                    />
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
                    <Button
                        variant="primary"
                        onClick={assignAll}
                        disabled={running || !plan.length}
                    >
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
                                            {match.user.name ||
                                                match.user.email ||
                                                match.user.id}
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
                                                    {cityLabel(lead)} -{" "}
                                                    {lead.business || lead.phone}
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
                                            +{match.leads.length - 8} más
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