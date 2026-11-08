import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Base button. A owns this folder: set the look here once and every screen
 * inherits it. Renders a link when given `href`, so it stays keyboard and
 * screen-reader friendly either way.
 */
type Common = { children: ReactNode; variant?: "primary" | "secondary" | "alternate"; className?: string };
type AsLink = Common & { href: string } & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;
type AsButton = Common & { href?: undefined } & Omit<ComponentProps<"button">, "className" | "children">;

const base =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
const variants = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-border bg-background text-foreground hover:bg-surface",
  /** The other way forward, e.g. Ask something else: teal, so it never reads as the main action. */
  alternate: "border-2 border-accent-2 text-accent-2 hover:bg-accent-2/10",
};

export function Button(props: AsLink | AsButton) {
  const { children, variant = "primary", className = "", ...rest } = props;
  const classes = `${base} ${variants[variant]} ${className}`.trim();
  if (props.href !== undefined) {
    const { href, ...linkProps } = rest as Omit<AsLink, keyof Common>;
    return (
      <Link href={href} {...linkProps} className={classes}>
        {children}
      </Link>
    );
  }
  const buttonProps = rest as Omit<AsButton, keyof Common>;
  return (
    <button type="button" {...buttonProps} className={classes}>
      {children}
    </button>
  );
}
