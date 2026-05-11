"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAdminDashboardSnapshot, getMonthlyChartData } from "@/data/adminDashboardRepo";
import type { MonthlyChartData } from "@/data/adminDashboardRepo";
import type { AdminDashboardRange, AdminDashboardSnapshot } from "@/types/dashboard";
import type { AutoAssignLogDoc, LeadAutoAssignMatchType, MetaLeadDoc } from "@/types/leads";
import { AppIcon, Badge, Button, Card, KpiCard, PageHeader } from "@/components/ui";
import { usePermissions } from "@/features/auth/usePermissions";
import { useAuth } from "@/features/auth/AuthProvider";

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

export default function AdminDashboardPage() {
    const permissions = usePermissions();
    const { firebaseUser, profile, isSuperAdmin } = useAuth();
    const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot>(EMPTY_SNAPSHOT);
    const [queueRange, setQueueRange] = useState<AdminDashboardRange>("today");
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const adminLabel = profile?.name || profile?.email || firebaseUser?.email?.split("@")[0] || "Admin";

    async function loadDashboard(range = queueRange) {
        setLoading(true);
        setErr(null);

        try {
            const next = await getAdminDashboardSnapshot({
                queueRange: range,
                adminId: profile?.id ?? null,
                isSuperAdmin,
            });
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

    const todayLabel = new Intl.DateTimeFormat("es", {
        weekday: "long",
        day: "numeric",
        month: "long",
    }).format(new Date());

    return (
        <div className="mx-auto w-full max-w-[1220px]">

            {/* ── MOBILE DASHBOARD ─────────────────────────────────── */}
            <div className="xl:hidden">
                {/* Greeting */}
                <div className="mb-4 overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#7c3aed_0%,#4f46e5_100%)] px-5 py-5 shadow-[0_10px_36px_rgba(124,58,237,0.32)]">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">Dashboard</p>
                    <p className="mt-1 text-[24px] font-black tracking-[-0.03em] text-white">Hola, {adminLabel}</p>
                    <p className="mt-0.5 capitalize text-[12px] font-semibold text-white/65">{todayLabel}</p>
                    <button
                        type="button"
                        onClick={() => loadDashboard()}
                        disabled={loading}
                        aria-label="Actualizar"
                        className="mt-3 flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white/90 transition active:bg-white/25 disabled:opacity-50"
                    >
                        <svg viewBox="0 0 24 24" className={["h-3 w-3 shrink-0", loading ? "tg-spin" : ""].join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                            <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                        </svg>
                        {loading ? "Actualizando..." : "Actualizar"}
                    </button>
                </div>

                {/* Stat pills */}
                <div className="mb-4 grid grid-cols-3 gap-2">
                    <MobileStatPill label="Cola" value={snapshot.stats.queueTotal} tone="blue" />
                    <MobileStatPill label="Por revisar" value={snapshot.stats.pendingReview} tone="purple" />
                    {permissions.assignmentsView
                        ? <MobileStatPill label="Hoy" value={snapshot.stats.autoAssignmentsToday} tone="green" />
                        : <MobileStatPill label="Usuarios" value={snapshot.stats.activeUsers} tone="slate" />
                    }
                </div>

                {/* Monthly chart */}
                <MonthlyChartCard
                    adminId={profile?.id ?? null}
                    adminCreatedAt={profile?.createdAt}
                    isSuperAdmin={isSuperAdmin}
                />

                {/* Recent assignments */}
                {permissions.assignmentsView ? (
                    <div className="mb-4">
                        <div className="mb-2.5 flex items-center justify-between px-0.5">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">Últimas asignaciones</p>
                            <Link href="/admin/leads/assignments" className="text-[11px] font-bold text-[#7c3aed]">
                                Ver todas →
                            </Link>
                        </div>
                        <div className="overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                            {loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <svg className="tg-spin h-5 w-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                    </svg>
                                </div>
                            ) : snapshot.recentAssignments.length === 0 ? (
                                <p className="px-4 py-6 text-center text-[12px] font-semibold text-[#98a2b3]">
                                    Aún no hay asignaciones hoy.
                                </p>
                            ) : (
                                <div className="divide-y divide-[#f0f1f2]">
                                    {snapshot.recentAssignments.slice(0, 5).map((log) => (
                                        <MobileAssignmentRow key={log.id} log={log} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : null}

                {/* Recent leads */}
                {permissions.prospectos ? (
                    <div className="mb-4">
                        <div className="mb-2.5 flex items-center justify-between px-0.5">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">Cola reciente</p>
                            <Link href="/admin/leads" className="text-[11px] font-bold text-[#7c3aed]">
                                Ver todos →
                            </Link>
                        </div>
                        <div className="overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                            {loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <svg className="tg-spin h-5 w-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                    </svg>
                                </div>
                            ) : snapshot.recentLeads.length === 0 ? (
                                <p className="px-4 py-6 text-center text-[12px] font-semibold text-[#98a2b3]">
                                    No hay leads recientes en cola.
                                </p>
                            ) : (
                                <div className="divide-y divide-[#f0f1f2]">
                                    {snapshot.recentLeads.slice(0, 5).map((lead) => (
                                        <MobileLeadRow key={lead.id} lead={lead} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : null}
            </div>

            {/* ── DESKTOP DASHBOARD ─────────────────────────────────── */}
            <div className="hidden xl:block">
            <PageHeader
                title="Dashboard"
                subtitle="Pulso operativo de leads, asignaciones y cobertura."
                icon={<AppIcon name="activity" tone="purple" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <div className="flex flex-wrap justify-end gap-2">
                        {permissions.prospectos ? <QuickLink href="/admin/leads" icon="lead">Prospectos</QuickLink> : null}
                        {permissions.assignmentsView ? <QuickLink href="/admin/leads/assignments" icon="assign">Asign.</QuickLink> : null}
                        {permissions.usersView ? <QuickLink href="/admin/settings/users" icon="users">Usuarios</QuickLink> : null}
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
                {permissions.assignmentsView ? (
                    <KpiCard label="Asignaciones hoy" value={snapshot.stats.autoAssignmentsToday} caption="Auto-asignación" icon="assign" tone="green" />
                ) : null}
                <KpiCard label="Usuarios activos" value={snapshot.stats.activeUsers} caption={`${snapshot.stats.autoAssignUsers} con auto ON`} icon="check" tone="orange" />
            </section>

            <section className="mb-3 grid gap-3 xl:mb-4 xl:grid-cols-[1.1fr_0.9fr] xl:gap-4">
                <Card className="overflow-hidden">
                    <PanelHeader
                        title="Actividad reciente"
                        caption={`${snapshot.recentLeads.length} prospectos recientes`}
                        href="/admin/leads"
                    />
                    <div className="divide-y divide-[#f0f1f2]">
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
                    <div className="divide-y divide-[#f0f1f2]">
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

                {permissions.assignmentsView ? (
                    <Card className="overflow-hidden">
                        <PanelHeader
                            title="Ultimas asignaciones"
                            caption={`${snapshot.recentAssignments.length} logs recientes de hoy`}
                            href="/admin/leads/assignments"
                        />
                        <div className="divide-y divide-[#f0f1f2]">
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
                ) : null}
            </section>
            </div>
        </div>
    );
}

// ── Mobile helpers ───────────────────────────────────────────────────────────

const STAT_TONE_MAP = {
    blue: "bg-[#eff6ff] text-[#2563eb]",
    purple: "bg-[#f3f0ff] text-[#7c3aed]",
    green: "bg-[#ecfdf5] text-[#059669]",
    slate: "bg-[#f8fafc] text-[#475569]",
} as const;

function MobileStatPill({ label, value, tone }: { label: string; value: number; tone: keyof typeof STAT_TONE_MAP }) {
    return (
        <div className={["rounded-[14px] px-3 py-3 text-center", STAT_TONE_MAP[tone]].join(" ")}>
            <p className="text-[22px] font-black leading-none tracking-[-0.04em]">{value}</p>
            <p className="mt-1 text-[10px] font-bold leading-tight opacity-75">{label}</p>
        </div>
    );
}

function MobileAssignmentRow({ log }: { log: AutoAssignLogDoc }) {
    const matchType = safeMatchType(log.matchType);
    return (
        <Link
            href={log.leadId ? `/admin/leads/${log.leadId}?from=assignments` : "/admin/leads/assignments"}
            className="flex items-center gap-3 px-4 py-3 transition active:bg-[#f8f7ff]"
        >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f0ff]">
                <AppIcon name="user" tone="purple" size="sm" className="h-4 w-4 bg-transparent text-[#7c3aed] ring-0" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[#101936]">{assignmentLeadTitle(log)}</p>
                <p className="truncate text-[11px] font-semibold text-[#66739A]">{log.userName || "Usuario"}</p>
            </div>
            {matchType ? (
                <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
            ) : (
                <Badge tone="gray">—</Badge>
            )}
        </Link>
    );
}

function MobileLeadRow({ lead }: { lead: MetaLeadDoc }) {
    return (
        <Link
            href={`/admin/leads/${lead.id}?from=leads`}
            className="flex items-center gap-3 px-4 py-3 transition active:bg-[#f8f7ff]"
        >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f0ff]">
                <AppIcon name="lead" tone="purple" size="sm" className="h-4 w-4 bg-transparent text-[#7c3aed] ring-0" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[#101936]">{displayName(lead)}</p>
                <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.business || cityLabel(lead) || "Sin datos"}</p>
            </div>
            <Badge tone={statusTone(lead.verificationStatus)}>{statusLabel(lead.verificationStatus)}</Badge>
        </Link>
    );
}

// ── Desktop helpers ───────────────────────────────────────────────────────────

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
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[13px] border border-[#e4e7ec] bg-white px-2 py-2 text-[12px] font-semibold text-[#344054] shadow-sm transition hover:border-[#c4b5fd] hover:bg-[#f8f7ff] hover:text-[#4f46e5] sm:gap-2 sm:px-3"
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
        <div className="flex flex-col gap-3 border-b border-[#f0f1f2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h2 className="text-[14px] font-semibold text-[#171717]">{title}</h2>
                <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">{caption}</p>
            </div>
            <div className="flex items-center gap-2">
                {controls}
                <Link href={href} className="text-[12px] font-semibold text-[#52525b] hover:underline">
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
        <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-[#f4f5f6] p-1">
            {RANGE_OPTIONS.map((item) => (
                <button
                    key={item.value}
                    type="button"
                    onClick={() => onChange(item.value)}
                    className={
                        value === item.value
                            ? "rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-[#171717] shadow-sm"
                            : "rounded-md px-2.5 py-1 text-[11px] font-semibold text-[#71717a] transition hover:bg-white/70 hover:text-[#171717]"
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
        <div className="px-4 py-8 text-center text-[13px] font-medium text-[#71717a]">
            {text}
        </div>
    );
}

function RecentLeadRow({ lead, compact = false }: { lead: MetaLeadDoc; compact?: boolean }) {
    return (
        <Link href={`/admin/leads/${lead.id}?from=leads`} className={compact ? "block px-4 py-2.5 transition hover:bg-[#fafafa]" : "block px-4 py-3 transition hover:bg-[#fafafa]"}>
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-[#171717]">
                        {displayName(lead)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                        {lead.business || lead.phone || "Sin negocio"} - {cityLabel(lead)}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone(lead.verificationStatus)}>
                        {statusLabel(lead.verificationStatus)}
                    </Badge>
                    <span className="hidden text-[11px] font-semibold text-[#9ca3af] sm:inline">
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
            href={log.leadId ? `/admin/leads/${log.leadId}?from=assignments` : "/admin/leads/assignments"}
            className="block px-4 py-3 transition hover:bg-[#fafafa]"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-[#171717]">
                        {assignmentLeadTitle(log)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                        {log.userName || "Usuario"} - {log.userCoverageLabel || "Sin cobertura visible"}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {matchType ? (
                        <Badge tone={matchTone[matchType]}>{matchLabel[matchType]}</Badge>
                    ) : (
                        <Badge tone="gray">Match</Badge>
                    )}
                    <span className="text-[11px] font-semibold text-[#9ca3af]">
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
        <div className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-3">
            <div className="mb-2">
                <Badge tone={tone}>{label}</Badge>
            </div>
            <div className="text-[22px] font-semibold text-[#171717]">{value}</div>
        </div>
    );
}

// ── Monthly chart ─────────────────────────────────────────────────────────────

const CW = 300;
const CH = 80;
const CPT = 8;
const CPB = 4;
const CPL = 4;
const CPR = 4;

function mkChartPts(values: number[], maxVal: number) {
    if (values.length < 2) return [];
    const dw = CW - CPL - CPR;
    const dh = CH - CPT - CPB;
    return values.map((v, i) => ({
        x: CPL + (i / (values.length - 1)) * dw,
        y: CPT + dh - (maxVal > 0 ? (v / maxVal) * dh : 0),
    }));
}

function smoothLine(pts: { x: number; y: number }[]) {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
        const cx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
        d += ` C ${cx} ${pts[i - 1].y.toFixed(1)} ${cx} ${pts[i].y.toFixed(1)} ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    }
    return d;
}

function chartAreaPath(pts: { x: number; y: number }[], bottom: number) {
    const line = smoothLine(pts);
    if (!line) return "";
    return `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${bottom} L ${pts[0].x.toFixed(1)} ${bottom} Z`;
}

function fmtRevenue(v: number) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
    return `$${Math.round(v)}`;
}

function MonthlyChartCard({
    adminId,
    adminCreatedAt,
    isSuperAdmin,
}: {
    adminId?: string | null;
    adminCreatedAt?: number;
    isSuperAdmin: boolean;
}) {
    const [monthDate, setMonthDate] = useState(() => {
        const t = new Date();
        return new Date(t.getFullYear(), t.getMonth(), 1);
    });
    const [data, setData] = useState<MonthlyChartData | null>(null);
    const [loading, setLoading] = useState(true);

    const now = new Date();
    const isCurrentMonth =
        monthDate.getFullYear() === now.getFullYear() &&
        monthDate.getMonth() === now.getMonth();

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setLoading(true);
            setData(null);
        }, 0);
        const y = monthDate.getFullYear();
        const m = String(monthDate.getMonth() + 1).padStart(2, "0");
        const lastDayNum = isCurrentMonth
            ? new Date().getDate()
            : new Date(y, monthDate.getMonth() + 1, 0).getDate();
        const d = String(lastDayNum).padStart(2, "0");
        let cancelled = false;
        getMonthlyChartData(`${y}-${m}-01`, `${y}-${m}-${d}`, { adminId, adminCreatedAt, isSuperAdmin })
            .then((v) => { if (!cancelled) setData(v); })
            .catch(() => { if (!cancelled) setData(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthDate, adminId, adminCreatedAt, isSuperAdmin]);

    const monthName = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(monthDate);
    const todayKey = isCurrentMonth
        ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
        : null;
    const todayPt = todayKey ? data?.points.find((p) => p.day === todayKey) : null;

    const assignVals = data?.points.map((p) => p.assignments) ?? [];
    const visitVals = data?.points.map((p) => p.visits) ?? [];
    const maxVal = Math.max(...assignVals, ...visitVals, 1);
    const bottom = CH - CPB;

    const assignPts = mkChartPts(assignVals, maxVal);
    const visitPts = mkChartPts(visitVals, maxVal);

    return (
        <div className="mb-5 overflow-hidden rounded-[20px] border border-[#E8E7FB] bg-white shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#7c70ba]">Rendimiento mensual</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[#a3acca] transition active:bg-[#f3f0ff] active:text-[#7c3aed]"
                            aria-label="Mes anterior"
                        >
                            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M15 18l-6-6 6-6" />
                            </svg>
                        </button>
                        <p className="text-[17px] font-black capitalize tracking-[-0.02em] text-[#101936]">{monthName}</p>
                        <button
                            type="button"
                            onClick={() => { if (!isCurrentMonth) setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }}
                            disabled={isCurrentMonth}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[#a3acca] transition active:bg-[#f3f0ff] active:text-[#7c3aed] disabled:opacity-25"
                            aria-label="Mes siguiente"
                        >
                            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 18l6-6-6-6" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#7c3aed]" />
                        <span className="text-[10px] font-bold text-[#66739A]">Asig.</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#059669]" />
                        <span className="text-[10px] font-bold text-[#66739A]">Visitas</span>
                    </div>
                </div>
            </div>

            {/* Chart area */}
            <div className="px-2">
                {loading ? (
                    <div className="flex h-[88px] items-center justify-center">
                        <svg className="tg-spin h-5 w-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                            <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                        </svg>
                    </div>
                ) : !data ? (
                    <div className="flex h-[88px] items-center justify-center">
                        <p className="text-[11px] font-semibold text-[#a3acca]">Sin datos disponibles</p>
                    </div>
                ) : (
                    <svg
                        viewBox={`0 0 ${CW} ${CH}`}
                        className="w-full"
                        style={{ height: "88px" }}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                    >
                        <defs>
                            <linearGradient id="mg-a" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.28" />
                                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.03" />
                            </linearGradient>
                            <linearGradient id="mg-v" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#059669" stopOpacity="0.22" />
                                <stop offset="100%" stopColor="#059669" stopOpacity="0.03" />
                            </linearGradient>
                        </defs>

                        {([0.33, 0.66, 1] as const).map((f) => {
                            const y = (CPT + (bottom - CPT) * (1 - f)).toFixed(1);
                            return (
                                <line key={f} x1={CPL} y1={y} x2={CW - CPR} y2={y}
                                    stroke="#ede9fe" strokeWidth="0.6" />
                            );
                        })}

                        {assignPts.length >= 2 && (
                            <>
                                <path d={chartAreaPath(assignPts, bottom)} fill="url(#mg-a)" />
                                <path d={smoothLine(assignPts)} fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" />
                            </>
                        )}

                        {visitPts.length >= 2 && (
                            <>
                                <path d={chartAreaPath(visitPts, bottom)} fill="url(#mg-v)" />
                                <path d={smoothLine(visitPts)} fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" />
                            </>
                        )}
                    </svg>
                )}
            </div>

            {/* Bottom stats */}
            <div className="grid grid-cols-3 divide-x divide-[#f0f1f2] border-t border-[#f0f1f2]">
                <div className="px-3 py-3 text-center">
                    <p className="text-[20px] font-black leading-none tracking-[-0.04em] text-[#7c3aed]">
                        {isCurrentMonth ? (todayPt?.assignments ?? 0) : (data?.totalAssignments ?? 0)}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#a3acca]">
                        {isCurrentMonth ? "Hoy" : "Total"}
                    </p>
                </div>
                <div className="px-3 py-3 text-center">
                    <p className="text-[20px] font-black leading-none tracking-[-0.04em] text-[#059669]">
                        {data?.totalVisits ?? 0}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#a3acca]">Visitados</p>
                </div>
                <div className="px-3 py-3 text-center">
                    <p className="text-[20px] font-black leading-none tracking-[-0.04em] text-[#101936]">
                        {data ? fmtRevenue(data.totalRevenue) : "—"}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#a3acca]">Mi ganancia</p>
                </div>
            </div>
        </div>
    );
}
