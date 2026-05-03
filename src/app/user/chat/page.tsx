"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { dddCity, extractDDD, subscribeIncompleteClients } from "@/data/incompleteClientsRepo";
import type { MetaLeadDoc } from "@/types/leads";

function norm(s: unknown) {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.business || lead.phone || "Sin nombre";
}

function formatRelative(ts: number | null | undefined): string {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Ahora";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(new Date(ts));
}


export default function UserChatPage() {
    const { phoneCodes } = useAuth();

    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [dddFilter, setDddFilter] = useState<string>("all");

    useEffect(() => {
        setLoading(true);
        const unsub = subscribeIncompleteClients(phoneCodes, (data) => {
            setLeads(data);
            setLoading(false);
        });
        return unsub;
    }, [phoneCodes]);

    const activeDdds = useMemo(() => {
        const seen = new Set<string>();
        leads.forEach((l) => {
            const ddd = extractDDD(l.phone);
            if (ddd) seen.add(ddd);
        });
        return Array.from(seen).sort();
    }, [leads]);

    const filtered = useMemo(() => {
        let list = leads;
        if (dddFilter !== "all") {
            list = list.filter((l) => extractDDD(l.phone) === dddFilter);
        }
        if (search.trim()) {
            const q = norm(search.trim());
            list = list.filter((l) =>
                norm(l.name).includes(q) ||
                norm(l.business).includes(q) ||
                norm(l.phone).includes(q) ||
                norm(l.location?.address).includes(q)
            );
        }
        return list;
    }, [leads, dddFilter, search]);

    if (!phoneCodes.length && !loading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-[#fbfaff] px-6 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                    <ChatIcon className="h-7 w-7 text-[#7C3AED]" />
                </div>
                <p className="text-[15px] font-black text-[#101936]">Sin indicativos configurados</p>
                <p className="mt-1 text-[12px] font-semibold text-[#66739A]">
                    El administrador debe configurar los DDDs de tu cobertura para ver clientes potenciales.
                </p>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.07),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f4f0ff_50%,#fbfaff_100%)]">

            {/* ── HEADER ──────────────────────────────────────────────── */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-4 backdrop-blur-md xl:px-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">Chat</h1>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#66739A]">
                            Clientes potenciales incompletos · {phoneCodes.map(dddCity).join(", ")}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSearchOpen(true)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                        aria-label="Buscar"
                    >
                        <SearchIconSm />
                    </button>
                </div>

                {/* DDD filter chips */}
                {activeDdds.length > 1 ? (
                    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <DddChip active={dddFilter === "all"} onClick={() => setDddFilter("all")}>
                            Todos <CountBadge active={dddFilter === "all"}>{leads.length}</CountBadge>
                        </DddChip>
                        {activeDdds.map((ddd) => {
                            const count = leads.filter((l) => extractDDD(l.phone) === ddd).length;
                            return (
                                <DddChip key={ddd} active={dddFilter === ddd} onClick={() => setDddFilter(ddd)}>
                                    {dddCity(ddd)} <CountBadge active={dddFilter === ddd}>{count}</CountBadge>
                                </DddChip>
                            );
                        })}
                    </div>
                ) : null}
            </div>

            {/* ── LIST ────────────────────────────────────────────────── */}
            <div className="flex-1 px-3 pb-4 pt-2 xl:px-6">
                {loading ? (
                    <LoadingState />
                ) : filtered.length === 0 ? (
                    <EmptyState hasPhoneCodes={phoneCodes.length > 0} />
                ) : (
                    <div className="grid gap-2">
                        {filtered.map((lead) => (
                            <ChatLeadCard key={lead.id} lead={lead} />
                        ))}
                    </div>
                )}
            </div>

            {/* ── SEARCH MODAL ────────────────────────────────────────── */}
            {searchOpen ? (
                <div className="fixed inset-0 z-50 flex flex-col bg-[#fbfaff]">
                    <div className="flex items-center gap-3 border-b border-[#E8E7FB] px-4 py-3">
                        <div className="flex flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2.5 shadow-sm">
                            <SearchIconSm />
                            <input
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Nombre, negocio, teléfono..."
                                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            />
                            {search ? (
                                <button type="button" onClick={() => setSearch("")} className="text-[18px] text-[#98A2B3]">×</button>
                            ) : null}
                        </div>
                        <button type="button" onClick={() => setSearchOpen(false)} className="text-[13px] font-black text-[#7C3AED]">
                            Listo
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 pt-3">
                        {filtered.length === 0 ? (
                            <p className="pt-10 text-center text-[13px] font-semibold text-[#98A2B3]">Sin resultados</p>
                        ) : (
                            <div className="grid gap-2">
                                {filtered.map((lead) => <ChatLeadCard key={lead.id} lead={lead} />)}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

// ── CHAT LEAD CARD ───────────────────────────────────────────────────────────

function ChatLeadCard({ lead }: { lead: MetaLeadDoc }) {
    const ddd = extractDDD(lead.phone);
    const hasLocation = lead.location?.lat !== null && lead.location?.lat !== undefined;
    const hasBusiness = Boolean(lead.business);

    const missingBits: string[] = [];
    if (!hasLocation) missingBits.push("ubicación");
    if (!hasBusiness) missingBits.push("tipo de negocio");

    return (
        <Link
            href={`/user/chat/${lead.id}`}
            className="block overflow-hidden rounded-[18px] border border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)] transition active:bg-[#f9f8ff]"
        >
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <p className="truncate text-[14px] font-black text-[#101936]">{displayName(lead)}</p>
                            {ddd ? (
                                <span className="shrink-0 rounded-full bg-[#f3f0ff] px-1.5 py-0.5 text-[9px] font-black text-[#7C3AED]">
                                    {ddd} · {dddCity(ddd)}
                                </span>
                            ) : null}
                        </div>
                        {lead.business && lead.name ? (
                            <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.business}</p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[10px] font-semibold text-[#98A2B3]">
                            {formatRelative(lead.lastInboundMessageAt)}
                        </span>
                        <ParseStatusDot status={lead.parseStatus} />
                    </div>
                </div>

                {/* Last message preview */}
                {lead.lastInboundText ? (
                    <p className="mt-1.5 line-clamp-1 text-[12px] font-semibold text-[#66739A]">
                        {lead.lastInboundText}
                    </p>
                ) : null}

                {/* Missing info badges */}
                {missingBits.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {missingBits.map((bit) => (
                            <span key={bit} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                Falta: {bit}
                            </span>
                        ))}
                    </div>
                ) : null}

                {/* Phone */}
                <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#66739A]">{lead.phone}</span>
                    <span className="flex items-center gap-1 text-[11px] font-bold text-[#7C3AED]">
                        Abrir chat
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <path d="m9 18 6-6-6-6" />
                        </svg>
                    </span>
                </div>
            </div>
        </Link>
    );
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function ParseStatusDot({ status }: { status: string }) {
    const colors: Record<string, string> = {
        empty: "bg-red-400",
        partial: "bg-amber-400",
        ready: "bg-emerald-400",
    };
    const labels: Record<string, string> = {
        empty: "Vacío",
        partial: "Incompleto",
        ready: "Listo",
    };
    return (
        <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${colors[status] ?? "bg-gray-300"}`} />
            <span className="text-[9px] font-bold text-[#98A2B3]">{labels[status] ?? status}</span>
        </span>
    );
}

function DddChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black transition",
                active
                    ? "border-[#7C3AED] bg-[#7C3AED] text-white"
                    : "border-[#E8E7FB] bg-white text-[#66739A] hover:border-[#7C3AED]/40 hover:text-[#7C3AED]",
            ].join(" ")}
        >
            {children}
        </button>
    );
}

function CountBadge({ active, children }: { active: boolean; children: React.ReactNode }) {
    return (
        <span className={[
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
            active ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]",
        ].join(" ")}>
            {children}
        </span>
    );
}

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                </svg>
            </div>
            <p className="mt-3 text-[13px] font-bold text-[#66739A]">Cargando clientes...</p>
        </div>
    );
}

function EmptyState({ hasPhoneCodes }: { hasPhoneCodes: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <ChatIcon className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <p className="text-[14px] font-black text-[#101936]">
                {hasPhoneCodes ? "Sin clientes incompletos" : "Sin indicativos configurados"}
            </p>
            <p className="mt-1 text-[12px] font-semibold text-[#98A2B3]">
                {hasPhoneCodes
                    ? "No hay clientes pendientes de verificar en tu cobertura"
                    : "Contacta al administrador para configurar tus DDDs"}
            </p>
        </div>
    );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

function SearchIconSm() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
        </svg>
    );
}

function ChatIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    );
}
