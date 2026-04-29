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
        <div className="rounded-lg border border-[#e4e7ec] bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#667085]">{label}</p>
            <p className="mt-2 font-mono text-[24px] font-medium tracking-[-0.04em] text-[#172033]">
                {value}
            </p>
            {caption ? (
                <p className="mt-1 text-[11px] font-medium text-[#667085]">
                    {caption}
                </p>
            ) : null}
        </div>
    );
}
