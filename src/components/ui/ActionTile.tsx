import Link from "next/link";
import type { ReactNode } from "react";
import { AppIcon, type AppIconName, type AppIconTone } from "./AppIcon";

const baseClassName =
    "flex w-full items-center gap-3 rounded-[18px] border border-[#e7e9f3] bg-white px-3.5 py-3 text-left shadow-[0_10px_26px_rgba(31,41,55,0.06)] transition active:scale-[0.99] active:bg-[#f7f4ff] disabled:cursor-not-allowed disabled:opacity-50 xl:w-auto xl:rounded-2xl xl:border-[#e4e7ec] xl:bg-white xl:px-3 xl:py-3 xl:shadow-sm xl:hover:border-[#c4b5fd] xl:hover:bg-[#f8f7ff] xl:active:scale-100";

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
            className={baseClassName}
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
            <span className="min-w-0 flex-1 truncate text-[13px] font-black text-[#172033] xl:text-[12px] xl:font-bold xl:text-[#101936]">
                {label}
            </span>
        </>
    );
}