"use client";

import {
    browserLocalPersistence,
    onAuthStateChanged,
    setPersistence,
    signInWithEmailAndPassword,
    signOut,
    type User,
} from "firebase/auth";
import { doc, getDoc, getDocFromCache, type DocumentSnapshot } from "firebase/firestore";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { auth, db } from "@/lib/firebase";
import type { AdminPermissions, UserPermissions } from "@/types/users";

const COUNTRY_PHONE_CODES: Record<string, string> = {
    panama: "507",
    guatemala: "502",
    el_salvador: "503",
    honduras: "504",
    nicaragua: "505",
    costa_rica: "506",
    republica_dominicana: "509",
    ecuador: "593",
    bolivia: "591",
    paraguay: "595",
    uruguay: "598",
};

function normalizeCountryKey(value: unknown) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\s\-/]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function resolvePhoneCodes(data: Record<string, unknown>) {
    const codes = new Set(
        (Array.isArray(data.phoneCodes) ? data.phoneCodes : [])
            .map((code) => String(code ?? "").replace(/\D+/g, ""))
            .filter(Boolean)
    );

    const coverage = Array.isArray(data.geoCoverage) ? data.geoCoverage : [];
    for (const raw of coverage) {
        const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const country = normalizeCountryKey(item.countryNormalized || item.countryLabel);
        const code = COUNTRY_PHONE_CODES[country];
        if (code) codes.add(code);
    }

    return Array.from(codes);
}

function profileFromSnapshot(id: string, data: Record<string, unknown>, authEmail?: string | null): AppUser {
    return {
        id,
        name: String(data.name ?? ""),
        email: String(data.email ?? authEmail ?? ""),
        role: data.role === "admin" ? "admin" : "user",
        active: data.active === true,
        isSuperAdmin: data.isSuperAdmin === true,
        permissions: (data.permissions as AdminPermissions | undefined) ?? undefined,
        userPermissions: (data.userPermissions as UserPermissions | undefined) ?? undefined,
        phoneCodes: resolvePhoneCodes(data),
    };
}

async function readUserProfile(uid: string): Promise<DocumentSnapshot> {
    const ref = doc(db, "users", uid);
    try {
        return await getDoc(ref);
    } catch (error) {
        console.warn("[auth] Firestore profile read failed, retrying.", error);
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        try {
            return await getDoc(ref);
        } catch (retryError) {
            console.warn("[auth] Firestore profile retry failed, trying cache.", retryError);
            return await getDocFromCache(ref);
        }
    }
}

export type AppUser = {
    id: string;
    name?: string;
    email?: string;
    role: "admin" | "user";
    active: boolean;
    isSuperAdmin?: boolean;
    permissions?: AdminPermissions;
    userPermissions?: UserPermissions;
    phoneCodes?: string[];
};

type AuthContextValue = {
    firebaseUser: User | null;
    profile: AppUser | null;
    loading: boolean;
    isAdmin: boolean;
    isUser: boolean;
    isSuperAdmin: boolean;
    /** Null when the user is superadmin (implicitly has all permissions). */
    adminPermissions: AdminPermissions | null;
    /** Resolved vendor permissions — undefined fields default to true (full access). */
    userPermissions: UserPermissions;
    /** Brazilian DDDs this vendor covers. Empty = no restriction configured. */
    phoneCodes: string[];
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            setLoading(true);

            try {
                setFirebaseUser(user);

                if (!user) {
                    setProfile(null);
                    return;
                }

                const snap = await readUserProfile(user.uid);

                if (!snap.exists()) {
                    setProfile(null);
                    return;
                }

                const data = snap.data() as Record<string, unknown>;

                setProfile(profileFromSnapshot(snap.id, data, user.email));
            } finally {
                setLoading(false);
            }
        });

        return () => unsub();
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            firebaseUser,
            profile,
            loading,
            isAdmin: profile?.role === "admin" && profile?.active === true,
            isUser: profile?.role === "user" && profile?.active === true,
            isSuperAdmin: profile?.isSuperAdmin === true,
            adminPermissions: profile?.isSuperAdmin ? null : (profile?.permissions ?? null),
            userPermissions: {
                canSeeMap: profile?.userPermissions?.canSeeMap ?? true,
                canSeeHistory: profile?.userPermissions?.canSeeHistory ?? true,
                canSeeChat: profile?.userPermissions?.canSeeChat ?? true,
            },
            phoneCodes: profile?.phoneCodes ?? [],
            login: async (email, password) => {
                await setPersistence(auth, browserLocalPersistence);
                await signInWithEmailAndPassword(auth, email.trim(), password);
            },
            logout: async () => {
                await signOut(auth);
            },
        }),
        [firebaseUser, profile, loading]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
    return ctx;
}
