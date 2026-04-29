import type {
    AccountingSummary,
    AccountingUserRow,
    DailyEventDoc,
    UserDoc,
    WeeklyInvestmentDoc,
} from "@/types/accounting";

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();

    for (const e of events) {
        if (!e.clientId) continue;

        const prev = map.get(e.clientId);
        const prevMs = safeNumber(prev?.createdAt, 0);
        const currMs = safeNumber(e.createdAt, 0);

        if (!prev || currMs >= prevMs) {
            map.set(e.clientId, e);
        }
    }

    return Array.from(map.values());
}

function getWeekSubscription(user: UserDoc | undefined, weekStartKey: string) {
    if (!user) {
        return {
            gross: 0,
            cost: 0,
            paid: false,
        };
    }

    const week = user.weeklySubscriptionWeeks?.[weekStartKey];
    const paid = week?.paid === true;

    if (!paid) {
        return {
            gross: 0,
            cost: 0,
            paid: false,
        };
    }

    return {
        gross: clamp2(
            safeNumber(week?.amount, safeNumber(user.weeklySubscriptionAmount, 0))
        ),
        cost: clamp2(
            safeNumber(week?.cost, safeNumber(user.weeklySubscriptionCost, 0))
        ),
        paid: true,
    };
}

function getEventAmount(event: DailyEventDoc, user?: UserDoc) {
    const amount = safeNumber(event.amount, NaN);
    if (Number.isFinite(amount)) return amount;

    const amountSnapshot = safeNumber(event.amountSnapshot, NaN);
    if (Number.isFinite(amountSnapshot)) return amountSnapshot;

    const rateApplied = safeNumber(event.rateApplied, NaN);
    if (Number.isFinite(rateApplied)) return rateApplied;

    const rateSnapshot = safeNumber(event.ratePerVisitSnapshot, NaN);
    if (Number.isFinite(rateSnapshot)) return rateSnapshot;

    return safeNumber(user?.ratePerVisit, 0);
}

function buildGroupAllocations(investment: WeeklyInvestmentDoc | null) {
    const out: Record<string, number> = {};
    const groups = Array.isArray(investment?.groups) ? investment.groups : [];

    if (!groups.length) {
        for (const [uid, amount] of Object.entries(investment?.allocations ?? {})) {
            const cleanUid = String(uid || "").trim();
            if (!cleanUid) continue;

            out[cleanUid] = clamp2((out[cleanUid] ?? 0) + safeNumber(amount, 0));
        }

        return out;
    }

    for (const group of groups) {
        if (group.status === "inactive") continue;

        const amount = safeNumber(group.amount, 0);
        const userIds = Array.isArray(group.userIds)
            ? Array.from(
                new Set(
                    group.userIds
                        .map((x) => String(x || "").trim())
                        .filter(Boolean)
                )
            )
            : [];

        if (amount <= 0 || userIds.length <= 0) continue;

        const share = clamp2(amount / userIds.length);

        for (const uid of userIds) {
            out[uid] = clamp2((out[uid] ?? 0) + share);
        }
    }

    return out;
}

function getGroupInvestmentTotal(investment: WeeklyInvestmentDoc | null) {
    const groups = Array.isArray(investment?.groups) ? investment.groups : [];

    if (groups.length) {
        return clamp2(
            groups.reduce(
                (acc, group) =>
                    group.status === "inactive"
                        ? acc
                        : acc + safeNumber(group.amount, 0),
                0
            )
        );
    }

    return clamp2(
        Object.values(investment?.allocations ?? {}).reduce(
            (acc, amount) => acc + safeNumber(amount, 0),
            0
        )
    );
}

export function buildAccountingSummary(input: {
    startKey: string;
    endKey: string;
    users: UserDoc[];
    events: DailyEventDoc[];
    investment: WeeklyInvestmentDoc | null;
}): AccountingSummary {
    const usersById = new Map(input.users.map((u) => [u.id, u]));
    const investmentByUser = buildGroupAllocations(input.investment);

    const rowsMap = new Map<string, AccountingUserRow>();

    let grossSubscriptions = 0;
    let subscriptionInvestment = 0;
    let subscriptionsPaid = 0;

    for (const user of input.users) {
        const billingMode = user.billingMode ?? "per_visit";
        const isWeekly = billingMode === "weekly_subscription";
        const subscription = isWeekly
            ? getWeekSubscription(user, input.startKey)
            : null;

        if (subscription?.paid) {
            grossSubscriptions = clamp2(grossSubscriptions + subscription.gross);
            subscriptionInvestment = clamp2(subscriptionInvestment + subscription.cost);
            subscriptionsPaid += 1;
        }

        rowsMap.set(user.id, {
            userId: user.id,
            name: user.name || "Usuario",
            email: user.email,
            billingMode,
            visited: 0,
            rejected: 0,
            gross: subscription?.gross ?? 0,
            cost: 0,
            real: 0,
            subscriptionPaid: subscription?.paid,
        });
    }

    const latestEvents = latestEventByClient(input.events);

    let visited = 0;
    let rejected = 0;
    let grossVisits = 0;

    for (const event of latestEvents) {
        const row = rowsMap.get(event.userId);
        const user = usersById.get(event.userId);

        if (!row) continue;

        if (event.type === "visited") {
            visited += 1;
            row.visited += 1;

            if (row.billingMode !== "weekly_subscription") {
                const amount = getEventAmount(event, user);
                row.gross = clamp2(row.gross + amount);
                grossVisits = clamp2(grossVisits + amount);
            }
        }

        if (event.type === "rejected") {
            rejected += 1;
            row.rejected += 1;
        }
    }

    const rows = Array.from(rowsMap.values())
        .map((row) => {
            const user = usersById.get(row.userId);
            const subscription =
                row.billingMode === "weekly_subscription"
                    ? getWeekSubscription(user, input.startKey)
                    : null;

            const subscriptionCost =
                row.billingMode === "weekly_subscription"
                    ? clamp2(subscription?.cost ?? 0)
                    : 0;
            const groupCost = clamp2(investmentByUser[row.userId] ?? 0);
            const cost = clamp2(subscriptionCost + groupCost);

            return {
                ...row,
                cost,
                real: clamp2(row.gross - cost),
            };
        })
        .sort((a, b) => b.real - a.real);

    const gross = clamp2(rows.reduce((acc, row) => acc + row.gross, 0));

    const groupInvestment = getGroupInvestmentTotal(input.investment);
    const manualAdjustment = clamp2(input.investment?.amount ?? 0);
    const investment = clamp2(subscriptionInvestment + groupInvestment + manualAdjustment);
    const real = clamp2(gross - investment);
    const roi = investment > 0 ? (real / investment) * 100 : null;

    return {
        startKey: input.startKey,
        endKey: input.endKey,
        visited,
        rejected,
        gross,
        grossVisits,
        grossSubscriptions,
        subscriptionsPaid,
        investment,
        subscriptionInvestment,
        groupInvestment,
        manualAdjustment,
        real,
        roi,
        rows,
    };
}
