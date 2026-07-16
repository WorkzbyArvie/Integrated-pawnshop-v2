import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-semibold tracking-[-0.01em] text-sm",
    "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)]",
    "active:scale-[0.97]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "text-[#0A0A0F]",
          "rounded-[14px]",
        ].join(" "),
        destructive: [
          "text-white",
          "rounded-[14px]",
        ].join(" "),
        outline: [
          "rounded-[14px]",
        ].join(" "),
        secondary: [
          "rounded-[14px]",
        ].join(" "),
        ghost: [
          "rounded-[12px]",
        ].join(" "),
        link: "text-[var(--gold)] underline-offset-4 hover:underline rounded-none",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-[12px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "size-10 rounded-[12px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const VARIANT_STYLES: Record<string, React.CSSProperties> = {
  default: {
    background: "linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)",
    border: "1px solid rgba(201,160,92,0.5)",
    boxShadow: "0 0 0 1px rgba(201,160,92,0.2) inset, 0 4px 14px rgba(201,160,92,0.22), 0 1px 0 rgba(255,255,255,0.18) inset",
    color: "#0A0A0F",
  },
  destructive: {
    background: "linear-gradient(135deg, #D44545 0%, #A83030 100%)",
    border: "1px solid rgba(212,69,69,0.45)",
    boxShadow: "0 0 0 1px rgba(212,69,69,0.15) inset, 0 4px 14px rgba(212,69,69,0.2)",
    color: "#fff",
  },
  outline: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(201,160,92,0.22)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset",
    color: "var(--text-primary)",
  },
  secondary: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset",
    color: "var(--text-primary)",
  },
  ghost: {
    background: "transparent",
    border: "1px solid transparent",
    boxShadow: "none",
    color: "var(--text-secondary)",
  },
  link: {},
  icon: {},
};

const VARIANT_HOVER_STYLES: Record<string, React.CSSProperties> = {
  default: {
    boxShadow: "0 0 0 1px rgba(201,160,92,0.3) inset, 0 6px 20px rgba(201,160,92,0.3)",
    filter: "brightness(1.08)",
  },
  destructive: {
    boxShadow: "0 0 0 1px rgba(212,69,69,0.2) inset, 0 6px 20px rgba(212,69,69,0.28)",
    filter: "brightness(1.08)",
  },
  outline: {
    background: "rgba(201,160,92,0.07)",
    borderColor: "rgba(201,160,92,0.35)",
  },
  secondary: {
    background: "rgba(255,255,255,0.09)",
    borderColor: "rgba(255,255,255,0.16)",
  },
  ghost: {
    background: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
    color: "var(--text-primary)",
  },
  link: {},
  icon: {},
};

function Button({
  className,
  variant = "default",
  size,
  asChild = false,
  style,
  onMouseEnter,
  onMouseLeave,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  const [hovered, setHovered] = React.useState(false);

  const baseStyle = VARIANT_STYLES[variant as string] ?? {};
  const hoverStyle = hovered ? (VARIANT_HOVER_STYLES[variant as string] ?? {}) : {};

  const hasIconOnly = size === "icon";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      style={{
        ...baseStyle,
        ...hoverStyle,
        ...style,
      }}
      onMouseEnter={e => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={e => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
      {...props}
    >
      {hasIconOnly ? (
        <span
          className="flex items-center justify-center w-full h-full transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ transform: hovered ? "scale(1.12)" : "scale(1)" }}
        >
          {children}
        </span>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
