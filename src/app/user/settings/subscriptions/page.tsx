"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppIcon, type AppIconName, type AppIconTone } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/features/auth/AuthProvider";
import { SUBSCRIPTION_PLANS } from "@/lib/subscriptionPlans";
import type { SubscriptionCity, SubscriptionPlanId } from "@/types/subscriptions";

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
    startDate?: number | null;
    endDate?: number | null;
};

type PortalCheckout = {
    id: string;
    cityId?: string | null;
    cityName?: string | null;
    plan?: string | null;
    amount: number;
    adsBudget: number;
    paymentId: string;
    status: string;
    activationStatus: string;
    qrCode: string;
    qrCodeBase64: string;
    ticketUrl?: string | null;
    expiresAt?: string | null;
    failureReason?: string | null;
    createdAt?: number | null;
    updatedAt?: number | null;
};

const FEATURE_CARDS: Array<{
    id: string;
    icon: AppIconName;
    tone: AppIconTone;
    title: string;
    badge: string;
    detail: string;
}> = [
    {
        id: "reception",
        icon: "lead",
        tone: "green",
        title: "Recepcion activa",
        badge: "Clientes asignados",
        detail:
            "Recibes clientes asignados directamente a ti — personas reales que ya fueron contactadas, estan interesadas en el servicio y esperan ser atendidas por un profesional como tu. No buscas, no filtras: llegan listos para cerrar.",
    },
    {
        id: "management",
        icon: "activity",
        tone: "blue",
        title: "Gestion",
        badge: "Potenciales incluidos",
        detail:
            "Mas alla de los asignados, accedes a un panel de clientes potenciales: personas que ya mostraron interes en el servicio y estan esperando ser contactadas. Tu decides cuando y como, extendiendo tu alcance mucho mas alla de la recepcion activa.",
    },
    {
        id: "flexibility",
        icon: "location",
        tone: "orange",
        title: "Flexibilidad",
        badge: "Garantia minima",
        detail:
            "La cantidad de clientes asignados varia por ciudad, demanda y actividad de la zona. TrackGo se compromete y certifica en gestionar los clientes minimos prometidos para tu ciclo. Tu inversion siempre tiene respaldo.",
    },
    {
        id: "database",
        icon: "search",
        tone: "purple",
        title: "Base de datos",
        badge: "Acceso exclusivo",
        detail:
            "TrackGo administra una base activa de comercios de distintos tipos, barrios y categorias, adaptada a tu ciudad asignada. Trabajamos continuamente para fortalecer esta base y optimizar la adquisicion de clientes en todas las dimensiones posibles — para que siempre tengas nuevas oportunidades.",
    },
];

const visiblePlanIds = new Set<SubscriptionPlanId>(["base", "crecimiento"]);
const visiblePlans = SUBSCRIPTION_PLANS.filter((plan) => visiblePlanIds.has(plan.id));
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" });

export default function UserSubscriptionsPage() {
    const { firebaseUser, profile, userPermissions } = useAuth();
    const [cities, setCities] = useState<SubscriptionCity[]>([]);
    const [settings, setSettings] = useState<Settings>({ adsShare: 0.5, cycleDays: 5 });
    const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([]);
    const [checkouts, setCheckouts] = useState<PortalCheckout[]>([]);
    const [selectedCityId, setSelectedCityId] = useState("");
    const [selectedPlan, setSelectedPlan] = useState<Exclude<SubscriptionPlanId, "dominio">>("crecimiento");
    const [customAmount, setCustomAmount] = useState(500);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState("");
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [activeFeature, setActiveFeature] = useState<string | null>(null);

    const selectedPlanInfo = useMemo(
        () => visiblePlans.find((plan) => plan.id === selectedPlan) || null,
        [selectedPlan],
    );
    const selectedAmount = selectedPlan === "custom" ? customAmount : selectedPlanInfo?.amount || 0;
    const operatingBase = Math.round(selectedAmount * settings.adsShare * 100) / 100;
    const estimatedClients = estimateClientRange(operatingBase);
    const selectedCity = useMemo(() => cities.find((city) => city.id === selectedCityId) || null, [cities, selectedCityId]);
    const availableCities = useMemo(() => cities.filter((city) => city.status === "available"), [cities]);

    const activeSubscription = useMemo(
        () => subscriptions.find((item) => item.status === "active") || null,
        [subscriptions],
    );
    const provisioningSubscription = useMemo(
        () => subscriptions.find((item) => item.status === "provisioning") || null,
        [subscriptions],
    );
    const failedActivationSub = useMemo(
        () => subscriptions.find((item) => item.status === "payment_approved_meta_failed") || null,
        [subscriptions],
    );
    const pendingCheckout = useMemo(
        () => checkouts.find((item) => item.cityId === selectedCityId && item.status === "pending"),
        [checkouts, selectedCityId],
    );
    const activeCheckouts = useMemo(
        () => checkouts.filter((item) =>
            item.status === "pending" ||
            (item.status === "approved" && item.activationStatus !== "active")
        ),
        [checkouts],
    );
    const historicalSubscriptions = useMemo(
        () => subscriptions.filter((item) => ["expired", "expiration_failed", "released"].includes(item.status)),
        [subscriptions],
    );
    const historicalCheckouts = useMemo(
        () => checkouts.filter((item) => item.status === "failed" || item.status === "expired"),
        [checkouts],
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
            setSelectedCityId((current) => {
                if (current && nextCities.some((city) => city.id === current)) return current;
                return nextCities.find((city) => city.status === "available")?.id || "";
            });
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No se pudieron cargar las suscripciones.");
        } finally {
            setLoading(false);
        }
    }, [firebaseUser]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    function requestPixConfirmation() {
        if (!selectedCityId) {
            setMessage("Selecciona una ciudad disponible dentro de tu cobertura.");
            return;
        }
        if (selectedAmount < 300) {
            setMessage("El valor minimo para presupuesto personalizado es R$300.");
            return;
        }
        setConfirmOpen(true);
    }

    async function createPix() {
        if (!firebaseUser) return;
        if (!selectedCityId) {
            setMessage("Selecciona una ciudad disponible dentro de tu cobertura.");
            return;
        }

        setCreating(true);
        setMessage("");

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
                    amount: selectedPlan === "custom" ? customAmount : undefined,
                    email: firebaseUser.email || profile?.email,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudo generar el Pix.");
            }
            setConfirmOpen(false);
            await loadData();
            setMessage("Pix generado. Escanea el QR o copia el codigo para completar el pago.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No se pudo generar el Pix.");
        } finally {
            setCreating(false);
        }
    }

    async function copyPixCode(qrCode: string, id: string) {
        await navigator.clipboard.writeText(qrCode);
        setCopiedId(id);
        window.setTimeout(() => setCopiedId(null), 1400);
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
                {/* Header */}
                <header className="overflow-hidden rounded-[30px] border border-[#e8e7fb] bg-white p-4 shadow-[0_20px_54px_rgba(91,33,255,0.1)]">
                    <div className="flex items-start gap-3">
                        <AppIcon name="wallet" size="lg" tone="purple" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7c70ba]">Suscripciones</p>
                            <h1 className="text-[30px] font-black tracking-[-0.07em] text-[#101936]">Activa tu zona</h1>
                            <p className="mt-1 max-w-2xl text-[13px] font-semibold leading-snug text-[#66739a]">
                                Clientes reales, interesados y listos para cerrar — directamente en tu ciudad.
                            </p>
                        </div>
                        <Button type="button" variant="ghost" onClick={loadData} disabled={loading} aria-label="Actualizar">
                            <AppIcon name="refresh" plain className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {FEATURE_CARDS.map((card) => (
                            <FeatureCardButton
                                key={card.id}
                                card={card}
                                active={activeFeature === card.id}
                                onClick={() => setActiveFeature(activeFeature === card.id ? null : card.id)}
                            />
                        ))}
                    </div>

                    {activeFeature ? (
                        <FeatureDetail
                            key={activeFeature}
                            card={FEATURE_CARDS.find((c) => c.id === activeFeature)!}
                        />
                    ) : null}
                </header>

                {/* Message banner */}
                {message ? (
                    <div className="rounded-2xl border border-[#ded8ff] bg-white px-4 py-3 text-[12px] font-bold text-[#4f46e5] shadow-sm">
                        {message}
                    </div>
                ) : null}

                {/* Suscripcion activa */}
                {activeSubscription ? (
                    <section className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-4 shadow-[0_18px_46px_rgba(16,185,129,0.08)]">
                        <div className="flex items-start gap-3">
                            <AppIcon name="check" tone="green" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="text-[15px] font-black text-emerald-950">Acceso activo</p>
                                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Activa</span>
                                </div>
                                <p className="mt-1 text-[12px] font-bold text-emerald-800">
                                    {activeSubscription.city || activeSubscription.cityId} — {currency.format(activeSubscription.amount)}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                                    Termina: {activeSubscription.endDate ? dateTime.format(new Date(activeSubscription.endDate)) : "sin fecha"}
                                </p>
                            </div>
                        </div>
                    </section>
                ) : null}

                {/* Provisionando */}
                {provisioningSubscription ? (
                    <section className="rounded-[28px] border border-blue-100 bg-blue-50 p-4 shadow-[0_18px_46px_rgba(59,130,246,0.08)]">
                        <div className="flex items-start gap-3">
                            <AppIcon name="clock" tone="blue" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="text-[15px] font-black text-blue-950">Activando tu zona...</p>
                                    <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Procesando</span>
                                </div>
                                <p className="mt-1 text-[12px] font-bold text-blue-800">
                                    {provisioningSubscription.city || provisioningSubscription.cityId} — {currency.format(provisioningSubscription.amount)}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-blue-700">
                                    Pago confirmado. Estamos configurando tu campana, en breve tu acceso estara listo.
                                </p>
                            </div>
                        </div>
                    </section>
                ) : null}

                {/* Error de activacion de campana */}
                {failedActivationSub ? (
                    <section className="rounded-[28px] border border-rose-100 bg-rose-50 p-4 shadow-[0_18px_46px_rgba(244,63,94,0.08)]">
                        <div className="flex items-start gap-3">
                            <AppIcon name="alert" tone="red" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="text-[15px] font-black text-rose-950">Error al activar campana</p>
                                    <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Error</span>
                                </div>
                                <p className="mt-1 text-[12px] font-bold text-rose-800">
                                    {failedActivationSub.city || failedActivationSub.cityId} — {currency.format(failedActivationSub.amount)}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-rose-700">
                                    Tu pago fue recibido pero hubo un problema al activar la campana. Contacta soporte para resolverlo.
                                </p>
                            </div>
                        </div>
                    </section>
                ) : null}

                {/* Selector ciudad + plan */}
                <section className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
                    {/* Ciudad */}
                    <div className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                        <div className="mb-3">
                            <div className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#6d28d9] text-[10px] font-black text-white">1</span>
                                <p className="text-[15px] font-black text-[#101936]">Elige tu zona</p>
                            </div>
                            <p className="mt-0.5 pl-7 text-[11px] font-bold text-[#66739a]">
                                {availableCities.length > 0
                                    ? `${availableCities.length} zona${availableCities.length > 1 ? "s" : ""} disponible${availableCities.length > 1 ? "s" : ""} en tu cobertura`
                                    : "Sin zonas disponibles ahora"}
                            </p>
                        </div>
                        <div className="grid gap-2">
                            {loading ? <EmptyLine text="Cargando zonas..." /> : null}
                            {!loading && cities.length === 0 ? (
                                <EmptyLine text="No hay ciudades habilitadas para tu cobertura geografica." />
                            ) : null}
                            {cities.map((city) => {
                                const isAvailable = city.status === "available";
                                const selected = selectedCityId === city.id;
                                return (
                                    <button
                                        key={city.id}
                                        type="button"
                                        disabled={!isAvailable}
                                        onClick={() => setSelectedCityId(city.id)}
                                        className={[
                                            "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                                            selected
                                                ? "border-[#8b5cf6] bg-[#f4f0ff] shadow-[0_10px_24px_rgba(91,33,255,0.14)]"
                                                : isAvailable
                                                ? "border-emerald-100 bg-emerald-50/60 active:scale-[0.99] hover:border-emerald-200"
                                                : "border-[#f3f4f6] bg-[#fafafa] opacity-55",
                                        ].join(" ")}
                                    >
                                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                            isAvailable
                                                ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
                                                : city.status === "reserved"
                                                ? "bg-amber-400"
                                                : "bg-rose-400"
                                        }`} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[14px] font-black text-[#101936]">{city.name}</span>
                                            <span className="block truncate text-[11px] font-semibold text-[#66739a]">
                                                {[city.state, city.country].filter(Boolean).join(", ") || "Brasil"}
                                            </span>
                                        </span>
                                        {isAvailable ? (
                                            <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                                                Libre
                                            </span>
                                        ) : (
                                            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                                                {city.status === "reserved" ? "Reservada" : "Ocupada"}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Plan */}
                    <div className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                        <div className="mb-3">
                            <div className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#6d28d9] text-[10px] font-black text-white">2</span>
                                <p className="text-[15px] font-black text-[#101936]">Define tu inversion</p>
                            </div>
                            <p className="mt-0.5 pl-7 text-[11px] font-bold text-[#66739a]">
                                Mas inversion, mas presupuesto operativo, mas clientes.
                            </p>
                        </div>
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
                            <PlanCard
                                active={selectedPlan === "custom"}
                                title="Personalizado"
                                amount={customAmount}
                                clients={estimateClientRange(Math.round(customAmount * settings.adsShare * 100) / 100)}
                                cycleDays={settings.cycleDays}
                                onClick={() => setSelectedPlan("custom")}
                            />
                        </div>

                        {selectedPlan === "custom" ? (
                            <label className="mt-3 block rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-3">
                                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">Valor personalizado</span>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-[13px] font-black text-[#66739a]">R$</span>
                                    <input
                                        type="number"
                                        min={300}
                                        step={10}
                                        value={customAmount}
                                        onChange={(event) => setCustomAmount(Number(event.target.value))}
                                        className="h-11 min-w-0 flex-1 rounded-2xl border border-[#ded8ff] bg-white px-3 text-[16px] font-black text-[#101936] outline-none focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#ede9fe]"
                                    />
                                </div>
                                <p className="mt-1 text-[11px] font-bold text-[#66739a]">Minimo R$300. Los clientes estimados se ajustan automaticamente.</p>
                            </label>
                        ) : null}
                    </div>
                </section>

                {/* CTA — Resumen + boton */}
                <section className="overflow-hidden rounded-[28px] border border-[#c4b5fd] bg-white shadow-[0_22px_56px_rgba(91,33,255,0.14)]">
                    <div className="bg-gradient-to-r from-[#6d28d9] to-[#5b21b6] px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-purple-200">Tu zona</p>
                                <p className="mt-0.5 truncate text-[18px] font-black tracking-tight text-white">
                                    {selectedCity?.name || "Sin seleccionar"}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-purple-200">Clientes est.</p>
                                <p className="mt-0.5 text-[22px] font-black tracking-tight text-white">{estimatedClients}</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-4">
                        <div className="grid grid-cols-3 gap-2">
                            <Summary label="Inversion" value={currency.format(selectedAmount)} />
                            <Summary label="Ciclo" value={`${settings.cycleDays}+2 dias`} />
                            <Summary label="Clientes" value={estimatedClients} />
                        </div>

                        <Button
                            type="button"
                            variant="primary"
                            onClick={requestPixConfirmation}
                            disabled={creating || Boolean(pendingCheckout) || !selectedCityId || selectedAmount < 300}
                            className="mt-4 w-full !min-h-[52px] !rounded-2xl"
                        >
                            {creating
                                ? "Generando Pix..."
                                : pendingCheckout
                                ? "Pix pendiente para esta zona"
                                : !selectedCityId
                                ? "Elige una zona para continuar"
                                : "Activar mi zona"}
                        </Button>

                        {pendingCheckout ? (
                            <p className="mt-2 text-center text-[11px] font-bold text-amber-700">
                                Ya tienes un Pix pendiente para esta ciudad. Usa el QR de abajo o espera a que la reserva expire.
                            </p>
                        ) : (
                            <p className="mt-2 text-center text-[11px] font-semibold text-[#66739a]">
                                Sin contratos · Sin renovacion automatica · Pago unico via Pix
                            </p>
                        )}
                    </div>
                </section>

                {/* Pagos activos: pending, procesando, meta_failed, ciudad ocupada */}
                {activeCheckouts.length > 0 ? (
                    <section className="space-y-3">
                        <p className="px-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">Pagos activos</p>
                        {activeCheckouts.map((checkout) => (
                            <CheckoutCard
                                key={checkout.id}
                                checkout={checkout}
                                copiedId={copiedId}
                                onCopy={copyPixCode}
                            />
                        ))}
                    </section>
                ) : null}

                {/* Historial de compras */}
                {(historicalSubscriptions.length > 0 || historicalCheckouts.length > 0) ? (
                    <section className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.06)]">
                        <div className="mb-3 flex items-center gap-2">
                            <AppIcon name="history" size="sm" tone="slate" />
                            <p className="text-[15px] font-black text-[#101936]">Historial de compras</p>
                        </div>
                        <div className="space-y-2">
                            {historicalSubscriptions.map((sub) => (
                                <HistoryRow
                                    key={sub.id}
                                    cityName={sub.city || sub.cityId || "Ciudad desconocida"}
                                    amount={sub.amount}
                                    statusLabel={
                                        sub.status === "expired" ? "Expirada"
                                        : sub.status === "released" ? "Liberada"
                                        : "Error al expirar"
                                    }
                                    statusTone={sub.status === "expiration_failed" ? "red" : "neutral"}
                                    startDate={sub.startDate}
                                    endDate={sub.endDate}
                                />
                            ))}
                            {historicalCheckouts.map((checkout) => (
                                <HistoryRow
                                    key={checkout.id}
                                    cityName={checkout.cityName || checkout.cityId || "Ciudad desconocida"}
                                    amount={checkout.amount}
                                    statusLabel={checkout.status === "failed" ? "Pago fallido" : "Pix expirado"}
                                    statusTone={checkout.status === "failed" ? "red" : "neutral"}
                                    note={checkout.failureReason || undefined}
                                    startDate={checkout.createdAt}
                                />
                            ))}
                        </div>
                    </section>
                ) : null}

                <ConfirmPixModal
                    open={confirmOpen}
                    city={selectedCity}
                    planName={selectedPlan === "custom" ? "Personalizado" : selectedPlanInfo?.name || "Acceso"}
                    amount={selectedAmount}
                    clients={estimatedClients}
                    cycleDays={settings.cycleDays}
                    creating={creating}
                    onConfirm={createPix}
                    onClose={() => setConfirmOpen(false)}
                />
            </section>
        </main>
    );
}

// --- Checkout card: muestra el estado de un pago en curso ---

function CheckoutCard({
    checkout,
    copiedId,
    onCopy,
}: {
    checkout: PortalCheckout;
    copiedId: string | null;
    onCopy: (qrCode: string, id: string) => Promise<void>;
}) {
    const isPending = checkout.status === "pending";
    const isMetaFailed = checkout.status === "approved" && checkout.activationStatus === "meta_failed";
    const isCityOccupied = checkout.status === "approved" && checkout.activationStatus === "city_occupied";
    const isProcessing = checkout.status === "approved" && checkout.activationStatus === "processing";

    const cityLabel = checkout.cityName || checkout.cityId || "Ciudad";
    const amountLabel = currency.format(checkout.amount);
    const copied = copiedId === checkout.id;

    if (isPending) {
        return (
            <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 shadow-[0_18px_46px_rgba(245,158,11,0.08)]">
                <div className="flex items-start gap-3">
                    <AppIcon name="clock" tone="orange" />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-black text-amber-950">Pix pendiente</p>
                            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Aguardando pago</span>
                        </div>
                        <p className="mt-1 text-[12px] font-bold text-amber-800">{cityLabel} — {amountLabel}</p>
                        {checkout.expiresAt ? (
                            <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
                                Expira: {dateTime.format(new Date(checkout.expiresAt))}
                            </p>
                        ) : null}
                    </div>
                </div>
                {checkout.qrCodeBase64 ? (
                    <img
                        alt="QR Pix"
                        src={`data:image/png;base64,${checkout.qrCodeBase64}`}
                        className="mx-auto mt-4 h-56 w-56 rounded-2xl border border-amber-100 bg-white p-2"
                    />
                ) : null}
                {checkout.qrCode ? (
                    <Button type="button" variant="secondary" onClick={() => void onCopy(checkout.qrCode, checkout.id)} className="mt-3 w-full !rounded-2xl">
                        {copied ? "Copiado" : "Copiar codigo Pix"}
                    </Button>
                ) : null}
                {checkout.ticketUrl ? (
                    <a
                        href={checkout.ticketUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block rounded-2xl border border-amber-200 bg-white px-3 py-3 text-center text-[12px] font-black text-amber-800"
                    >
                        Abrir pago en MercadoPago
                    </a>
                ) : null}
            </div>
        );
    }

    if (isProcessing) {
        return (
            <div className="rounded-[28px] border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-start gap-3">
                    <AppIcon name="clock" tone="blue" />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-black text-blue-950">Procesando pago</p>
                            <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">En proceso</span>
                        </div>
                        <p className="mt-1 text-[12px] font-bold text-blue-800">{cityLabel} — {amountLabel}</p>
                        <p className="mt-1 text-[11px] font-semibold text-blue-700">Tu pago fue recibido y estamos activando tu acceso.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (isMetaFailed) {
        return (
            <div className="rounded-[28px] border border-rose-100 bg-rose-50 p-4">
                <div className="flex items-start gap-3">
                    <AppIcon name="alert" tone="red" />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-black text-rose-950">Error de activacion</p>
                            <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Error</span>
                        </div>
                        <p className="mt-1 text-[12px] font-bold text-rose-800">{cityLabel} — {amountLabel}</p>
                        <p className="mt-1 text-[11px] font-semibold text-rose-700">
                            Pago recibido pero hubo un error al activar la campana.{checkout.failureReason ? ` (${checkout.failureReason})` : ""} Contacta soporte.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (isCityOccupied) {
        return (
            <div className="rounded-[28px] border border-amber-100 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                    <AppIcon name="lock" tone="orange" />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-black text-amber-950">Ciudad ocupada</p>
                            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Ocupada</span>
                        </div>
                        <p className="mt-1 text-[12px] font-bold text-amber-800">{cityLabel} — {amountLabel}</p>
                        <p className="mt-1 text-[11px] font-semibold text-amber-700">
                            La ciudad fue ocupada mientras se procesaba tu pago. Contacta soporte para una solucion.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

// --- Fila de historial ---

function HistoryRow({
    cityName,
    amount,
    statusLabel,
    statusTone,
    note,
    startDate,
    endDate,
}: {
    cityName: string;
    amount: number;
    statusLabel: string;
    statusTone: "red" | "neutral";
    note?: string;
    startDate?: number | null;
    endDate?: number | null;
}) {
    return (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f0eef8] bg-[#faf9ff] px-3 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-black text-[#101936]">{cityName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusTone === "red" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                        {statusLabel}
                    </span>
                </div>
                {note ? <p className="mt-0.5 text-[11px] font-semibold text-[#66739a]">{note}</p> : null}
                {(startDate || endDate) ? (
                    <p className="mt-0.5 text-[11px] font-semibold text-[#66739a]">
                        {startDate ? dateOnly.format(new Date(startDate)) : ""}
                        {startDate && endDate ? " – " : ""}
                        {endDate ? dateOnly.format(new Date(endDate)) : ""}
                    </p>
                ) : null}
            </div>
            <span className="shrink-0 text-[14px] font-black text-[#4f46e5]">{currency.format(amount)}</span>
        </div>
    );
}

// --- Componentes de layout ---

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
                "overflow-hidden rounded-[24px] border text-left transition active:scale-[0.99]",
                active
                    ? "border-[#8b5cf6] bg-[#f4f0ff] shadow-[0_14px_30px_rgba(91,33,255,0.16)]"
                    : "border-[#edf0f6] bg-white hover:border-[#c4b5fd]",
            ].join(" ")}
        >
            {featured ? (
                <div className="bg-[#6d28d9] px-4 py-1.5 text-center">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-white">★ Recomendado</span>
                </div>
            ) : null}
            <div className="p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#66739a]">{title}</p>
                <div className="my-3 flex flex-col items-center py-1">
                    <p className="text-[46px] font-black leading-none tracking-[-0.04em] text-emerald-500">{clients}</p>
                    <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-600">clientes estimados</p>
                </div>
                <div className="flex items-baseline justify-between gap-2 border-t border-[#ede9fe] pt-3">
                    <p className="text-[22px] font-black tracking-[-0.04em] text-[#4f46e5]">{currency.format(amount)}</p>
                    <p className="text-[10px] font-bold text-[#66739a]">{cycleDays}+2 dias</p>
                </div>
            </div>
        </button>
    );
}

function FeatureCardButton({
    card,
    active,
    onClick,
}: {
    card: (typeof FEATURE_CARDS)[number];
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition-all active:scale-[0.97]",
                active
                    ? "border-[#8b5cf6] bg-[#f0ebff] shadow-[0_6px_18px_rgba(91,33,255,0.18)]"
                    : "border-[#ede9fe] bg-[#fbfaff] hover:border-[#c4b5fd]",
            ].join(" ")}
        >
            <AppIcon name={card.icon} size="sm" tone={card.tone} />
            <div className="min-w-0 w-full">
                <p className="text-[12px] font-black leading-tight text-[#101936]">{card.title}</p>
                <span className="mt-0.5 block truncate text-[10px] font-bold text-[#7c70ba]">{card.badge}</span>
            </div>
            <span className={`text-[9px] font-black uppercase tracking-wider transition-colors ${active ? "text-[#7c3aed]" : "text-[#c4b5fd]"}`}>
                {active ? "cerrar ▲" : "ver mas ▼"}
            </span>
        </button>
    );
}

function FeatureDetail({ card }: { card: (typeof FEATURE_CARDS)[number] }) {
    return (
        <div className="mt-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#5b21b6] via-[#6d28d9] to-[#4c1d95] p-4 shadow-[0_14px_36px_rgba(91,33,255,0.28)]">
            <div className="mb-3 flex items-center gap-2">
                <AppIcon name={card.icon} size="sm" tone={card.tone} />
                <p className="text-[14px] font-black text-white">{card.title}</p>
                <span className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white/80">
                    {card.badge}
                </span>
            </div>
            <p className="text-[13px] font-semibold leading-relaxed text-white/90">{card.detail}</p>
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

function ConfirmPixModal({
    open,
    city,
    planName,
    amount,
    clients,
    cycleDays,
    creating,
    onConfirm,
    onClose,
}: {
    open: boolean;
    city: SubscriptionCity | null;
    planName: string;
    amount: number;
    clients: string;
    cycleDays: number;
    creating: boolean;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const start = new Date();
    const receptionEnd = new Date(start);
    receptionEnd.setDate(receptionEnd.getDate() + cycleDays);
    const managementEnd = new Date(receptionEnd);
    managementEnd.setDate(managementEnd.getDate() + 2);

    return (
        <Modal open={open} title="Confirmar suscripcion" subtitle="Revisa los datos antes de generar el Pix." size="sm" onClose={onClose}>
            <div className="space-y-3">
                <div className="rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#7c70ba]">Resumen</p>
                    <div className="mt-3 grid gap-2 text-[12px] font-bold text-[#66739a]">
                        <ConfirmRow label="Ciudad" value={city ? [city.name, city.state].filter(Boolean).join(" - ") : "sin seleccionar"} />
                        <ConfirmRow label="Plan" value={`${planName} - ${currency.format(amount)}`} />
                        <ConfirmRow label="Clientes" value={`${clients} estimados`} />
                        <ConfirmRow label="Empieza" value={dateTime.format(start)} />
                        <ConfirmRow label="Recepcion hasta" value={dateTime.format(receptionEnd)} />
                        <ConfirmRow label="Gestion hasta" value={dateTime.format(managementEnd)} />
                    </div>
                </div>
                <p className="text-[11px] font-semibold leading-snug text-[#66739a]">
                    La cantidad puede variar por ciudad, demanda y actividad de la zona. El pago reserva la ciudad mientras el Pix este pendiente.
                </p>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button type="button" variant="primary" disabled={creating} onClick={onConfirm}>
                        {creating ? "Generando..." : "Generar pago QR"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
            <span>{label}</span>
            <span className="text-right font-black text-[#101936]">{value}</span>
        </div>
    );
}

function estimateClientRange(operatingBase: number) {
    if (operatingBase <= 0) return "0-0";
    if (operatingBase <= 100) return "10-25";
    if (operatingBase <= 150) return "10-35";
    if (operatingBase <= 200) return "25-50";
    const min = Math.round(operatingBase * 0.115);
    const max = Math.round(operatingBase * 0.27);
    return `${min}-${max}`;
}
