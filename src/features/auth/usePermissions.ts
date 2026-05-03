"use client";

import { useMemo } from "react";
import { useAuth } from "./AuthProvider";
import { fullAdminPermissions, defaultAdminPermissions } from "@/types/users";
import type { AdminPermissions } from "@/types/users";

/**
 * Returns the effective permissions for the currently logged-in admin.
 *
 * - Superadmin (`isSuperAdmin === true`): all permissions granted.
 * - Sub-admin: uses the `permissions` stored in their profile.
 *   Any missing key defaults to `false`.
 * - Non-admin users: all denied (shouldn't reach admin routes anyway).
 */
export function usePermissions(): AdminPermissions {
    const { isSuperAdmin, adminPermissions } = useAuth();

    return useMemo(() => {
        if (isSuperAdmin) return fullAdminPermissions();
        if (adminPermissions) {
            // Merge with defaults so missing keys are false rather than undefined.
            return { ...defaultAdminPermissions(), ...adminPermissions };
        }
        return defaultAdminPermissions();
    }, [isSuperAdmin, adminPermissions]);
}

/**
 * Convenience hook — returns true if the current user has the given permission.
 * Superadmin always returns true.
 */
export function useCan(permission: keyof AdminPermissions): boolean {
    const perms = usePermissions();
    return perms[permission];
}
