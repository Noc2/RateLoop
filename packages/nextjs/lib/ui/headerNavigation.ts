export function isHeaderMenuLinkActive(pathname: string, href: string) {
  if (pathname === "/") return false;

  return pathname === href || pathname.startsWith(`${href}/`);
}
