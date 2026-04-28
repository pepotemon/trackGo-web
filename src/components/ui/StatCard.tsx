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
        <div className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <p className="text-[12px] font-medium text-[#71717a]">{label}</p>
            <p className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-[#171717]">
                {value}
            </p>
            {caption ? (
                <p className="mt-1 text-[12px] font-medium text-[#9ca3af]">
                    {caption}
                </p>
            ) : null}
        </div>
    );
}