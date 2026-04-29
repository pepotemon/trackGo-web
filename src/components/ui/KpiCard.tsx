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
        <div className={`relative overflow-hidden rounded-2xl border border-[#e7e8f0] bg-gradient-to-br ${fillColors[tone]} to-white p-5 shadow-[0_16px_42px_rgba(16,25,54,0.08)]`}>
            <div className="flex items-start gap-4">
                <AppIcon name={icon} tone={tone} size="lg" />

                <div className="min-w-0">
                    <p className={`text-[11px] font-extrabold uppercase tracking-[0.06em] ${labelColors[tone]}`}>
                        {label}
                    </p>
                    <p className="mt-2 font-mono text-[30px] font-semibold leading-none tracking-[-0.05em] text-[#101936]">
                        {value}
                    </p>
                    {caption ? (
                        <p className="mt-2 max-w-[160px] text-[12px] font-medium leading-snug text-[#66739a]">
                            {caption}
                        </p>
                    ) : null}
                </div>
            </div>

            <svg aria-hidden="true" viewBox="0 0 96 50" className="mt-5 h-12 w-full">
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
