import Link from "next/link";
import type { ReactNode } from "react";
import { AppIcon, type AppIconName, type AppIconTone } from "./AppIcon";

const baseClassName =
    "flex items-center gap-3 rounded-2xl border border-[#e4e7ec] bg-white px-3 py-3 text-left shadow-sm transition hover:border-[#c4b5fd] hover:bg-[#f8f7ff]";

export function ActionTile({
    href,
    label,
    icon,
    tone = "purple",
    external,
}: {
    href: string;
    label: string;
    icon: AppIconName;
    tone?: AppIconTone;
    external?: boolean;
}) {
    const content = <ActionTileContent label={label} icon={icon} tone={tone} />;

    if (external) {
        return (
            <a href={href} target="_blank" rel="noreferrer" className={baseClassName}>
                {content}
            </a>
        );
    }

    return (
        <Link href={href} className={baseClassName}>
            {content}
        </Link>
    );
}

export function ActionTileButton({
    label,
    icon,
    tone = "purple",
    children,
    onClick,
    disabled,
}: {
    label: string;
    icon: AppIconName;
    tone?: AppIconTone;
    children?: ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`${baseClassName} disabled:cursor-not-allowed disabled:opacity-50`}
        >
            <ActionTileContent label={label} icon={icon} tone={tone} />
            {children}
        </button>
    );
}

function ActionTileContent({
    label,
    icon,
    tone,
}: {
    label: string;
    icon: AppIconName;
    tone: AppIconTone;
}) {
    return (
        <>
            <AppIcon name={icon} tone={tone} size="md" />
            <span className="text-[12px] font-bold text-[#101936]">{label}</span>
        </>
    );
}
