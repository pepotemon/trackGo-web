"use client";

import { PushSettingsPanel } from "@/components/mobile/PushSettingsPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { useAuth } from "@/features/auth/AuthProvider";

export default function AdminNotificationsSettingsPage() {
    const { firebaseUser, isSuperAdmin } = useAuth();

    return (
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-4">
            <PageHeader
                icon={<AppIcon name="alert" plain className="h-5 w-5 text-current" />}
                title="Notificaciones"
                subtitle="Activa o desactiva avisos push para este dispositivo administrativo."
            />

            {firebaseUser ? (
                <PushSettingsPanel
                    userId={firebaseUser.uid}
                    roleLabel={isSuperAdmin ? "tu superadmin" : "tu usuario admin"}
                />
            ) : null}
        </main>
    );
}
