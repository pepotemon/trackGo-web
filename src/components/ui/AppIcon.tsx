export type AppIconName =
    | "activity"
    | "alert"
    | "arrowLeft"
    | "arrowRight"
    | "assign"
    | "chat"
    | "check"
    | "close"
    | "download"
    | "edit"
    | "filter"
    | "history"
    | "lead"
    | "lock"
    | "map"
    | "more"
    | "pause"
    | "play"
    | "plus"
    | "power"
    | "refresh"
    | "search"
    | "settings"
    | "trash"
    | "unlock"
    | "users"
    | "wallet";

export type AppIconTone =
    | "blue"
    | "purple"
    | "orange"
    | "red"
    | "green"
    | "slate";

const toneClass: Record<AppIconTone, string> = {
    blue: "bg-blue-50 text-blue-600 ring-blue-100",
    purple: "bg-violet-50 text-violet-600 ring-violet-100",
    orange: "bg-orange-50 text-orange-600 ring-orange-100",
    red: "bg-rose-50 text-rose-600 ring-rose-100",
    green: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    slate: "bg-slate-50 text-slate-600 ring-slate-100",
};

export function AppIcon({
    name,
    tone = "purple",
    size = "md",
    plain = false,
    className = "",
}: {
    name: AppIconName;
    tone?: AppIconTone;
    size?: "sm" | "md" | "lg";
    plain?: boolean;
    className?: string;
}) {
    const shouldUsePlainSurface =
        plain ||
        className.includes("bg-transparent") ||
        className.includes("text-current");
    const box =
        size === "lg"
            ? "h-14 w-14 rounded-2xl"
            : size === "sm"
                ? "h-8 w-8 rounded-xl"
                : "h-10 w-10 rounded-2xl";
    const icon = size === "lg" ? "h-7 w-7" : size === "sm" ? "h-4 w-4" : "h-5 w-5";

    return (
        <span className={`inline-flex shrink-0 items-center justify-center ${shouldUsePlainSurface ? "" : "ring-1"} ${box} ${shouldUsePlainSurface ? "" : toneClass[tone]} ${className}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {name === "activity" ? <path d="M22 12h-4l-3 8L9 4l-3 8H2" /> : null}
                {name === "alert" ? (
                    <>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v6M12 17h.01" />
                    </>
                ) : null}
                {name === "arrowLeft" ? <path d="M19 12H5M12 19l-7-7 7-7" /> : null}
                {name === "arrowRight" ? <path d="M5 12h14M12 5l7 7-7 7" /> : null}
                {name === "assign" ? (
                    <>
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M19 8v6M22 11h-6" />
                    </>
                ) : null}
                {name === "chat" ? <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" /> : null}
                {name === "check" ? <path d="M20 6 9 17l-5-5" /> : null}
                {name === "close" ? (
                    <>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M15 9 9 15M9 9l6 6" />
                    </>
                ) : null}
                {name === "download" ? <path d="M12 3v12M7 10l5 5 5-5M5 21h14" /> : null}
                {name === "edit" ? <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /> : null}
                {name === "filter" ? <path d="M4 6h16M7 12h10M10 18h4" /> : null}
                {name === "history" ? <path d="M3 12a9 9 0 1 0 3-6.7M3 4v6h6M12 7v5l3 2" /> : null}
                {name === "lead" ? (
                    <>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                        <circle cx="10" cy="7" r="4" />
                        <path d="M21 8v8M17 12h8" />
                    </>
                ) : null}
                {name === "lock" ? <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11Z" /> : null}
                {name === "map" ? <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3ZM9 3v15M15 6v15" /> : null}
                {name === "more" ? <path d="M5 12h.01M12 12h.01M19 12h.01" /> : null}
                {name === "pause" ? <path d="M8 5v14M16 5v14" /> : null}
                {name === "play" ? <path d="m8 5 12 7-12 7V5Z" /> : null}
                {name === "plus" ? <path d="M12 5v14M5 12h14" /> : null}
                {name === "power" ? <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" /> : null}
                {name === "refresh" ? <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5" /> : null}
                {name === "search" ? <path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /> : null}
                {name === "settings" ? <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 0 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" /> : null}
                {name === "trash" ? <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /> : null}
                {name === "unlock" ? <path d="M7 11V8a5 5 0 0 1 9.6-2M6 11h12v10H6V11Z" /> : null}
                {name === "users" ? (
                    <>
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.8M16 3.3a4 4 0 0 1 0 7.4" />
                    </>
                ) : null}
                {name === "wallet" ? (
                    <>
                        <path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
                        <path d="M16 14h5" />
                    </>
                ) : null}
            </svg>
        </span>
    );
}
