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
import { auth } from "@/lib/firebase";
import { money } from "@/lib/date";
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
        await assignLeadToUser(lead.id, userId);
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">

            {/* MOBILE HEADER */}
            <div className="xl:hidden -mx-3 -mt-4 flex items-center gap-2 border-b border-[#E8E7FB] bg-white px-3 py-3">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
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
                            {client?.business || client?.phone ? (
                                <p className="truncate text-[10px] font-semibold text-[#66739A]">
                                    {client.business || client.phone}
                                </p>
                            ) : null}
                        </>
                    )}
                </div>

                {client ? (
                    <Badge tone={clientStatusTone[status]}>{clientStatusLabel[status]}</Badge>
                ) : null}
            </div>

            {/* MOBILE ACTION BAR */}
            <div className="xl:hidden -mx-3 mb-4 grid grid-cols-3 gap-2 border-b border-[#E8E7FB] bg-white px-3 pb-3 pt-2">
                <button
                    type="button"
                    onClick={() => setRejectOpen(true)}
                    disabled={!client || savingStatus || status === "rejected"}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[12px] border border-red-200 bg-red-50 text-[12px] font-bold text-red-600 transition active:bg-red-100 disabled:opacity-40"
                >
                    <AppIcon name="close" tone="slate" size="sm" className="h-4 w-4 bg-transparent text-red-500 ring-0" />
                    Rechazar
                </button>

                <button
                    type="button"
                    onClick={() => setConfirmStatus("pending")}
                    disabled={!client || savingStatus || status === "pending"}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[12px] border border-amber-200 bg-amber-50 text-[12px] font-bold text-amber-700 transition active:bg-amber-100 disabled:opacity-40"
                >
                    <AppIcon name="refresh" tone="slate" size="sm" className="h-4 w-4 bg-transparent text-amber-600 ring-0" />
                    Revertir
                </button>

                <button
                    type="button"
                    onClick={() => setConfirmStatus("visited")}
                    disabled={!client || savingStatus || status === "visited"}
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[12px] border border-emerald-200 bg-emerald-50 text-[12px] font-bold text-emerald-700 transition active:bg-emerald-100 disabled:opacity-40"
                >
                    <AppIcon name="check" tone="slate" size="sm" className="h-4 w-4 bg-transparent text-emerald-600 ring-0" />
                    Visitado
                </button>
            </div>

            {/* DESKTOP HEADER */}
            <div className="hidden xl:block">
                <PageHeader
                    title={displayName(client)}
                    subtitle={client?.business || client?.phone || "Gestion operativa del cliente"}
                    icon={<AppIcon name="users" tone="blue" size="sm" className="bg-transparent text-white ring-0" />}
                    actions={
                        <>
                            <QuickLink href="/admin/activity" icon="activity" label="Actividad" />
                            <QuickLink href={`/admin/leads/${clientId}`} icon="chat" label="Chat" />
                            {client?.location.mapsUrl ? (
                                <QuickLink href={client.location.mapsUrl} icon="map" label="Maps" external />
                            ) : null}
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
                    }
                />
            </div>

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

                                <div className="grid grid-cols-3 gap-2 pt-1">
                                    <SmallAction href={`/admin/leads/${clientId}`} icon="chat" label="Chat" />
                                    {client.location.mapsUrl ? (
                                        <SmallAction href={client.location.mapsUrl} icon="map" label="Maps" external />
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => setEditOpen(true)}
                                        className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e8e7fb] bg-[#fbfaff] text-[#7c3aed] transition hover:bg-[#f5f3ff]"
                                        aria-label="Editar lead"
                                        title="Editar lead"
                                    >
                                        <AppIcon name="edit" tone="purple" size="sm" plain />
                                    </button>
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

            <Modal
                open={rejectOpen}
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
                open={!!confirmStatus}
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
                open={editOpen}
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
