import Image from "next/image";

type TrackGoLogoVariant = "full" | "mark";

export function TrackGoLogo({
    variant = "full",
    size = "md",
    className = "",
}: {
    variant?: TrackGoLogoVariant;
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
}) {
    const imageSize =
        variant === "mark"
            ? size === "xl"
                ? "h-28 w-28"
                : size === "lg"
                    ? "h-16 w-16"
                    : size === "sm"
                        ? "h-9 w-9"
                        : "h-11 w-11"
            : size === "xl"
                ? "h-36 w-40"
                : size === "lg"
                    ? "h-24 w-28"
                : size === "sm"
                        ? "h-10 w-12"
                        : "h-14 w-16";

    return (
        <span className={`relative inline-flex shrink-0 items-center justify-center ${imageSize} ${className}`}>
            <Image
                src="/brand/trackgo-logo-crop.png"
                alt="TrackGo"
                fill
                sizes={variant === "mark" ? "64px" : "160px"}
                priority={size === "lg" || size === "xl"}
                className="object-contain"
            />
        </span>
    );
}
