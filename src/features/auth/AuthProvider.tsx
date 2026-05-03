"use client";

import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
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

                const snap = await getDoc(doc(db, "users", user.uid));

                if (!snap.exists()) {
                    setProfile(null);
                    return;
                }

                const data = snap.data() as any;

                setProfile({
                    id: snap.id,
                    name: data.name ?? "",
                    email: data.email ?? user.email ?? "",
                    role: data.role ?? "user",
                    active: data.active === true,
                    isSuperAdmin: data.isSuperAdmin === true,
                    permissions: data.permissions ?? undefined,
                    userPermissions: data.userPermissions ?? undefined,
                    phoneCodes: Array.isArray(data.phoneCodes) ? (data.phoneCodes as string[]) : [],
                });
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
