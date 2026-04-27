'use client';

import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { FileText, Book, Banknote, TrendingUp, TrendingDown, Package, Warehouse, ArrowRightLeft, Users, UserCheck, BarChartHorizontal, Repeat, BarChart, DollarSign, PackageCheck, ClipboardCheck, Truck, Landmark, Calculator, Gift, SlidersHorizontal, Briefcase, ShoppingCart, AlertTriangle, Target, Tags, Contact2, HandCoins, BookOpen, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const reports = [
  {
    title: 'All Transactions',
    description: 'View and filter all recorded transactions.',
    href: '/reports/all-transactions',
    icon: <FileText className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Statistics',
    description: 'View top products, customers, and other insights.',
    href: '/reports/statistics',
    icon: <TrendingUp className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Day Book',
    description: 'A summary of all transactions for a specific day.',
    href: '/reports/day-book',
    icon: <Book className="h-8 w-8 text-primary" />,
  },
    {
    title: 'Daily Balance Audit',
    description: 'Review daily opening and closing balances to find discrepancies.',
    href: '/reports/daily-balance-audit',
    icon: <BookOpen className="h-8 w-8 text-indigo-500" />,
  },
  {
    title: 'Cash Register',
    description: 'Track the flow of cash in and out of your business.',
    href: '/reports/cash-register',
    icon: <Banknote className="h-8 w-8 text-primary" />,
  },
   {
    title: 'Cash Flow',
    description: 'Track the flow of cash in and out of your business.',
    href: '/reports/cash-flow',
    icon: <DollarSign className="h-8 w-8 text-primary" />,
  },
   {
    title: 'Profit/Loss Report',
    description: 'Analyze business profitability over a period.',
    href: '/reports/profit-loss',
    icon: <BarChartHorizontal className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Net Profit Report',
    description: 'Income and Stock Profitability minus Expenses.',
    href: '/reports/net-profit',
    icon: <BarChart className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Sales Report',
    description: 'View and filter all cash and credit sales.',
    href: '/reports/sales',
    icon: <ShoppingCart className="h-8 w-8 text-green-600" />,
  },
  {
    title: 'Sales Target & Achieve',
    description: 'Set and track sales targets for products.',
    href: '/reports/sales-target',
    icon: <Target className="h-8 w-8 text-blue-500" />,
  },
  {
    title: 'Custom Profit Management',
    description: 'Calculate profit with custom parameters and adjustments.',
    href: '/reports/custom-profit',
    icon: <Calculator className="h-8 w-8 text-teal-500" />,
  },
  {
    title: 'Custom Project Management',
    description: 'Track income, expenses, and profitability for specific projects.',
    href: '/reports/custom-project-management',
    icon: <Briefcase className="h-8 w-8 text-indigo-500" />,
  },
   {
    title: 'Loan Management',
    description: 'Track and manage all loan accounts and EMIs.',
    href: '/reports/loan-management',
    icon: <Landmark className="h-8 w-8 text-purple-500" />,
  },
  {
    title: 'Truck & Gift Track',
    description: 'Manage truck deliveries and track gift distributions.',
    href: '/reports/truck-gift-track',
    icon: <Gift className="h-8 w-8 text-orange-500" />,
  },
  {
    title: 'Expense Report',
    description: 'Analyze all your business and personal expenses.',
    href: '/reports/expense',
    icon: <TrendingDown className="h-8 w-8 text-destructive" />,
  },
  {
    title: 'Income Report',
    description: 'Track all sources of your income.',
    href: '/reports/income',
    icon: <TrendingUp className="h-8 w-8 text-green-600" />,
  },
    {
    title: 'Party Profitability',
    description: 'See which customers are most profitable.',
    href: '/reports/party-profitability',
    icon: <Users className="h-8 w-8 text-green-600" />,
  },
  {
    title: 'Stock Profitability',
    description: 'Analyze profit margins for each product.',
    href: '/reports/stock-profitability',
    icon: <PackageCheck className="h-8 w-8 text-green-600" />,
  },
  {
    title: 'Purchase Report',
    description: 'Review all purchase transactions.',
    href: '/reports/purchase',
    icon: <Package className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Purchase Details',
    description: 'View a detailed list of all purchased items.',
    href: '/reports/purchase-details',
    icon: <Package className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Stock In/Out Report',
    description: 'Track all product movements (sold, added).',
    href: '/reports/stock-in-out',
    icon: <Repeat className="h-8 w-8 text-cyan-500" />,
  },
  {
    title: 'Stock Valuation Report',
    description: 'View stock value based on cost and sale price.',
    href: '/reports/stock-valuation',
    icon: <DollarSign className="h-8 w-8 text-green-500" />,
  },
  {
    title: 'Low Stock Report',
    description: 'Identify products that are running low in stock.',
    href: '/reports/low-stock',
    icon: <Warehouse className="h-8 w-8 text-yellow-500" />,
    disabled: false,
  },
   {
    title: 'Delivery Report',
    description: 'Track deliveries and manage payments for delivery personnel.',
    href: '/reports/delivery',
    icon: <Truck className="h-8 w-8 text-blue-500" />,
  },
  {
    title: 'Stock & Cash Audit',
    description: 'Physically verify stock and cash against system records.',
    href: '/reports/stock-audit',
    icon: <ClipboardCheck className="h-8 w-8 text-teal-500" />,
  },
  {
    title: 'Stock Adjustment Report',
    description: 'View a log of all manual stock adjustments.',
    href: '/reports/stock-adjustment',
    icon: <SlidersHorizontal className="h-8 w-8 text-indigo-500" />,
  },
  {
    title: 'Transfer Report',
    description: 'See all internal account-to-account transfers.',
    href: '/reports/transfer',
    icon: <ArrowRightLeft className="h-8 w-8 text-blue-500" />,
  },
  {
    title: 'Party Statement',
    description: 'Generate and save a custom statement for a party.',
    href: '/reports/party-statement',
    icon: <Users className="h-8 w-8 text-primary" />,
  },
  {
    title: 'Warehouse In/Out Report',
    description: 'Track stock movements between different warehouses/locations.',
    href: '/reports/warehouse-in-out',
    icon: <Warehouse className="h-8 w-8 text-indigo-500" />,
  },
  {
    title: 'Suspicious Transactions',
    description: 'Review potentially duplicate or erroneous entries.',
    href: '/reports/suspicious-transactions',
    icon: <AlertTriangle className="h-8 w-8 text-orange-500" />,
  },
   {
    title: 'Update Prices',
    description: 'Bulk update sale and wholesale prices for all products.',
    href: '/reports/update-prices',
    icon: <Tags className="h-8 w-8 text-teal-500" />,
  },
];

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
        <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Reports Center</h1>
            <p className="text-muted-foreground mt-1">Generate and view detailed reports for your business.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {reports.map((report) => (
            <Link 
              key={report.title} 
              href={report.href} 
              className={cn(report.disabled && 'pointer-events-none opacity-50')}
              aria-disabled={report.disabled}
              tabIndex={report.disabled ? -1 : undefined}
            >
              <Card className="hover:shadow-lg transition-shadow h-full flex flex-col items-center justify-center text-center p-6">
                <CardHeader className="flex-row items-start gap-4 space-y-0">
                  <div className="flex-shrink-0">{report.icon}</div>
                  <div>
                    <CardTitle>{report.title}</CardTitle>
                    <CardDescription>{report.description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
    </Suspense>
  );
}
