import { routing } from "./routing";
import { createNavigation } from "next-intl/navigation";

export const { Link, getPathname, redirect, usePathname, useRouter } = createNavigation(routing);
