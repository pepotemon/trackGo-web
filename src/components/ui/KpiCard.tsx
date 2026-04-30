import { AppIcon, type AppIconName, type AppIconTone } from "./AppIcon";

const lineColors: Record<AppIconTone, string> = {
    blue: "#2563eb",
    purple: "#7c3aed",
    orange: "#f97316",
    red: "#f43f5e",
    green: "#10b981",
    slate: "#64748b",
};

const labelColors: Record<AppIconTone, string> = {
    blue: "text-blue-600",
    purple: "text-violet-600",
    orange: "text-orange-500",
    red: "text-rose-500",
    green: "text-emerald-600",
    slate: "text-slate-600",
};

const fillColors: Record<AppIconTone, string> = {
    blue: "from-blue-50/70",
    purple: "from-violet-50/70",
    orange: "from-orange-50/70",
    red: "from-rose-50/70",
    green: "from-emerald-50/70",
    slate: "from-slate-50/70",
};

const pathByTone: Record<AppIconTone, string> = {
    blue: "M2 38 C12 28 18 45 30 34 S48 18 58 31 S76 48 94 34",
    purple: "M2 34 C12 14 20 44 32 26 S51 17 61 35 S80 45 94 25",
    orange: "M2 37 C11 20 21 30 30 25 S43 16 51 31 S68 38 76 29 S87 23 94 34",
    red: "M2 36 C12 16 20 45 31 28 S43 18 52 36 S68 43 78 30 S88 18 94 34",
    green: "M2 38 C14 31 20 33 30 25 S45 19 55 29 S72 39 94 22",
    slate: "M2 35 C13 30 24 40 35 33 S53 25 64 31 S82 40 94 32",
};

export function KpiCard({
    label,
    value,
    caption,
    icon,
    tone = "purple",
}: {
    label: string;
    value: string | number;
    caption?: string;
    icon: AppIconName;
    tone?: AppIconTone;
}) {
    return (
        <div className={`relative overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#111827] p-3 shadow-[0_12px_30px_rgba(0,0,0,0.16)] sm:p-5 xl:rounded-2xl xl:border-[#e7e8f0] xl:bg-gradient-to-br ${fillColors[tone]} xl:to-white xl:shadow-[0_16px_42px_rgba(16,25,54,0.08)]`}>
            <div className="flex items-start gap-3 sm:gap-4">
                <AppIcon name={icon} tone={tone} size="md" className="sm:h-14 sm:w-14" />

                <div className="min-w-0">
                    <p className={`text-[10px] font-extrabold uppercase tracking-[0.06em] sm:text-[11px] ${labelColors[tone]}`}>
                        {label}
                    </p>
                    <p className="mt-1.5 break-words font-mono text-[clamp(18px,7vw,24px)] font-black leading-none tracking-[-0.04em] text-[#F9FAFB] sm:mt-2 sm:text-[clamp(20px,2.15vw,30px)] xl:font-semibold xl:text-[#101936]">
                        {value}
                    </p>
                    {caption ? (
                        <p className="mt-1.5 max-w-[160px] text-[11px] font-extrabold leading-snug text-[#9CA3AF] sm:mt-2 sm:text-[12px] xl:font-medium xl:text-[#66739a]">
                            {caption}
                        </p>
                    ) : null}
                </div>
            </div>

            <svg aria-hidden="true" viewBox="0 0 96 50" className="mt-3 h-8 w-full sm:mt-5 sm:h-12">
                <path
                    d={pathByTone[tone]}
                    fill="none"
                    stroke={lineColors[tone]}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                />
            </svg>
        </div>
    );
}
