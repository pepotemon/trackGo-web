type TrackGoLogoVariant = "full" | "mark";
type TrackGoLogoSize = "sm" | "md" | "lg" | "xl";
type TrackGoLogoTheme = "light" | "dark";

const MARK_PX: Record<TrackGoLogoSize, number> = { sm: 26, md: 34, lg: 42, xl: 52 };
const FONT: Record<TrackGoLogoSize, string> = {
    sm: "text-[14px]",
    md: "text-[18px]",
    lg: "text-[23px]",
    xl: "text-[29px]",
};
const GAP: Record<TrackGoLogoSize, string> = { sm: "gap-1.5", md: "gap-2", lg: "gap-2.5", xl: "gap-3" };

// Dot angles from 12 o'clock clockwise (degrees):
//   Secondary (29, 10) → dx=9, dy=-10 → atan2(9,10) ≈ 42°  → delay = 42/360 * 3s ≈ 0.35s
//   Tertiary  (8,  13) → dx=-12,dy=-7 → 360-atan2(12,7)≈60° → 300°  → delay ≈ 2.50s

function RadarMark({ px, id, animated = false }: { px: number; id: string; animated?: boolean }) {
    const sw = `${id}-sw`;
    const cd = `${id}-cd`;
    const rf = `${id}-rf`;
    return (
        <svg width={px} height={px} viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <defs>
                {animated && (
                    <style>{`
                        @keyframes tg-spin {
                            from { transform: rotate(0deg); }
                            to   { transform: rotate(360deg); }
                        }
                        @keyframes tg-blip {
                            0%   { transform: scale(1);   opacity: 0.85; }
                            18%  { transform: scale(2.2); opacity: 0.35; }
                            30%  { transform: scale(3.0); opacity: 0;    }
                            100% { transform: scale(3.0); opacity: 0;    }
                        }
                        @keyframes tg-ring {
                            0%, 100% { opacity: 0.6; }
                            50%      { opacity: 1;   }
                        }
                        @keyframes tg-core {
                            0%, 100% { opacity: 1;    }
                            50%      { opacity: 0.45; }
                        }
                        .${id}-sweep {
                            transform-origin: 20px 20px;
                            animation: tg-spin 3s linear infinite;
                        }
                        .${id}-ring-1 { animation: tg-ring 3.5s 0s    ease-in-out infinite; }
                        .${id}-ring-2 { animation: tg-ring 3.5s 1.17s ease-in-out infinite; }
                        .${id}-ring-3 { animation: tg-ring 3.5s 2.33s ease-in-out infinite; }
                        .${id}-blip-a {
                            transform-origin: 29px 10px;
                            animation: tg-blip 3s 0.35s linear infinite;
                        }
                        .${id}-blip-b {
                            transform-origin: 8px 13px;
                            animation: tg-blip 3s 2.50s linear infinite;
                        }
                        .${id}-core {
                            transform-origin: 20px 20px;
                            animation: tg-core 1.5s ease-in-out infinite;
                        }
                        @media (prefers-reduced-motion: reduce) {
                            .${id}-sweep, .${id}-ring-1, .${id}-ring-2, .${id}-ring-3,
                            .${id}-blip-a, .${id}-blip-b, .${id}-core {
                                animation: none !important;
                            }
                        }
                    `}</style>
                )}

                {/* Sweep gradient (static version): center → leading edge */}
                <linearGradient id={sw} x1="20" y1="20" x2="35.6" y2="11" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#7C3AED" />
                    <stop offset="1" stopColor="#E879F9" />
                </linearGradient>
                {/* Radial fill for animated sweep sector — angle-independent */}
                <radialGradient id={rf} cx="20" cy="20" r="18" gradientUnits="userSpaceOnUse">
                    <stop offset="0%"   stopColor="#8B5CF6" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#E879F9" stopOpacity="0.04" />
                </radialGradient>
                {/* Center dot gradient: bright core → fuchsia */}
                <radialGradient id={cd} cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#EC4899" />
                </radialGradient>
            </defs>

            {/* Radar rings — outer → inner, wave-pulse when animated */}
            <circle className={animated ? `${id}-ring-1` : undefined} cx="20" cy="20" r="18" stroke="#7C3AED" strokeWidth="0.75" strokeOpacity="0.3" />
            <circle className={animated ? `${id}-ring-2` : undefined} cx="20" cy="20" r="13" stroke="#7C3AED" strokeWidth="0.75" strokeOpacity="0.55" />
            <circle className={animated ? `${id}-ring-3` : undefined} cx="20" cy="20" r="8"  stroke="#8B5CF6" strokeWidth="1"    strokeOpacity="0.75" />

            {/* Crosshair — faint dashes, always static */}
            <line x1="20" y1="2"  x2="20" y2="38" stroke="#8B5CF6" strokeWidth="0.4" strokeOpacity="0.2" strokeDasharray="1.5 2.5" />
            <line x1="2"  y1="20" x2="38" y2="20" stroke="#8B5CF6" strokeWidth="0.4" strokeOpacity="0.2" strokeDasharray="1.5 2.5" />

            {/* Sweep arm — the whole group rotates when animated */}
            <g className={animated ? `${id}-sweep` : undefined}>
                <path
                    d="M20 20 L20 2 A18 18 0 0 1 35.6 11 Z"
                    fill={animated ? `url(#${rf})` : `url(#${sw})`}
                    fillOpacity={animated ? 1 : 0.18}
                />
                {/* Trailing edge */}
                <line x1="20" y1="20" x2="20"   y2="2"  stroke="#7C3AED" strokeWidth="0.75" strokeOpacity="0.45" />
                {/* Leading edge */}
                <line x1="20" y1="20" x2="35.6" y2="11" stroke="#E879F9" strokeWidth="1.5"  strokeLinecap="round" />
            </g>

            {/* Secondary detected lead — upper-right */}
            <circle cx="29" cy="10" r="3.5" fill="#7C3AED" fillOpacity="0.18" />
            {animated && <circle cx="29" cy="10" r="3.5" className={`${id}-blip-a`} fill="#A78BFA" />}
            <circle cx="29" cy="10" r="2" fill="#A78BFA" />

            {/* Tertiary lead — upper-left */}
            {animated && <circle cx="8" cy="13" r="2.2" className={`${id}-blip-b`} fill="#7C3AED" />}
            <circle cx="8" cy="13" r="1.3" fill="#7C3AED" fillOpacity="0.55" />

            {/* Center — captured lead, heartbeat when animated */}
            <circle cx="20" cy="20" r="5.5" fill="#EC4899" fillOpacity="0.18" />
            <circle cx="20" cy="20" r="3"   fill={`url(#${cd})`} className={animated ? `${id}-core` : undefined} />
        </svg>
    );
}

export function TrackGoLogo({
    variant = "full",
    size = "md",
    className = "",
    theme = "light",
    animated = false,
}: {
    variant?: TrackGoLogoVariant;
    size?: TrackGoLogoSize;
    className?: string;
    theme?: TrackGoLogoTheme;
    animated?: boolean;
}) {
    const px = MARK_PX[size];
    const id = `tg-${size}`;

    if (variant === "mark") {
        return (
            <span className={`inline-flex items-center justify-center ${className}`}>
                <RadarMark px={px} id={id} animated={animated} />
            </span>
        );
    }

    const trackColor = theme === "dark" ? "text-white" : "text-[#101936]";
    const goGradient = theme === "dark"
        ? "from-[#A78BFA] to-[#F0ABFC]"
        : "from-[#6D28D9] to-[#7C3AED]";

    return (
        <span className={`inline-flex items-center ${GAP[size]} ${className}`}>
            <RadarMark px={px} id={id} animated={animated} />
            <span className={`font-black leading-none tracking-tight ${FONT[size]} ${trackColor}`}>
                Track<span className={`bg-gradient-to-r ${goGradient} bg-clip-text text-transparent`}>Go</span>
            </span>
        </span>
    );
}
