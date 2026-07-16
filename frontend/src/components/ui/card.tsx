import * as React from "react";

import { cn } from "./utils";

function Card({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("relative flex flex-col gap-0 overflow-hidden", className)}
      style={{
        background: "linear-gradient(160deg, rgba(28,28,38,0.96) 0%, rgba(20,20,27,0.98) 100%)",
        border: "1px solid rgba(201,160,92,0.15)",
        borderRadius: "var(--radius-lg, 20px)",
        boxShadow:
          "0 0 0 1px rgba(201,160,92,0.06) inset, 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.35)",
        color: "var(--text-primary, #EAE2D6)",
        ...style,
      }}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-5 pt-5 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <h4
      data-slot="card-title"
      className={cn("leading-none text-sm font-semibold tracking-[-0.01em]", className)}
      style={{ color: "var(--text-primary, #EAE2D6)", fontFamily: "var(--font-display)" }}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-[12px] leading-relaxed", className)}
      style={{ color: "var(--text-secondary, #999186)" }}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 [&:last-child]:pb-5", className)}
      {...props}
    />
  );
}

function CardFooter({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-5 pb-5", className)}
      style={{
        borderTop: "1px solid rgba(201,160,92,0.08)",
        paddingTop: "16px",
        ...style,
      }}
      {...props}
    />
  );
}

function CardInner({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-inner"
      className={cn("rounded-[14px] p-4", className)}
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset",
        ...style,
      }}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardInner,
};
