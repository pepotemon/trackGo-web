export function StatCard({
    label,
    value,
    caption,
}: {
    label: string;
    value: string | number;
    caption?: string;
}) {
    return (
        <div className="rounded-[16px] border border-[#e8e7fb] bg-gradient-to-br from-white to-[#f8f7ff] p-3 shadow-[0_10px_28px_rgba(16,25,54,0.06)] sm:p-4 xl:rounded-lg xl:border-[#e4e7ec] xl:bg-white xl:shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085]">
                {label}
            </p>

            <p className="mt-1.5 font-mono text-[clamp(18px,6vw,24px)] font-black leading-none tracking-[-0.04em] text-[#101936] sm:mt-2 xl:text-[24px] xl:font-medium xl:text-[#172033]">
                {value}
            </p>

            {caption ? (
                <p className="mt-1 text-[11px] font-semibold text-[#667085] xl:font-medium">
                    {caption}
                </p>
            ) : null}
        </div>
    );
}