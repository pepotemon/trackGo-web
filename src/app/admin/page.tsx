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
    queueRange: "all",
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
    const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot>(EMPTY_SNAPSHOT);
    const [queueRange, setQueueRange] = useState<AdminDashboardRange>("all");
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

    const alerts = useMemo(() => {
        const items: Array<{ title: string; body: string; href: string; tone: "red" | "yellow" | "blue" }> = [];
        const { stats } = snapshot;

        if (stats.outOfCoverage > 0) {
            items.push({
                title: "Leads fuera de cobertura",
                body: `${stats.outOfCoverage} leads cargados no tienen cobertura clara.`,
                href: "/admin/leads",
                tone: "yellow",
            });
        }

        if (stats.usersWithoutCoverage > 0) {
            items.push({
                title: "Usuarios sin cobertura",
                body: `${stats.usersWithoutCoverage} vendedores activos no tienen cobertura configurada.`,
                href: "/admin/settings/users",
                tone: "red",
            });
        }

        if (stats.autoAssignUsers === 0) {
            items.push({
                title: "Auto-asignacion apagada",
                body: "No hay vendedores activos recibiendo leads automaticamente.",
                href: "/admin/settings/users",
                tone: "blue",
            });
        }

        return items;
    }, [snapshot]);

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Dashboard"
                subtitle="Pulso operativo de leads, asignaciones y cobertura."
                icon={<AppIcon name="activity" tone="purple" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <>
                        <QuickLink href="/admin/leads" icon="lead">Leads</QuickLink>
                        <QuickLink href="/admin/leads/assignments" icon="assign">Asignaciones</QuickLink>
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
                    </>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Cola activa" value={snapshot.stats.queueTotal} caption="Leads Meta sin asignar" icon="users" tone="blue" />
                <KpiCard label="Por revisar" value={snapshot.stats.pendingReview} caption="Listos para validar" icon="lead" tone="purple" />
                <KpiCard label="Asignaciones hoy" value={snapshot.stats.autoAssignmentsToday} caption="Auto-asignacion" icon="assign" tone="green" />
                <KpiCard label="Usuarios activos" value={snapshot.stats.activeUsers} caption={`${snapshot.stats.autoAssignUsers} con auto ON`} icon="check" tone="orange" />
            </section>

            <section className="mb-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <Card className="overflow-hidden">
                    <PanelHeader
                        title="Actividad reciente"
                        caption={`${snapshot.recentLeads.length} leads recientes cargados`}
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
                        title="Alertas operativas"
                        caption="Riesgos que conviene revisar"
                        href="/admin/settings/users"
                    />
                    <div className="divide-y divide-[#f0f1f2]">
                        {alerts.length ? (
                            alerts.map((alert) => (
                                <Link
                                    key={alert.title}
                                    href={alert.href}
                                    className="block px-4 py-3 transition hover:bg-[#fafafa]"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-[12px] font-semibold text-[#171717]">
                                                {alert.title}
                                            </div>
                                            <div className="mt-0.5 text-[11px] font-medium text-[#71717a]">
                                                {alert.body}
                                            </div>
                                        </div>
                                        <Badge tone={alert.tone}>Revisar</Badge>
                                    </div>
                                </Link>
                            ))
                        ) : (
                            <EmptyRow text="No hay alertas fuertes ahora mismo." />
                        )}
                    </div>
                </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
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
                    <div className="grid gap-3 p-4 sm:grid-cols-3">
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
            </section>
        </div>
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
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#e4e7ec] bg-white px-3 py-2 text-[12px] font-semibold text-[#344054] shadow-sm transition hover:border-[#c4b5fd] hover:bg-[#f8f7ff] hover:text-[#4f46e5]"
        >
            <AppIcon name={icon} tone={icon === "assign" ? "green" : icon === "users" ? "blue" : "purple"} size="sm" className="h-5 w-5 rounded-lg" />
            {children}
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

function RecentLeadRow({ lead }: { lead: MetaLeadDoc }) {
    return (
        <Link href={`/admin/leads/${lead.id}`} className="block px-4 py-3 transition hover:bg-[#fafafa]">
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
                    <span className="text-[11px] font-semibold text-[#9ca3af]">
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
            className="block px-4 py-3 transition hover:bg-[#fafafa]"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-[#171717]">
                        {assignmentLeadTitle(log)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                        {log.userName || log.userId || "Usuario"} - {log.userCoverageLabel || "Sin cobertura visible"}
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
        <div className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] p-3">
            <div className="mb-3">
                <Badge tone={tone}>{label}</Badge>
            </div>
            <div className="text-[24px] font-semibold text-[#171717]">{value}</div>
        </div>
    );
}
