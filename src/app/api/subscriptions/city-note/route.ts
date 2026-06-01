import { errorResponse, requireServerUser, requireSubscriptionsEdit } from "@/server/auth";
import { saveCityNote } from "@/server/subscriptions/subscriptionService";

export async function PATCH(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const cityId = String(body.cityId || "").trim();
        const note = body.note === null || body.note === "" ? null : String(body.note ?? "").trim() || null;
        await saveCityNote(cityId, note);
        return Response.json({ ok: true });
    } catch (error) {
        return errorResponse(error);
    }
}
