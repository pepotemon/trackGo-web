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

const PROFILE_CACHE_PREFIX = "trackgo_profile_cache_";

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

function profileCacheKey(uid: string) {
    return `${PROFILE_CACHE_PREFIX}${uid}`;
}

function readCachedProfile(uid: string): AppUser | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(profileCacheKey(uid));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as AppUser;
        return parsed?.id === uid ? parsed : null;
    } catch {
        return null;
    }
}

function saveCachedProfile(profile: AppUser) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(profileCacheKey(profile.id), JSON.stringify(profile));
    } catch {
        // localStorage can be unavailable in private/restricted contexts.
    }
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
        let disposed = false;
        let retryTimer: number | null = null;

        async function loadProfile(user: User, attempt = 0) {
            if (disposed) return;

            try {
                const snap = await readUserProfile(user.uid);
                if (disposed) return;

                if (!snap.exists()) {
                    setProfile(null);
                    setLoading(false);
                    return;
                }

                const data = snap.data() as Record<string, unknown>;
                const nextProfile = profileFromSnapshot(snap.id, data, user.email);
                setProfile(nextProfile);
                saveCachedProfile(nextProfile);
                setLoading(false);
            } catch (error) {
                if (disposed) return;

                const cached = readCachedProfile(user.uid);
                if (cached) {
                    console.warn("[auth] Using cached profile while Firestore recovers.", error);
                    setProfile(cached);
                    setLoading(false);

                    if (attempt < 5) {
                        retryTimer = window.setTimeout(() => loadProfile(user, attempt + 1), 1200 * (attempt + 1));
                    }
                    return;
                }

                if (attempt < 8) {
                    retryTimer = window.setTimeout(() => loadProfile(user, attempt + 1), 500 * (attempt + 1));
                    return;
                }

                console.error("[auth] Could not load profile after retries.", error);
                setProfile(null);
                setLoading(false);
            }
        }

        const unsub = onAuthStateChanged(auth, async (user) => {
            setLoading(true);

            if (retryTimer) {
                window.clearTimeout(retryTimer);
                retryTimer = null;
            }

            setFirebaseUser(user);

            if (!user) {
                setProfile(null);
                setLoading(false);
                return;
            }

            const cached = readCachedProfile(user.uid);
            if (cached) setProfile(cached);

            await loadProfile(user);
        });

        return () => {
            disposed = true;
            if (retryTimer) window.clearTimeout(retryTimer);
            unsub();
        };
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
                canChatWithProspects: profile?.userPermissions?.canChatWithProspects ?? false,
                canSeeSubscriptions: profile?.userPermissions?.canSeeSubscriptions ?? true,
                canSeeCommercialDirectory: profile?.userPermissions?.canSeeCommercialDirectory ?? true,
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
