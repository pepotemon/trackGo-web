"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
    listClientDailyEvents,
    updateClientOperationalStatus,
    type ClientRejectedReason,
} from "@/data/clientsRepo";
import { assignLeadToUser } from "@/data/leadsRepo";
import { subscribeLeadClient, subscribeLeadMessages } from "@/data/leadChatRepo";
import { listAdminUsers } from "@/data/usersRepo";
import { LeadEditModal } from "@/features/leads/LeadEditModal";
import { useCan } from "@/features/auth/usePermissions";
import { auth } from "@/lib/firebase";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { money } from "@/lib/date";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import type { DailyEventDoc } from "@/types/accounting";
import type { LeadMessageDoc, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { AppIcon, Badge, Card, CardHeader, Field, IconButton, Input, Modal, PageHeader } from "@/components/ui";
type ConfirmStatus = "pending" | "visited" | null;

const clientStatusLabel: Record<NonNullable<MetaLeadDoc["status"]>, string> = {
    pending: "Pendiente",
    visited: "Visitado",
    rejected: "Rechazado",
};

const clientStatusTone: Record<NonNullable<MetaLeadDoc["status"]>, "yellow" | "green" | "red"> = {
    pending: "yellow",
    visited: "green",
    rejected: "red",
};

const eventLabel: Record<DailyEventDoc["type"], string> = {
    pending: "Pendiente",
    visited: "Visitado",
    rejected: "Rechazado",
};

const eventTone: Record<DailyEventDoc["type"], "yellow" | "green" | "red"> = {
    pending: "yellow",
    visited: "green",
    rejected: "red",
};

const rejectReasonOptions: { value: ClientRejectedReason; label: string }[] = [
    { value: "clavo", label: "Clavo" },
    { value: "localizacion", label: "Localizacion" },
    { value: "zona_riesgosa", label: "Zona riesgosa" },
    { value: "ingresos_insuficientes", label: "Ingresos insuficientes" },
    { value: "muy_endeudado", label: "Muy endeudado" },
    { value: "informacion_dudosa", label: "Informacion dudosa" },
    { value: "no_le_interesa", label: "No le interesa" },
    { value: "no_estaba_cerrado", label: "No estaba cerrado" },
    { value: "fuera_de_ruta", label: "Fuera de ruta" },
    { value: "otro", label: "Otro" },
];

function formatDate(value?: number | null) {
    if (!value) return "Sin fecha";
    return new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function displayName(client: MetaLeadDoc | null) {
    return client?.name || client?.business || client?.phone || "Cliente";
}

function resolveAmount(event: DailyEventDoc) {
    const values = [event.amount, event.rateApplied, event.amountSnapshot, event.ratePerVisitSnapshot];
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function rawText(client: MetaLeadDoc | null, key: string) {
    const value = client?.raw?.[key];
    return typeof value === "string" ? value.trim() : "";
}

export default function ClientDetailPage() {
    const params = useParams<{ id: string }>();
    const clientId = String(params.id ?? "").trim();
    const router = useRouter();
    const canActivity = useCan("actividad");
    const canChatView = useCan("chatView");
    const canActivityChat = useCan("activityChat");
    const canLeadsEdit = useCan("leadsEdit");
    const canActivityEdit = useCan("activityEdit");
    const canChat = canChatView || canActivityChat;
    const canEdit = canLeadsEdit || canActivityEdit;
    const canMaps = useCan("activityMaps");
    const canWhatsapp = useCan("leadsWhatsapp");

    const [client, setClient] = useState<MetaLeadDoc | null>(null);
    const [messages, setMessages] = useState<LeadMessageDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [loadingClient, setLoadingClient] = useState(true);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [savingStatus, setSavingStatus] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState<ClientRejectedReason>("no_le_interesa");
    const [rejectText, setRejectText] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const [quickActionsOpen, setQuickActionsOpen] = useState(false);
    useBackButtonDismiss(quickActionsOpen, () => setQuickActionsOpen(false));

    async function refreshEvents() {
        const nextEvents = await listClientDailyEvents(clientId);
        setEvents(nextEvents);
    }

    useEffect(() => {
        if (!clientId) return;

        const unsubClient = subscribeLeadClient(
            clientId,
            (next) => {
                setClient(next);
                setLoadingClient(false);
            },
            (message) => {
                setErr(message);
                setLoadingClient(false);
            }
        );

        const unsubMessages = subscribeLeadMessages(
            clientId,
            setMessages,
            (message) => setErr(message)
        );

        queueMicrotask(async () => {
            try {
                const [nextEvents, nextUsers] = await Promise.all([
                    listClientDailyEvents(clientId),
                    listAdminUsers(),
                ]);
                setEvents(nextEvents);
                setUsers(nextUsers);
            } catch (error) {
                setErr(error instanceof Error ? error.message : "No se pudo cargar el cliente.");
            } finally {
                setLoadingEvents(false);
            }
        });

        return () => {
            unsubClient();
            unsubMessages();
        };
    }, [clientId]);

    const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
    const assignedUser = client?.assignedTo ? userMap.get(client.assignedTo) : null;
    const latestEvent = events[0] ?? null;
    const visited = events.filter((event) => event.type === "visited").length;
    const rejected = events.filter((event) => event.type === "rejected").length;
    const pending = (client?.status ?? "pending") === "pending" ? 1 : 0;
    const totalAmount = events.reduce((sum, event) => sum + resolveAmount(event), 0);
    const status = client?.status ?? "pending";
    const rejectedReason = rawText(client, "rejectedReason") || rawText(client, "note");
    const rejectedReasonText = rawText(client, "rejectedReasonText");

    async function changeStatus(nextStatus: "pending" | "visited") {
        if (!canEdit) return;
        if (!client) return;

        const actorId = auth.currentUser?.uid ?? "";
        const userId = client.assignedTo || actorId;

        setSavingStatus(true);
        setErr(null);

        try {
            await updateClientOperationalStatus({
                clientId,
                status: nextStatus,
                actorId,
                userId,
                snapshot: {
                    phone: client.phone,
                    name: client.name,
                    business: client.business,
                    address: client.location.address,
                    mapsUrl: client.location.mapsUrl,
                },
            });
            await refreshEvents();
            setConfirmStatus(null);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
        } finally {
            setSavingStatus(false);
        }
    }

    async function submitRejected() {
        if (!canEdit) return;
        if (!client) return;

        if (rejectReason === "otro" && !rejectText.trim()) {
            setErr("Escribe el motivo cuando selecciones Otro.");
            return;
        }

        const actorId = auth.currentUser?.uid ?? "";
        const userId = client.assignedTo || actorId;

        setSavingStatus(true);
        setErr(null);

        try {
            await updateClientOperationalStatus({
                clientId,
                status: "rejected",
                actorId,
                userId,
                rejectedReason: rejectReason,
                rejectedReasonText: rejectReason === "otro" ? rejectText : null,
                snapshot: {
                    phone: client.phone,
                    name: client.name,
                    business: client.business,
                    address: client.location.address,
                    mapsUrl: client.location.mapsUrl,
                },
            });
            await refreshEvents();
            setRejectOpen(false);
            setRejectText("");
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo rechazar el cliente.");
        } finally {
            setSavingStatus(false);
        }
    }

    async function assignFromEdit(lead: MetaLeadDoc, userId: string) {
        if (!canEdit) return;
        await assignLeadToUser(lead.id, userId);
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">

            {/* ====================== MOBILE LAYOUT ====================== */}
            <div className="xl:hidden -mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] pb-6 text-[#101936]">

                {/* STICKY HEADER */}
                <div className="sticky top-0 z-20 bg-[#fbfaff]/96 backdrop-blur-md">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                        <button
                            type="button"
                            onClick={() => router.back()}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Volver"
                        >
                            <AppIcon name="arrowLeft" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#101936] ring-0" />
                        </button>

                        <div className="min-w-0 flex-1">
                            {loadingClient ? (
                                <p className="text-[13px] font-semibold text-[#66739A]">Cargando...</p>
                            ) : (
                                <>
                                    <p className="truncate text-[14px] font-black text-[#101936]">{displayName(client)}</p>
                                    <p className="truncate text-[10px] font-semibold text-[#66739A]">
                                        {[client?.phone, client?.location?.displayLabel].filter(Boolean).join(" · ") || "Sin datos"}
                                    </p>
                                </>
                            )}
                        </div>

                        {client ? (
                            <span className={[
                                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black",
                                status === "visited"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : status === "rejected"
                                        ? "border-red-200 bg-red-50 text-red-600"
                                        : "border-amber-200 bg-amber-50 text-amber-700",
                            ].join(" ")}>
                                {clientStatusLabel[status]}
                            </span>
                        ) : null}

                        <button
                            type="button"
                            onClick={() => setQuickActionsOpen(true)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Acciones"
                        >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#66739A]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="5" r="1" fill="currentColor" />
                                <circle cx="12" cy="12" r="1" fill="currentColor" />
                                <circle cx="12" cy="19" r="1" fill="currentColor" />
                            </svg>
                        </button>
                    </div>

                    {err ? (
                        <div className="mx-3 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                            {err}
                        </div>
                    ) : null}
                </div>

                {/* CONTENT */}
                <div className="px-3 pt-3">

                    {/* STAT CARDS */}
                    <div className="mb-3 grid grid-cols-4 gap-2">
                        <div className="rounded-[13px] border border-[#E8E7FB] bg-white px-1.5 py-2 shadow-sm">
                            <div className="text-center text-[12px] font-black text-emerald-600">{visited}</div>
                            <div className="mt-1 truncate text-center text-[9px] font-black text-[#66739A]">Visitados</div>
                        </div>
                        <div className="rounded-[13px] border border-[#E8E7FB] bg-white px-1.5 py-2 shadow-sm">
                            <div className="text-center text-[12px] font-black text-red-500">{rejected}</div>
                            <div className="mt-1 truncate text-center text-[9px] font-black text-[#66739A]">Rechazados</div>
                        </div>
                        <div className="rounded-[13px] border border-[#E8E7FB] bg-white px-1.5 py-2 shadow-sm">
                            <div className="truncate text-center text-[12px] font-black text-violet-600">{money(totalAmount)}</div>
                            <div className="mt-1 truncate text-center text-[9px] font-black text-[#66739A]">Monto</div>
                        </div>
                        <div className="rounded-[13px] border border-[#E8E7FB] bg-white px-1.5 py-2 shadow-sm">
                            <div className="truncate text-center text-[12px] font-black text-[#101936]">{events.length}</div>
                            <div className="mt-1 truncate text-center text-[9px] font-black text-[#66739A]">Eventos</div>
                        </div>
                    </div>

                    {/* CLIENT INFO CARD */}
                    <div className="mb-3 rounded-[16px] border border-[#E8E7FB] bg-white p-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.06em] text-[#98A2B3]">Datos del cliente</div>
                        <div className="space-y-2 text-[12px]">
                            <MobileInfoRow label="Teléfono" value={client?.phone || "Sin teléfono"} />
                            <MobileInfoRow label="Negocio" value={client?.business || "Sin negocio"} />
                            <MobileInfoRow label="Ciudad" value={client?.location?.displayLabel || client?.location?.adminCityLabel || "Sin ciudad"} />
                            <MobileInfoRow label="Asignado" value={assignedUser?.name || assignedUser?.email || (client?.assignedTo ? "Asignado" : "Sin asignar")} />
                        </div>
                        {status === "rejected" && (rejectedReason || rejectedReasonText) ? (
                            <div className="mt-3 rounded-[10px] border border-red-100 bg-red-50 px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.06em] text-red-400">Motivo de rechazo</div>
                                <p className="mt-1 text-[12px] font-semibold text-red-700">{rejectedReason || rejectedReasonText}</p>
                            </div>
                        ) : null}
                    </div>

                    {/* EVENT HISTORY */}
                    <div className="overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                        <div className="border-b border-[#E8E7FB] px-3 py-3">
                            <div className="text-[13px] font-black text-[#101936]">Historial</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-[#66739A]">{events.length} eventos registrados</div>
                        </div>
                        {loadingEvents ? (
                            <div className="flex flex-col items-center gap-3 py-8 text-center">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                                    <svg className="tg-spin h-6 w-6 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                    </svg>
                                </div>
                                <p className="text-[13px] font-semibold text-[#66739A]">Cargando historial</p>
                            </div>
                        ) : events.length === 0 ? (
                            <div className="py-8 text-center text-[13px] font-medium text-[#66739A]">
                                Sin eventos registrados.
                            </div>
                        ) : (
                            <div className="divide-y divide-[#E8E7FB]">
                                {events.map((event) => {
                                    const user = userMap.get(event.userId);
                                    return (
                                        <div key={event.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={[
                                                        "rounded-full border px-2 py-0.5 text-[9px] font-black",
                                                        event.type === "visited"
                                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                            : event.type === "rejected"
                                                                ? "border-red-200 bg-red-50 text-red-600"
                                                                : "border-amber-200 bg-amber-50 text-amber-700",
                                                    ].join(" ")}>
                                                        {eventLabel[event.type]}
                                                    </span>
                                                    <span className="truncate text-[11px] font-semibold text-[#66739A]">
                                                        {user?.name || "Usuario"}
                                                    </span>
                                                </div>
                                                <div className="mt-0.5 text-[10px] font-medium text-[#98A2B3]">
                                                    {event.dayKey} · {formatDate(event.createdAt)}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-[12px] font-black text-[#101936]">
                                                {money(resolveAmount(event))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* QUICK ACTIONS BOTTOM SHEET */}
                {quickActionsOpen ? (
                    <div className="fixed inset-0 z-50 flex items-end">
                        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setQuickActionsOpen(false)} />
                        <div className="relative w-full rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-2xl">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="truncate text-[16px] font-black text-[#101936]">{displayName(client)}</h3>
                                    <p className="mt-0.5 truncate text-[12px] font-semibold text-[#66739A]">
                                        {[client?.phone, client?.location?.displayLabel].filter(Boolean).join(" · ") || "Sin datos"}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setQuickActionsOpen(false)}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f0ff] text-[20px] text-[#7C3AED] transition active:bg-violet-200"
                                >
                                    ×
                                </button>
                            </div>

                            {/* STATUS ACTIONS */}
                            {canEdit ? (
                                <div className="mb-4 grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setQuickActionsOpen(false); setRejectOpen(true); }}
                                        disabled={!client || savingStatus || status === "rejected"}
                                        className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[16px] border border-red-200 bg-red-50 text-[11px] font-black text-red-600 shadow-sm transition active:bg-red-100 disabled:opacity-40"
                                    >
                                        <AppIcon name="close" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-red-500 ring-0" />
                                        Rechazar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setQuickActionsOpen(false); setConfirmStatus("pending"); }}
                                        disabled={!client || savingStatus || status === "pending"}
                                        className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[16px] border border-amber-200 bg-amber-50 text-[11px] font-black text-amber-700 shadow-sm transition active:bg-amber-100 disabled:opacity-40"
                                    >
                                        <AppIcon name="refresh" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-amber-600 ring-0" />
                                        Revertir
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setQuickActionsOpen(false); setConfirmStatus("visited"); }}
                                        disabled={!client || savingStatus || status === "visited"}
                                        className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[16px] border border-emerald-200 bg-emerald-50 text-[11px] font-black text-emerald-700 shadow-sm transition active:bg-emerald-100 disabled:opacity-40"
                                    >
                                        <AppIcon name="check" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-emerald-600 ring-0" />
                                        Visitado
                                    </button>
                                </div>
                            ) : null}

                            {/* LINK ACTIONS */}
                            <div className="grid grid-cols-4 gap-3">
                                {canChat ? (
                                <Link
                                    href={`/admin/leads/${clientId}?from=client`}
                                    className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                    onClick={() => setQuickActionsOpen(false)}
                                >
                                    <AppIcon name="chat" tone="purple" size="sm" className="h-6 w-6 bg-transparent text-[#7C3AED] ring-0" />
                                    <span className="text-[10px] font-black text-[#66739A]">Chat</span>
                                </Link>
                                ) : null}

                                {client?.location?.mapsUrl && canMaps ? (
                                    <Link
                                        href={client.location.mapsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                        onClick={() => setQuickActionsOpen(false)}
                                    >
                                        <AppIcon name="map" tone="green" size="sm" className="h-6 w-6 bg-transparent text-emerald-600 ring-0" />
                                        <span className="text-[10px] font-black text-[#66739A]">Maps</span>
                                    </Link>
                                ) : null}

                                {client?.phone && canWhatsapp ? (
                                    <Link
                                        href={buildWhatsAppUrl(client.phone)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                        onClick={() => setQuickActionsOpen(false)}
                                    >
                                        <AppIcon name="chat" tone="green" size="sm" className="h-6 w-6 bg-transparent text-emerald-600 ring-0" />
                                        <span className="text-[10px] font-black text-[#66739A]">WhatsApp</span>
                                    </Link>
                                ) : null}

                                {canEdit ? (
                                    <button
                                        type="button"
                                        className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                        onClick={() => { setQuickActionsOpen(false); setEditOpen(true); }}
                                    >
                                        <AppIcon name="edit" tone="purple" size="sm" className="h-6 w-6 bg-transparent text-[#7C3AED] ring-0" />
                                        <span className="text-[10px] font-black text-[#66739A]">Editar</span>
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* ====================== DESKTOP LAYOUT ====================== */}
            <div className="hidden xl:block">
                <PageHeader
                    title={displayName(client)}
                    subtitle={client?.business || client?.phone || "Gestion operativa del cliente"}
                    icon={<AppIcon name="users" tone="blue" size="sm" className="bg-transparent text-white ring-0" />}
                    actions={
                        <>
                            {canActivity ? <QuickLink href="/admin/activity" icon="activity" label="Actividad" /> : null}
                            {canChat ? <QuickLink href={`/admin/leads/${clientId}?from=client`} icon="chat" label="Chat" /> : null}
                            {client?.location?.mapsUrl && canMaps ? (
                                <QuickLink href={client.location.mapsUrl} icon="map" label="Maps" external />
                            ) : null}
                            {canEdit ? (
                                <>
                                    <IconButton
                                        icon="edit"
                                        label="Editar lead"
                                        onClick={() => setEditOpen(true)}
                                        disabled={!client}
                                    />
                                    <IconButton
                                        icon="pause"
                                        label="Volver a pendiente"
                                        onClick={() => setConfirmStatus("pending")}
                                        disabled={!client || savingStatus || status === "pending"}
                                    />
                                    <IconButton
                                        icon="close"
                                        label="Rechazar"
                                        onClick={() => setRejectOpen(true)}
                                        disabled={!client || savingStatus || status === "rejected"}
                                        variant="danger"
                                    />
                                    <IconButton
                                        icon="check"
                                        label="Marcar visitado"
                                        onClick={() => setConfirmStatus("visited")}
                                        disabled={!client || savingStatus || status === "visited"}
                                        variant="primary"
                                    />
                                </>
                            ) : null}
                        </>
                    }
                />

                {err ? (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                        {err}
                    </div>
                ) : null}

                <section className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
                    <ClientMiniStat label="Estado" value={clientStatusLabel[status]} caption={formatDate(client?.raw?.statusAt as number | null) || "Actual"} tone={clientStatusTone[status]} />
                    <ClientMiniStat label="Eventos" value={String(events.length)} caption="Historial" tone="blue" />
                    <ClientMiniStat label="Visitados" value={String(visited)} caption="Positivos" tone="green" />
                    <ClientMiniStat label="Rechazados" value={String(rejected)} caption="Negativos" tone="red" />
                    <ClientMiniStat label="Monto" value={money(totalAmount)} caption="Registrado" tone="purple" />
                </section>

                <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
                    <aside className="space-y-4">
                        <Card className="overflow-hidden">
                            <CardHeader title="Perfil" subtitle="Datos normalizados del cliente" />
                            <div className="border-t border-[#eef1f5] p-4">
                                {loadingClient ? (
                                    <p className="text-[13px] font-medium text-[#667085]">Cargando cliente...</p>
                                ) : !client ? (
                                    <p className="text-[13px] font-medium text-red-500">Cliente no encontrado.</p>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[18px] font-black text-white shadow-[0_14px_30px_rgba(91,33,255,0.22)]">
                                                {displayName(client).slice(0, 1).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <h2 className="truncate text-[20px] font-bold tracking-[-0.03em] text-[#101936]">
                                                    {displayName(client)}
                                                </h2>
                                                <p className="mt-1 text-[12px] font-medium text-[#667085]">
                                                    {client.business || client.phone || client.id}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            <Badge tone={clientStatusTone[status]}>{clientStatusLabel[status]}</Badge>
                                            {client.verificationStatus ? (
                                                <Badge tone="blue">{client.verificationStatus}</Badge>
                                            ) : null}
                                            {client.location.outOfCoverage ? (
                                                <Badge tone="yellow">Fuera cobertura</Badge>
                                            ) : null}
                                        </div>

                                        <div className="space-y-2 text-[12px] font-medium">
                                            <Info label="Telefono" value={client.phone || "Sin telefono"} />
                                            <Info label="Negocio" value={client.business || "Sin negocio"} />
                                            <Info label="Ciudad" value={client.location.displayLabel || client.location.adminCityLabel || "Sin ciudad"} />
                                            <Info label="Asignado a" value={assignedUser?.name || assignedUser?.email || (client.assignedTo ? "Usuario asignado" : "Sin asignar")} />
                                            <Info label="Actualizado" value={formatDate(client.updatedAt)} />
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 pt-1">
                                            {canChat ? <SmallAction href={`/admin/leads/${clientId}?from=client`} icon="chat" label="Chat" /> : null}
                                            {canEdit ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setEditOpen(true)}
                                                    className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e8e7fb] bg-[#fbfaff] text-[#7c3aed] transition hover:bg-[#f5f3ff]"
                                                    aria-label="Editar lead"
                                                    title="Editar lead"
                                                >
                                                    <AppIcon name="edit" tone="purple" size="sm" plain />
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card className="overflow-hidden">
                            <CardHeader title="Trazabilidad" subtitle="Estado operativo" />
                            <div className="space-y-2 border-t border-[#eef1f5] p-4 text-[12px] font-medium">
                                <Info label="Ultimo evento" value={latestEvent ? `${eventLabel[latestEvent.type]} - ${formatDate(latestEvent.createdAt)}` : "Sin eventos"} />
                                <Info label="Mensajes" value={String(messages.length)} />
                                <Info label="Pendiente actual" value={pending ? "Si" : "No"} />
                            </div>
                        </Card>

                        {status === "rejected" ? (
                            <Card className="overflow-hidden border-red-100">
                                <CardHeader title="Motivo de rechazo" subtitle="Registro del ultimo cierre" />
                                <div className="border-t border-[#eef1f5] p-4">
                                    <p className="text-[12px] font-medium leading-5 text-[#667085]">
                                        {rejectedReason || "Sin motivo estructurado"}
                                    </p>
                                    {rejectedReasonText ? (
                                        <p className="mt-2 rounded-md bg-[#f9fafb] px-3 py-2 text-[12px] font-medium text-[#344054]">
                                            {rejectedReasonText}
                                        </p>
                                    ) : null}
                                </div>
                            </Card>
                        ) : null}
                    </aside>

                    <Card className="overflow-hidden">
                        <CardHeader title="Historial operativo" subtitle="Eventos diarios que alimentan Activity y Contabilidad" />

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] border-collapse">
                                <thead>
                                    <tr className="border-b border-[#eef1f5] text-left text-[11px] font-medium text-[#667085]">
                                        <th className="px-4 py-3">Estado</th>
                                        <th className="px-4 py-3">Usuario</th>
                                        <th className="px-4 py-3">Dia</th>
                                        <th className="px-4 py-3 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingEvents ? (
                                        <tr>
                                            <td colSpan={4} className="p-8 text-center text-[13px] font-medium text-[#667085]">
                                                Cargando actividad...
                                            </td>
                                        </tr>
                                    ) : events.length ? (
                                        events.map((event) => {
                                            const user = userMap.get(event.userId);
                                            return (
                                                <tr key={event.id} className="border-b border-[#eef1f5] last:border-0">
                                                    <td className="px-4 py-3">
                                                        <Badge tone={eventTone[event.type]}>{eventLabel[event.type]}</Badge>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="text-[12px] font-semibold text-[#344054]">
                                                            {user?.name || user?.email || "Usuario"}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="text-[12px] font-semibold text-[#344054]">{event.dayKey || "-"}</div>
                                                        <div className="mt-0.5 text-[11px] font-medium text-[#667085]">
                                                            {formatDate(event.createdAt)}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#172033]">
                                                        {money(resolveAmount(event))}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    ) : (
                                        <tr>
                                            <td colSpan={4} className="p-8 text-center text-[13px] font-medium text-[#667085]">
                                                Sin eventos diarios para este cliente.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </section>
            </div>

            {/* SHARED MODALS */}
            <Modal
                open={rejectOpen && canEdit}
                onClose={() => setRejectOpen(false)}
                title="Rechazar cliente"
                subtitle={displayName(client)}
                size="sm"
            >
                <div className="space-y-4">
                    <Field label="Motivo">
                        <select
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value as ClientRejectedReason)}
                            className="h-9 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-[12px] font-semibold text-[#172033] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-blue-100"
                        >
                            {rejectReasonOptions.map((item) => (
                                <option key={item.value} value={item.value}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </Field>

                    {rejectReason === "otro" ? (
                        <Field label="Detalle">
                            <Input
                                value={rejectText}
                                onChange={(event) => setRejectText(event.target.value)}
                                placeholder="Describe el motivo"
                            />
                        </Field>
                    ) : null}

                    <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-4">
                        <IconButton
                            icon="close"
                            label="Cancelar"
                            onClick={() => setRejectOpen(false)}
                            disabled={savingStatus}
                        />
                        <IconButton
                            icon="check"
                            label={savingStatus ? "Guardando" : "Confirmar rechazo"}
                            variant="danger"
                            onClick={submitRejected}
                            disabled={savingStatus}
                        />
                    </div>
                </div>
            </Modal>

            <Modal
                open={!!confirmStatus && canEdit}
                onClose={() => setConfirmStatus(null)}
                title={
                    confirmStatus === "visited"
                        ? "Marcar visitado"
                        : "Revertir a pendiente"
                }
                subtitle={displayName(client)}
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-[13px] font-medium leading-5 text-[#667085]">
                        {confirmStatus === "visited"
                            ? "Esto actualizara el estado del cliente y registrara un evento diario para contabilidad."
                            : "El cliente volvera a estado pendiente. El estado anterior quedara en el historial de eventos."}
                    </p>

                    <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-4">
                        <IconButton
                            icon="close"
                            label="Cancelar"
                            onClick={() => setConfirmStatus(null)}
                            disabled={savingStatus}
                        />
                        <IconButton
                            icon={confirmStatus === "visited" ? "check" : "pause"}
                            label="Confirmar"
                            variant={confirmStatus === "visited" ? "primary" : "secondary"}
                            onClick={() => {
                                if (confirmStatus) void changeStatus(confirmStatus);
                            }}
                            disabled={savingStatus}
                        />
                    </div>
                </div>
            </Modal>

            <LeadEditModal
                open={editOpen && canEdit}
                lead={client}
                onClose={() => setEditOpen(false)}
                onSaved={refreshEvents}
                users={users}
                onAssign={assignFromEdit}
            />
        </div>
    );
}

function QuickLink({
    href,
    icon,
    label,
    external = false,
}: {
    href: string;
    icon: "activity" | "chat" | "map";
    label: string;
    external?: boolean;
}) {
    return (
        <Link
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            aria-label={label}
            title={label}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#e4e7ec] bg-white text-[#344054] shadow-sm transition hover:bg-[#f8f7ff] hover:text-[#4f46e5]"
        >
            <AppIcon name={icon} tone={icon === "map" ? "green" : "purple"} size="sm" plain />
        </Link>
    );
}

function SmallAction({
    href,
    icon,
    label,
    external = false,
}: {
    href: string;
    icon: "chat" | "map";
    label: string;
    external?: boolean;
}) {
    return (
        <Link
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e8e7fb] bg-[#fbfaff] text-[#7c3aed] transition hover:bg-[#f5f3ff]"
            aria-label={label}
            title={label}
        >
            <AppIcon name={icon} tone={icon === "map" ? "green" : "purple"} size="sm" plain />
        </Link>
    );
}

function ClientMiniStat({
    label,
    value,
    caption,
    tone,
}: {
    label: string;
    value: string;
    caption: string;
    tone: "yellow" | "green" | "red" | "blue" | "purple";
}) {
    const color =
        tone === "green"
            ? "text-emerald-600"
            : tone === "red"
                ? "text-red-500"
                : tone === "yellow"
                    ? "text-orange-600"
                    : tone === "blue"
                        ? "text-blue-600"
                        : "text-[#7c3aed]";

    return (
        <div className="rounded-xl border border-[#e8e7fb] bg-white px-3 py-2.5 shadow-[0_10px_28px_rgba(16,25,54,0.045)]">
            <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#8a93ad]">{label}</div>
            <div className={`mt-1 truncate text-[20px] font-black leading-none tracking-[-0.04em] ${color}`}>{value}</div>
            <div className="mt-1 truncate text-[11px] font-semibold text-[#66739a]">{caption}</div>
        </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[#667085]">{label}</span>
            <span className="truncate text-right font-semibold text-[#172033]">{value || "-"}</span>
        </div>
    );
}

function MobileInfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-[#98A2B3]">{label}</span>
            <span className="min-w-0 truncate text-right font-semibold text-[#101936]">{value || "-"}</span>
        </div>
    );
}
