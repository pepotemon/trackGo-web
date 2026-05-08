import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "@/server/firebaseAdmin";
import type { AdminPermissions, UserPermissions } from "@/types/users";

export type ServerUser = {
    token: DecodedIdToken;
    uid: string;
    role?: string | null;
    active?: boolean;
    isSuperAdmin?: boolean;
    permissions?: Partial<AdminPermissions> | null;
    userPermissions?: Partial<UserPermissions> | null;
};

export async function requireServerUser(request: Request): Promise<ServerUser> {
    const header = request.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
        throw new ResponseError("auth_required", "Debes iniciar sesion para continuar.", 401);
    }

    const token = await adminAuth.verifyIdToken(match[1]);
    const userSnap = await adminDb.collection("users").doc(token.uid).get();
    const user = userSnap.data();

    if (!userSnap.exists || user?.active !== true) {
        throw new ResponseError("inactive_user", "Tu usuario no esta activo.", 403);
    }

    return {
        token,
        uid: token.uid,
        role: typeof user?.role === "string" ? user.role : null,
        active: user?.active === true,
        isSuperAdmin: user?.isSuperAdmin === true,
        permissions: (user?.permissions ?? null) as Partial<AdminPermissions> | null,
        userPermissions: (user?.userPermissions ?? null) as Partial<UserPermissions> | null,
    };
}

export function canManageSubscriptionCheckout(user: ServerUser, userId: string) {
    if (user.uid === userId) {
        return user.role === "user" ? user.userPermissions?.canSeeSubscriptions !== false : true;
    }
    return user.isSuperAdmin === true || user.role === "admin";
}

export function canViewSubscriptions(user: ServerUser) {
    return user.isSuperAdmin === true || user.permissions?.subscriptionsView === true;
}

export function canEditSubscriptions(user: ServerUser) {
    return user.isSuperAdmin === true || user.permissions?.subscriptionsEdit === true;
}

export function requireSubscriptionsView(user: ServerUser) {
    if (!canViewSubscriptions(user) && !canEditSubscriptions(user)) {
        throw new ResponseError("subscriptions_view_required", "No tienes permiso para ver suscripciones.", 403);
    }
}

export function requireSubscriptionReadAccess(user: ServerUser) {
    if (user.role === "user") {
        if (user.userPermissions?.canSeeSubscriptions === false) {
            throw new ResponseError("subscriptions_user_required", "No tienes permiso para acceder a suscripciones.", 403);
        }
        return;
    }

    requireSubscriptionsView(user);
}

export function requireSubscriptionsEdit(user: ServerUser) {
    if (!canEditSubscriptions(user)) {
        throw new ResponseError("subscriptions_edit_required", "No tienes permiso para configurar suscripciones.", 403);
    }
}

export function requireSuperAdmin(user: ServerUser) {
    if (user.isSuperAdmin !== true) {
        throw new ResponseError("superadmin_required", "Solo el superadmin puede hacer esta accion.", 403);
    }
}

export class ResponseError extends Error {
    status: number;
    code: string;

    constructor(code: string, message: string, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export function errorResponse(error: unknown) {
    if (error instanceof ResponseError) {
        return Response.json(
            {
                ok: false,
                code: error.code,
                message: error.message,
            },
            { status: error.status },
        );
    }

    console.error(error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("FIREBASE_ADMIN_ENV_MISSING")) {
        return Response.json(
            {
                ok: false,
                code: "firebase_admin_env_missing",
                message: "Faltan variables FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en el servidor.",
            },
            { status: 500 },
        );
    }
    if (message.includes("FIREBASE_PRIVATE_KEY_INVALID_FORMAT") || message.includes("PEM")) {
        return Response.json(
            {
                ok: false,
                code: "firebase_private_key_invalid",
                message: "FIREBASE_PRIVATE_KEY tiene formato invalido. Pegala completa con saltos \\n y sin comillas extra en Vercel.",
            },
            { status: 500 },
        );
    }

    return Response.json(
        {
            ok: false,
            code: "internal_error",
            message: "No se pudo completar la operacion.",
        },
        { status: 500 },
    );
}
