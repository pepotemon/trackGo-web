"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    markLeadMessagesSeen,
    sendManualLeadMessage,
    setLeadChatMode,
    subscribeLeadClient,
    subscribeLeadMessages,
} from "@/data/leadChatRepo";
import { assignLeadToUser, deleteLead, getLeadQueuePage, updateLeadStatus } from "@/data/leadsRepo";
import { LeadEditModal } from "@/features/leads/LeadEditModal";
import { AssignUserModal } from "@/features/leads/AssignUserModal";
import { listAdminUsers } from "@/data/usersRepo";
import { useCan } from "@/features/auth/usePermissions";
import { useAuth } from "@/features/auth/AuthProvider";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { phoneMatchesCoverageCodes } from "@/lib/phoneCoverage";
import { leadMatchesPhonePrefix } from "@/lib/phonePrefixes";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import type { LeadChatMode, LeadFilters, LeadMessageDoc, LeadQueueCityField, LeadQueueCityFilter, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { AppIcon, Badge, Button, Card, CardHeader, IconButton, Input, Modal, PageHeader } from "@/components/ui";

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

const QUEUE_CONTEXT_KEY = "leads_mobile_queue_context";
const CITY_FILTER_FIELDS = new Set<LeadQueueCityField>([
    "geoAdminCityNormalized",
    "geoCityNormalized",
    "geoAdminStateNormalized",
]);

function dayKeyFromMs(ms: number) {
    const date = new Date(ms);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function leadActivityAt(lead: MetaLeadDoc) {
    return lead.lastInboundMessageAt || lead.verificationStatusChangedAt || lead.updatedAt || lead.createdAt || 0;
}

function hasNewInbound(lead: MetaLeadDoc) {
    const inbound = lead.lastInboundMessageAt ?? 0;
    const seen = Math.max(lead.adminQueueLastSeenMessageAt ?? 0, lead.adminQueueSeenAt ?? 0);
    return inbound > seen;
}

function cityFilterValue(lead: MetaLeadDoc) {
    if (lead.location.adminCityNormalized) return `geoAdminCityNormalized:${lead.location.adminCityNormalized}`;
    if (lead.location.cityNormalized) return `geoCityNormalized:${lead.location.cityNormalized}`;
    if (lead.location.adminStateNormalized) return `geoAdminStateNormalized:${lead.location.adminStateNormalized}`;
    return "unknown";
}

function parseCityFilter(value?: string): LeadQueueCityFilter | null {
    if (!value || value === "all") return null;
    const [field, ...rest] = value.split(":");
    const cityValue = rest.join(":").trim();
    if (!CITY_FILTER_FIELDS.has(field as LeadQueueCityField) || !cityValue) return null;
    return { field: field as LeadQueueCityField, value: cityValue };
}

function queueStatuses(filters: LeadFilters | null): LeadReviewStatus[] {
    if (!filters || filters.status === "all") return ["pending_review", "incomplete", "not_suitable"];
    return [filters.status];
}

function leadMatchesQueueFilters(lead: MetaLeadDoc, filters: LeadFilters | null, options?: { newOnly?: boolean }) {
    if (options?.newOnly && !hasNewInbound(lead)) return false;
    if (!filters) return true;
    if (filters.status !== "all" && lead.verificationStatus !== filters.status) return false;
    if (filters.city !== "all" && cityFilterValue(lead) !== filters.city) return false;
    if (!leadMatchesPhonePrefix(lead.phone, filters.phonePrefix)) return false;

    if (filters.startKey || filters.endKey) {
        const at = leadActivityAt(lead);
        const key = at ? dayKeyFromMs(at) : "";
        if (filters.startKey && key < filters.startKey) return false;
        if (filters.endKey && key > filters.endKey) return false;
    }

    const search = filters.search.trim().toLowerCase();
    const searchDigits = filters.search.replace(/\D+/g, "");
    if (!search && !searchDigits) return true;
    if (searchDigits && lead.phone.replace(/\D+/g, "").includes(searchDigits)) return true;

    return [
        lead.id,
        lead.name,
        lead.business,
        lead.phone,
        lead.waId,
        lead.verificationStatus,
        lead.notSuitableReason,
        lead.location.displayLabel,
        lead.location.address,
        lead.location.mapsUrl,
        lead.lastInboundText,
    ].map((value) => String(value ?? "").toLowerCase()).join(" ").includes(search);
}

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
    const canCityChatView = useCan("cityChatView");
    const canActivityChat = useCan("activityChat");
    const canLeadsEdit = useCan("leadsEdit");
    const canActivityEdit = useCan("activityEdit");
    const from = searchParams.get("from");
    const canChat = canChatView || (from === "activity" && canActivityChat) || (from === "city-chat" && canCityChatView);
    const canEdit = canLeadsEdit || canActivityEdit;
    const canAssign = useCan("leadsAssign");
    const canMaps = useCan("activityMaps");
    const canWhatsapp = useCan("leadsWhatsapp");
    const canStatusManage = useCan("leadsStatusManage");
    const canDelete = useCan("leadsDelete");
    const canClientView = useCan("activityClientView") || canChatView || canCityChatView;

    const [lead, setLead] = useState<MetaLeadDoc | null>(null);
    const [messages, setMessages] = useState<LeadMessageDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [draft, setDraft] = useState("");
    const [editOpen, setEditOpen] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const [loadingLead, setLoadingLead] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [sending, setSending] = useState(false);
    const [busyMode, setBusyMode] = useState(false);
    const [assigningUser, setAssigningUser] = useState(false);
    const [savingStatus, setSavingStatus] = useState(false);
    const [deletingLead, setDeletingLead] = useState(false);
    const [copiedConversation, setCopiedConversation] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [mobileQueue, setMobileQueue] = useState<string[]>([]);
    const [queueFilters, setQueueFilters] = useState<LeadFilters | null>(null);
    const [queueNewOnly, setQueueNewOnly] = useState(false);
    const [queueHasMore, setQueueHasMore] = useState(false);
    const [queueCursorLeadId, setQueueCursorLeadId] = useState<string | null>(null);
    const [queueLoadingMore, setQueueLoadingMore] = useState(false);
    const [quickActionsOpen, setQuickActionsOpen] = useState(false);
    useBackButtonDismiss(quickActionsOpen, () => setQuickActionsOpen(false));
    const [touchStartX, setTouchStartX] = useState<number | null>(null);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem("leads_mobile_queue");
            if (raw) {
                queueMicrotask(() => setMobileQueue(JSON.parse(raw) as string[]));
            }
            const rawContext = sessionStorage.getItem(QUEUE_CONTEXT_KEY);
            if (rawContext) {
                const context = JSON.parse(rawContext) as { filters?: LeadFilters; hasMore?: boolean; cursorLeadId?: string | null; newOnly?: boolean };
                queueMicrotask(() => {
                    setQueueFilters(context.filters ?? null);
                    setQueueHasMore(context.hasMore === true);
                    setQueueCursorLeadId(context.cursorLeadId ?? null);
                    setQueueNewOnly(context.newOnly === true);
                });
            }
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
        if (from === "city-chat") return "/admin/leads/city-chat";
        if (from === "client") return `/admin/clients/${clientId}`;
        return "/admin/leads";
    }, [clientId, from]);
    const fromParam = searchParams.get("from") ?? "leads";

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

    const goToQueuedLead = useCallback((targetId: string | null) => {
        if (!targetId) return;
        router.push(`/admin/leads/${targetId}?from=${fromParam}`);
    }, [fromParam, router]);

    const leadVisibleToCurrentAdmin = useCallback((item: MetaLeadDoc) => {
        if (isSuperAdmin || !profile || profile.role !== "admin") return true;
        if (users.length === 0) return true;

        const myUsers = users.filter((user) =>
            user.sharedWith?.some((entry) => entry.adminId === profile.id)
        );
        const myUserIds = new Set(myUsers.map((user) => user.id));
        const phoneCodes = new Set<string>();
        for (const user of myUsers) {
            for (const code of user.phoneCodes ?? []) phoneCodes.add(code);
        }

        if (item.assignedTo && myUserIds.has(item.assignedTo)) return true;
        return phoneCodes.size > 0 && phoneMatchesCoverageCodes(item.phone, phoneCodes);
    }, [isSuperAdmin, profile, users]);

    const loadNextQueuedLead = useCallback(async () => {
        if (queueLoadingMore || !queueHasMore || !mobileQueue.length) return null;

        setQueueLoadingMore(true);
        setErr(null);

        try {
            let cursorLeadId = queueCursorLeadId || mobileQueue[mobileQueue.length - 1];
            let hasMore: boolean = queueHasMore;
            const collected: string[] = [];
            let pages = 0;

            while (hasMore && collected.length === 0 && pages < 5) {
                const page = await getLeadQueuePage({
                    cursorLeadId,
                    statuses: queueStatuses(queueFilters),
                    city: parseCityFilter(queueFilters?.city),
                    pageSize: 60,
                });

                const visible = page.items
                    .filter((item) => leadVisibleToCurrentAdmin(item))
                    .filter((item) => leadMatchesQueueFilters(item, queueFilters, { newOnly: queueNewOnly }))
                    .map((item) => item.id)
                    .filter((id) => !mobileQueue.includes(id) && !collected.includes(id));

                collected.push(...visible);
                cursorLeadId = page.cursorLeadId || cursorLeadId;
                hasMore = page.hasMore;
                pages += 1;
            }

            setQueueHasMore(hasMore);
            setQueueCursorLeadId(cursorLeadId);
            if (!collected.length) return null;

            const nextQueue = [...mobileQueue, ...collected];
            setMobileQueue(nextQueue);
            try {
                sessionStorage.setItem("leads_mobile_queue", JSON.stringify(nextQueue));
                sessionStorage.setItem(QUEUE_CONTEXT_KEY, JSON.stringify({ filters: queueFilters, hasMore, cursorLeadId, newOnly: queueNewOnly }));
            } catch {}
            return collected[0] ?? null;
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cargar el siguiente chat.");
            return null;
        } finally {
            setQueueLoadingMore(false);
        }
    }, [leadVisibleToCurrentAdmin, mobileQueue, queueCursorLeadId, queueFilters, queueHasMore, queueLoadingMore, queueNewOnly]);

    const goNextQueuedLead = useCallback(async () => {
        if (nextId) {
            goToQueuedLead(nextId);
            return;
        }

        const loadedId = await loadNextQueuedLead();
        if (loadedId) goToQueuedLead(loadedId);
    }, [goToQueuedLead, loadNextQueuedLead, nextId]);

    function finishSwipe(clientX: number) {
        if (touchStartX === null) return;
        const delta = clientX - touchStartX;
        setTouchStartX(null);

        if (Math.abs(delta) < 70) return;
        if (delta > 0) goToQueuedLead(prevId);
        if (delta < 0) void goNextQueuedLead();
    }

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const target = event.target as HTMLElement | null;
            const tagName = target?.tagName?.toLowerCase();
            if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) return;
            if (event.key === "ArrowLeft" && prevId) {
                event.preventDefault();
                goToQueuedLead(prevId);
            }
            if (event.key === "ArrowRight" && (nextId || queueHasMore)) {
                event.preventDefault();
                void goNextQueuedLead();
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [goNextQueuedLead, goToQueuedLead, prevId, nextId, queueHasMore]);

    function closeQuickActionsForNavigation() {
        if (typeof window !== "undefined" && window.history.state?.__trackgoModal) {
            const nextState = { ...window.history.state };
            delete nextState.__trackgoModal;
            window.history.replaceState(nextState, "", window.location.href);
        }
        setQuickActionsOpen(false);
    }

    function goBackToPreviousScreen() {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
            return;
        }
        router.replace(returnTo);
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
        setAssigningUser(true);

        try {
            await updateLeadStatus(clientId, {
                verificationStatus: "verified",
                leadQuality: "valid",
                notSuitableReason: "",
                verifiedAt: Date.now(),
            });
            await assignLeadToUser(clientId, userId);
            setAssignOpen(false);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo asignar el lead.");
        } finally {
            setAssigningUser(false);
        }
    }

    async function changeReviewStatus(status: LeadReviewStatus, notSuitableReason?: string | null) {
        if (!lead || !canStatusManage) return;
        if (lead.assignedTo) {
            setErr("No se puede cambiar el estado de un cliente ya asignado.");
            setStatusOpen(false);
            return;
        }

        setSavingStatus(true);
        setErr(null);

        try {
            await updateLeadStatus(clientId, {
                verificationStatus: status,
                leadQuality:
                    status === "verified"
                        ? "valid"
                        : status === "not_suitable"
                            ? "not_suitable"
                            : status === "pending_review"
                                ? "review"
                                : "unknown",
                notSuitableReason:
                    status === "not_suitable"
                        ? notSuitableReason || lead.notSuitableReason || "Perfil no apto"
                        : "",
                verifiedAt: status === "verified" ? Date.now() : null,
            });
            setStatusOpen(false);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cambiar el estado.");
        } finally {
            setSavingStatus(false);
        }
    }

    async function removeLead() {
        if (!lead || !canDelete) return;
        const ok = window.confirm(`¿Eliminar el lead "${displayName(lead)}"? Esta acción no se puede deshacer.`);
        if (!ok) return;

        setDeletingLead(true);
        setErr(null);

        try {
            await deleteLead(clientId);
            router.replace(returnTo);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo eliminar el lead.");
        } finally {
            setDeletingLead(false);
        }
    }

    async function copyConversation() {
        const lines = [
            "# Conversacion TrackGo",
            "",
            "## Lead",
            `ID: ${clientId}`,
            `Nombre: ${displayName(lead)}`,
            `Telefono: ${lead?.phone || "-"}`,
            `Negocio: ${lead?.business || "-"}`,
            `Ciudad/Zona: ${lead?.location?.displayLabel || "-"}`,
            `Estado revision: ${lead ? statusLabel[lead.verificationStatus] : "-"}`,
            `Modo chat: ${modeLabel(mode)}`,
            "",
            "## Mensajes",
            messages.length
                ? messages.map((message) => {
                    const when = message.createdAt ? new Date(message.createdAt).toISOString() : "sin_fecha";
                    return `- [${when}] ${senderLabel(message)} (${message.direction}): ${message.text || ""}`;
                }).join("\n")
                : "Sin mensajes.",
        ].join("\n");

        try {
            await navigator.clipboard.writeText(lines);
        } catch {
            window.prompt("Copia la conversacion", lines);
        }
        setCopiedConversation(true);
        window.setTimeout(() => setCopiedConversation(false), 1400);
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
                            onClick={goBackToPreviousScreen}
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
                    <>
                        <button
                            type="button"
                            onClick={() => setQuickActionsOpen(false)}
                            className="fixed inset-0 z-40 bg-black/40 xl:hidden"
                            aria-label="Cerrar"
                        />
                        <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] xl:hidden">
                            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB]" />
                            <div className="mb-4 min-w-0">
                                <div className="min-w-0">
                                    <h3 className="truncate text-[15px] font-black text-[#101936]">{displayName(lead)}</h3>
                                    <p className="mt-0.5 truncate text-[12px] font-semibold text-[#66739A]">
                                        {[lead?.phone, lead?.location?.displayLabel].filter(Boolean).join(" · ") || "Sin datos"}
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-2">
                                {canClientView ? (
                                    <Link
                                        href={`/admin/clients/${clientId}`}
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                                        onClick={closeQuickActionsForNavigation}
                                    >
                                        <AppIcon name="users" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                                        Ver cliente
                                    </Link>
                                ) : null}

                                {canEdit ? (
                                    <button
                                        type="button"
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#fff7ed] px-4 text-[14px] font-bold text-[#101936] transition active:bg-orange-100"
                                        onClick={() => { setQuickActionsOpen(false); setEditOpen(true); }}
                                    >
                                        <AppIcon name="edit" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-orange-600 ring-0" />
                                        Editar
                                    </button>
                                ) : null}

                                {canAssign ? (
                                    <button
                                        type="button"
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                                        onClick={() => { setQuickActionsOpen(false); setAssignOpen(true); }}
                                    >
                                        <AppIcon name="assign" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                                        Asignar a usuario
                                    </button>
                                ) : null}

                                {canStatusManage && !lead?.assignedTo ? (
                                    <button
                                        type="button"
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-blue-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-blue-100"
                                        onClick={() => { setQuickActionsOpen(false); setStatusOpen(true); }}
                                    >
                                        <AppIcon name="settings" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-blue-600 ring-0" />
                                        Estado
                                    </button>
                                ) : null}

                                {lead?.location?.mapsUrl && canMaps ? (
                                    <Link
                                        href={lead.location.mapsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100"
                                        onClick={closeQuickActionsForNavigation}
                                    >
                                        <AppIcon name="map" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-emerald-600 ring-0" />
                                        Maps
                                    </Link>
                                ) : null}

                                {lead?.phone && canWhatsapp ? (
                                    <Link
                                        href={buildWhatsAppUrl(lead.phone)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100"
                                        onClick={closeQuickActionsForNavigation}
                                    >
                                        <AppIcon name="chat" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-emerald-600 ring-0" />
                                        WhatsApp
                                    </Link>
                                ) : null}

                                {canDelete ? (
                                    <button
                                        type="button"
                                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-red-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-red-100 disabled:opacity-50"
                                        onClick={() => { setQuickActionsOpen(false); void removeLead(); }}
                                        disabled={deletingLead}
                                    >
                                        <AppIcon name="trash" tone="red" size="sm" className="h-5 w-5 bg-transparent ring-0" />
                                        Eliminar lead
                                    </button>
                                ) : null}
                            </div>

                            <button
                                type="button"
                                onClick={() => setQuickActionsOpen(false)}
                                className="mt-3 min-h-[48px] w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] text-[14px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                            >
                                Cancelar
                            </button>
                        </div>
                    </>
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
                            <IconButton
                                icon="arrowLeft"
                                label="Chat anterior"
                                onClick={() => goToQueuedLead(prevId)}
                                disabled={!prevId}
                            />
                            <IconButton
                                icon="arrowRight"
                                label={nextId ? "Chat siguiente" : "Cargar siguiente chat"}
                                onClick={() => void goNextQueuedLead()}
                                disabled={!nextId && (!queueHasMore || queueLoadingMore)}
                            />
                            {lead?.location?.mapsUrl && canMaps ? (
                                <QuickLink href={lead.location.mapsUrl} icon="map" label="Maps" external />
                            ) : null}
                            {lead?.phone && canWhatsapp ? (
                                <QuickLink href={buildWhatsAppUrl(lead.phone)} icon="chat" label="WhatsApp" external />
                            ) : null}
                            {canAssign ? (
                                <IconButton
                                    icon="assign"
                                    label="Asignar usuario"
                                    onClick={() => setEditOpen(true)}
                                    disabled={!lead}
                                />
                            ) : null}
                            {canStatusManage && !lead?.assignedTo ? (
                                <IconButton
                                    icon="settings"
                                    label="Cambiar estado"
                                    onClick={() => setStatusOpen(true)}
                                    disabled={!lead}
                                />
                            ) : null}
                            {canDelete ? (
                                <IconButton
                                    icon="trash"
                                    label="Eliminar lead"
                                    onClick={() => void removeLead()}
                                    disabled={!lead || deletingLead}
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
                            <CardHeader title="Prospecto" subtitle="Perfil y asignacion" />
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
                    </aside>

                    <Card className="flex min-h-[680px] flex-col overflow-hidden">
                        <CardHeader
                            title="Conversacion"
                            subtitle={`${messages.length} mensajes`}
                            action={
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => void copyConversation()}
                                        disabled={loadingMessages}
                                    >
                                        <AppIcon name={copiedConversation ? "check" : "copy"} tone="slate" size="sm" className="h-4 w-4 bg-transparent text-current ring-0" />
                                        {copiedConversation ? "Copiado" : "Copiar"}
                                    </Button>
                                    <Badge tone={mode === "human" ? "blue" : "green"}>
                                        {modeLabel(mode)}
                                    </Badge>
                                </div>
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

            <LeadStatusModal
                lead={statusOpen && canStatusManage && !lead?.assignedTo ? lead : null}
                saving={savingStatus}
                onClose={() => setStatusOpen(false)}
                onSave={(_lead, status, notSuitableReason) => changeReviewStatus(status, notSuitableReason)}
            />

            <AssignUserModal
                open={assignOpen && canAssign}
                onClose={() => setAssignOpen(false)}
                users={users}
                onAssign={(userId) => void assign(userId)}
                saving={assigningUser}
            />
        </div>
    );
}

function LeadStatusModal({
    lead,
    saving,
    onClose,
    onSave,
}: {
    lead: MetaLeadDoc | null;
    saving: boolean;
    onClose: () => void;
    onSave: (lead: MetaLeadDoc, status: LeadReviewStatus, notSuitableReason?: string | null) => Promise<void>;
}) {
    const [status, setStatus] = useState<LeadReviewStatus>("pending_review");
    const [reason, setReason] = useState("");

    useEffect(() => {
        if (!lead) return;
        queueMicrotask(() => {
            setStatus(lead.verificationStatus);
            setReason(lead.notSuitableReason || "");
        });
    }, [lead]);

    if (!lead) return null;

    const needsReason = status === "not_suitable";

    return (
        <Modal
            open={!!lead}
            onClose={onClose}
            title="Cambiar estado"
            subtitle={displayName(lead)}
            size="sm"
        >
            <div className="space-y-4">
                <div className="rounded-2xl border border-[#eef0f6] bg-[#fbfcff] p-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#98a2b3]">Estado actual</div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-[13px] font-black text-[#101936]">{displayName(lead)}</div>
                            <div className="truncate text-[12px] font-semibold text-[#66739a]">{lead.business || lead.phone}</div>
                        </div>
                        <Badge tone={statusTone[lead.verificationStatus]}>{statusLabel[lead.verificationStatus]}</Badge>
                    </div>
                </div>

                <div className="grid gap-2">
                    {STATUS_OPTIONS.map((option) => {
                        const active = status === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setStatus(option.value)}
                                className={[
                                    "flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                                    active
                                        ? "border-violet-200 bg-[#f5f1ff] text-[#6d28d9]"
                                        : "border-[#e8eaf3] bg-white text-[#172033] hover:border-violet-100 hover:bg-[#fbfaff]",
                                ].join(" ")}
                            >
                                <span className="text-[13px] font-black">{option.label}</span>
                                {active ? <AppIcon name="check" tone="purple" size="sm" /> : null}
                            </button>
                        );
                    })}
                </div>

                {needsReason ? (
                    <label className="block">
                        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-[#98a2b3]">Motivo</span>
                        <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            rows={3}
                            placeholder="Ej: fuera de perfil, asalariado, motorista..."
                            className="w-full resize-none rounded-2xl border border-[#e8eaf3] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#172033] outline-none transition placeholder:text-[#98a2b3] focus:border-violet-300 focus:ring-4 focus:ring-violet-50"
                        />
                    </label>
                ) : null}

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => onSave(lead, status, needsReason ? reason.trim() || null : null)}
                        disabled={saving || (status === lead.verificationStatus && (!needsReason || reason.trim() === (lead.notSuitableReason || "")))}
                    >
                        {saving ? "Guardando..." : "Guardar"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function QuickLink({
    href,
    icon,
    label,
    external = false,
}: {
    href: string;
    icon: "lead" | "users" | "map" | "chat";
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
            <AppIcon name={icon} tone={icon === "map" || icon === "chat" ? "green" : "purple"} size="sm" plain />
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
