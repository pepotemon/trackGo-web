"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import { useCan } from "@/features/auth/usePermissions";
import { useAuth } from "@/features/auth/AuthProvider";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { phoneMatchesCoverageCodes } from "@/lib/phoneCoverage";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import type { LeadChatMode, LeadMessageDoc, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { AppIcon, Badge, Button, Card, CardHeader, IconButton, Input, PageHeader } from "@/components/ui";

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
    const searchParams = useSearchParams();
    const clientId = String(params.id ?? "").trim();
    const router = useRouter();
    const { profile, isSuperAdmin } = useAuth();
    const canChatView = useCan("chatView");
    const canActivityChat = useCan("activityChat");
    const canLeadsEdit = useCan("leadsEdit");
    const canActivityEdit = useCan("activityEdit");
    const from = searchParams.get("from");
    const canChat = canChatView || (from === "activity" && canActivityChat);
    const canEdit = canLeadsEdit || canActivityEdit;
    const canAssign = useCan("leadsAssign");
    const canMaps = useCan("activityMaps");
    const canWhatsapp = useCan("leadsWhatsapp");
    const canClientView = useCan("activityClientView") || canChatView;

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
    const [mobileQueue, setMobileQueue] = useState<string[]>([]);
    const [quickActionsOpen, setQuickActionsOpen] = useState(false);
    useBackButtonDismiss(quickActionsOpen, () => setQuickActionsOpen(false));
    const [touchStartX, setTouchStartX] = useState<number | null>(null);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem("leads_mobile_queue");
            if (raw) setMobileQueue(JSON.parse(raw) as string[]);
        } catch {}
    }, []);

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

    const queueIndex = mobileQueue.indexOf(clientId);
    const prevId = queueIndex > 0 ? mobileQueue[queueIndex - 1] : null;
    const nextId = queueIndex < mobileQueue.length - 1 ? mobileQueue[queueIndex + 1] : null;
    const returnTo = useMemo(() => {
        if (from === "activity") return "/admin/activity";
        if (from === "assignments") return "/admin/leads/assignments";
        if (from === "client") return `/admin/clients/${clientId}`;
        return "/admin/leads";
    }, [clientId, from]);

    const canOpenThisLead = useMemo(() => {
        if (!lead || isSuperAdmin || !profile || profile.role !== "admin") return true;
        if (users.length === 0) return true;

        const myUsers = users.filter((user) =>
            user.sharedWith?.some((entry) => entry.adminId === profile.id)
        );
        const myUserIds = new Set(myUsers.map((user) => user.id));

        const phoneCodes = new Set<string>();
        for (const user of myUsers) {
            for (const code of user.phoneCodes ?? []) phoneCodes.add(code);
        }

        if (lead.assignedTo && myUserIds.has(lead.assignedTo)) return true;

        return phoneCodes.size > 0 && phoneMatchesCoverageCodes(lead.phone, phoneCodes);
    }, [isSuperAdmin, lead, profile, users]);

    function finishSwipe(clientX: number) {
        if (touchStartX === null) return;
        const delta = clientX - touchStartX;
        setTouchStartX(null);

        if (Math.abs(delta) < 70) return;
        if (delta > 0 && prevId) router.push(`/admin/leads/${prevId}?from=${searchParams.get("from") ?? "leads"}`);
        if (delta < 0 && nextId) router.push(`/admin/leads/${nextId}?from=${searchParams.get("from") ?? "leads"}`);
    }

    function closeQuickActionsForNavigation() {
        if (typeof window !== "undefined" && window.history.state?.__trackgoModal) {
            const nextState = { ...window.history.state };
            delete nextState.__trackgoModal;
            window.history.replaceState(nextState, "", window.location.href);
        }
        setQuickActionsOpen(false);
    }

    const canSend = useMemo(() => {
        return canChat && mode === "human" && !!draft.trim() && !sending;
    }, [canChat, draft, mode, sending]);

    if (!loadingLead && !canOpenThisLead) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fef2f2]">
                    <AppIcon name="alert" tone="red" size="lg" />
                </div>
                <p className="text-[16px] font-black text-[#101936]">Sin permiso</p>
                <p className="max-w-xs text-[13px] font-semibold text-[#66739A]">
                    Este chat no pertenece a los indicativos o vendedores asignados a tu administracion.
                </p>
                <Button onClick={() => router.back()}>Volver</Button>
            </div>
        );
    }

    async function changeMode(nextMode: Exclude<LeadChatMode, "hybrid">) {
        if (!canChat) return;
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

    async function activateHumanMode() {
        if (!canChat || mode !== "bot" || busyMode) return;
        setBusyMode(true);
        try {
            await setLeadChatMode(clientId, "human");
        } catch {
            // silent fail - user can still type
        } finally {
            setBusyMode(false);
        }
    }

    async function sendMessage() {
        const text = draft.trim();
        if (!canChat || !text || !clientId) return;

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
        if (!canAssign || !userId) return;
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

            {/* ====================== MOBILE LAYOUT (xl:hidden) ====================== */}
            <div className="fixed inset-0 z-30 flex h-dvh flex-col overflow-hidden bg-white xl:hidden">

                {/* STICKY HEADER — pressable for quick actions */}
                <div className="shrink-0 border-b border-[#E8E7FB] bg-white">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                        <button
                            type="button"
                            onClick={() => router.replace(returnTo)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
                            aria-label="Volver"
                        >
                            <AppIcon name="arrowLeft" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#101936] ring-0" />
                        </button>

                        <button
                            type="button"
                            onClick={() => setQuickActionsOpen(true)}
                            className="min-w-0 flex-1 text-left transition active:opacity-70"
                        >
                            {loadingLead ? (
                                <p className="text-[13px] font-semibold text-[#66739A]">Cargando...</p>
                            ) : (
                                <>
                                    <p className="truncate text-[14px] font-black text-[#101936]">{displayName(lead)}</p>
                                    <p className="truncate text-[10px] font-semibold text-[#66739A]">
                                        {[lead?.phone, lead?.location?.displayLabel].filter(Boolean).join(" · ") || "Sin datos"}
                                    </p>
                                </>
                            )}
                        </button>

                        {mode === "human" ? (
                            <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                                Humano
                            </span>
                        ) : (
                            <span className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600">
                                Bot
                            </span>
                        )}

                        {prevId ? (
                            <Link
                                href={`/admin/leads/${prevId}?from=${searchParams.get("from") ?? "leads"}`}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
                                aria-label="Lead anterior"
                            >
                                <AppIcon name="arrowLeft" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#66739A] ring-0" />
                            </Link>
                        ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] opacity-25">
                                <AppIcon name="arrowLeft" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#66739A] ring-0" />
                            </span>
                        )}

                        {nextId ? (
                            <Link
                                href={`/admin/leads/${nextId}?from=${searchParams.get("from") ?? "leads"}`}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
                                aria-label="Lead siguiente"
                            >
                                <AppIcon name="arrowRight" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#66739A] ring-0" />
                            </Link>
                        ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] opacity-25">
                                <AppIcon name="arrowRight" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#66739A] ring-0" />
                            </span>
                        )}
                    </div>

                    {err ? (
                        <div className="mx-3 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                            {err}
                        </div>
                    ) : null}
                </div>

                {/* MESSAGES AREA — scrollable */}
                <div
                    key={clientId}
                    className="tg-chat-thread min-h-0 flex-1 touch-pan-y space-y-3 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top_left,#f5f3ff_0,#fbfaff_28%,#ffffff_70%)] p-4 pb-[calc(env(safe-area-inset-bottom)+88px)]"
                    onClick={activateHumanMode}
                    onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
                    onTouchEnd={(event) => finishSwipe(event.changedTouches[0]?.clientX ?? 0)}
                >
                    {loadingMessages ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                                <svg className="tg-spin h-6 w-6 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                </svg>
                            </div>
                            <p className="text-[13px] font-semibold text-[#66739A]">Cargando mensajes</p>
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

                {/* INPUT BAR — fixed at bottom */}
                <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E8E7FB] bg-white/96 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 shadow-[0_-12px_30px_rgba(16,25,54,0.08)] backdrop-blur-xl">
                    <div className="flex gap-2 rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2">
                        <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onFocus={activateHumanMode}
                            placeholder={mode === "human" ? "Escribe una respuesta..." : "Toca para responder"}
                            disabled={sending}
                            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            style={{ fontSize: "16px" }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void sendMessage();
                                }
                            }}
                        />
                        <button
                            type="button"
                            onClick={sendMessage}
                            disabled={!canSend}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#7C3AED] text-white transition active:bg-violet-700 disabled:opacity-40"
                            aria-label="Enviar"
                        >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* QUICK ACTIONS BOTTOM SHEET */}
                {quickActionsOpen ? (
                    <div className="fixed inset-0 z-50 flex items-end">
                        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setQuickActionsOpen(false)} />
                        <div className="relative w-full rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-2xl">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="truncate text-[16px] font-black text-[#101936]">{displayName(lead)}</h3>
                                    <p className="mt-0.5 truncate text-[12px] font-semibold text-[#66739A]">
                                        {[lead?.phone, lead?.location?.displayLabel].filter(Boolean).join(" · ") || "Sin datos"}
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

                            <div className="grid grid-cols-4 gap-3">
                                <Link
                                    href={`/admin/clients/${clientId}`}
                                    className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                    onClick={closeQuickActionsForNavigation}
                                >
                                    <AppIcon name="users" tone="purple" size="sm" className="h-6 w-6 bg-transparent text-[#7C3AED] ring-0" />
                                    <span className="text-[10px] font-black text-[#66739A]">Ver cliente</span>
                                </Link>

                                {lead?.location?.mapsUrl && canMaps ? (
                                    <Link
                                        href={lead.location.mapsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                        onClick={closeQuickActionsForNavigation}
                                    >
                                        <AppIcon name="map" tone="green" size="sm" className="h-6 w-6 bg-transparent text-emerald-600 ring-0" />
                                        <span className="text-[10px] font-black text-[#66739A]">Maps</span>
                                    </Link>
                                ) : null}

                                {lead?.phone && canWhatsapp ? (
                                    <Link
                                        href={buildWhatsAppUrl(lead.phone)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] py-4 transition active:bg-[#f3f0ff]"
                                        onClick={closeQuickActionsForNavigation}
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

            {/* ====================== DESKTOP LAYOUT (hidden xl:block) ====================== */}
            <div className="hidden xl:block">
                <PageHeader
                    title={displayName(lead)}
                    subtitle={lead?.business || lead?.phone || "Conversacion y validacion del lead"}
                    icon={<AppIcon name="chat" tone="purple" size="sm" className="bg-transparent text-white ring-0" />}
                    actions={
                        <>
                            <QuickLink href="/admin/leads" icon="lead" label="Prospectos" />
                            {canClientView ? <QuickLink href={`/admin/clients/${clientId}`} icon="users" label="Cliente" /> : null}
                            {lead?.location?.mapsUrl && canMaps ? (
                                <QuickLink href={lead.location.mapsUrl} icon="map" label="Maps" external />
                            ) : null}
                            {canEdit ? (
                                <IconButton
                                    icon="edit"
                                    label="Editar lead"
                                    onClick={() => setEditOpen(true)}
                                    disabled={!lead}
                                />
                            ) : null}
                            {canChat ? (
                                <>
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
                            ) : null}
                        </>
                    }
                />

                {err ? (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                        {err}
                    </div>
                ) : null}

                <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
                    <aside className="space-y-4">
                        <Card className="overflow-hidden">
                            <CardHeader title="Lead" subtitle="Perfil y asignacion" />
                            <div className="border-t border-[#eef1f5] p-4">
                                {loadingLead ? (
                                    <p className="text-[13px] font-medium text-[#71717a]">Cargando lead...</p>
                                ) : !lead ? (
                                    <p className="text-[13px] font-medium text-red-500">Lead no encontrado.</p>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[18px] font-black text-white shadow-[0_14px_30px_rgba(91,33,255,0.22)]">
                                                {displayName(lead).slice(0, 1).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <h2 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                                                    {displayName(lead)}
                                                </h2>
                                                <p className="mt-1 text-[12px] font-medium text-[#71717a]">
                                                    {subtitle(lead)}
                                                </p>
                                            </div>
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

                                        <div className="space-y-2 rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3 text-[12px] font-medium text-[#52525b]">
                                            <Info label="Telefono" value={lead.phone || "Sin telefono"} />
                                            <Info label="Ciudad" value={lead.location.displayLabel || "Sin ciudad"} />
                                            <Info label="Ultimo inbound" value={formatDate(lead.lastInboundMessageAt)} />
                                        </div>

                                        <div className="grid grid-cols-3 gap-2">
                                            {canClientView ? <SmallAction href={`/admin/clients/${clientId}`} icon="users" label="Cliente" /> : null}
                                            {lead.location.mapsUrl && canMaps ? (
                                                <SmallAction href={lead.location.mapsUrl} icon="map" label="Maps" external />
                                            ) : null}
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

                        {canChat ? (
                            <Card className="overflow-hidden">
                                <CardHeader title="Control de bot" subtitle="Modo de atencion actual" />
                                <div className="space-y-3 border-t border-[#eef1f5] p-4">
                                    <div className="flex items-center justify-between rounded-2xl border border-[#eef1f5] bg-[#fbfaff] px-3 py-2">
                                        <span className="text-[12px] font-bold text-[#66739a]">Modo</span>
                                        <Badge tone={mode === "human" ? "blue" : "green"}>
                                            {modeLabel(mode)}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button onClick={() => changeMode("human")} disabled={busyMode || mode === "human"}>
                                            Tomar
                                        </Button>
                                        <Button variant="primary" onClick={() => changeMode("bot")} disabled={busyMode || mode === "bot"}>
                                            Bot
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        ) : null}
                    </aside>

                    <Card className="flex min-h-[680px] flex-col overflow-hidden">
                        <CardHeader
                            title="Conversacion"
                            subtitle={`${messages.length} mensajes`}
                            action={
                                <Badge tone={mode === "human" ? "blue" : "green"}>
                                    {modeLabel(mode)}
                                </Badge>
                            }
                        />

                        <div className="flex-1 space-y-3 overflow-y-auto border-t border-[#eef1f5] bg-[radial-gradient(circle_at_top_left,#f5f3ff_0,#fbfaff_28%,#ffffff_70%)] p-4">
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

                        <div className="border-t border-[#eef1f5] bg-white p-4">
                            <div className="flex gap-2 rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-2">
                                <Input
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder={
                                        mode === "human"
                                            ? "Escribe una respuesta..."
                                            : "Toma el chat para responder"
                                    }
                                    disabled={!canChat || mode !== "human" || sending}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            void sendMessage();
                                        }
                                    }}
                                    className="border-transparent bg-white"
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
            </div>

            <LeadEditModal
                open={editOpen && canEdit}
                lead={lead}
                onClose={() => setEditOpen(false)}
                users={users}
                onAssign={(_lead, userId) => assign(userId)}
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
    icon: "lead" | "users" | "map";
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
    icon: "users" | "map";
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
