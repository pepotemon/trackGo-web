import { errorResponse, requireServerUser, requireSuperAdmin } from "@/server/auth";
import { checkAndPauseByBudget } from "@/server/subscriptions/subscriptionService";

function isCronAuthorized(request: Request) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) return false;

    const authorization = request.headers.get("authorization") || "";
    const cronSecret = request.headers.get("x-cron-secret") || "";

    return authorization === `Bearer ${secret}` || cronSecret === secret;
}

export async function GET(request: Request) {
    try {
        if (!isCronAuthorized(request)) {
            const user = await requireServerUser(request);
            requireSuperAdmin(user);
        }

        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20) || 20, 1), 50);
        const result = await checkAndPauseByBudget(limit);
        return Response.json({ ok: true, ...result });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        if (!isCronAuthorized(request)) {
            const user = await requireServerUser(request);
            requireSuperAdmin(user);
        }

        let limit = 20;
        try {
            const body = await request.json();
            limit = Math.min(Math.max(Number(body.limit || 20) || 20, 1), 50);
        } catch {
            // Body is optional for manual cron runs.
        }

        const result = await checkAndPauseByBudget(limit);
        return Response.json({ ok: true, ...result });
    } catch (error) {
        return errorResponse(error);
    }
}
