'use client';

import './globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from "@/components/ui/toaster";
import Header from '@/components/Header';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import BottomNavBar from '@/components/BottomNavBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { SecurityWrapper } from '@/components/layout/SecurityWrapper';
import { useEffect, useState, Suspense } from 'react';
import { applyTheme } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift();
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [userType, setUserType] = useState<string | undefined>(undefined);
  const [isMobileView, setIsMobileView] = useState<boolean>(false);
  const pathname = usePathname();
  let isMobile = useIsMobile();

  if (isMobileView) {
    isMobile = true;
  }

  useEffect(() => {
    const savedFontSize = localStorage.getItem('app-font-size');
    const savedThemeColors = localStorage.getItem('activeThemeColors');

    if (savedFontSize) {
      document.documentElement.style.fontSize = `${savedFontSize}px`;
    } else {
      document.documentElement.style.fontSize = '16px';
    }

    if (savedThemeColors) {
      try {
        const colors = JSON.parse(savedThemeColors);
        applyTheme({ colors } as any);
      } catch (e) {
        console.error("Failed to parse saved theme colors", e);
      }
    }
    
    setUserType(getCookie('userType'));
    setIsMobileView(getCookie('isMobileView') === 'true');

  }, [pathname]);
  
  const isNewsPage = pathname.startsWith('/news');
  const isPortalUser = userType === 'fin-plan-user' || userType === 'fin-plan-staff' || userType === 'fin-plan-admin';
  const isPublicAuthPage = pathname.startsWith('/portal/login') || pathname.startsWith('/portal/signup') || pathname.startsWith('/maintenance-e-service') || pathname.startsWith('/migration-guide.html') || pathname.startsWith('/tools/family-registration') || pathname.startsWith('/store');
  
  const showHeaderAndSidebar = !isPortalUser && !isPublicAuthPage && !pathname.startsWith('/pin-login') && !isNewsPage;
  const showBottomNav = showHeaderAndSidebar && isMobile && (pathname === '/' || pathname === '/transactions');

  return (
    <html lang="en" className={inter.variable}>
      <body>
         <SecurityWrapper>
            <SidebarProvider defaultOpen={true}>
                {showHeaderAndSidebar && <AppSidebar />}
                <SidebarInset className={cn(isPortalUser && "!ml-0")}>
                    {showHeaderAndSidebar && <Header />}
                    <div className={cn(
                        "p-4 md:p-6 lg:p-8",
                        showBottomNav && "pb-24",
                        (isPortalUser || isPublicAuthPage || isNewsPage) && "p-0 md:p-0 lg:p-0"
                    )}>
                        <main>
                          <Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
                            {children}
                          </Suspense>
                        </main>
                    </div>
                    {showBottomNav && <BottomNavBar />}
                </SidebarInset>
              <Toaster />
            </SidebarProvider>
        </SecurityWrapper>
      </body>
    </html>
  );
}
