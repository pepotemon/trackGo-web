import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import type { AdminPermissions, UserBillingMode, UserDoc, UserGeoCoverage, UserGeoCoverageType, UserPermissions, UserRole, UserSharedAdmin } from "@/types/users";

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function cleanPhone(value?: string | null) {
    return String(value ?? "").replace(/\D+/g, "");
}

function cleanText(value: unknown) {
    return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
    return cleanText(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\s\-/]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function coverageType(value: unknown): UserGeoCoverageType {
    const type = normalizeText(value);
    if (type === "state" || type === "country") return type;
    return "city";
}

function buildCoverageId(item: Pick<UserGeoCoverage, "type" | "countryNormalized" | "stateNormalized" | "cityNormalized">) {
    return [
        item.type,
        item.countryNormalized || "all",
        item.stateNormalized || "all",
        item.cityNormalized || "all",
    ].join("__");
}

export function normalizeCoverageList(value: unknown): UserGeoCoverage[] {
    if (!Array.isArray(value)) return [];

    const now = Date.now();
    const seen = new Set<string>();
    const out: UserGeoCoverage[] = [];

    for (const raw of value) {
        const input = raw && typeof raw === "object" ? (raw as Partial<UserGeoCoverage>) : {};
        const type = coverageType(input.type);
        const countryLabel = cleanText(input.countryLabel || "Brasil");
        const countryNormalized = normalizeText(input.countryNormalized || input.countryLabel || "brasil");
        const stateLabel = cleanText(input.stateLabel);
        const stateNormalized = normalizeText(input.stateNormalized || input.stateLabel);
        const cityLabel = cleanText(input.cityLabel);
        const cityNormalized = normalizeText(input.cityNormalized || input.cityLabel);

        if (type === "country" && !countryNormalized) continue;
        if (type === "state" && !stateNormalized) continue;
        if (type === "city" && (!stateNormalized || !cityNormalized)) continue;

        const displayLabel =
            cleanText(input.displayLabel) ||
            (type === "country"
                ? countryLabel
                : type === "state"
                    ? `${stateLabel}, ${countryLabel}`
                    : `${cityLabel}, ${stateLabel}`);

        const normalized: UserGeoCoverage = {
            id: cleanText(input.id) || buildCoverageId({
                type,
                countryNormalized,
                stateNormalized,
                cityNormalized,
            }),
            type,
            countryLabel,
            countryNormalized,
            stateLabel,
            stateNormalized,
            cityLabel,
            cityNormalized,
            displayLabel,
            source: input.source || "manual",
            active: input.active !== false,
            createdAt: safeNumber(input.createdAt, now),
            updatedAt: now,
        };

        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        out.push(normalized);
    }

    return out;
}

function cleanUserPatch(patch: Partial<UserDoc>) {
    const data: Partial<UserDoc> & { updatedAt?: number } = { ...patch };

    if ("ratePerVisit" in data) {
        data.ratePerVisit = safeNumber(data.ratePerVisit, 0);
    }

    if ("weeklySubscriptionAmount" in data) {
        data.weeklySubscriptionAmount = safeNumber(data.weeklySubscriptionAmount, 0);
    }

    if ("weeklySubscriptionCost" in data) {
        data.weeklySubscriptionCost = safeNumber(data.weeklySubscriptionCost, 0);
    }

    if ("whatsappPhone" in data) {
        data.whatsappPhone = cleanPhone(data.whatsappPhone);
    }

    if ("geoCoverage" in data) {
        data.geoCoverage = normalizeCoverageList(data.geoCoverage);
        data.primaryGeoCoverageLabel = data.geoCoverage[0]?.displayLabel ?? null;
    }

    data.updatedAt = Date.now();

    return data;
}

export async function listAdminUsers(): Promise<UserDoc[]> {
    const q = query(
        collection(db, "users"),
        orderBy("createdAt", "desc"),
        limit(500)
    );

    const snap = await getDocs(q);

    return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<UserDoc, "id">),
    }));
}

type CreateManagedUserInput = {
    name: string;
    email: string;
    password: string;
    whatsappPhone?: string;
    role: UserRole;
    billingMode?: UserBillingMode;
    ratePerVisit?: number;
    weeklySubscriptionAmount?: number;
    weeklySubscriptionCost?: number;
    weeklySubscriptionActive?: boolean;
    autoAssignEnabled?: boolean;
    autoAssignDailyLimit?: number | null;
    geoCoverage?: UserGeoCoverage[];
};

type CreateManagedUserCallableInput = CreateManagedUserInput & {
    primaryGeoCoverageLabel?: string | null;
};

export async function createManagedUserProfile(input: CreateManagedUserInput): Promise<UserDoc> {
    const createManagedUser = httpsCallable<
        CreateManagedUserCallableInput,
        { uid?: string; email?: string }
    >(functions, "createManagedUser");

    const normalizedCoverage = normalizeCoverageList(input.geoCoverage);
    const result = await createManagedUser({
        ...input,
        email: cleanText(input.email).toLowerCase(),
        name: cleanText(input.name) || "Usuario",
        whatsappPhone: cleanPhone(input.whatsappPhone),
        geoCoverage: normalizedCoverage,
        primaryGeoCoverageLabel: normalizedCoverage[0]?.displayLabel ?? null,
    });

    const uid = cleanText(result.data?.uid);

    if (!uid) {
        throw new Error("La funcion no devolvio el UID del usuario creado.");
    }

    const snap = await getDoc(doc(db, "users", uid));

    if (!snap.exists()) {
        throw new Error("El usuario fue creado en Auth, pero no se encontro su perfil.");
    }

    return {
        id: snap.id,
        ...(snap.data() as Omit<UserDoc, "id">),
    };
}

export async function toggleUserActive(userId: string, active: boolean) {
    await updateDoc(doc(db, "users", userId), {
        active,
        updatedAt: Date.now(),
    });
}

export async function updateUserRole(userId: string, role: UserRole) {
    await updateDoc(doc(db, "users", userId), {
        role,
        updatedAt: Date.now(),
    });
}

export async function updateUserProfile(userId: string, patch: Partial<UserDoc>) {
    await updateDoc(doc(db, "users", userId), cleanUserPatch(patch));
}

export async function updateUserBilling(userId: string, patch: Partial<UserDoc>) {
    await updateDoc(doc(db, "users", userId), cleanUserPatch(patch));
}

export async function updateUserAutoAssign(
    userId: string,
    enabled: boolean,
    dailyLimit: number | null
) {
    await updateDoc(doc(db, "users", userId), {
        autoAssignEnabled: enabled,
        autoAssignDailyLimit: dailyLimit,
        updatedAt: Date.now(),
    });
}

export async function updateUserPermissions(userId: string, permissions: AdminPermissions) {
    await updateDoc(doc(db, "users", userId), {
        permissions,
        updatedAt: Date.now(),
    });
}

export async function updateUserVendorPermissions(userId: string, userPermissions: UserPermissions): Promise<void> {
    await updateDoc(doc(db, "users", userId), {
        userPermissions,
        updatedAt: Date.now(),
    });
}

export async function updateUserPhoneCodes(userId: string, phoneCodes: string[]): Promise<void> {
    await updateDoc(doc(db, "users", userId), {
        phoneCodes,
        updatedAt: Date.now(),
    });
}

export async function updateUserSharedWith(userId: string, sharedWith: UserSharedAdmin[]) {
    await updateDoc(doc(db, "users", userId), {
        sharedWith,
        updatedAt: Date.now(),
    });
}

export async function updateUserGeoCoverage(
    userId: string,
    coverage: UserGeoCoverage[]
) {
    const normalized = normalizeCoverageList(coverage);

    await updateDoc(doc(db, "users", userId), {
        geoCoverage: normalized,
        primaryGeoCoverageLabel: normalized[0]?.displayLabel ?? null,
        updatedAt: Date.now(),
    });

    return normalized;
}
