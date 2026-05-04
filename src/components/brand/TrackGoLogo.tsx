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

function RadarMark({ px, id }: { px: number; id: string }) {
    const sw = `${id}-sw`;
    const cd = `${id}-cd`;
    return (
        <svg width={px} height={px} viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <defs>
                {/* Sweep gradient: center → leading edge */}
                <linearGradient id={sw} x1="20" y1="20" x2="35.6" y2="11" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#7C3AED" />
                    <stop offset="1" stopColor="#E879F9" />
                </linearGradient>
                {/* Center dot gradient: bright core → fuchsia */}
                <radialGradient id={cd} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#EC4899" />
                </radialGradient>
            </defs>

            {/* Radar rings — outer → inner */}
            <circle cx="20" cy="20" r="18" stroke="#7C3AED" strokeWidth="0.75" strokeOpacity="0.3" />
            <circle cx="20" cy="20" r="13" stroke="#7C3AED" strokeWidth="0.75" strokeOpacity="0.55" />
            <circle cx="20" cy="20" r="8"  stroke="#8B5CF6" strokeWidth="1"    strokeOpacity="0.75" />

            {/* Sweep sector: 12 o'clock → ~2 o'clock (60° arc) */}
            <path
                d="M20 20 L20 2 A18 18 0 0 1 35.6 11 Z"
                fill={`url(#${sw})`}
                fillOpacity="0.18"
            />
            {/* Trailing edge (straight up) */}
            <line x1="20" y1="20" x2="20"   y2="2"  stroke="#7C3AED"        strokeWidth="0.75" strokeOpacity="0.45" />
            {/* Leading edge (gradient) */}
            <line x1="20" y1="20" x2="35.6" y2="11" stroke={`url(#${sw})`}  strokeWidth="1.5"  strokeLinecap="round" />

            {/* Crosshair — very faint dashes */}
            <line x1="20" y1="2"  x2="20" y2="38" stroke="#8B5CF6" strokeWidth="0.4" strokeOpacity="0.2" strokeDasharray="1.5 2.5" />
            <line x1="2"  y1="20" x2="38" y2="20" stroke="#8B5CF6" strokeWidth="0.4" strokeOpacity="0.2" strokeDasharray="1.5 2.5" />

            {/* Secondary detected lead — inside sweep, upper-right */}
            <circle cx="29" cy="10" r="3.5" fill="#7C3AED" fillOpacity="0.18" />
            <circle cx="29" cy="10" r="2"   fill="#A78BFA" />

            {/* Tertiary lead — upper-left, outside sweep */}
            <circle cx="8" cy="13" r="1.3" fill="#7C3AED" fillOpacity="0.55" />

            {/* Center — captured lead */}
            <circle cx="20" cy="20" r="5.5" fill="#EC4899" fillOpacity="0.18" />
            <circle cx="20" cy="20" r="3"   fill={`url(#${cd})`} />
        </svg>
    );
}

export function TrackGoLogo({
    variant = "full",
    size = "md",
    className = "",
    theme = "light",
}: {
    variant?: TrackGoLogoVariant;
    size?: TrackGoLogoSize;
    className?: string;
    theme?: TrackGoLogoTheme;
}) {
    const px = MARK_PX[size];
    const id = `tg-${size}`;

    if (variant === "mark") {
        return (
            <span className={`inline-flex items-center justify-center ${className}`}>
                <RadarMark px={px} id={id} />
            </span>
        );
    }

    const trackColor  = theme === "dark" ? "text-white" : "text-[#101936]";
    const goGradient  = theme === "dark"
        ? "from-[#A78BFA] to-[#F0ABFC]"
        : "from-[#6D28D9] to-[#7C3AED]";

    return (
        <span className={`inline-flex items-center ${GAP[size]} ${className}`}>
            <RadarMark px={px} id={id} />
            <span className={`font-black leading-none tracking-tight ${FONT[size]} ${trackColor}`}>
                Track<span className={`bg-gradient-to-r ${goGradient} bg-clip-text text-transparent`}>Go</span>
            </span>
        </span>
    );
}
