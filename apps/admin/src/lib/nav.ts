import { resolve } from '$app/paths';
import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
import PackageIcon from '@lucide/svelte/icons/package';
import BoxesIcon from '@lucide/svelte/icons/boxes';
import UsersIcon from '@lucide/svelte/icons/users';
import ScanBarcodeIcon from '@lucide/svelte/icons/scan-barcode';
import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
import SettingsIcon from '@lucide/svelte/icons/settings';
import PaletteIcon from '@lucide/svelte/icons/palette';
import PuzzleIcon from '@lucide/svelte/icons/puzzle';
import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
import TagsIcon from '@lucide/svelte/icons/tags';
import TruckIcon from '@lucide/svelte/icons/truck';
import CalendarRangeIcon from '@lucide/svelte/icons/calendar-range';
import PlugIcon from '@lucide/svelte/icons/plug';
import LandmarkIcon from '@lucide/svelte/icons/landmark';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import type { MessageKey } from './i18n/index.svelte.ts';

/** Base-path aware link helper. */
export const to = (p: string) => resolve(p as any);

export interface NavItem {
  href: string;
  key: MessageKey;
  icon: typeof LayoutDashboardIcon;
  /** Shown only to members with this permission. */
  perm?: string;
}

export const NAV: NavItem[] = [
  { href: '/', key: 'nav.dashboard', icon: LayoutDashboardIcon },
  { href: '/orders', key: 'nav.orders', icon: ClipboardListIcon },
  { href: '/products', key: 'nav.products', icon: PackageIcon },
  { href: '/categories', key: 'nav.categories', icon: FolderTreeIcon },
  { href: '/pricing', key: 'nav.pricing', icon: TagsIcon },
  { href: '/inventory', key: 'nav.inventory', icon: BoxesIcon },
  { href: '/planner', key: 'nav.planner', icon: CalendarRangeIcon, perm: 'orders:read' },
  { href: '/customers', key: 'nav.customers', icon: UsersIcon },
  { href: '/scan', key: 'nav.scan', icon: ScanBarcodeIcon },
  { href: '/deliveries', key: 'nav.deliveries', icon: TruckIcon, perm: 'deliveries:read' },
  { href: '/maintenance', key: 'nav.maintenance', icon: WrenchIcon },
  { href: '/reports', key: 'nav.reports', icon: ChartColumnIcon },
  { href: '/accounting', key: 'nav.accounting', icon: LandmarkIcon, perm: 'accounting:read' },
];

/** Shop setup: storefront look, extensions and settings. */
export const NAV_CONFIGURE: NavItem[] = [
  { href: '/themes', key: 'nav.themes', icon: PaletteIcon },
  { href: '/pages', key: 'nav.pages', icon: FileTextIcon, perm: 'themes:manage' },
  { href: '/plugins', key: 'nav.plugins', icon: PuzzleIcon },
  { href: '/integrations', key: 'nav.integrations', icon: PlugIcon, perm: 'integrations:manage' },
  { href: '/audit', key: 'nav.audit', icon: ScrollTextIcon },
  { href: '/settings', key: 'nav.settings', icon: SettingsIcon },
];

type ScanHandler = (code: string) => boolean | Promise<boolean>;
let pageHandler: ScanHandler | null = null;

/** Pages that consume scans (order hub, scan screen) register here; return true when handled. */
export function setScanHandler(h: ScanHandler | null) {
  pageHandler = h;
  return () => {
    if (pageHandler === h) pageHandler = null;
  };
}

export function currentScanHandler() {
  return pageHandler;
}
