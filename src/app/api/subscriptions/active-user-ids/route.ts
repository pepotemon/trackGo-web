import { errorResponse, requireServerUser, ResponseError } from "@/server/auth";
import { getActiveSubscriptionUserIds } from "@/server/subscriptions/subscriptionService";

export async function GET(request: Request) {
    try {
        const user = await requireServerUser(request);
        if (!user.isSuperAdmin && user.role !== "admin") {
            throw new ResponseError("forbidden", "No tienes permiso para esta accion.", 403);
        }

        const userIds = await getActiveSubscriptionUserIds({
            adminId: user.uid,
            isSuperAdmin: user.isSuperAdmin === true,
        });
        return Response.json({ ok: true, userIds });
    } catch (error) {
        return errorResponse(error);
    }
}
