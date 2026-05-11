import type {
    AccountingSummary,
    AccountingUserRow,
    AccountingAssignmentDoc,
    AccountingSubscriptionSummaryRow,
    AccountingSubscriptionDoc,
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

function buildRealSubscriptionsByUser(subscriptions: AccountingSubscriptionDoc[]) {
    const map = new Map<
        string,
        {
            gross: number;
            cost: number;
            count: number;
            cities: string[];
        }
    >();

    for (const subscription of subscriptions) {
        if (!subscription.userId) continue;

        const current = map.get(subscription.userId) ?? {
            gross: 0,
            cost: 0,
            count: 0,
            cities: [],
        };
        const cost = subscription.adsBudget;
        const city = String(subscription.city || subscription.cityId || "").trim();

        map.set(subscription.userId, {
            gross: clamp2(current.gross + subscription.amount),
            cost: clamp2(current.cost + cost),
            count: current.count + 1,
            cities: city && !current.cities.includes(city)
                ? [...current.cities, city]
                : current.cities,
        });
    }

    return map;
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
    assignments: AccountingAssignmentDoc[];
    subscriptions?: AccountingSubscriptionDoc[];
    investment: WeeklyInvestmentDoc | null;
}): AccountingSummary {
    const usersById = new Map(input.users.map((u) => [u.id, u]));
    const investmentByUser = buildGroupAllocations(input.investment);
    const realSubscriptionsByUser = buildRealSubscriptionsByUser(input.subscriptions ?? []);

    const rowsMap = new Map<string, AccountingUserRow>();

    let grossSubscriptions = 0;
    let subscriptionInvestment = 0;
    let subscriptionsPaid = 0;
    const subscriptionRows: AccountingSubscriptionSummaryRow[] = [];

    for (const user of input.users) {
        const realSubscription = realSubscriptionsByUser.get(user.id);
        const hasRealSubscription = Boolean(realSubscription && realSubscription.count > 0);
        const configuredBillingMode = user.billingMode ?? "per_visit";
        const billingMode = hasRealSubscription ? "weekly_subscription" : configuredBillingMode;
        const legacySubscription = !hasRealSubscription && configuredBillingMode === "weekly_subscription"
            ? getWeekSubscription(user, input.startKey)
            : null;
        const subscription = hasRealSubscription
            ? {
                gross: realSubscription?.gross ?? 0,
                cost: realSubscription?.cost ?? 0,
                paid: true,
                source: "real" as const,
                count: realSubscription?.count ?? 0,
                cities: realSubscription?.cities ?? [],
            }
            : legacySubscription?.paid
                ? {
                    ...legacySubscription,
                    source: "manual" as const,
                    count: 1,
                    cities: [],
                }
                : null;

        if (subscription?.paid) {
            grossSubscriptions = clamp2(grossSubscriptions + subscription.gross);
            subscriptionInvestment = clamp2(subscriptionInvestment + subscription.cost);
            subscriptionsPaid += Math.max(1, subscription.count);

            if (subscription.source === "manual") {
                subscriptionRows.push({
                    subscriptionId: `manual_${user.id}_${input.startKey}`,
                    userId: user.id,
                    userName: user.name || "Usuario",
                    userEmail: user.email,
                    amount: subscription.gross,
                    cost: subscription.cost,
                    real: clamp2(subscription.gross - subscription.cost),
                    source: "manual",
                    createdAt: null,
                });
            }
        }

        rowsMap.set(user.id, {
            userId: user.id,
            name: user.name || "Usuario",
            email: user.email,
            billingMode,
            assigned: 0,
            visited: 0,
            rejected: 0,
            gross: subscription?.gross ?? 0,
            cost: 0,
            real: 0,
            subscriptionPaid: subscription?.paid,
            subscriptionSource: subscription?.source ?? "none",
            subscriptionCount: subscription?.count ?? 0,
            subscriptionCities: subscription?.cities ?? [],
        });
    }

    let assigned = 0;

    const assignedClientIds = new Set<string>();
    for (const assignment of input.assignments) {
        if (!assignment.id || assignedClientIds.has(assignment.id)) continue;
        assignedClientIds.add(assignment.id);

        const row = rowsMap.get(assignment.userId);
        if (!row) continue;

        assigned += 1;
        row.assigned += 1;
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
            const realSubscription = realSubscriptionsByUser.get(row.userId);
            const subscription = realSubscription
                ? {
                    cost: realSubscription.cost,
                    paid: true,
                }
                : row.billingMode === "weekly_subscription"
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

    for (const subscription of input.subscriptions ?? []) {
        const user = usersById.get(subscription.userId);
        if (!user) continue;
        const cost = subscription.adsBudget;

        subscriptionRows.push({
            subscriptionId: subscription.id,
            userId: subscription.userId,
            userName: user.name || "Usuario",
            userEmail: user.email,
            cityId: subscription.cityId,
            city: subscription.city,
            plan: subscription.plan,
            status: subscription.status,
            amount: clamp2(subscription.amount),
            cost: clamp2(cost),
            real: clamp2(subscription.amount - cost),
            source: "real",
            createdAt: subscription.createdAt,
        });
    }

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
        assigned,
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
        subscriptionRows: subscriptionRows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    };
}
