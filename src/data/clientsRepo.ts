import { collection, doc, getDoc, getDocs, limit, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DailyEventDoc } from "@/types/accounting";

export type ClientOperationalStatus = "pending" | "visited" | "rejected";
export type ClientRejectedReason =
    | "clavo"
    | "localizacion"
    | "zona_riesgosa"
    | "ingresos_insuficientes"
    | "muy_endeudado"
    | "informacion_dudosa"
    | "no_le_interesa"
    | "no_estaba_cerrado"
    | "fuera_de_ruta"
    | "otro";

function safeType(value: unknown): DailyEventDoc["type"] {
    if (value === "visited" || value === "rejected" || value === "pending") return value;
    return "pending";
}

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stripUndefined(input: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    );
}

function dayKeyFromMs(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function validRejectedReason(value: string): ClientRejectedReason {
    const reasons: ClientRejectedReason[] = [
        "clavo",
        "localizacion",
        "zona_riesgosa",
        "ingresos_insuficientes",
        "muy_endeudado",
        "informacion_dudosa",
        "no_le_interesa",
        "no_estaba_cerrado",
        "fuera_de_ruta",
        "otro",
    ];

    return reasons.includes(value as ClientRejectedReason)
        ? (value as ClientRejectedReason)
        : "otro";
}

export async function listClientDailyEvents(clientId: string): Promise<DailyEventDoc[]> {
    const cleanId = clientId.trim();
    if (!cleanId) return [];

    const snap = await getDocs(
        query(
            collection(db, "dailyEvents"),
            where("clientId", "==", cleanId),
            limit(80)
        )
    );

    return snap.docs
        .map((docSnap) => {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                type: safeType(data.type),
                userId: text(data.userId),
                clientId: text(data.clientId) || cleanId,
                createdAt: safeNumber(data.createdAt, 0),
                dayKey: text(data.dayKey),
                phone: text(data.phone),
                name: text(data.name),
                business: text(data.business),
                address: text(data.address),
                ratePerVisitSnapshot: safeNumber(data.ratePerVisitSnapshot, undefined),
                billingModeSnapshot:
                    data.billingModeSnapshot === "weekly_subscription" ? "weekly_subscription" : "per_visit",
                amountSnapshot: safeNumber(data.amountSnapshot, undefined),
                rateApplied: safeNumber(data.rateApplied, undefined),
                amount: safeNumber(data.amount, undefined),
            } satisfies DailyEventDoc;
        })
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export async function updateClientOperationalStatus(input: {
    clientId: string;
    status: ClientOperationalStatus;
    actorId: string;
    userId: string;
    rejectedReason?: ClientRejectedReason | string | null;
    rejectedReasonText?: string | null;
    snapshot?: {
        phone?: string;
        name?: string;
        business?: string;
        address?: string;
        mapsUrl?: string;
    };
}) {
    const clientId = input.clientId.trim();
    const actorId = input.actorId.trim();
    const userId = input.userId.trim() || actorId;

    if (!clientId) throw new Error("Cliente invalido.");
    if (!actorId) throw new Error("No hay usuario autenticado.");
    if (!userId) throw new Error("El cliente no tiene usuario asignado.");

    const now = Date.now();
    const dayKey = dayKeyFromMs(now);
    const normalizedReason =
        input.status === "rejected"
            ? validRejectedReason(String(input.rejectedReason || "otro"))
            : null;
    const rejectedReasonText =
        input.status === "rejected"
            ? String(input.rejectedReasonText ?? "").trim() || null
            : null;

    let rateApplied: number | null = null;
    let amount: number | null = null;

    if (input.status === "visited") {
        const userSnap = await getDoc(doc(db, "users", userId));
        const userData = userSnap.exists() ? userSnap.data() : {};
        const rate = safeNumber(userData.ratePerVisit, 0);
        rateApplied = rate;
        amount = rate;
    }

    const clientPatch =
        input.status === "pending"
            ? {
                status: "pending",
                statusBy: null,
                statusAt: null,
                rejectedReason: null,
                rejectedReasonText: null,
                note: null,
                updatedAt: now,
            }
            : input.status === "visited"
                ? {
                    status: "visited",
                    statusBy: actorId,
                    statusAt: now,
                    rejectedReason: null,
                    rejectedReasonText: null,
                    note: null,
                    updatedAt: now,
                }
                : {
                    status: "rejected",
                    statusBy: actorId,
                    statusAt: now,
                    rejectedReason: normalizedReason,
                    rejectedReasonText: normalizedReason === "otro" ? rejectedReasonText : null,
                    note: normalizedReason === "otro" ? rejectedReasonText : null,
                    updatedAt: now,
                };

    const event = stripUndefined({
        type: input.status,
        userId,
        clientId,
        phone: input.snapshot?.phone,
        name: input.snapshot?.name,
        business: input.snapshot?.business,
        address: input.snapshot?.address,
        mapsUrl: input.snapshot?.mapsUrl,
        rateApplied: input.status === "visited" ? rateApplied : null,
        amount: input.status === "visited" ? amount : null,
        rejectedReason: input.status === "rejected" ? normalizedReason : null,
        rejectedReasonText:
            input.status === "rejected" && normalizedReason === "otro"
                ? rejectedReasonText
                : null,
        note: input.status === "rejected" ? rejectedReasonText : null,
        createdAt: now,
        dayKey,
    });

    const batch = writeBatch(db);
    batch.update(doc(db, "clients", clientId), stripUndefined(clientPatch));
    batch.set(doc(db, "dailyEvents", `${dayKey}_${clientId}`), event, { merge: true });
    await batch.commit();
}
