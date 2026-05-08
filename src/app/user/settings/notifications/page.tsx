"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { PushSettingsPanel } from "@/components/mobile/PushSettingsPanel";

export default function UserNotificationsSettingsPage() {
    const { firebaseUser } = useAuth();

    return (
        <main className="min-h-screen bg-[#fbfaff] px-4 pb-24 pt-5 text-[#101936]">
            <section className="mx-auto max-w-xl space-y-4">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7c70ba]">Notificaciones</p>
                    <h1 className="mt-1 text-[26px] font-black tracking-[-0.05em]">Avisos de clientes</h1>
                    <p className="mt-2 text-[13px] font-semibold leading-snug text-[#66739a]">
                        Activa o desactiva los avisos de clientes nuevos en este dispositivo.
                    </p>
                </div>
                {firebaseUser ? <PushSettingsPanel userId={firebaseUser.uid} roleLabel="tu usuario vendedor" /> : null}
            </section>
        </main>
    );
}
