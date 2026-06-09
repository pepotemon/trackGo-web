const admin = require("firebase-admin");
const { dayKeyFromMs } = require("../utils/geo");
const { selectAutoAssignUser } = require("./selectAutoAssignUser");
const { logAutoAssign } = require("./autoAssignLogger");

function s(v) {
    return String(v ?? "").trim();
}

async function autoAssignLead(lead) {
    try {
        if (!lead?.id) {
            console.log("[AUTO ASSIGN] skipped: missing lead.id");
            return;
        }

        if (s(lead.assignedTo)) {
            console.log("[AUTO ASSIGN] skipped: already assigned", {
                clientId: lead.id,
                assignedTo: lead.assignedTo,
            });
            return;
        }

        const leadStatus = s(lead.status);
        if (leadStatus === "rejected" || leadStatus === "visited") {
            console.log("[AUTO ASSIGN] skipped: lead already actioned", {
                clientId: lead.id,
                status: leadStatus,
            });
            return;
        }

        const parseStatus = s(lead.parseStatus);
        const verificationStatus = s(lead.verificationStatus);

        if (parseStatus !== "ready") {
            console.log("[AUTO ASSIGN] skipped: parseStatus not ready", {
                clientId: lead.id,
                parseStatus,
            });
            return;
        }

        if (
            verificationStatus !== "pending_review" &&
            verificationStatus !== "verified"
        ) {
            console.log("[AUTO ASSIGN] skipped: invalid verificationStatus", {
                clientId: lead.id,
                verificationStatus,
            });
            return;
        }

        // Campaign-based assignment: if the lead came from a specific campaign,
        // assign directly to the vendor who owns that campaign via the cities collection.
        const campaignId = s(lead.leadAcquisitionCampaignId || "");
        if (campaignId) {
            let ownerDoc = null;

            const snap1 = await admin.firestore()
                .collection("cities")
                .where("activeCampaignId", "==", campaignId)
                .where("status", "==", "occupied")
                .limit(1)
                .get();
            if (!snap1.empty) ownerDoc = snap1.docs[0];

            if (!ownerDoc) {
                const snap2 = await admin.firestore()
                    .collection("cities")
                    .where("campaignId", "==", campaignId)
                    .where("status", "==", "occupied")
                    .limit(1)
                    .get();
                if (!snap2.empty) ownerDoc = snap2.docs[0];
            }

            if (ownerDoc) {
                const ownerUserId = s(ownerDoc.data()?.ownerUserId || "");
                if (ownerUserId) {
                    const now = Date.now();
                    const dayKey = dayKeyFromMs(now);
                    const coverageKey = `campaign:${campaignId}`;

                    await admin.firestore().collection("clients").doc(lead.id).update({
                        assignedTo: ownerUserId,
                        assignedAt: now,
                        assignedDayKey: dayKey,
                        status: "pending",
                        statusBy: null,
                        statusAt: null,
                        rejectedReason: null,
                        rejectedReasonText: null,
                        note: null,
                        autoAssignedAt: now,
                        autoAssignMatchType: "campaign",
                        autoAssignCoverageKey: coverageKey,
                        assignmentMode: "campaign_auto",
                        updatedAt: now,
                    });

                    await logAutoAssign({
                        lead,
                        user: { id: ownerUserId, ...ownerDoc.data() },
                        matchType: "campaign",
                        coverageKey,
                        coverageItem: ownerDoc.data(),
                        createdAt: now,
                        dayKey,
                    });

                    console.log("[AUTO ASSIGN] campaign-assigned:", {
                        clientId: lead.id,
                        userId: ownerUserId,
                        campaignId,
                        coverageKey,
                    });
                    return;
                }
            }

            console.log("[AUTO ASSIGN] campaign not matched, falling through to geo:", {
                clientId: lead.id,
                campaignId,
            });
        }

        const selected = await selectAutoAssignUser(lead);

        if (!selected) {
            console.log("[AUTO ASSIGN] skipped: no user matched", {
                clientId: lead.id,
                geoAdminCityLabel: lead?.geoAdminCityLabel || "",
                geoCityLabel: lead?.geoCityLabel || "",
                geoAdminStateLabel: lead?.geoAdminStateLabel || "",
            });
            return;
        }

        const {
            user,
            matchType,
            coverageKey,
            coverageItem,
            stateRef,
        } = selected;

        const now = Date.now();
        const dayKey = dayKeyFromMs(now);
        const clientRef = admin.firestore().collection("clients").doc(lead.id);

        await clientRef.update({
            assignedTo: user.id,
            assignedAt: now,
            assignedDayKey: dayKey,

            status: "pending",
            statusBy: null,
            statusAt: null,

            rejectedReason: null,
            rejectedReasonText: null,
            note: null,

            autoAssignedAt: now,
            autoAssignMatchType: matchType,
            autoAssignCoverageKey: coverageKey,
            assignmentMode: "coverage_auto",

            updatedAt: now,
        });

        await stateRef.set(
            {
                lastAssignedUserId: user.id,
                coverageKey,
                matchType,
                updatedAt: now,
                dayKey,
            },
            { merge: true }
        );

        await logAutoAssign({
            lead,
            user,
            matchType,
            coverageKey,
            coverageItem,
            createdAt: now,
            dayKey,
        });

        console.log("[AUTO ASSIGN] assigned:", {
            clientId: lead.id,
            userId: user.id,
            matchType,
            coverageKey,
            dayKey,
        });

    } catch (e) {
        console.error("[AUTO ASSIGN] autoAssignLead error:", e);
    }
}

module.exports = {
    autoAssignLead,
};