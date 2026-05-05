"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { markUserLeadMessagesSeen, sendManualLeadMessage, subscribeLeadClient, subscribeLeadMessages } from "@/data/leadChatRepo";
import { dddCity, extractDDD } from "@/data/incompleteClientsRepo";
import type { LeadMessageDoc, MetaLeadDoc } from "@/types/leads";
import { buildWhatsAppUrl } from "@/lib/whatsapp";

function formatTime(ts: number | null | undefined) {
    if (!ts) return "";
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function formatDate(ts: number | null | undefined) {
    if (!ts) return "";
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    if (day.getTime() === today.getTime()) return "Hoy";
    if (day.getTime() === yesterday.getTime()) return "Ayer";
    return new Intl.DateTimeFormat("es", { weekday: "long", day: "2-digit", month: "long" }).format(d);
}

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.business || lead.phone || "Cliente";
}

function groupByDay(messages: LeadMessageDoc[]) {
    const groups: { label: string; messages: LeadMessageDoc[] }[] = [];
    const seen = new Map<string, LeadMessageDoc[]>();
    for (const msg of messages) {
        const label = formatDate(msg.createdAt);
        if (!seen.has(label)) {
            seen.set(label, []);
            groups.push({ label, messages: seen.get(label)! });
        }
        seen.get(label)!.push(msg);
    }
    return groups;
}

function lastInboundAt(lead: MetaLeadDoc | null, messages: LeadMessageDoc[]) {
    const fromMessages = messages.reduce((max, msg) => {
        if (msg.direction !== "inbound") return max;
        return Math.max(max, msg.createdAt ?? 0);
    }, 0);

    return Math.max(fromMessages, lead?.lastInboundMessageAt ?? 0);
}

export default function UserChatDetailPage() {
    const params = useParams();
    const router = useRouter();
    const clientId = String(params?.id ?? "");

    const [lead, setLead] = useState<MetaLeadDoc | null>(null);
    const [messages, setMessages] = useState<LeadMessageDoc[]>([]);
    const [loadingLead, setLoadingLead] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState("");

    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!clientId) return;
        const unsub = subscribeLeadClient(
            clientId,
            (data) => { setLead(data); setLoadingLead(false); },
            () => setLoadingLead(false)
        );
        return unsub;
    }, [clientId]);

    useEffect(() => {
        if (!clientId) return;
        const unsub = subscribeLeadMessages(
            clientId,
            (data) => { setMessages(data); setLoadingMessages(false); },
            () => setLoadingMessages(false)
        );
        return unsub;
    }, [clientId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        if (!clientId || loadingLead || loadingMessages || !lead) return;
        const inboundAt = lastInboundAt(lead, messages);
        const seenAt = Math.max(lead.userChatLastSeenMessageAt ?? 0, lead.userChatSeenAt ?? 0);
        if (!inboundAt || inboundAt <= seenAt) return;

        void markUserLeadMessagesSeen(clientId, inboundAt).catch((err) => {
            console.error("[markUserLeadMessagesSeen]", err);
        });
    }, [clientId, lead, loadingLead, loadingMessages, messages]);

    async function handleSend() {
        const msg = text.trim();
        if (!msg || !clientId || sending) return;
        setSending(true);
        setSendError("");
        try {
            await sendManualLeadMessage(clientId, msg);
            setText("");
            inputRef.current?.focus();
        } catch (e) {
            setSendError(e instanceof Error ? e.message : "Error al enviar");
        } finally {
            setSending(false);
        }
    }

    function openWhatsApp() {
        if (!lead) return;
        const url = buildWhatsAppUrl(lead.phone);
        if (url) window.open(url, "_blank");
    }

    function openMaps() {
        if (!lead) return;
        const url = lead.location?.mapsUrl || (lead.location?.lat ? `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}` : null);
        if (url) window.open(url, "_blank");
    }

    const ddd = lead ? extractDDD(lead.phone) : null;
    const dayGroups = groupByDay(messages);

    if (loadingLead) {
        return (
            <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center bg-[#fbfaff]">
                <svg className="tg-spin h-8 w-8 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                </svg>
            </div>
        );
    }

    if (!lead) {
        return (
            <div className="fixed inset-0 z-50 flex h-dvh flex-col items-center justify-center bg-[#fbfaff] px-6 text-center">
                <p className="text-[15px] font-black text-[#101936]">Cliente no encontrado</p>
                <button type="button" onClick={() => router.back()} className="mt-4 text-[13px] font-bold text-[#7C3AED]">Volver</button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-[#f8f7ff]">

            {/* ── HEADER ──────────────────────────────────────────────── */}
            <div className="shrink-0 border-b border-[#E8E7FB] bg-white">
                <div className="flex items-center gap-3 px-3 py-3">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-white transition active:bg-[#f3f0ff]"
                >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6" />
                    </svg>
                </button>

                <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-black text-[#101936]">{displayName(lead)}</p>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-[#66739A]">{lead.phone}</span>
                        {ddd ? (
                            <span className="rounded-full bg-[#f3f0ff] px-1.5 py-0.5 text-[9px] font-black text-[#7C3AED]">
                                {ddd} · {dddCity(ddd)}
                            </span>
                        ) : null}
                        <ParseStatusBadge status={lead.parseStatus} />
                    </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                    <button
                        type="button"
                        onClick={openWhatsApp}
                        className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-emerald-200 bg-emerald-50 text-emerald-700 transition active:bg-emerald-100"
                        title="WhatsApp"
                    >
                        <WAIcon />
                    </button>
                    {lead.location?.lat ? (
                        <button
                            type="button"
                            onClick={openMaps}
                            className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-blue-200 bg-blue-50 text-blue-700 transition active:bg-blue-100"
                            title="Ver en Maps"
                        >
                            <MapsIcon />
                        </button>
                    ) : null}
                </div>
                </div>
            </div>

            {/* ── INFO PILLS ──────────────────────────────────────────── */}
            {(!lead.location?.lat || !lead.business) ? (
                <div className="shrink-0 overflow-x-auto border-b border-[#E8E7FB] bg-white/80 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex gap-2">
                    {!lead.business ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Falta: tipo de negocio
                        </span>
                    ) : null}
                    {!lead.location?.lat ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Falta: ubicación en Maps
                        </span>
                    ) : null}
                    </div>
                </div>
            ) : null}

            {/* ── MESSAGES ────────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+96px)]">
                {loadingMessages ? (
                    <div className="flex justify-center py-10">
                        <svg className="tg-spin h-6 w-6 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                        </svg>
                    </div>
                ) : messages.length === 0 ? (
                    <p className="py-10 text-center text-[13px] font-semibold text-[#98A2B3]">Sin mensajes aún</p>
                ) : (
                    <div className="space-y-4">
                        {dayGroups.map(({ label, messages: dayMsgs }) => (
                            <div key={label}>
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="flex-1 border-t border-[#E8E7FB]" />
                                    <span className="rounded-full bg-[#E8E7FB] px-2.5 py-1 text-[10px] font-bold text-[#66739A]">{label}</span>
                                    <div className="flex-1 border-t border-[#E8E7FB]" />
                                </div>
                                <div className="space-y-2">
                                    {dayMsgs.map((msg) => (
                                        <MessageBubble key={msg.id} msg={msg} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* ── INPUT ───────────────────────────────────────────────── */}
            <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-[#E8E7FB] bg-white/96 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 shadow-[0_-12px_30px_rgba(16,25,54,0.08)] backdrop-blur-xl">
                {sendError ? (
                    <p className="mb-1.5 text-[11px] font-bold text-red-600">{sendError}</p>
                ) : null}
                <div className="flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        }}
                        placeholder="Escribe un mensaje..."
                        rows={1}
                        className="min-h-[40px] flex-1 resize-none rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2.5 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                        style={{ maxHeight: "120px" }}
                    />
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!text.trim() || sending}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#7C3AED] text-white shadow-md transition active:bg-[#6d28d9] disabled:opacity-40"
                    >
                        {sending ? (
                            <svg className="tg-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                                <path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── MESSAGE BUBBLE ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: LeadMessageDoc }) {
    const isOut = msg.direction === "outbound";
    const isBot = msg.senderType === "bot";

    return (
        <div className={["flex", isOut ? "justify-end" : "justify-start"].join(" ")}>
            <div className={[
                "max-w-[78%] rounded-[16px] px-3 py-2",
                isOut
                    ? "rounded-br-[4px] bg-[#7C3AED] text-white"
                    : "rounded-bl-[4px] border border-[#E8E7FB] bg-white text-[#101936]",
            ].join(" ")}>
                {isOut && isBot ? (
                    <p className={["mb-0.5 text-[9px] font-black uppercase tracking-wide", isOut ? "text-violet-200" : "text-[#98A2B3]"].join(" ")}>
                        Bot
                    </p>
                ) : null}
                <p className="text-[13px] font-semibold leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <p className={["mt-0.5 text-right text-[10px]", isOut ? "text-violet-200" : "text-[#98A2B3]"].join(" ")}>
                    {formatTime(msg.createdAt)}
                </p>
            </div>
        </div>
    );
}

// ── PARSE STATUS BADGE ───────────────────────────────────────────────────────

function ParseStatusBadge({ status }: { status: string }) {
    const cfg: Record<string, { label: string; cls: string }> = {
        empty: { label: "Vacío", cls: "border-red-200 bg-red-50 text-red-700" },
        partial: { label: "Incompleto", cls: "border-amber-200 bg-amber-50 text-amber-700" },
        ready: { label: "Listo", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    };
    const c = cfg[status] ?? { label: status, cls: "border-[#E8E7FB] bg-white text-[#66739A]" };
    return (
        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-black ${c.cls}`}>
            {c.label}
        </span>
    );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

function WAIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z" />
            <path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z" />
        </svg>
    );
}

function MapsIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
            <path d="M9 3v15M15 6v15" />
        </svg>
    );
}
