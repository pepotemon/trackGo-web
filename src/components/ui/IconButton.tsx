import type { ButtonHTMLAttributes } from "react";
import { AppIcon, type AppIconName, type AppIconTone } from "./AppIcon";
import { Button } from "./Button";

type IconButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const toneByVariant: Record<IconButtonVariant, AppIconTone> = {
    primary: "purple",
    secondary: "slate",
    danger: "red",
    ghost: "slate",
};

export function IconButton({
    icon,
    label,
    tone,
    variant = "secondary",
    className = "",
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: AppIconName;
    label: string;
    tone?: AppIconTone;
    variant?: IconButtonVariant;
}) {
    return (
        <Button
            type="button"
            variant={variant}
            aria-label={label}
            title={label}
            className={`h-10 w-10 px-0 py-0 ${className}`}
            {...props}
        >
            <AppIcon
                name={icon}
                tone={tone ?? toneByVariant[variant]}
                size="sm"
                className={variant === "primary" ? "bg-transparent text-white ring-0" : "h-5 w-5 rounded-lg"}
            />
        </Button>
    );
}
