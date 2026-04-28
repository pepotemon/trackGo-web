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

export type AppUser = {
    id: string;
    name?: string;
    email?: string;
    role: "admin" | "user";
    active: boolean;
};

type AuthContextValue = {
    firebaseUser: User | null;
    profile: AppUser | null;
    loading: boolean;
    isAdmin: boolean;
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