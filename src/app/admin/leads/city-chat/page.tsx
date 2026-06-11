"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dddCity, extractDDD } from "@/data/incompleteClientsRepo";
import { getLeadQueuePage } from "@/data/leadsRepo";
import { listAdminUsers } from "@/data/usersRepo";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCan } from "@/features/auth/usePermissions";
import { phoneMatchesCoverageCodes } from "@/lib/phoneCoverage";
import { AppIcon, Badge, Button, Card, CardContent, CardHeader, Input, PageHeader } from "@/components/ui";
import type { LeadQueuePageCursor, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";

type StatusFilter = LeadReviewStatus | "all";

type DddGroup = {
    code: string;
    label: string;
    leads: MetaLeadDoc[];
    latestAt: number;
    pendingReview: number;
    incomplete: number;
    notSuitable: number;
    newInbound: number;
    assigned: number;
};

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "pending_review", label: "Por revisar" },
    { value: "incomplete", label: "Incompletos" },
    { value: "not_suitable", label: "No aptos" },
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

const QUEUE_KEY = "leads_mobile_queue";
const QUEUE_CONTEXT_KEY = "leads_mobile_queue_context";
const PAGE_SIZE = 120;

function activityAt(lead: MetaLeadDoc) {
    return lead.lastInboundMessageAt || lead.verificationStatusChangedAt || lead.updatedAt || lead.createdAt || 0;
}

function hasNewInbound(lead: MetaLeadDoc) {
    const inbound = lead.lastInboundMessageAt ?? 0;
    const seen = Math.max(lead.adminQueueLastSeenMessageAt ?? 0, lead.adminQueueSeenAt ?? 0);
    return inbound > seen;
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
    return lead.name || lead.business || lead.phone || "Prospecto";
}

function cityLabel(lead: MetaLeadDoc) {
    return (
        lead.location.displayLabel ||
        lead.location.adminCityLabel ||
        lead.location.cityLabel ||
        lead.location.adminStateLabel ||
        "Sin ciudad detectada"
    );
}

function quickStatus(lead: MetaLeadDoc) {
    return typeof lead.raw.quickStatusText === "string" ? lead.raw.quickStatusText : "";
}

function phonePrefixValue(code: string) {
    return code.length === 3 ? `country:${code}` : `phone:${code}`;
}

function statusList(status: StatusFilter): LeadReviewStatus[] {
    return status === "all" ? ["pending_review", "incomplete", "not_suitable"] : [status];
}

function matchesSearch(lead: MetaLeadDoc, search: string) {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const digits = search.replace(/\D+/g, "");
    if (digits && lead.phone.replace(/\D+/g, "").includes(digits)) return true;
    return [
        lead.name,
        lead.business,
        lead.phone,
        lead.lastInboundText,
        cityLabel(lead),
        quickStatus(lead),
    ].map((item) => String(item ?? "").toLowerCase()).join(" ").includes(query);
}

export default function AdminCityChatPage() {
    const router = useRouter();
    const canCityChat = useCan("cityChatView");
    const { profile, isSuperAdmin } = useAuth();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [status, setStatus] = useState<StatusFilter>("all");
    const [search, setSearch] = useState("");
    const [onlyUnassigned, setOnlyUnassigned] = useState(false);
    const [onlyActive, setOnlyActive] = useState(false);
    const [selectedCode, setSelectedCode] = useState<string>("");
    const [cursor, setCursor] = useState<LeadQueuePageCursor | null>(null);
    const [cursorLeadId, setCursorLeadId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const myPhoneCodes = useMemo(() => {
        if (isSuperAdmin || !profile) return null;
        const codes = new Set<string>();
        for (const user of users) {
            if (!user.sharedWith?.some((share) => share.adminId === profile.id)) continue;
            for (const code of user.phoneCodes ?? []) codes.add(code);
        }
        return codes;
    }, [isSuperAdmin, profile, users]);

    const visibleLeads = useMemo(() => {
        const base = myPhoneCodes
            ? leads.filter((lead) => myPhoneCodes.size > 0 && phoneMatchesCoverageCodes(lead.phone, myPhoneCodes))
            : leads;
        return base.filter((lead) => matchesSearch(lead, search));
    }, [leads, myPhoneCodes, search]);

    const groups = useMemo<DddGroup[]>(() => {
        const map = new Map<string, MetaLeadDoc[]>();

        for (const lead of visibleLeads) {
            const code = extractDDD(lead.phone) ?? "unknown";
            const list = map.get(code) ?? [];
            list.push(lead);
            map.set(code, list);
        }

        return Array.from(map.entries())
            .map(([code, groupLeads]) => {
                const sortedLeads = groupLeads.slice().sort((a, b) => activityAt(b) - activityAt(a));
                return {
                    code,
                    label: code === "unknown" ? "Sin indicativo" : dddCity(code),
                    leads: sortedLeads,
                    latestAt: sortedLeads.reduce((max, lead) => Math.max(max, activityAt(lead)), 0),
                    pendingReview: sortedLeads.filter((lead) => lead.verificationStatus === "pending_review").length,
                    incomplete: sortedLeads.filter((lead) => lead.verificationStatus === "incomplete").length,
                    notSuitable: sortedLeads.filter((lead) => lead.verificationStatus === "not_suitable").length,
                    newInbound: sortedLeads.filter(hasNewInbound).length,
                    assigned: sortedLeads.filter((lead) => !!lead.assignedTo).length,
                };
            })
            .sort((a, b) => b.latestAt - a.latestAt);
    }, [visibleLeads]);

    const selectedGroup = useMemo(() => {
        return groups.find((group) => group.code === selectedCode) ?? groups[0] ?? null;
    }, [groups, selectedCode]);

    const totalNew = useMemo(() => visibleLeads.filter(hasNewInbound).length, [visibleLeads]);

    async function loadUsers() {
        try {
            const nextUsers = await listAdminUsers();
            setUsers(nextUsers.filter((user) => user.active && user.role === "user"));
        } catch {
            setUsers([]);
        }
    }

    async function loadPage(reset = false) {
        if (reset) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }
        setErr(null);

        try {
            const page = await getLeadQueuePage({
                cursor: reset ? null : cursor,
                statuses: statusList(status),
                pageSize: PAGE_SIZE,
                includeAssigned: !onlyUnassigned,
                includeStale: !onlyActive,
            });
            setLeads((prev) => {
                const map = new Map((reset ? [] : prev).map((lead) => [lead.id, lead]));
                for (const lead of page.items) map.set(lead.id, lead);
                return Array.from(map.values()).sort((a, b) => activityAt(b) - activityAt(a));
            });
            setCursor(page.cursor);
            setCursorLeadId(page.cursorLeadId ?? null);
            setHasMore(page.hasMore);
        } catch (error: unknown) {
            setErr(error instanceof Error ? error.message : "No se pudieron cargar los chats por ciudad.");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }

    function prepareChatQueue(group: DddGroup, leadId: string, options?: { onlyNew?: boolean }) {
        if (typeof window === "undefined") return;

        const queueLeads = options?.onlyNew ? group.leads.filter(hasNewInbound) : group.leads;
        const ids = queueLeads.map((lead) => lead.id);
        const ordered = ids.includes(leadId)
            ? [leadId, ...ids.filter((id) => id !== leadId)]
            : ids;

        window.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(ordered));
        window.sessionStorage.setItem(QUEUE_CONTEXT_KEY, JSON.stringify({
            filters: {
                status,
                city: "all",
                assignment: "all",
                phonePrefix: group.code === "unknown" ? "unknown" : phonePrefixValue(group.code),
                search,
                startKey: "",
                endKey: "",
            },
            hasMore,
            cursorLeadId,
            newOnly: options?.onlyNew === true,
        }));
    }

    function openNewChatsGroup(group: DddGroup) {
        const newLeads = group.leads.filter(hasNewInbound);
        const first = newLeads[0];
        if (!first) return;
        prepareChatQueue(group, first.id, { onlyNew: true });
        router.push(`/admin/leads/${first.id}?from=city-chat`);
    }

    useEffect(() => {
        queueMicrotask(() => {
            void loadUsers();
        });
    }, []);

    useEffect(() => {
        queueMicrotask(() => {
            void loadPage(true);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, onlyUnassigned, onlyActive]);

    useEffect(() => {
        queueMicrotask(() => {
            if (!groups.length) {
                setSelectedCode("");
                return;
            }
            if (!selectedCode || !groups.some((group) => group.code === selectedCode)) {
                setSelectedCode(groups[0].code);
            }
        });
    }, [groups, selectedCode]);

    if (!canCityChat) {
        return (
            <Card className="mx-auto max-w-lg">
                <CardContent className="text-center">
                    <AppIcon name="lock" tone="red" className="mx-auto mb-3" />
                    <h1 className="text-[18px] font-black text-[#101936]">Sin permiso</h1>
                    <p className="mt-1 text-[13px] font-semibold text-[#66739a]">
                        Tu usuario no tiene permiso para abrir el chat administrativo por ciudad.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader
                title="Chat por ciudad"
                subtitle="Gestiona prospectos por indicativo y navega entre chats del mismo grupo."
                icon={<AppIcon name="chat" plain className="text-current" />}
                actions={
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <Button type="button" variant="secondary" onClick={() => loadPage(true)} disabled={loading}>
                            <AppIcon name="refresh" size="sm" plain className="text-current" />
                            Actualizar
                        </Button>
                        <Link
                            href="/admin/leads"
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[14px] border border-[#ded8ff] bg-white px-3 py-2 text-[12px] font-bold text-[#312e81] shadow-sm transition hover:bg-[#f8f7ff] sm:min-h-0 sm:rounded-md xl:border-[#e4e7ec] xl:text-[#344054]"
                        >
                            <AppIcon name="arrowLeft" size="sm" plain className="text-current" />
                            Prospectos
                        </Link>
                    </div>
                }
            />

            <section className="mb-4 grid gap-2 sm:grid-cols-4">
                <Stat title="Prospectos visibles" value={visibleLeads.length} icon="lead" />
                <Stat title="Indicativos" value={groups.length} icon="map" />
                <Stat title="Sin leer" value={totalNew} icon="alert" />
                <Stat title="Asignados" value={visibleLeads.filter((l) => !!l.assignedTo).length} icon="user" />
            </section>

            <Card className="mb-4">
                <CardContent className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                    <label className="grid gap-1">
                        <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[#66739a]">Estado</span>
                        <select
                            value={status}
                            onChange={(event) => setStatus(event.target.value as StatusFilter)}
                            className="h-10 rounded-[14px] border border-[#ded8ff] bg-white px-3 text-[13px] font-bold text-[#172033] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                        >
                            {STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="grid gap-1">
                        <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[#66739a]">Buscar</span>
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Nombre, negocio, telefono, texto o ciudad"
                        />
                    </label>

                    <Button type="button" variant="secondary" onClick={() => setSearch("")} disabled={!search.trim()}>
                        Limpiar
                    </Button>
                </CardContent>
                <CardContent className="flex flex-wrap gap-4 border-t border-[#f2f4f7] pt-3">
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlyUnassigned}
                            onChange={(e) => setOnlyUnassigned(e.target.checked)}
                            className="h-4 w-4 rounded border-[#ded8ff] accent-[#7c3aed]"
                        />
                        <span className="text-[13px] font-bold text-[#344054]">Solo sin asignar</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlyActive}
                            onChange={(e) => setOnlyActive(e.target.checked)}
                            className="h-4 w-4 rounded border-[#ded8ff] accent-[#7c3aed]"
                        />
                        <span className="text-[13px] font-bold text-[#344054]">Solo activos (últimos 30 días)</span>
                    </label>
                </CardContent>
            </Card>

            {err ? (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-700">
                    {err}
                </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
                <Card className="overflow-hidden">
                    <CardHeader
                        title="Ciudades / indicativos"
                        subtitle={loading ? "Cargando grupos..." : `${groups.length} grupos encontrados`}
                        action={hasMore ? <Badge tone="purple">{visibleLeads.length}+</Badge> : null}
                    />
                    <CardContent className="max-h-[calc(100vh-285px)] overflow-y-auto p-2">
                        {groups.length === 0 && !loading ? (
                            <EmptyState title="Sin grupos" body="No hay chats activos con este filtro." />
                        ) : null}

                        <div className="grid gap-2">
                            {groups.map((group) => {
                                const active = selectedGroup?.code === group.code;
                                return (
                                    <button
                                        key={group.code}
                                        type="button"
                                        onClick={() => setSelectedCode(group.code)}
                                        className={[
                                            "w-full rounded-2xl border p-3 text-left transition",
                                            active
                                                ? "border-[#c4b5fd] bg-[#f5f3ff] shadow-sm"
                                                : "border-[#eef1f5] bg-white hover:border-[#ded8ff] hover:bg-[#fbfaff]",
                                        ].join(" ")}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-[14px] font-black text-[#101936]">
                                                    {group.label}
                                                </p>
                                                <p className="mt-0.5 text-[11px] font-bold text-[#66739a]">
                                                    DDD {group.code} · {formatDate(group.latestAt)}
                                                </p>
                                            </div>
                                            <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-[#5b21ff] shadow-sm">
                                                {group.leads.length}
                                            </span>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-1">
                                            <MiniPill tone="yellow">Revisar {group.pendingReview}</MiniPill>
                                            <MiniPill tone="gray">Inc. {group.incomplete}</MiniPill>
                                            <MiniPill tone="red">No apt. {group.notSuitable}</MiniPill>
                                            {group.newInbound ? <MiniPill tone="blue">Nuevo {group.newInbound}</MiniPill> : null}
                                {group.assigned ? <MiniPill tone="green">Asig. {group.assigned}</MiniPill> : null}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {hasMore ? (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => loadPage(false)}
                                disabled={loadingMore}
                                className="mt-3 w-full"
                            >
                                {loadingMore ? "Cargando..." : "Cargar mas chats"}
                            </Button>
                        ) : null}
                    </CardContent>
                </Card>

                <Card className="overflow-hidden">
                    <CardHeader
                        title={selectedGroup ? `${selectedGroup.label} · DDD ${selectedGroup.code}` : "Selecciona una ciudad"}
                        subtitle={selectedGroup ? `${selectedGroup.leads.length} chats en este grupo` : "Elige un indicativo para ver sus prospectos."}
                        action={selectedGroup && selectedGroup.newInbound > 0 ? (
                            <Button
                                type="button"
                                variant="primary"
                                onClick={() => openNewChatsGroup(selectedGroup)}
                                className="whitespace-nowrap"
                            >
                                <AppIcon name="alert" size="sm" plain className="text-current" />
                                Abrir nuevos
                            </Button>
                        ) : null}
                    />
                    <CardContent className="p-2 sm:p-3">
                        {!selectedGroup ? (
                            <EmptyState title="Sin seleccion" body="Carga o selecciona un grupo para abrir sus chats." />
                        ) : (
                            <div className="grid gap-2">
                                {selectedGroup.newInbound > 0 ? (
                                    <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-700">
                                        Hay {selectedGroup.newInbound} chats nuevos sin revisar en este grupo. Usa Abrir nuevos para navegar solo entre ellos con las flechas.
                                    </div>
                                ) : null}
                                {selectedGroup.leads.map((lead) => (
                                    <article
                                        key={lead.id}
                                        className="rounded-2xl border border-[#eef1f5] bg-white p-3 shadow-sm transition hover:border-[#ded8ff] hover:bg-[#fbfaff]"
                                    >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="max-w-full truncate text-[14px] font-black text-[#101936]">
                                                        {displayName(lead)}
                                                    </h3>
                                                    <Badge tone={statusTone[lead.verificationStatus]}>
                                                        {statusLabel[lead.verificationStatus]}
                                                    </Badge>
                                                    {hasNewInbound(lead) ? <Badge tone="blue">Nuevo</Badge> : null}
                                                    {lead.assignedTo ? (
                                                        <Badge tone="green">
                                                            {users.find((u) => u.id === lead.assignedTo)?.name ?? "Asignado"}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                                <p className="mt-1 text-[12px] font-semibold text-[#66739a]">
                                                    {lead.business || quickStatus(lead) || "Sin negocio confirmado"}
                                                </p>
                                                <p className="mt-1 text-[11px] font-bold text-[#98A2B3]">
                                                    {lead.phone || "Sin telefono"} · {cityLabel(lead)} · {formatDate(activityAt(lead))}
                                                </p>
                                                {lead.lastInboundText ? (
                                                    <p className="mt-2 line-clamp-2 text-[12px] font-semibold leading-snug text-[#475467]">
                                                        {lead.lastInboundText}
                                                    </p>
                                                ) : null}
                                            </div>

                                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                                {lead.location.mapsUrl ? (
                                                    <a
                                                        href={lead.location.mapsUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#e4e7ec] bg-white text-[#2563eb] shadow-sm transition hover:bg-blue-50"
                                                        title="Abrir Maps"
                                                    >
                                                        <AppIcon name="map" size="sm" plain className="text-current" />
                                                    </a>
                                                ) : null}
                                                <Link
                                                    href={`/admin/leads/${lead.id}?from=city-chat`}
                                                    onClick={() => prepareChatQueue(selectedGroup, lead.id)}
                                                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#6d28d9] bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] px-3 text-[12px] font-black text-white shadow-[0_10px_22px_rgba(91,33,255,0.20)] transition hover:from-[#6d28d9] hover:to-[#4338ca]"
                                                >
                                                    <AppIcon name="chat" size="sm" plain className="text-current" />
                                                    Chat
                                                </Link>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Stat({
    title,
    value,
    icon,
}: {
    title: string;
    value: number;
    icon: "lead" | "map" | "alert" | "user";
}) {
    return (
        <Card>
            <CardContent className="flex items-center gap-3">
                <AppIcon name={icon} tone={icon === "alert" ? "orange" : icon === "user" ? "green" : "purple"} />
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[#66739a]">{title}</p>
                    <p className="text-[22px] font-black text-[#101936]">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function MiniPill({
    children,
    tone,
}: {
    children: ReactNode;
    tone: "yellow" | "gray" | "red" | "blue" | "green";
}) {
    const classes: Record<typeof tone, string> = {
        yellow: "bg-amber-50 text-amber-700",
        gray: "bg-slate-100 text-slate-600",
        red: "bg-red-50 text-red-600",
        blue: "bg-blue-50 text-blue-600",
        green: "bg-emerald-50 text-emerald-700",
    };

    return (
        <span className={["rounded-full px-2 py-1 text-[10px] font-black", classes[tone]].join(" ")}>
            {children}
        </span>
    );
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-[#ded8ff] bg-[#fbfaff] p-6 text-center">
            <AppIcon name="search" tone="slate" className="mx-auto mb-3" />
            <p className="text-[14px] font-black text-[#101936]">{title}</p>
            <p className="mt-1 text-[12px] font-semibold text-[#66739a]">{body}</p>
        </div>
    );
}
