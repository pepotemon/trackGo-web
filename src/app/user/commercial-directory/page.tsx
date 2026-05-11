"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import {
    listDirectoryProspectsForCities,
    listMyDirectoryAssignments,
    listMyDirectoryTouches,
    markDirectoryProspectContacted,
    saveDirectoryProspectNote,
} from "@/data/commercialDirectoryRepo";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import type {
    CommercialDirectoryAssignmentDoc,
    CommercialDirectoryProspectDoc,
    CommercialDirectoryProspectTouchDoc,
} from "@/types/commercialDirectory";

const SPANISH_PHONE_PREFIXES = ["507", "502", "503", "504", "505", "506", "509", "593", "591", "595", "598", "52", "54", "56", "57", "51", "58"];

function buildWALink(phone: string, msg: string) {
    const d = phone.replace(/\D/g, "");
    if (SPANISH_PHONE_PREFIXES.some((p) => d.startsWith(p))) return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
    if (d.startsWith("55")) return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
    return `https://wa.me/55${d}?text=${encodeURIComponent(msg)}`;
}

function norm(value: unknown) {
    return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function dayKey(ms?: number | null) {
    return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

function contactTone(count: number) {
    if (count <= 15) return { label: "Saludable", tone: "green" as const, text: "Mantente en este ritmo." };
    if (count <= 25) return { label: "Riesgo", tone: "yellow" as const, text: "Baja la velocidad para evitar bloqueos." };
    return { label: "Detener", tone: "red" as const, text: "Pausa los envios por hoy." };
}

function messageTemplates(countryName: string, businessName: string, sellerName: string) {
    const br = norm(countryName).includes("brasil") || norm(countryName).includes("brazil");
    const loja = businessName || (br ? "sua loja" : "tu negocio");
    const seller = sellerName || (br ? "consultor" : "asesor");

    if (br) {
        return [
            `Ola, bom dia! Meu nome e ${seller}. Desculpa a mensagem inesperada, encontrei seu contato no Google Maps. Trabalho oferecendo creditos e microcreditos para comerciantes da sua regiao. Se quiser, posso enviar os valores sem compromisso. Caso contrario, desculpa o incomodo. Obrigado pelo seu tempo.`,
            `Ola! Tudo bem? Vi o contato de ${loja} no Google Maps e queria me apresentar. Trabalho com opcoes de credito para comercios locais. Posso te enviar uma simulacao rapida, sem compromisso?`,
            `Bom dia! Aqui e ${seller}. Estou falando com comerciantes da regiao sobre credito e microcredito para capital de giro. Se fizer sentido para ${loja}, posso passar as condicoes por aqui.`,
            `Ola, tudo bem? Encontrei ${loja} no Google Maps. Temos algumas opcoes de credito para comerciantes que precisam reforcar estoque, caixa ou investir no negocio. Posso enviar mais informacoes?`,
            `Boa tarde! Meu nome e ${seller}. Trabalho com apoio financeiro para pequenos comercios. Se voce tiver interesse em conhecer valores de credito disponiveis, eu posso te explicar de forma simples por aqui.`,
        ];
    }

    return [
        `Hola, buen dia. Mi nombre es ${seller}. Disculpa el mensaje inesperado, encontre el contacto de ${loja} en Google Maps. Trabajo ofreciendo creditos y microcreditos para comercios. Si quieres, puedo enviarte los valores sin compromiso.`,
        `Hola! Vi ${loja} en Google Maps y queria presentarme. Trabajo con opciones de credito para comerciantes. Puedo enviarte una simulacion rapida sin compromiso?`,
        `Buenas tardes, soy ${seller}. Estamos contactando comercios de la zona con opciones de credito para capital de trabajo, inventario o crecimiento. Te puedo enviar mas informacion?`,
        `Hola, que tal? Encontre el contacto de ${loja} publicamente en Google Maps. Si en algun momento necesitas credito para tu comercio, puedo explicarte las opciones disponibles.`,
        `Buen dia! Mi nombre es ${seller}. Trabajo con microcredito para negocios. Si te interesa conocer montos y condiciones, te los puedo enviar por aqui sin compromiso.`,
    ];
}

export default function UserCommercialDirectoryPage() {
    const { firebaseUser, profile, userPermissions } = useAuth();
    const userId = firebaseUser?.uid ?? "";
    const userName = profile?.name?.split(" ")[0] || "Vendedor";
    const [assignments, setAssignments] = useState<CommercialDirectoryAssignmentDoc[]>([]);
    const [prospects, setProspects] = useState<CommercialDirectoryProspectDoc[]>([]);
    const [touches, setTouches] = useState<CommercialDirectoryProspectTouchDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [cityId, setCityId] = useState("all");
    const [neighborhood, setNeighborhood] = useState("all");
    const [category, setCategory] = useState("all");
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [waProspect, setWaProspect] = useState<CommercialDirectoryProspectDoc | null>(null);
    const [noteProspect, setNoteProspect] = useState<CommercialDirectoryProspectDoc | null>(null);
    const [noteText, setNoteText] = useState("");
    const [customMessage, setCustomMessage] = useState("");
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useBackButtonDismiss(searchOpen, () => setSearchOpen(false));
    useBackButtonDismiss(infoOpen, () => setInfoOpen(false));
    useBackButtonDismiss(Boolean(waProspect), () => setWaProspect(null));
    useBackButtonDismiss(Boolean(noteProspect), () => setNoteProspect(null));

    useEffect(() => {
        return () => {
            if (copyTimer.current) clearTimeout(copyTimer.current);
        };
    }, []);

    useEffect(() => {
        if (!userPermissions.canSeeCommercialDirectory) return;
        if (!userId) return;
        let disposed = false;
        queueMicrotask(() => setLoading(true));

        async function loadData() {
            try {
                const nextAssignments = await listMyDirectoryAssignments(userId);
                const nextProspects = await listDirectoryProspectsForCities(nextAssignments.map((item) => item.cityId));
                const nextTouches = await listMyDirectoryTouches(userId);
                if (disposed) return;
                setAssignments(nextAssignments);
                setProspects(nextProspects);
                setTouches(nextTouches);
                setCityId((current) => current === "all" ? "all" : current);
            } finally {
                if (!disposed) setLoading(false);
            }
        }

        void loadData();
        return () => {
            disposed = true;
        };
    }, [userId, userPermissions.canSeeCommercialDirectory]);

    const touchMap = useMemo(() => {
        const map = new Map<string, CommercialDirectoryProspectTouchDoc>();
        touches.forEach((item) => map.set(item.prospectId, item));
        return map;
    }, [touches]);

    const cityOptions = useMemo(() => assignments, [assignments]);
    const baseProspects = useMemo(() => {
        return prospects.filter((item) => cityId === "all" || item.cityId === cityId);
    }, [cityId, prospects]);

    const neighborhoods = useMemo(() => Array.from(new Set(baseProspects.map((item) => item.neighborhoodName))).sort(), [baseProspects]);
    const categories = useMemo(() => Array.from(new Set(baseProspects.filter((item) => neighborhood === "all" || item.neighborhoodName === neighborhood).map((item) => item.categoryName))).sort(), [baseProspects, neighborhood]);

    const visible = useMemo(() => {
        let list = baseProspects;
        if (neighborhood !== "all") list = list.filter((item) => item.neighborhoodName === neighborhood);
        if (category !== "all") list = list.filter((item) => item.categoryName === category);
        if (search.trim()) {
            const q = norm(search);
            list = list.filter((item) => norm(item.name).includes(q) || norm(item.phone).includes(q) || norm(item.address).includes(q) || norm(item.categoryName).includes(q));
        }
        return list;
    }, [baseProspects, category, neighborhood, search]);

    const todayContacts = useMemo(() => touches.filter((item) => item.contacted && dayKey(item.contactedAt) === todayKey()).length, [touches]);
    const dailyTone = contactTone(todayContacts);
    const totalContacted = visible.filter((item) => touchMap.get(item.id)?.contacted).length;
    const completion = visible.length ? Math.round((totalContacted / visible.length) * 100) : 0;

    async function refreshTouches() {
        setTouches(await listMyDirectoryTouches(userId));
    }

    async function openWhatsApp(prospect: CommercialDirectoryProspectDoc, message: string) {
        window.open(buildWALink(prospect.phone, message), "_blank");
        await markDirectoryProspectContacted({ userId, prospectId: prospect.id, cityId: prospect.cityId });
        await refreshTouches();
        setWaProspect(null);
    }

    async function saveNote() {
        if (!noteProspect) return;
        await saveDirectoryProspectNote({ userId, prospectId: noteProspect.id, cityId: noteProspect.cityId, note: noteText });
        await refreshTouches();
        setNoteProspect(null);
        setNoteText("");
    }

    async function copyProspect(prospect: CommercialDirectoryProspectDoc) {
        const text = [
            `Nombre: ${prospect.name}`,
            prospect.phone ? `Telefono: ${prospect.phone}` : "",
            prospect.address ? `Direccion: ${prospect.address}` : "",
            prospect.googleMapsLink ? `Maps: ${prospect.googleMapsLink}` : "",
        ].filter(Boolean).join("\n");
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            window.prompt("Copia los datos", text);
        }
        setCopiedId(prospect.id);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopiedId(null), 1200);
    }

    if (!userPermissions.canSeeCommercialDirectory) {
        return <EmptyState title="Sin permiso" body="El administrador debe habilitar tu acceso a Base Comercial." />;
    }

    return (
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.07),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f4f0ff_50%,#fbfaff_100%)]">
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-4 backdrop-blur-md xl:px-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">Base Comercial</h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                            {cityOptions.length ? cityOptions.map((item) => item.cityName).join(", ") : "Sin ciudades asignadas"}
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => setInfoOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white text-[#7C3AED] shadow-sm" aria-label="Informacion">
                            <span className="text-[15px] font-black">i</span>
                        </button>
                        <button type="button" onClick={() => setSearchOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm" aria-label="Buscar">
                            <SearchIcon />
                        </button>
                    </div>
                </div>

                <div className="mb-3 grid grid-cols-3 gap-2">
                    <StatPill label="Contactados" value={totalContacted} tone="green" />
                    <StatPill label="Avance" value={`${completion}%`} tone="violet" />
                    <StatPill label={dailyTone.label} value={todayContacts} tone={dailyTone.tone} />
                </div>

                <div className="mb-2 rounded-[14px] border border-[#E8E7FB] bg-white p-2 shadow-sm">
                    <div className="h-2 overflow-hidden rounded-full bg-[#f3f0ff]">
                        <div className="h-full rounded-full bg-[#7C3AED]" style={{ width: `${completion}%` }} />
                    </div>
                    <p className="mt-1.5 text-[10px] font-bold text-[#66739A]">{dailyTone.text}</p>
                </div>

                <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <FilterChip active={cityId === "all"} onClick={() => { setCityId("all"); setNeighborhood("all"); setCategory("all"); }}>Todas</FilterChip>
                    {cityOptions.map((item) => (
                        <FilterChip key={item.cityId} active={cityId === item.cityId} onClick={() => { setCityId(item.cityId); setNeighborhood("all"); setCategory("all"); }}>
                            {item.cityName}
                        </FilterChip>
                    ))}
                </div>

                <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <FilterChip active={neighborhood === "all"} onClick={() => { setNeighborhood("all"); setCategory("all"); }}>Barrios</FilterChip>
                    {neighborhoods.map((item) => (
                        <FilterChip key={item} active={neighborhood === item} onClick={() => { setNeighborhood(item); setCategory("all"); }}>{item}</FilterChip>
                    ))}
                </div>

                <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <FilterChip active={category === "all"} onClick={() => setCategory("all")}>Categorias</FilterChip>
                    {categories.map((item) => (
                        <FilterChip key={item} active={category === item} onClick={() => setCategory(item)}>{item}</FilterChip>
                    ))}
                </div>
            </div>

            <div className="flex-1 px-3 pb-4 pt-2 xl:px-6">
                {loading ? (
                    <LoadingState />
                ) : !assignments.length ? (
                    <EmptyState title="Sin base asignada" body="Cuando el administrador te asigne una ciudad, veras sus comercios aqui." />
                ) : !visible.length ? (
                    <EmptyState title="Sin comercios" body="No hay resultados para los filtros actuales." />
                ) : (
                    <div className="grid gap-2.5">
                        {visible.map((prospect) => (
                            <ProspectCard
                                key={prospect.id}
                                prospect={prospect}
                                touch={touchMap.get(prospect.id)}
                                copied={copiedId === prospect.id}
                                onWhatsApp={() => {
                                    setWaProspect(prospect);
                                    setCustomMessage("");
                                }}
                                onMaps={() => window.open(prospect.googleMapsLink || `https://maps.google.com/?q=${prospect.latitude},${prospect.longitude}`, "_blank")}
                                onCopy={() => copyProspect(prospect)}
                                onNote={() => {
                                    setNoteProspect(prospect);
                                    setNoteText(touchMap.get(prospect.id)?.note ?? "");
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {searchOpen ? (
                <BottomSheet onClose={() => setSearchOpen(false)}>
                    <h2 className="mb-3 text-[17px] font-black text-[#101936]">Buscar comercio</h2>
                    <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, telefono, direccion..." className="h-12 w-full rounded-[14px] border border-[#E8E7FB] px-3 text-[14px] font-bold outline-none focus:border-[#7C3AED]" />
                    <button type="button" onClick={() => setSearchOpen(false)} className="mt-3 h-11 w-full rounded-[14px] bg-[#7C3AED] text-[13px] font-black text-white">Aplicar</button>
                </BottomSheet>
            ) : null}

            {infoOpen ? (
                <BottomSheet onClose={() => setInfoOpen(false)}>
                    <h2 className="text-[17px] font-black text-[#101936]">Uso responsable</h2>
                    <div className="mt-3 space-y-2 text-[12px] font-semibold leading-relaxed text-[#66739A]">
                        <p>Esta base viene de informacion publica. Estos comercios todavia no pidieron contacto directo dentro de TrackGo.</p>
                        <p>El envio de mensajes frios es responsabilidad del vendedor. Para reducir riesgo de bloqueos en WhatsApp, evita textos repetidos en masa, personaliza cuando puedas y no insistas si no hay respuesta.</p>
                        <p>Recomendacion operativa: hasta 15 mensajes al dia es saludable, de 16 a 25 ya es zona de riesgo, y por encima de 25 conviene detener los envios por ese dia.</p>
                    </div>
                    <button type="button" onClick={() => setInfoOpen(false)} className="mt-4 h-11 w-full rounded-[14px] bg-[#7C3AED] text-[13px] font-black text-white">Entendido</button>
                </BottomSheet>
            ) : null}

            {waProspect ? (
                <BottomSheet onClose={() => setWaProspect(null)} tall>
                    <h2 className="text-[17px] font-black text-[#101936]">Enviar WhatsApp</h2>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739A]">{waProspect.name}</p>
                    <div className="mt-3 space-y-2">
                        {messageTemplates(waProspect.countryName, waProspect.name, userName).map((message, index) => (
                            <button key={message} type="button" onClick={() => openWhatsApp(waProspect, message)} className="w-full rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2.5 text-left text-[12px] font-semibold leading-relaxed text-[#344054] active:bg-[#f3f0ff]">
                                <span className="mb-1 block text-[10px] font-black uppercase text-[#7C3AED]">Mensaje {index + 1}</span>
                                {message}
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 rounded-[14px] border border-[#E8E7FB] bg-[#fbfaff] p-3">
                        <p className="mb-2 text-[11px] font-black text-[#101936]">Personalizado</p>
                        <textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} className="min-h-24 w-full rounded-[12px] border border-[#E8E7FB] p-3 text-[12px] font-semibold outline-none focus:border-[#7C3AED]" placeholder="Escribe tu mensaje..." />
                        <button type="button" disabled={!customMessage.trim()} onClick={() => openWhatsApp(waProspect, customMessage)} className="mt-2 h-10 w-full rounded-[13px] bg-[#7C3AED] text-[12px] font-black text-white disabled:opacity-50">
                            Enviar personalizado
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {noteProspect ? (
                <BottomSheet onClose={() => setNoteProspect(null)}>
                    <h2 className="text-[17px] font-black text-[#101936]">Nota</h2>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739A]">{noteProspect.name}</p>
                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} className="mt-3 min-h-28 w-full rounded-[14px] border border-[#E8E7FB] p-3 text-[13px] font-semibold outline-none focus:border-[#7C3AED]" placeholder="Ej: llamar manana, pidio valores..." />
                    <button type="button" onClick={saveNote} className="mt-3 h-11 w-full rounded-[14px] bg-[#7C3AED] text-[13px] font-black text-white">Guardar nota</button>
                </BottomSheet>
            ) : null}
        </div>
    );
}

function ProspectCard({
    prospect,
    touch,
    copied,
    onWhatsApp,
    onMaps,
    onCopy,
    onNote,
}: {
    prospect: CommercialDirectoryProspectDoc;
    touch?: CommercialDirectoryProspectTouchDoc;
    copied: boolean;
    onWhatsApp: () => void;
    onMaps: () => void;
    onCopy: () => void;
    onNote: () => void;
}) {
    return (
        <div className="overflow-hidden rounded-[18px] border border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]">
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-[#101936]">{prospect.name}</p>
                        <p className="truncate text-[11px] font-semibold text-[#66739A]">{prospect.categoryName} · {prospect.neighborhoodName}</p>
                    </div>
                    {touch?.contacted ? (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-black text-[#7C3AED]">Contactado</span>
                    ) : null}
                </div>
                <div className="mt-2 space-y-1">
                    {prospect.phone ? <InfoLine icon={<PhoneIcon />} text={prospect.phone} /> : null}
                    {prospect.address ? <InfoLine icon={<PinIcon />} text={prospect.address} /> : null}
                </div>
                {touch?.note ? (
                    <div className="mt-2 rounded-[10px] border border-violet-100 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#5B21FF]">
                        {touch.note}
                    </div>
                ) : null}
                <div className="mt-3 flex gap-1.5 border-t border-[#F2F0FF] pt-2.5">
                    <ActionBtn onClick={onWhatsApp} title={touch?.contacted ? "Enviado" : "WhatsApp"} tone={touch?.contacted ? "sent" : "green"}><WAIcon /></ActionBtn>
                    <ActionBtn onClick={onMaps} title="Maps" tone="blue"><MapsIcon /></ActionBtn>
                    <ActionBtn onClick={onCopy} title={copied ? "Copiado" : "Copiar"} tone={copied ? "sent" : "violet"}>{copied ? <CheckIcon /> : <CopyIcon />}</ActionBtn>
                    <ActionBtn onClick={onNote} title="Nota" tone="violet"><NoteIcon /></ActionBtn>
                </div>
            </div>
        </div>
    );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return <button type="button" onClick={onClick} className={["flex shrink-0 items-center rounded-full border px-3 py-1.5 text-[11px] font-black transition", active ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#E8E7FB] bg-white text-[#66739A]"].join(" ")}>{children}</button>;
}

function StatPill({ label, value, tone }: { label: string; value: string | number; tone: "green" | "yellow" | "red" | "violet" }) {
    const cls = {
        green: "border-emerald-100 bg-emerald-50 text-emerald-700",
        yellow: "border-yellow-100 bg-yellow-50 text-yellow-700",
        red: "border-red-100 bg-red-50 text-red-700",
        violet: "border-violet-100 bg-violet-50 text-[#7C3AED]",
    }[tone];
    return <div className={`rounded-[12px] border px-1.5 py-1.5 text-center ${cls}`}><div className="text-[15px] font-black">{value}</div><div className="mt-0.5 text-[9px] font-black leading-none opacity-70">{label}</div></div>;
}

function ActionBtn({ onClick, title, tone, children }: { onClick: () => void; title: string; tone: "green" | "blue" | "violet" | "sent"; children: React.ReactNode }) {
    const cls = {
        green: "border-emerald-200 bg-emerald-50 text-emerald-700",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
        violet: "border-violet-200 bg-violet-50 text-violet-700",
        sent: "border-[#6D28D9] bg-[#7C3AED] text-white shadow-[0_8px_18px_rgba(124,58,237,0.28)]",
    }[tone];
    return <button type="button" onClick={onClick} title={title} className={`flex h-8 w-8 items-center justify-center rounded-[11px] border transition active:opacity-70 ${cls}`}>{children}</button>;
}

function InfoLine({ icon, text }: { icon: React.ReactNode; text: string }) {
    return <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">{icon}<span className="truncate">{text}</span></div>;
}

function BottomSheet({ children, onClose, tall }: { children: React.ReactNode; onClose: () => void; tall?: boolean }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className={["relative w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 shadow-2xl xl:max-w-md xl:rounded-[24px] xl:pb-6", tall ? "max-h-[88vh]" : "max-h-[72vh]"].join(" ")}>
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E8E7FB] xl:hidden" />
                {children}
            </div>
        </div>
    );
}

function LoadingState() {
    return <div className="flex flex-col items-center justify-center py-20"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]"><svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3.1-6.8" /></svg></div><p className="mt-3 text-[13px] font-bold text-[#66739A]">Cargando base...</p></div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return <div className="flex flex-col items-center justify-center py-20 text-center"><div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]"><DatabaseIcon /></div><p className="text-[14px] font-black text-[#101936]">{title}</p><p className="mt-1 max-w-xs text-[12px] font-semibold text-[#98A2B3]">{body}</p></div>;
}

const ic = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
function SearchIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" {...ic}><path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.4a2 2 0 0 1-.5 2.1L8.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.4.7a2 2 0 0 1 1.7 2Z" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" {...ic} /></svg>; }
function WAIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z"/><path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z"/></svg>; }
function MapsIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>; }
function CopyIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M20 6 9 17l-5-5" /></svg>; }
function NoteIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>; }
function DatabaseIcon() { return <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#7C3AED]" {...ic}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>; }
