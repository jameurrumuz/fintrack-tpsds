'use client';

import { Suspense } from 'react';
import PlanClientPage from './PlanClientPage';
import { Loader2 } from 'lucide-react';

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
      <PlanClientPage />
    </Suspense>
  );
}
