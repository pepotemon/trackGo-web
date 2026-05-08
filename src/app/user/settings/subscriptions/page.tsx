"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthProvider";
import { SUBSCRIPTION_PLANS } from "@/lib/subscriptionPlans";
import type { PixCheckoutResponse, SubscriptionCity, SubscriptionPlanId } from "@/types/subscriptions";

type Settings = {
    adsShare: number;
    cycleDays: number;
};

type PortalSubscription = {
    id: string;
    cityId?: string | null;
    city?: string | null;
    plan?: string | null;
    amount: number;
    adsBudget: number;
    status: string;
    endDate?: number | null;
};

type PortalCheckout = Omit<PixCheckoutResponse, "checkoutId"> & {
    id: string;
    cityId?: string | null;
    cityName?: string | null;
    amount: number;
    adsBudget: number;
    activationStatus: string;
    failureReason?: string | null;
    updatedAt?: number | null;
};

const visiblePlanIds = new Set<SubscriptionPlanId>(["base", "crecimiento"]);
const visiblePlans = SUBSCRIPTION_PLANS.filter((plan) => visiblePlanIds.has(plan.id));
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function UserSubscriptionsPage() {
    const { firebaseUser, profile, userPermissions } = useAuth();
    const [cities, setCities] = useState<SubscriptionCity[]>([]);
    const [settings, setSettings] = useState<Settings>({ adsShare: 0.5, cycleDays: 5 });
    const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([]);
    const [checkouts, setCheckouts] = useState<PortalCheckout[]>([]);
    const [selectedCityId, setSelectedCityId] = useState("");
    const [selectedPlan, setSelectedPlan] = useState<Exclude<SubscriptionPlanId, "custom" | "dominio">>("crecimiento");
    const [pix, setPix] = useState<PixCheckoutResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState("");
    const [copied, setCopied] = useState(false);

    const selectedPlanInfo = useMemo(
        () => visiblePlans.find((plan) => plan.id === selectedPlan) || visiblePlans[1] || visiblePlans[0],
        [selectedPlan],
    );
    const selectedAmount = selectedPlanInfo?.amount || 0;
    const operatingBase = Math.round(selectedAmount * settings.adsShare * 100) / 100;
    const estimatedClients = estimateClientRange(operatingBase);
    const selectedCity = useMemo(() => cities.find((city) => city.id === selectedCityId) || null, [cities, selectedCityId]);
    const availableCities = useMemo(() => cities.filter((city) => city.status === "available"), [cities]);
    const activeSubscription = useMemo(
        () => subscriptions.find((item) => item.status === "active" || item.status === "provisioning") || null,
        [subscriptions],
    );
    const pendingCheckout = useMemo(
        () => checkouts.find((item) => item.cityId === selectedCityId && item.status === "pending"),
        [checkouts, selectedCityId],
    );

    const loadData = useCallback(async () => {
        if (!firebaseUser) return;
        setLoading(true);
        setMessage("");

        try {
            const token = await firebaseUser.getIdToken();
            const response = await fetch("/api/subscriptions/me", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudieron cargar las suscripciones.");
            }

            const nextCities = (data.cities || []) as SubscriptionCity[];
            setCities(nextCities);
            setSettings(data.settings || { adsShare: 0.5, cycleDays: 5 });
            setSubscriptions(data.subscriptions || []);
            setCheckouts(data.checkouts || []);
            setSelectedCityId((current) => current || nextCities.find((city) => city.status === "available")?.id || "");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No se pudieron cargar las suscripciones.");
        } finally {
            setLoading(false);
        }
    }, [firebaseUser]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        if (pendingCheckout?.qrCode || pendingCheckout?.qrCodeBase64) {
            setPix({
                checkoutId: pendingCheckout.id,
                paymentId: pendingCheckout.paymentId,
                status: pendingCheckout.status,
                qrCode: pendingCheckout.qrCode,
                qrCodeBase64: pendingCheckout.qrCodeBase64,
                ticketUrl: pendingCheckout.ticketUrl,
                expiresAt: pendingCheckout.expiresAt,
            });
        }
    }, [pendingCheckout]);

    async function createPix() {
        if (!firebaseUser) return;
        if (!selectedCityId) {
            setMessage("Selecciona una ciudad disponible.");
            return;
        }

        setCreating(true);
        setMessage("");
        setPix(null);

        try {
            const token = await firebaseUser.getIdToken();
            const response = await fetch("/api/subscriptions/create-pix", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userId: firebaseUser.uid,
                    cityId: selectedCityId,
                    plan: selectedPlan,
                    email: firebaseUser.email || profile?.email,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudo generar el Pix.");
            }
            setPix(data.pix);
            await loadData();
            setMessage("Pix generado. Cuando el pago sea confirmado, tu acceso se activa automaticamente.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No se pudo generar el Pix.");
        } finally {
            setCreating(false);
        }
    }

    async function copyPixCode() {
        if (!pix?.qrCode) return;
        await navigator.clipboard.writeText(pix.qrCode);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
    }

    if (!userPermissions.canSeeSubscriptions) {
        return (
            <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaff_0%,#f5f1ff_58%,#ffffff_100%)] px-4 pb-24 pt-5 text-[#101936]">
                <section className="mx-auto max-w-md rounded-[28px] border border-[#e8e7fb] bg-white p-5 text-center shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                    <p className="text-[16px] font-black text-[#101936]">Sin permiso</p>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739a]">Tu usuario no tiene acceso a suscripciones.</p>
                </section>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaff_0%,#f5f1ff_56%,#ffffff_100%)] px-4 pb-24 pt-5 text-[#101936] xl:px-8">
            <section className="mx-auto max-w-4xl space-y-4">
                <header className="overflow-hidden rounded-[30px] border border-[#e8e7fb] bg-white p-4 shadow-[0_20px_54px_rgba(91,33,255,0.1)]">
                    <div className="flex items-start gap-3">
                        <AppIcon name="wallet" size="lg" tone="purple" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7c70ba]">Suscripciones</p>
                            <h1 className="text-[30px] font-black tracking-[-0.07em] text-[#101936]">Activa tu zona</h1>
                            <p className="mt-1 max-w-2xl text-[13px] font-semibold leading-snug text-[#66739a]">
                                Compra acceso temporal a oportunidades comerciales activas dentro de tu ciudad.
                            </p>
                        </div>
                        <Button type="button" variant="ghost" onClick={loadData} disabled={loading} aria-label="Actualizar">
                            <AppIcon name="refresh" plain className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <CycleStep day={`1-${settings.cycleDays}`} title="Recepcion activa" body="Recibes nuevos clientes listos para contactar." />
                        <CycleStep day={`+2`} title="Gestion" body="Trabajas los clientes recibidos y oportunidades disponibles." />
                        <CycleStep day="Var." title="Cantidad flexible" body="Puede variar por ciudad, demanda y actividad de la zona." />
                    </div>
                </header>

                {message ? (
                    <div className="rounded-2xl border border-[#ded8ff] bg-white px-4 py-3 text-[12px] font-bold text-[#4f46e5] shadow-sm">
                        {message}
                    </div>
                ) : null}

                {activeSubscription ? (
                    <section className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-4 shadow-[0_18px_46px_rgba(16,185,129,0.08)]">
                        <div className="flex items-start gap-3">
                            <AppIcon name="check" tone="green" />
                            <div className="min-w-0 flex-1">
                                <p className="text-[15px] font-black text-emerald-950">Acceso activo</p>
                                <p className="mt-1 text-[12px] font-bold text-emerald-800">
                                    {activeSubscription.city || activeSubscription.cityId} - {currency.format(activeSubscription.amount)}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                                    Termina: {activeSubscription.endDate ? dateTime.format(new Date(activeSubscription.endDate)) : "sin fecha"}
                                </p>
                            </div>
                        </div>
                    </section>
                ) : null}

                <section className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
                    <Panel title="Elige tu ciudad" subtitle={`${availableCities.length} disponibles de ${cities.length || 0}`}>
                        <div className="grid gap-2">
                            {loading ? <EmptyLine text="Cargando ciudades..." /> : null}
                            {!loading && cities.length === 0 ? <EmptyLine text="Todavia no hay ciudades disponibles." /> : null}
                            {cities.map((city) => {
                                const disabled = city.status !== "available";
                                const selected = selectedCityId === city.id;
                                return (
                                    <button
                                        key={city.id}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => setSelectedCityId(city.id)}
                                        className={[
                                            "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition",
                                            selected
                                                ? "border-[#8b5cf6] bg-[#f4f0ff] shadow-[0_10px_24px_rgba(91,33,255,0.12)]"
                                                : "border-[#edf0f6] bg-white",
                                            disabled ? "opacity-55" : "active:scale-[0.99]",
                                        ].join(" ")}
                                    >
                                        <span className={`h-3 w-3 rounded-full ${city.status === "available" ? "bg-emerald-500" : city.status === "reserved" ? "bg-amber-500" : "bg-rose-500"}`} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[14px] font-black">{city.name}</span>
                                            <span className="block truncate text-[11px] font-bold text-[#66739a]">
                                                {[city.state, city.country].filter(Boolean).join(" - ") || "Sin region"}
                                            </span>
                                        </span>
                                        <span className="rounded-full bg-[#f8f7ff] px-2 py-1 text-[10px] font-black uppercase text-[#6d5bd0]">
                                            {city.status === "available" ? "Disponible" : city.status === "reserved" ? "Reservada" : "Ocupada"}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </Panel>

                    <Panel title="Escoge tu acceso" subtitle="Dos opciones simples para empezar.">
                        <div className="grid gap-2">
                            {visiblePlans.map((plan) => (
                                <PlanCard
                                    key={plan.id}
                                    active={selectedPlan === plan.id}
                                    title={plan.name}
                                    amount={plan.amount}
                                    clients={estimateClientRange(Math.round(plan.amount * settings.adsShare * 100) / 100)}
                                    cycleDays={settings.cycleDays}
                                    featured={plan.id === "crecimiento"}
                                    onClick={() => setSelectedPlan(plan.id as Exclude<SubscriptionPlanId, "custom" | "dominio">)}
                                />
                            ))}
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <Benefit icon="users" title="Clientes diarios" body="Nuevas oportunidades durante los primeros 5 dias." />
                            <Benefit icon="plus" title="Disponibles" body="Oportunidades adicionales que puedes tomar manualmente." />
                            <Benefit icon="map" title="Mapa" body="Visualiza zonas con mayor actividad comercial." />
                            <Benefit icon="clock" title="Proximamente" body="Comercios por ciudad, barrio y categoria." />
                        </div>
                    </Panel>
                </section>

                <section className="rounded-[28px] border border-[#ded8ff] bg-[#fbfaff] p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <Summary label="Pago" value={currency.format(selectedAmount)} />
                        <Summary label="Operacion" value={`${settings.cycleDays}+2 dias`} />
                        <Summary label="Clientes" value={estimatedClients} />
                    </div>
                    <p className="mt-3 text-center text-[11px] font-bold leading-snug text-[#66739a]">
                        Ciudad: {selectedCity?.name || "sin seleccionar"}. La cantidad real puede variar por ciudad, demanda y actividad de la zona.
                    </p>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={createPix}
                        disabled={creating || Boolean(pendingCheckout) || !selectedCityId || selectedAmount < 100}
                        className="mt-4 w-full !min-h-12 !rounded-2xl"
                    >
                        {creating ? "Generando Pix..." : pendingCheckout ? "Pix pendiente" : "Generar Pix"}
                    </Button>
                    {pendingCheckout ? (
                        <p className="mt-2 text-center text-[11px] font-bold text-amber-700">
                            Ya tienes un Pix pendiente para esta ciudad. Usa el QR de abajo o espera a que la reserva expire.
                        </p>
                    ) : null}
                </section>

                {pix ? (
                    <section className="rounded-[28px] border border-[#d8b4fe] bg-white p-4 text-center shadow-[0_18px_46px_rgba(91,33,255,0.12)]">
                        <p className="text-[15px] font-black">Pix listo</p>
                        <p className="mt-1 text-[11px] font-bold text-[#66739a]">
                            Cuando el pago sea confirmado, tu ciudad queda activa automaticamente.
                        </p>
                        {pix.qrCodeBase64 ? (
                            <img
                                alt="QR Pix"
                                src={`data:image/png;base64,${pix.qrCodeBase64}`}
                                className="mx-auto mt-4 h-56 w-56 rounded-2xl border border-[#edf0f6] bg-white p-2"
                            />
                        ) : null}
                        <Button type="button" variant="secondary" onClick={copyPixCode} className="mt-3 w-full !rounded-2xl">
                            {copied ? "Copiado" : "Copiar codigo Pix"}
                        </Button>
                        {pix.ticketUrl ? (
                            <a
                                href={pix.ticketUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 block rounded-2xl border border-[#ded8ff] bg-[#f8f7ff] px-3 py-3 text-[12px] font-black text-[#4f46e5]"
                            >
                                Abrir pago
                            </a>
                        ) : null}
                    </section>
                ) : null}
            </section>
        </main>
    );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
    return (
        <section className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                    <p className="text-[15px] font-black text-[#101936]">{title}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-[#66739a]">{subtitle}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

function PlanCard({
    active,
    featured,
    title,
    amount,
    clients,
    cycleDays,
    onClick,
}: {
    active: boolean;
    featured?: boolean;
    title: string;
    amount: number;
    clients: string;
    cycleDays: number;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "relative overflow-hidden rounded-[24px] border p-4 text-left transition active:scale-[0.99]",
                active ? "border-[#8b5cf6] bg-[#f4f0ff] shadow-[0_14px_30px_rgba(91,33,255,0.16)]" : "border-[#edf0f6] bg-white",
            ].join(" ")}
        >
            {featured ? (
                <span className="absolute right-3 top-3 rounded-full bg-[#6d28d9] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white">
                    Recomendado
                </span>
            ) : null}
            <div className="pr-24">
                <p className="text-[17px] font-black text-[#101936]">{title}</p>
                <p className="mt-1 text-[11px] font-bold leading-snug text-[#66739a]">{clients} clientes estimados por ciclo.</p>
            </div>
            <p className="mt-4 text-[28px] font-black tracking-[-0.06em] text-[#4f46e5]">{currency.format(amount)}</p>
            <p className="mt-1 text-[11px] font-bold text-[#66739a]">{cycleDays} dias de recepcion activa + 2 dias de gestion.</p>
        </button>
    );
}

function CycleStep({ day, title, body }: { day: string; title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-[#ede9fe] bg-[#fbfaff] p-3">
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-[#6d28d9] ring-1 ring-[#ded8ff]">{day}</span>
            <p className="mt-2 text-[12px] font-black text-[#101936]">{title}</p>
            <p className="mt-0.5 text-[11px] font-semibold leading-snug text-[#66739a]">{body}</p>
        </div>
    );
}

function Benefit({ icon, title, body }: { icon: "users" | "plus" | "map" | "clock"; title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-[#edf0f6] bg-[#fbfaff] p-3">
            <div className="flex items-start gap-2">
                <AppIcon name={icon} size="sm" tone={icon === "map" ? "blue" : icon === "clock" ? "orange" : "purple"} />
                <div>
                    <p className="text-[12px] font-black text-[#101936]">{title}</p>
                    <p className="mt-0.5 text-[11px] font-semibold leading-snug text-[#66739a]">{body}</p>
                </div>
            </div>
        </div>
    );
}

function Summary({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-[#e8e7fb] bg-white px-2 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#7c70ba]">{label}</p>
            <p className="mt-1 truncate text-[13px] font-black text-[#101936]">{value}</p>
        </div>
    );
}

function EmptyLine({ text }: { text: string }) {
    return <p className="rounded-2xl bg-[#f8f7ff] p-4 text-[12px] font-bold text-[#66739a]">{text}</p>;
}

function estimateClientRange(operatingBase: number) {
    if (operatingBase <= 0) return "0-0";
    if (operatingBase <= 100) return "10-25";
    if (operatingBase <= 150) return "10-35";
    if (operatingBase <= 200) return "20-50";
    const min = Math.round(operatingBase * 0.115);
    const max = Math.round(operatingBase * 0.27);
    return `${min}-${max}`;
}
