"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import {
    listClientDailyEvents,
    updateClientOperationalStatus,
    type ClientRejectedReason,
} from "@/data/clientsRepo";
import { subscribeLeadClient, subscribeLeadMessages } from "@/data/leadChatRepo";
import { listAdminUsers } from "@/data/usersRepo";
import { auth } from "@/lib/firebase";
import { money } from "@/lib/date";
import type { DailyEventDoc } from "@/types/accounting";
import type { LeadMessageDoc, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, StatCard } from "@/components/ui";

type IconName = "activity" | "chat" | "check" | "map" | "pause" | "x";
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

function Icon({ name }: { name: IconName }) {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        strokeWidth: 1.8,
    };

    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
            {name === "activity" ? <path {...common} d="M22 12h-4l-3 8L9 4l-3 8H2" /> : null}
            {name === "chat" ? (
                <>
                    <path {...common} d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
                    <path {...common} d="M8 9h8M8 13h5" />
                </>
            ) : null}
            {name === "check" ? <path {...common} d="M20 6 9 17l-5-5" /> : null}
            {name === "map" ? (
                <>
                    <path {...common} d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
                    <path {...common} d="M9 3v15M15 6v15" />
                </>
            ) : null}
            {name === "pause" ? <path {...common} d="M8 5v14M16 5v14" /> : null}
            {name === "x" ? <path {...common} d="M18 6 6 18M6 6l12 12" /> : null}
        </svg>
    );
}

function IconButton({
    icon,
    label,
    variant = "secondary",
    className = "",
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: IconName;
    label: string;
    variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
    return (
        <Button
            type="button"
            variant={variant}
            aria-label={label}
            title={label}
            className={`h-9 w-9 px-0 py-0 ${className}`}
            {...props}
        >
            <Icon name={icon} />
        </Button>
    );
}

export default function ClientDetailPage() {
    const params = useParams<{ id: string }>();
    const clientId = String(params.id ?? "").trim();

    const [client, setClient] = useState<MetaLeadDoc | null>(null);
    const [messages, setMessages] = useState<LeadMessageDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [loadingClient, setLoadingClient] = useState(true);
    const [loadingEvents, setLoadingEvents] = useState(true);
    const [savingStatus, setSavingStatus] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>(null);
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

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Cliente"
                actions={
                    <>
                        <LinkIcon href="/admin/activity" icon="activity" label="Actividad" />
                        <LinkIcon href={`/admin/leads/${clientId}`} icon="chat" label="Chat" />
                        <IconButton
                            icon="pause"
                            label="Volver a pendiente"
                            onClick={() => setConfirmStatus("pending")}
                            disabled={!client || savingStatus || status === "pending"}
                        />
                        <IconButton
                            icon="x"
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

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Estado" value={clientStatusLabel[status]} caption={formatDate(client?.raw?.statusAt as number | null)} />
                <StatCard label="Eventos" value={events.length} caption="Historial del cliente" />
                <StatCard label="Visitados" value={visited} caption="Marcaciones positivas" />
                <StatCard label="Rechazados" value={rejected} caption="Marcaciones negativas" />
                <StatCard label="Monto" value={money(totalAmount)} caption="Eventos registrados" />
            </section>

            <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
                <aside className="space-y-4">
                    <Card className="p-4">
                        {loadingClient ? (
                            <p className="text-[13px] font-medium text-[#667085]">Cargando cliente...</p>
                        ) : !client ? (
                            <p className="text-[13px] font-medium text-red-500">Cliente no encontrado.</p>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <h2 className="text-[20px] font-semibold text-[#172033]">
                                        {displayName(client)}
                                    </h2>
                                    <p className="mt-1 text-[12px] font-medium text-[#667085]">
                                        {client.business || client.phone || client.id}
                                    </p>
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
                                    <Info label="Asignado a" value={assignedUser?.name || assignedUser?.email || client.assignedTo || "Sin asignar"} />
                                    <Info label="Actualizado" value={formatDate(client.updatedAt)} />
                                </div>

                                {client.location.mapsUrl ? (
                                    <a
                                        href={client.location.mapsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label="Abrir Maps"
                                        title="Abrir Maps"
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#e4e7ec] bg-white text-[#344054] shadow-sm transition hover:bg-[#f9fafb] hover:text-[#172033]"
                                    >
                                        <Icon name="map" />
                                    </a>
                                ) : null}
                            </div>
                        )}
                    </Card>

                    <Card className="p-4">
                        <div className="text-[13px] font-semibold text-[#172033]">Trazabilidad</div>
                        <div className="mt-3 space-y-2 text-[12px] font-medium">
                            <Info label="Ultimo evento" value={latestEvent ? `${eventLabel[latestEvent.type]} - ${formatDate(latestEvent.createdAt)}` : "Sin eventos"} />
                            <Info label="Mensajes" value={String(messages.length)} />
                            <Info label="Pendiente actual" value={pending ? "Si" : "No"} />
                        </div>
                    </Card>

                    {status === "rejected" ? (
                        <Card className="p-4">
                            <div className="text-[13px] font-semibold text-[#172033]">Motivo de rechazo</div>
                            <p className="mt-2 text-[12px] font-medium leading-5 text-[#667085]">
                                {rejectedReason || "Sin motivo estructurado"}
                            </p>
                            {rejectedReasonText ? (
                                <p className="mt-2 rounded-md bg-[#f9fafb] px-3 py-2 text-[12px] font-medium text-[#344054]">
                                    {rejectedReasonText}
                                </p>
                            ) : null}
                        </Card>
                    ) : null}
                </aside>

                <Card className="overflow-hidden">
                    <div className="border-b border-[#eef1f5] px-4 py-3">
                        <div className="text-[13px] font-semibold text-[#172033]">Historial operativo</div>
                        <div className="mt-0.5 text-[12px] font-medium text-[#667085]">
                            Eventos diarios registrados para este cliente
                        </div>
                    </div>

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
                                                        {user?.name || user?.email || event.userId || "Usuario"}
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
                            icon="x"
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
                        : "Volver a pendiente"
                }
                subtitle={displayName(client)}
            >
                <div className="space-y-4">
                    <p className="text-[13px] font-medium leading-5 text-[#667085]">
                        {confirmStatus === "visited"
                            ? "Esto actualizara el estado del cliente y registrara un evento diario para contabilidad."
                            : "Esto limpiara el estado actual y registrara el cliente como pendiente nuevamente."}
                    </p>

                    <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-4">
                        <IconButton
                            icon="x"
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
        </div>
    );
}

function LinkIcon({
    href,
    icon,
    label,
}: {
    href: string;
    icon: IconName;
    label: string;
}) {
    return (
        <Link
            href={href}
            aria-label={label}
            title={label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#e4e7ec] bg-white text-[#344054] shadow-sm transition hover:bg-[#f9fafb] hover:text-[#172033]"
        >
            <Icon name={icon} />
        </Link>
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
