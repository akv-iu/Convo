import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Base button. A owns this folder: set the look here once and every screen
 * inherits it. Renders a link when given `href`, so it stays keyboard and
 * screen-reader friendly either way.
 */
type Common = { children: ReactNode; variant?: "primary" | "secondary"; className?: string };
type AsLink = Common & { href: string } & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;
type AsButton = Common & { href?: undefined } & Omit<ComponentProps<"button">, "className" | "children">;

const base =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
const variants = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "border border-border bg-background text-foreground hover:bg-surface",
};

export function Button(props: AsLink | AsButton) {
  const { children, variant = "primary", className = "" } = props;
  const classes = `${base} ${variants[variant]} ${className}`;
  if (props.href !== undefined) {
    const { href, ...rest } = props as AsLink;
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  const { ...rest } = props as AsButton;
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
