"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
    markLeadMessagesSeen,
    sendManualLeadMessage,
    setLeadChatMode,
    subscribeLeadClient,
    subscribeLeadMessages,
} from "@/data/leadChatRepo";
import { assignLeadToUser, updateLeadStatus } from "@/data/leadsRepo";
import { LeadEditModal } from "@/features/leads/LeadEditModal";
import { listAdminUsers } from "@/data/usersRepo";
import type { LeadChatMode, LeadMessageDoc, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";

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

function formatDate(value?: number | null) {
    if (!value) return "";
    return new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function displayName(lead?: MetaLeadDoc | null) {
    return lead?.name || lead?.phone || "Lead";
}

function subtitle(lead?: MetaLeadDoc | null) {
    return lead?.business || "Sin negocio definido";
}

function chatMode(lead?: MetaLeadDoc | null): LeadChatMode {
    const raw = typeof lead?.raw.chatMode === "string" ? lead.raw.chatMode : "bot";
    if (raw === "human" || raw === "hybrid") return raw;
    return "bot";
}

function modeLabel(mode: LeadChatMode) {
    if (mode === "human") return "Humano";
    if (mode === "hybrid") return "Hibrido";
    return "Bot";
}

function senderLabel(message: LeadMessageDoc) {
    if (message.senderType === "bot") return "Bot";
    if (message.senderType === "admin") return "Admin";
    return "Cliente";
}

function lastInboundAt(lead: MetaLeadDoc | null, messages: LeadMessageDoc[]) {
    const fromMessages = messages.reduce((max, message) => {
        if (message.direction !== "inbound") return max;
        return Math.max(max, message.createdAt ?? 0);
    }, 0);

    return Math.max(fromMessages, lead?.lastInboundMessageAt ?? 0);
}

export default function LeadChatPage() {
    const params = useParams<{ id: string }>();
    const clientId = String(params.id ?? "").trim();

    const [lead, setLead] = useState<MetaLeadDoc | null>(null);
    const [messages, setMessages] = useState<LeadMessageDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [draft, setDraft] = useState("");
    const [editOpen, setEditOpen] = useState(false);
    const [loadingLead, setLoadingLead] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [sending, setSending] = useState(false);
    const [busyMode, setBusyMode] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!clientId) return;

        const unsubLead = subscribeLeadClient(
            clientId,
            (nextLead) => {
                setLead(nextLead);
                setLoadingLead(false);
            },
            (message) => {
                setErr(message);
                setLoadingLead(false);
            }
        );

        const unsubMessages = subscribeLeadMessages(
            clientId,
            (nextMessages) => {
                setMessages(nextMessages);
                setLoadingMessages(false);
            },
            (message) => {
                setErr(message);
                setLoadingMessages(false);
            }
        );

        queueMicrotask(async () => {
            try {
                const nextUsers = await listAdminUsers();
                setUsers(nextUsers.filter((user) => user.active && user.role === "user"));
            } catch (error) {
                setErr(error instanceof Error ? error.message : "No se pudieron cargar usuarios.");
            }
        });

        return () => {
            unsubLead();
            unsubMessages();
        };
    }, [clientId]);

    useEffect(() => {
        if (!clientId || loadingLead || loadingMessages) return;

        const inboundAt = lastInboundAt(lead, messages);
        const seenAt = lead?.adminQueueLastSeenMessageAt ?? 0;

        if (inboundAt && inboundAt > seenAt) {
            void markLeadMessagesSeen(clientId, inboundAt);
        }
    }, [clientId, lead, loadingLead, loadingMessages, messages]);

    const mode = chatMode(lead);

    const canSend = useMemo(() => {
        return mode === "human" && !!draft.trim() && !sending;
    }, [draft, mode, sending]);

    async function changeMode(nextMode: Exclude<LeadChatMode, "hybrid">) {
        setBusyMode(true);
        setErr(null);

        try {
            await setLeadChatMode(clientId, nextMode);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cambiar el modo.");
        } finally {
            setBusyMode(false);
        }
    }

    async function sendMessage() {
        const text = draft.trim();
        if (!text || !clientId) return;

        setSending(true);
        setErr(null);

        try {
            await sendManualLeadMessage(clientId, text);
            setDraft("");
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo enviar el mensaje.");
        } finally {
            setSending(false);
        }
    }

    async function assign(userId: string) {
        if (!userId) return;
        setErr(null);

        try {
            await updateLeadStatus(clientId, {
                verificationStatus: "verified",
                leadQuality: "valid",
                notSuitableReason: "",
                verifiedAt: Date.now(),
            });
            await assignLeadToUser(clientId, userId);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo asignar el lead.");
        }
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Chat de lead"
                actions={
                    <>
                        <Link
                            href="/admin/leads"
                            className="inline-flex items-center justify-center rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-semibold text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
                        >
                            Volver
                        </Link>
                        <Button
                            onClick={() => setEditOpen(true)}
                            disabled={!lead}
                        >
                            Editar
                        </Button>
                        <Button
                            onClick={() => changeMode("human")}
                            disabled={busyMode || mode === "human"}
                        >
                            Tomar chat
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => changeMode("bot")}
                            disabled={busyMode || mode === "bot"}
                        >
                            Activar bot
                        </Button>
                    </>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="grid gap-4 xl:grid-cols-[340px_1fr]">
                <aside className="space-y-4">
                    <Card className="p-4">
                        {loadingLead ? (
                            <p className="text-[13px] font-medium text-[#71717a]">Cargando lead...</p>
                        ) : !lead ? (
                            <p className="text-[13px] font-medium text-red-500">Lead no encontrado.</p>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <h2 className="text-[18px] font-semibold text-[#171717]">
                                        {displayName(lead)}
                                    </h2>
                                    <p className="mt-1 text-[12px] font-medium text-[#71717a]">
                                        {subtitle(lead)}
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <Badge tone={statusTone[lead.verificationStatus]}>
                                        {statusLabel[lead.verificationStatus]}
                                    </Badge>
                                    <Badge tone={mode === "human" ? "blue" : "green"}>
                                        Modo {modeLabel(mode)}
                                    </Badge>
                                    {lead.location.outOfCoverage ? (
                                        <Badge tone="yellow">Fuera de cobertura</Badge>
                                    ) : null}
                                </div>

                                <div className="space-y-2 text-[12px] font-medium text-[#52525b]">
                                    <Info label="Telefono" value={lead.phone || "Sin telefono"} />
                                    <Info label="Ciudad" value={lead.location.displayLabel || "Sin ciudad"} />
                                    <Info label="Ultimo inbound" value={formatDate(lead.lastInboundMessageAt)} />
                                </div>

                                {lead.location.mapsUrl ? (
                                    <a
                                        href={lead.location.mapsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Google Maps"
                                        aria-label="Abrir en Google Maps"
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#e5e7eb] bg-white text-[#52525b] shadow-sm transition hover:bg-[#f9fafb]"
                                    >
                                        <MapIcon />
                                    </a>
                                ) : null}
                            </div>
                        )}
                    </Card>
                </aside>

                <Card className="flex min-h-[680px] flex-col overflow-hidden">
                    <div className="border-b border-[#f0f1f2] px-4 py-3">
                        <div className="text-[13px] font-semibold text-[#171717]">Conversacion</div>
                        <div className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                            {messages.length} mensajes
                        </div>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto bg-[#fafafa] p-4">
                        {loadingMessages ? (
                            <div className="py-10 text-center text-[13px] font-medium text-[#71717a]">
                                Cargando mensajes...
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="py-10 text-center text-[13px] font-medium text-[#71717a]">
                                Sin mensajes para este lead.
                            </div>
                        ) : (
                            messages.map((message) => (
                                <MessageBubble key={message.id} message={message} />
                            ))
                        )}
                    </div>

                    <div className="border-t border-[#f0f1f2] bg-white p-4">
                        <div className="flex gap-2">
                            <Input
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder={
                                    mode === "human"
                                        ? "Escribe una respuesta..."
                                        : "Toma el chat para responder"
                                }
                                disabled={mode !== "human" || sending}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void sendMessage();
                                    }
                                }}
                            />
                            <Button variant="primary" onClick={sendMessage} disabled={!canSend}>
                                {sending ? "Enviando..." : "Enviar"}
                            </Button>
                        </div>
                        <p className="mt-2 text-[11px] font-medium text-[#9ca3af]">
                            En modo humano el bot queda pausado y el mensaje se envia por WhatsApp.
                        </p>
                    </div>
                </Card>
            </section>

            <LeadEditModal
                open={editOpen}
                lead={lead}
                onClose={() => setEditOpen(false)}
                users={users}
                onAssign={(_lead, userId) => assign(userId)}
            />
        </div>
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

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[#9ca3af]">{label}</span>
            <span className="truncate text-right font-semibold text-[#171717]">{value || "-"}</span>
        </div>
    );
}

function MessageBubble({ message }: { message: LeadMessageDoc }) {
    const inbound = message.direction === "inbound";
    const bot = message.senderType === "bot";

    return (
        <div className={inbound ? "flex justify-start" : "flex justify-end"}>
            <div
                className={
                    inbound
                        ? "max-w-[74%] rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 shadow-sm"
                        : bot
                            ? "max-w-[74%] rounded-lg border border-blue-100 bg-blue-50 px-3 py-2"
                            : "max-w-[74%] rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"
                }
            >
                <div
                    className={
                        inbound
                            ? "mb-1 text-[10px] font-semibold text-[#9ca3af]"
                            : bot
                                ? "mb-1 text-[10px] font-semibold text-blue-600"
                                : "mb-1 text-[10px] font-semibold text-emerald-600"
                    }
                >
                    {senderLabel(message)} - {formatDate(message.createdAt)}
                </div>
                <p className="whitespace-pre-wrap text-[13px] font-medium leading-5 text-[#171717]">
                    {message.text}
                </p>
            </div>
        </div>
    );
}
