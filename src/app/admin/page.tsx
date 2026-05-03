"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAdminDashboardSnapshot } from "@/data/adminDashboardRepo";
import type { AdminDashboardRange, AdminDashboardSnapshot } from "@/types/dashboard";
import type { AutoAssignLogDoc, LeadAutoAssignMatchType, MetaLeadDoc } from "@/types/leads";
import { AppIcon, Badge, Button, Card, KpiCard, PageHeader } from "@/components/ui";

const EMPTY_SNAPSHOT: AdminDashboardSnapshot = {
    stats: {
        queueTotal: 0,
        pendingReview: 0,
        incomplete: 0,
        notSuitable: 0,
        outOfCoverage: 0,
        unreadLoaded: 0,
        autoAssignmentsToday: 0,
        activeUsers: 0,
        autoAssignUsers: 0,
        usersWithoutCoverage: 0,
    },
    queueRangeStats: {
        incomplete: 0,
        notSuitable: 0,
        outOfCoverage: 0,
    },
    queueRange: "today",
    recentLeads: [],
    recentAssignments: [],
};

const RANGE_OPTIONS: { value: AdminDashboardRange; label: string; caption: string }[] = [
    { value: "today", label: "Hoy", caption: "Actualizado hoy" },
    { value: "7d", label: "7 dias", caption: "Actualizado en 7 dias" },
    { value: "30d", label: "30 dias", caption: "Actualizado en 30 dias" },
    { value: "all", label: "Todo", caption: "Estado actual completo" },
];

const matchLabel: Record<LeadAutoAssignMatchType, string> = {
    city: "Ciudad",
    hub_city: "Hub",
    state: "Estado",
    country: "Pais",
};

const matchTone: Record<LeadAutoAssignMatchType, "green" | "purple" | "yellow" | "blue"> = {
    city: "green",
    hub_city: "purple",
    state: "yellow",
    country: "blue",
};

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

function statusLabel(status: MetaLeadDoc["verificationStatus"]) {
    if (status === "pending_review") return "Por revisar";
    if (status === "incomplete") return "Incompleto";
    if (status === "not_suitable") return "No apto";
    return "Verificado";
}

function statusTone(status: MetaLeadDoc["verificationStatus"]) {
    if (status === "pending_review") return "yellow";
    if (status === "incomplete") return "gray";
    if (status === "not_suitable") return "red";
    return "green";
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

function assignmentLeadTitle(log: AutoAssignLogDoc) {
    return log.leadName || log.leadPhone || log.leadId || "Lead";
}

function money(value: number) {
    return `R$ ${Number(value || 0).toFixed(2)}`;
}

export default function AdminDashboardPage() {
    const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot>(EMPTY_SNAPSHOT);
    const [queueRange, setQueueRange] = useState<AdminDashboardRange>("today");
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    async function loadDashboard(range = queueRange) {
        setLoading(true);
        setErr(null);

        try {
            const next = await getAdminDashboardSnapshot({ queueRange: range });
            setSnapshot(next);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cargar el dashboard.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        queueMicrotask(() => {
            void loadDashboard();
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queueRange]);

    function changeQueueRange(range: AdminDashboardRange) {
        setQueueRange(range);
    }

    const pendingReviewLeads = useMemo(() => {
        return snapshot.recentLeads.filter((lead) => lead.verificationStatus === "pending_review");
    }, [snapshot]);

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <MobileAdminHome
                snapshot={snapshot}
                loading={loading}
                queueRange={queueRange}
                onRangeChange={changeQueueRange}
            />

            <div className="hidden xl:block">
            <PageHeader
                title="Dashboard"
                subtitle="Pulso operativo de leads, asignaciones y cobertura."
                icon={<AppIcon name="activity" tone="purple" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <div className="grid w-full grid-cols-[1fr_1fr_1fr_44px] gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
                        <QuickLink href="/admin/leads" icon="lead">Prospectos</QuickLink>
                        <QuickLink href="/admin/leads/assignments" icon="assign">Asign.</QuickLink>
                        <QuickLink href="/admin/settings/users" icon="users">Usuarios</QuickLink>
                        <Button
                            variant="primary"
                            onClick={() => loadDashboard()}
                            disabled={loading}
                            aria-label="Actualizar dashboard"
                            title="Actualizar dashboard"
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

            <section className="mb-3 grid grid-cols-2 gap-2 md:gap-4 xl:mb-4 xl:grid-cols-4">
                <KpiCard label="Cola activa" value={snapshot.stats.queueTotal} caption="Sin asignar" icon="users" tone="blue" />
                <KpiCard label="Por revisar" value={snapshot.stats.pendingReview} caption="Listos para validar" icon="lead" tone="purple" />
                <KpiCard label="Asignaciones hoy" value={snapshot.stats.autoAssignmentsToday} caption="Auto-asignacion" icon="assign" tone="green" />
                <KpiCard label="Usuarios activos" value={snapshot.stats.activeUsers} caption={`${snapshot.stats.autoAssignUsers} con auto ON`} icon="check" tone="orange" />
            </section>

            <section className="mb-3 grid gap-3 xl:mb-4 xl:grid-cols-[1.1fr_0.9fr] xl:gap-4">
                <Card className="overflow-hidden">
                    <PanelHeader
                        title="Actividad reciente"
                        caption={`${snapshot.recentLeads.length} prospectos recientes`}
                        href="/admin/leads"
                    />
                    <div className="divide-y divide-white/[0.08] xl:divide-[#f0f1f2]">
                        {loading ? (
                            <EmptyRow text="Cargando actividad..." />
                        ) : snapshot.recentLeads.length ? (
                            snapshot.recentLeads.map((lead) => (
                                <RecentLeadRow key={lead.id} lead={lead} />
                            ))
                        ) : (
                            <EmptyRow text="No hay leads recientes en cola." />
                        )}
                    </div>
                </Card>

                <Card className="overflow-hidden">
                    <PanelHeader
                        title="Por revisar"
                        caption={`${pendingReviewLeads.length} prospectos listos para validar`}
                        href="/admin/leads"
                    />
                    <div className="divide-y divide-white/[0.08] xl:divide-[#f0f1f2]">
                        {loading ? (
                            <EmptyRow text="Cargando leads por revisar..." />
                        ) : pendingReviewLeads.length ? (
                            pendingReviewLeads.slice(0, 5).map((lead) => (
                                <RecentLeadRow key={lead.id} lead={lead} compact />
                            ))
                        ) : (
                            <EmptyRow text="No hay leads por revisar en el resumen." />
                        )}
                    </div>
                </Card>
            </section>

            <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr] xl:gap-4">
                <Card className="overflow-hidden">
                    <PanelHeader
                        title="Estado de cola"
                        caption={RANGE_OPTIONS.find((item) => item.value === snapshot.queueRange)?.caption ?? "Estado actual completo"}
                        href="/admin/leads/history"
                        controls={
                            <RangeSelector
                                value={queueRange}
                                onChange={changeQueueRange}
                            />
                        }
                    />
                    <div className="grid grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-4">
                        <MiniMetric label="Incompletos" value={snapshot.queueRangeStats.incomplete} tone="gray" />
                        <MiniMetric label="No aptos" value={snapshot.queueRangeStats.notSuitable} tone="red" />
                        <MiniMetric label="Fuera cobertura" value={snapshot.queueRangeStats.outOfCoverage} tone="yellow" />
                    </div>
                </Card>

                <Card className="overflow-hidden">
                    <PanelHeader
                        title="Ultimas asignaciones"
                        caption={`${snapshot.recentAssignments.length} logs recientes de hoy`}
                        href="/admin/leads/assignments"
                    />
                    <div className="divide-y divide-white/[0.08] xl:divide-[#f0f1f2]">
                        {loading ? (
                            <EmptyRow text="Cargando asignaciones..." />
                        ) : snapshot.recentAssignments.length ? (
                            snapshot.recentAssignments.map((log) => (
                                <RecentAssignmentRow key={log.id} log={log} />
                            ))
                        ) : (
                            <EmptyRow text="Aun no hay auto-asignaciones hoy." />
                        )}
                    </div>
                </Card>
            </section>
            </div>
        </div>
    );
}

function MobileAdminHome({
    snapshot,
    loading,
    queueRange,
    onRangeChange,
}: {
    snapshot: AdminDashboardSnapshot;
    loading: boolean;
    queueRange: AdminDashboardRange;
    onRangeChange: (range: AdminDashboardRange) => void;
}) {
    const isWeek = queueRange !== "30d";
    const visibleLeadStats = {
        pendingReview: snapshot.stats.pendingReview,
        incomplete: snapshot.queueRangeStats.incomplete,
        notSuitable: snapshot.queueRangeStats.notSuitable,
        verified: Math.max(0, snapshot.stats.queueTotal - snapshot.stats.pendingReview - snapshot.stats.incomplete - snapshot.stats.notSuitable),
        activeQueue: snapshot.stats.queueTotal,
        total: snapshot.stats.queueTotal + snapshot.queueRangeStats.incomplete + snapshot.queueRangeStats.notSuitable,
    };

    return (
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-6rem)] bg-[#0B1220] bg-[linear-gradient(rgba(3,10,20,0.54),rgba(3,10,20,0.54)),url('/brand/trackgo-bg-map.png')] bg-cover bg-center px-4 pt-3 text-[#F9FAFB] xl:hidden">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-[24px] font-black tracking-[0.02em]">Admin</h1>
                    <p className="mt-0.5 truncate text-[13px] font-bold text-[#D7E2EE]">
                        Hola, <span className="font-black text-white">TrackGo</span>
                    </p>
                </div>
                <Link
                    href="/admin/settings/users"
                    aria-label="Usuarios"
                    title="Usuarios"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.08] text-[#D7E2EE] transition active:bg-white/[0.15]"
                >
                    <MobileLineIcon name="users" />
                </Link>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
                <MobileQuickCard
                    href="/admin/activity"
                    icon="wallet"
                    badge="HOY"
                    badgeTone="green"
                    title="Cobranza de hoy"
                    value={money(0)}
                    stats={[
                        { label: "Visitados", value: 0, color: "#86EFAC", icon: "check" },
                        { label: "Rechazados", value: 0, color: "#FCA5A5", icon: "close" },
                        { label: "Pendientes", value: snapshot.stats.queueTotal, color: "#FDE68A", icon: "clock" },
                    ]}
                    footer={loading ? "Actualizando..." : "Top: Sin datos"}
                />

                <MobileQuickCard
                    href="/admin/accounting"
                    icon="calendar"
                    badge="SEMANA"
                    badgeTone="purple"
                    title="Cierre semanal"
                    value={money(0)}
                    stats={[
                        { label: "Visitados", value: 0, color: "#86EFAC", icon: "check" },
                        { label: "Rechazados", value: 0, color: "#FCA5A5", icon: "close" },
                        { label: "Pendientes", value: snapshot.stats.queueTotal, color: "#FDE68A", icon: "clock" },
                    ]}
                    footer="Lunes -> Domingo"
                />
            </div>

            <div className="mb-2 rounded-[22px] border border-[#1F2937] bg-[#111827] p-3.5">
                <div>
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] border border-white/[0.08] bg-[#0A1628]/80 text-[#5AC8FA] shadow-[0_0_18px_rgba(37,99,235,0.18)]">
                            <MobileLineIcon name="filter" />
                        </div>

                        <div className="flex flex-1 flex-col items-end gap-2">
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onRangeChange("7d")}
                                    className={isWeek ? "rounded-full border border-[#5AC8FA]/25 bg-[#5AC8FA]/15 px-3 py-1.5 text-[11px] font-black text-white" : "rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-black text-[#9CA3AF]"}
                                >
                                    Semana
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onRangeChange("30d")}
                                    className={!isWeek ? "rounded-full border border-[#5AC8FA]/25 bg-[#5AC8FA]/15 px-3 py-1.5 text-[11px] font-black text-white" : "rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-black text-[#9CA3AF]"}
                                >
                                    Mes
                                </button>
                            </div>
                            <span className="rounded-full border border-blue-300/30 bg-blue-400/10 px-3 py-1.5 text-[11px] font-black tracking-[0.04em] text-[#BFDBFE]">
                                META LEADS
                            </span>
                        </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <MobileTinyStat icon="help" color="#5AC8FA" value={visibleLeadStats.pendingReview} label="Revision" />
                        <MobileTinyStat icon="doc" color="#FDE68A" value={visibleLeadStats.incomplete} label="Incompletos" />
                        <MobileTinyStat icon="ban" color="#FCA5A5" value={visibleLeadStats.notSuitable} label="No aptos" />
                        <MobileTinyStat icon="done" color="#86EFAC" value={visibleLeadStats.verified} label="Verificados" />
                    </div>

                    <p className="mt-2 truncate text-[11px] font-extrabold text-[#CBD5E1]/90">
                        {isWeek ? "Semana actual" : "Mes actual"} · Cola activa: {visibleLeadStats.activeQueue} · Total: {visibleLeadStats.total}
                    </p>
                </div>

                <Link
                    href="/admin/leads/assignments"
                    className="mt-3 flex min-h-11 items-center gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.04] px-3"
                >
                    <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-[#5AC8FA]/20 bg-[#5AC8FA]/10 text-[#5AC8FA]">
                        <MobileLineIcon name="flash" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-black text-white">
                        Autoasignaciones de hoy
                    </span>
                    <span className="text-[#9CA3AF]">
                        <MobileLineIcon name="chevron" />
                    </span>
                </Link>
            </div>

            <div className="grid gap-2 pb-3">
                <MobileActionLink href="/admin/settings/users" title="Usuarios" subtitle="Equipo, cobertura y permisos." icon="users" />
                <MobileActionLink href="/admin/accounting" title="Contabilidad" subtitle="Resumen semanal y pagos." icon="wallet" />
                <MobileActionLink href="/admin/leads/assignments" title="Autoasignaciones" subtitle={`${snapshot.stats.autoAssignmentsToday} movimientos hoy.`} icon="flash" />
            </div>
        </div>
    );
}

function MobileQuickCard({
    href,
    icon,
    badge,
    badgeTone,
    title,
    value,
    stats,
    footer,
}: {
    href: string;
    icon: MobileIconName;
    badge: string;
    badgeTone: "green" | "purple";
    title: string;
    value: string;
    stats: { label: string; value: number; color: string; icon: MobileIconName }[];
    footer: string;
}) {
    return (
        <Link href={href} className="rounded-[22px] border border-[#1F2937] bg-[#111827] p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="flex h-[34px] w-[34px] items-center justify-center rounded-xl border border-[#5AC8FA]/20 bg-[#5AC8FA]/10 text-[#5AC8FA]">
                    <MobileLineIcon name={icon} />
                </span>
                <span className={badgeTone === "green" ? "rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-[10px] font-black text-[#86EFAC]" : "rounded-full border border-violet-400/35 bg-violet-400/15 px-2.5 py-1.5 text-[10px] font-black text-[#D8B4FE]"}>
                    {badge}
                </span>
            </div>
            <div className="mt-2 text-[14px] font-black text-white">{title}</div>
            <div className="mt-1 truncate text-[17px] font-black text-white">{value}</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
                {stats.map((stat) => (
                    <MobileTinyStat key={stat.label} {...stat} compact />
                ))}
            </div>
            <p className="mt-2 truncate text-[11px] font-extrabold text-[#CBD5E1]/90">{footer}</p>
        </Link>
    );
}

function MobileTinyStat({
    icon,
    color,
    value,
    label,
    compact = false,
}: {
    icon: MobileIconName;
    color: string;
    value: number;
    label: string;
    compact?: boolean;
}) {
    return (
        <div className={compact ? "flex h-[34px] min-w-0 items-center justify-center gap-1 rounded-[13px] border border-white/[0.08] bg-white/[0.05] px-1.5" : "flex h-[34px] min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/[0.08] bg-white/[0.05] px-2"}>
            <span style={{ color }}>
                <MobileLineIcon name={icon} />
            </span>
            <span className="text-[13px] font-black text-white">{value}</span>
            {!compact ? <span className="truncate text-[10px] font-black text-[#9CA3AF]">{label}</span> : null}
        </div>
    );
}

function MobileActionLink({
    href,
    title,
    subtitle,
    icon,
}: {
    href: string;
    title: string;
    subtitle: string;
    icon: MobileIconName;
}) {
    return (
        <Link href={href} className="flex min-h-14 items-center gap-3 rounded-[18px] border border-white/[0.08] bg-[#111827] px-3 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[13px] border border-[#5AC8FA]/20 bg-[#5AC8FA]/10 text-[#5AC8FA]">
                <MobileLineIcon name={icon} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-black text-white">{title}</span>
                <span className="mt-0.5 block truncate text-[11px] font-bold text-[#9CA3AF]">{subtitle}</span>
            </span>
            <span className="text-[#9CA3AF]">
                <MobileLineIcon name="chevron" />
            </span>
        </Link>
    );
}

type MobileIconName =
    | "ban"
    | "calendar"
    | "check"
    | "chevron"
    | "close"
    | "doc"
    | "done"
    | "filter"
    | "flash"
    | "help"
    | "logOut"
    | "users"
    | "wallet"
    | "clock";

function MobileLineIcon({ name }: { name: MobileIconName }) {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        strokeWidth: 2,
    };

    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
            {name === "wallet" ? <path {...common} d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12M16 14h5" /> : null}
            {name === "calendar" ? <path {...common} d="M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /> : null}
            {name === "check" || name === "done" ? <path {...common} d="M20 6 9 17l-5-5" /> : null}
            {name === "close" ? <path {...common} d="M18 6 6 18M6 6l12 12" /> : null}
            {name === "clock" ? <path {...common} d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /> : null}
            {name === "filter" ? <path {...common} d="M4 6h16M7 12h10M10 18h4" /> : null}
            {name === "help" ? <path {...common} d="M9.1 9a3 3 0 1 1 5.8 1c-.8 1.2-2.9 1.5-2.9 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /> : null}
            {name === "doc" ? <path {...common} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6" /> : null}
            {name === "ban" ? <path {...common} d="M4.9 4.9 19.1 19.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /> : null}
            {name === "flash" ? <path {...common} d="m13 2-9 13h7l-1 7 9-13h-7l1-7Z" /> : null}
            {name === "users" ? <path {...common} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.8M16 3.3a4 4 0 0 1 0 7.4" /> : null}
            {name === "logOut" ? <path {...common} d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6" /> : null}
            {name === "chevron" ? <path {...common} d="m9 18 6-6-6-6" /> : null}
        </svg>
    );
}

function QuickLink({
    href,
    icon,
    children,
}: {
    href: string;
    icon: "lead" | "assign" | "users";
    children: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-white/[0.08] bg-[#0F172A] px-2 py-2 text-[11px] font-black text-[#F9FAFB] shadow-sm transition active:bg-white/[0.06] sm:gap-2 sm:px-3 sm:text-[12px] xl:border-[#e4e7ec] xl:bg-white xl:font-semibold xl:text-[#344054] xl:hover:border-[#c4b5fd] xl:hover:bg-[#f8f7ff] xl:hover:text-[#4f46e5]"
        >
            <AppIcon name={icon} tone={icon === "assign" ? "green" : icon === "users" ? "blue" : "purple"} size="sm" className="h-5 w-5 rounded-lg" />
            <span className="truncate">{children}</span>
        </Link>
    );
}

function PanelHeader({
    title,
    caption,
    href,
    controls,
}: {
    title: string;
    caption: string;
    href: string;
    controls?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-3 border-b border-white/[0.08] px-3 py-3 sm:flex-row sm:items-center sm:justify-between xl:border-[#f0f1f2] xl:px-4">
            <div>
                <h2 className="text-[14px] font-black text-[#F9FAFB] xl:font-semibold xl:text-[#171717]">{title}</h2>
                <p className="mt-0.5 text-[12px] font-extrabold text-[#9CA3AF] xl:font-medium xl:text-[#9ca3af]">{caption}</p>
            </div>
            <div className="flex items-center gap-2">
                {controls}
                <Link href={href} className="text-[12px] font-black text-[#93C5FD] hover:underline xl:font-semibold xl:text-[#52525b]">
                    Ver
                </Link>
            </div>
        </div>
    );
}

function RangeSelector({
    value,
    onChange,
}: {
    value: AdminDashboardRange;
    onChange: (value: AdminDashboardRange) => void;
}) {
    return (
        <div className="inline-flex rounded-xl border border-white/[0.08] bg-[#0F172A] p-1 xl:rounded-lg xl:border-[#e5e7eb] xl:bg-[#f4f5f6]">
            {RANGE_OPTIONS.map((item) => (
                <button
                    key={item.value}
                    type="button"
                    onClick={() => onChange(item.value)}
                    className={
                        value === item.value
                            ? "rounded-lg bg-blue-500/16 px-2.5 py-1 text-[11px] font-black text-[#F9FAFB] shadow-sm xl:rounded-md xl:bg-white xl:font-semibold xl:text-[#171717]"
                            : "rounded-lg px-2.5 py-1 text-[11px] font-black text-[#9CA3AF] transition hover:bg-white/10 hover:text-[#F9FAFB] xl:rounded-md xl:font-semibold xl:text-[#71717a] xl:hover:bg-white/70 xl:hover:text-[#171717]"
                    }
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

function EmptyRow({ text }: { text: string }) {
    return (
        <div className="px-4 py-8 text-center text-[13px] font-bold text-[#9CA3AF] xl:font-medium xl:text-[#71717a]">
            {text}
        </div>
    );
}

function RecentLeadRow({ lead, compact = false }: { lead: MetaLeadDoc; compact?: boolean }) {
    return (
        <Link href={`/admin/leads/${lead.id}`} className={compact ? "block px-3 py-2.5 transition active:bg-[#0F172A] xl:px-4 xl:hover:bg-[#fafafa]" : "block px-3 py-3 transition active:bg-[#0F172A] xl:px-4 xl:hover:bg-[#fafafa]"}>
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-black text-[#F9FAFB] xl:text-[12px] xl:font-semibold xl:text-[#171717]">
                        {displayName(lead)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-[#9CA3AF] xl:font-medium xl:text-[#9ca3af]">
                        {lead.business || lead.phone || "Sin negocio"} - {cityLabel(lead)}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone(lead.verificationStatus)}>
                        {statusLabel(lead.verificationStatus)}
                    </Badge>
                    <span className="hidden text-[11px] font-semibold text-[#9CA3AF] sm:inline xl:text-[#9ca3af]">
                        {formatDate(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
                    </span>
                </div>
            </div>
        </Link>
    );
}

function RecentAssignmentRow({ log }: { log: AutoAssignLogDoc }) {
    const matchType = safeMatchType(log.matchType);

    return (
        <Link
            href={log.leadId ? `/admin/leads/${log.leadId}` : "/admin/leads/assignments"}
            className="block px-3 py-3 transition active:bg-[#0F172A] xl:px-4 xl:hover:bg-[#fafafa]"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-black text-[#F9FAFB] xl:text-[12px] xl:font-semibold xl:text-[#171717]">
                        {assignmentLeadTitle(log)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-[#9CA3AF] xl:font-medium xl:text-[#9ca3af]">
                        {log.userName || "Usuario"} - {log.userCoverageLabel || "Sin cobertura visible"}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {matchType ? (
                        <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                    ) : (
                        <Badge tone="gray">Match</Badge>
                    )}
                    <span className="text-[11px] font-semibold text-[#9CA3AF] xl:text-[#9ca3af]">
                        {formatDate(log.createdAt)}
                    </span>
                </div>
            </div>
        </Link>
    );
}

function MiniMetric({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: "gray" | "red" | "yellow";
}) {
    return (
        <div className="rounded-[14px] border border-white/[0.08] bg-[#0F172A] p-2.5 xl:rounded-xl xl:border-[#e5e7eb] xl:bg-[#fafafa] xl:p-3">
            <div className="mb-2">
                <Badge tone={tone}>{label}</Badge>
            </div>
            <div className="text-[20px] font-black text-[#F9FAFB] xl:text-[22px] xl:font-semibold xl:text-[#171717]">{value}</div>
        </div>
    );
}
