"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthProvider";
import { estimateLeadRange, SUBSCRIPTION_PLANS } from "@/lib/subscriptionPlans";
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

const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
});

export default function UserSubscriptionsPage() {
    const { firebaseUser, profile, userPermissions } = useAuth();
    const [cities, setCities] = useState<SubscriptionCity[]>([]);
    const [settings, setSettings] = useState<Settings>({ adsShare: 0.5, cycleDays: 5 });
    const [subscriptions, setSubscriptions] = useState<PortalSubscription[]>([]);
    const [checkouts, setCheckouts] = useState<PortalCheckout[]>([]);
    const [selectedCityId, setSelectedCityId] = useState("");
    const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanId>("crecimiento");
    const [customAmount, setCustomAmount] = useState(350);
    const [pix, setPix] = useState<PixCheckoutResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState("");
    const [copied, setCopied] = useState(false);

    const selectedAmount = selectedPlan === "custom"
        ? customAmount
        : SUBSCRIPTION_PLANS.find((plan) => plan.id === selectedPlan)?.amount || 0;
    const adsBudget = Math.round(selectedAmount * settings.adsShare * 100) / 100;
    const estimatedLeads = estimateLeadRange(adsBudget);

    const selectedCity = useMemo(
        () => cities.find((city) => city.id === selectedCityId) || null,
        [cities, selectedCityId],
    );
    const activeSubscription = useMemo(
        () => subscriptions.find((item) => item.status === "active" || item.status === "provisioning") || null,
        [subscriptions],
    );
    const pendingCheckout = useMemo(
        () => checkouts.find((item) => item.cityId === selectedCityId && item.status === "pending"),
        [checkouts, selectedCityId],
    );

    const availableCities = useMemo(
        () => cities.filter((city) => city.status === "available"),
        [cities],
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
                    amount: selectedPlan === "custom" ? customAmount : undefined,
                    email: firebaseUser.email || profile?.email,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudo generar el Pix.");
            }
            setPix(data.pix);
            await loadData();
            setMessage("Pix generado. La campana se activa automaticamente cuando Mercado Pago confirme el pago.");
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

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaff_0%,#f5f1ff_55%,#ffffff_100%)] px-4 pb-24 pt-5 text-[#101936] xl:px-8">
            {!userPermissions.canSeeSubscriptions ? (
                <section className="mx-auto max-w-md rounded-[28px] border border-[#e8e7fb] bg-white p-5 text-center shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                    <p className="text-[16px] font-black text-[#101936]">Sin permiso</p>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739a]">
                        Tu usuario no tiene acceso a suscripciones.
                    </p>
                </section>
            ) : (
            <section className="mx-auto max-w-3xl space-y-4">
                <header className="space-y-2">
                    <div className="flex items-center gap-3">
                        <AppIcon name="wallet" size="lg" tone="purple" />
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7c70ba]">
                                Suscripciones
                            </p>
                            <h1 className="text-[28px] font-black tracking-[-0.06em]">Activar ciudad</h1>
                        </div>
                    </div>
                    <p className="text-[13px] font-semibold leading-snug text-[#66739a]">
                        Elige una ciudad disponible, paga por Pix y TrackGo activa la campana por {settings.cycleDays} dias.
                    </p>
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
                                <p className="text-[15px] font-black text-emerald-950">Campana activa</p>
                                <p className="mt-1 text-[12px] font-bold text-emerald-800">
                                    {activeSubscription.city || activeSubscription.cityId} · {currency.format(activeSubscription.amount)}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                                    Termina: {activeSubscription.endDate ? new Date(activeSubscription.endDate).toLocaleString("es") : "sin fecha"}
                                </p>
                            </div>
                        </div>
                    </section>
                ) : null}

                <section className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <p className="text-[15px] font-black">Ciudades</p>
                            <p className="text-[11px] font-bold text-[#66739a]">
                                {availableCities.length} disponibles de {cities.length || 0}
                            </p>
                        </div>
                        <Button type="button" variant="ghost" onClick={loadData} disabled={loading} className="!min-h-9">
                            <AppIcon name="refresh" plain className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="grid gap-2">
                        {loading ? (
                            <p className="rounded-2xl bg-[#f8f7ff] p-4 text-[12px] font-bold text-[#66739a]">
                                Cargando ciudades...
                            </p>
                        ) : null}
                        {!loading && cities.length === 0 ? (
                            <p className="rounded-2xl bg-[#f8f7ff] p-4 text-[12px] font-bold text-[#66739a]">
                                Todavia no hay ciudades configuradas.
                            </p>
                        ) : null}
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
                                    <span
                                        className={[
                                            "h-3 w-3 rounded-full",
                                            city.status === "available" ? "bg-emerald-500" : city.status === "reserved" ? "bg-amber-500" : "bg-rose-500",
                                        ].join(" ")}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[14px] font-black">{city.name}</span>
                                        <span className="block text-[11px] font-bold text-[#66739a]">
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
                </section>

                <section className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                    <div className="mb-3">
                        <p className="text-[15px] font-black">Plan</p>
                        <p className="text-[11px] font-bold text-[#66739a]">
                            Estimacion variable segun ciudad, audiencia, competencia y calidad del anuncio.
                        </p>
                    </div>

                    <div className="grid gap-2">
                        {SUBSCRIPTION_PLANS.map((plan) => (
                            <PlanButton
                                key={plan.id}
                                active={selectedPlan === plan.id}
                                title={plan.name}
                                amount={plan.amount}
                                leads={estimateLeadRange(Math.round(plan.amount * settings.adsShare * 100) / 100)}
                                onClick={() => setSelectedPlan(plan.id)}
                            />
                        ))}
                        <PlanButton
                            active={selectedPlan === "custom"}
                            title="Personalizado"
                            amount={customAmount}
                            leads={estimatedLeads}
                            onClick={() => setSelectedPlan("custom")}
                        />
                    </div>

                    {selectedPlan === "custom" ? (
                        <label className="mt-3 block">
                            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">
                                Valor personalizado
                            </span>
                            <input
                                type="number"
                                min={100}
                                step={10}
                                value={customAmount}
                                onChange={(event) => setCustomAmount(Number(event.target.value))}
                                className="mt-1 h-12 w-full rounded-2xl border border-[#ded8ff] bg-white px-4 text-[15px] font-black text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-4 focus:ring-[#ede9fe]"
                            />
                        </label>
                    ) : null}
                </section>

                <section className="rounded-[28px] border border-[#ded8ff] bg-[#fbfaff] p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <Summary label="Pago" value={currency.format(selectedAmount)} />
                        <Summary label="Anuncios" value={currency.format(adsBudget)} />
                        <Summary label="Leads" value={estimatedLeads} />
                    </div>
                    <p className="mt-3 text-center text-[11px] font-bold text-[#66739a]">
                        Ciudad: {selectedCity?.name || "sin seleccionar"} · Ciclo: {settings.cycleDays} dias
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
                            Al aprobarse el pago, TrackGo activa la campana automaticamente.
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
            )}
        </main>
    );
}

function PlanButton({
    active,
    title,
    amount,
    leads,
    onClick,
}: {
    active: boolean;
    title: string;
    amount: number;
    leads: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition active:scale-[0.99]",
                active
                    ? "border-[#8b5cf6] bg-[#f4f0ff] shadow-[0_10px_24px_rgba(91,33,255,0.12)]"
                    : "border-[#edf0f6] bg-white",
            ].join(" ")}
        >
            <span>
                <span className="block text-[14px] font-black text-[#101936]">{title}</span>
                <span className="mt-0.5 block text-[11px] font-bold text-[#66739a]">{leads} clientes estimados</span>
            </span>
            <span className="text-[14px] font-black text-[#4f46e5]">{currency.format(amount)}</span>
        </button>
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
