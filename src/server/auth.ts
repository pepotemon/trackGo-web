import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "@/server/firebaseAdmin";

export type ServerUser = {
    token: DecodedIdToken;
    uid: string;
    role?: string | null;
    active?: boolean;
    isSuperAdmin?: boolean;
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
    };
}

export function canManageSubscriptionCheckout(user: ServerUser, userId: string) {
    return user.uid === userId || user.isSuperAdmin === true || user.role === "admin";
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
    return Response.json(
        {
            ok: false,
            code: "internal_error",
            message: "No se pudo completar la operacion.",
        },
        { status: 500 },
    );
}
