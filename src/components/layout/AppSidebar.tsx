'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, useSidebar } from '@/components/ui/sidebar';
import { ArrowRightLeft, Archive, Banknote, Users, FileText, CheckSquare, FilePlus, ShoppingCart, Settings, FileStack, Shield, History, WalletCards, Wrench, HeartPulse, Home, Gift, Bell, CalendarClock, Bot, Undo, Notebook, Lock, Contact2, ClipboardCheck, Briefcase, AlertTriangle, Search, MessageSquareWarning, Wrench as ToolkitIcon, Construction, Shapes, Store, BookOpen, Database, Dumbbell, Package, HardDriveDownload, ShieldCheck } from 'lucide-react';

const navItems = [
    { href: "/", label: "Home", icon: <Home className="h-4 w-4" /> },
    { href: "/transactions", label: "Transactions", icon: <ArrowRightLeft className="h-4 w-4" /> },
    { href: "/contacts", label: "Contacts", icon: <Contact2 className="h-4 w-4" /> },
    { href: "/plan", label: "Plan", icon: <CalendarClock className="h-4 w-4" /> },
    { href: "/pos", label: "POS", icon: <ShoppingCart className="h-4 w-4" /> },
    { href: "/po-rt", label: "PO", icon: <Briefcase className="h-4 w-4" /> },
    { href: "/billing", label: "Billing", icon: <FileStack className="h-4 w-4" /> },
    { href: "/order-management", label: "Order Management", icon: <Package className="h-4 w-4" /> },
    { href: "/sale-returns", label: "Sale Returns", icon: <Undo className="h-4 w-4" /> },
    { href: "/purchase-returns", label: "Purchase Returns", icon: <Undo className="h-4 w-4" /> },
    { href: "/inventory", label: "Inventory", icon: <Archive className="h-4 w-4" /> },
    { href: "/store", label: "Store", icon: <Store className="h-4 w-4" /> },
    { href: "/accounts", label: "Accounts", icon: <Banknote className="h-4 w-4" /> },
    { href: "/parties", label: "Parties", icon: <Users className="h-4 w-4" /> },
    { href: "/notes", label: "Notes", icon: <Notebook className="h-4 w-4" /> },
    { href: "/reminders", label: "Reminders", icon: <Bell className="h-4 w-4" /> },
    { href: "/auto-transactions", label: "Auto Transactions", icon: <Bot className="h-4 w-4" /> },
    { href: "/activity-log", label: "Activity Log", icon: <History className="h-4 w-4" /> },
    { href: "/log-record", label: "Log Record", icon: <BookOpen className="h-4 w-4" /> },
    { href: "/sms-reminder", label: "SMS", icon: <MessageSquareWarning className="h-4 w-4" /> },
    { href: "/reports", label: "Reports", icon: <FileText className="h-4 w-4" /> },
    { href: "/business-report", label: "Business Report", icon: <FileText className="h-4 w-4" /> },
    { href: "/tools", label: "Tools", icon: <ToolkitIcon className="h-4 w-4" /> },
    { href: "/toolkit", label: "Toolkit", icon: <ToolkitIcon className="h-4 w-4" /> },
    { href: "/backupandrestore", label: "Backup & Restore", icon: <HardDriveDownload className="h-4 w-4" /> },
    { href: "/rules-privacy", label: "Rules & Privacy", icon: <ShieldCheck className="h-4 w-4" /> },
    { href: "/widgets", label: "Widgets", icon: <Shapes className="h-4 w-4" /> },
    { href: "/telegram-notification", label: "Telegram Notification", icon: <MessageSquareWarning className="h-4 w-4" /> },
    { href: "/ecare", label: "Ecare", icon: <HeartPulse className="h-4 w-4" /> },
    { href: "/service-and-care", label: "Service & Care", icon: <Wrench className="h-4 w-4" /> },
    { href: "/web-seba", label: "Web Seba", icon: <Construction className="h-4 w-4" /> },
    { href: "/tasks", label: "Tasks", icon: <CheckSquare className="h-4 w-4" /> },
    { href: "/missing-transaction-finder", label: "Missing Transaction Finder", icon: <Search className="h-4 w-4" /> },
    { href: "/tools/find-trnx-with-sms", label: "Find Trnx With SMS", icon: <Search className="h-4 w-4" /> },
    { href: "/tools/fitness-challenge", label: "Fitness Challenge", icon: <Dumbbell className="h-4 w-4" /> },
    { href: "/tools/registration-database", label: "Registration DB", icon: <Database className="h-4 w-4" /> },
    { href: "/lalmonirhat-elite-club", label: "Lalmonirhat Elite Club", icon: <Users className="h-4 w-4" /> },
    { href: "/tools/news-management", label: "News Management", icon: <FileText className="h-4 w-4" /> },
    { href: "/portal/login", label: "Portal", icon: <Shield className="h-4 w-4" /> },
    { href: "/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
    { href: "/settings/page-lock", label: "Page Lock", icon: <Lock className="h-4 w-4" /> },
    { href: "/settings/shop-start-close", label: "Shop Start & Close", icon: <Store className="h-4 w-4" /> },
    { href: "/reports/daily-balance-audit", label: "Daily Balance Audit", icon: <BookOpen className="h-4 w-4" /> },
    { href: "/news", label: "News", icon: <FileText className="h-4 w-4" /> },
];

export function AppSidebar() {
    const pathname = usePathname();
    const { setOpen, setOpenMobile } = useSidebar();

    const handleLinkClick = () => {
        setOpen(false);
        setOpenMobile(false);
    };

    return (
        <Sidebar>
            <SidebarHeader>
                 {/* Optional Header Content */}
            </SidebarHeader>
            <SidebarContent>
                <SidebarMenu>
                    {navItems.map((item) => (
                        <SidebarMenuItem key={item.href}>
                            <SidebarMenuButton asChild isActive={pathname === item.href} onClick={handleLinkClick} tooltip={item.label}>
                                <Link href={item.href}>
                                    {item.icon}
                                    <span>{item.label}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </SidebarContent>
            <SidebarFooter>
                 {/* Optional Footer Content */}
            </SidebarFooter>
        </Sidebar>
    );
};