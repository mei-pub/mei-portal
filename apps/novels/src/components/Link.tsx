import type { AnchorHTMLAttributes } from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  // Keep the prop API compatible with next/link while forcing full navigation.
  prefetch?: boolean;
};

export default function Link({ href, prefetch: _prefetch, ...props }: LinkProps) {
  const basePath = "/novels";
  const isExternal = /^(https?:|mailto:|tel:|#|data:|blob:)/i.test(href);
  const hasBasePath = href === basePath || href.startsWith(`${basePath}/`);
  const resolvedHref = isExternal || hasBasePath
    ? href
    : `${basePath}${href.startsWith("/") ? "" : "/"}${href}`;

  return <a href={resolvedHref} {...props} />;
}
