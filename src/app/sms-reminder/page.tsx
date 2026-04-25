'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Loader2, MessageSquareWarning, MessageSquarePlus, Info, Smartphone, Cog, CheckCircle, AlertCircle, Database, History, Search, Pin, PinOff, MessageSquarePlus as MessageSquarePlusIcon, Send } from 'lucide-react';
import type { Party, Transaction, AppSettings, SmsLog, SmsTemplate, SmsPackage } from '@/types';
import { subscribeToParties } from '@/services/partyService';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { getAppSettings, saveAppSettings } from '@/services/settingsService';
import { useToast } from '@/hooks/use-toast';
import { getPartyBalanceEffect, formatAmount } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, parseISO, differenceInDays } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { subscribeToSmsLogs, markFailedLogsAsRead } from '@/services/smsLogService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';
import { sendSmsAction } from './actions';


const SmsLanguageDialog = ({ open, onOpenChange, onSend }: { open: boolean; onOpenChange: (open: boolean) => void; onSend: (lang: 'en' | 'bn', includeBalance: boolean) => void }) => {
    const [includeBalance, setIncludeBalance] = useState(true);
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Choose SMS Language</AlertDialogTitle>
                    <AlertDialogDescriptionComponent>Select the language for the SMS receipt.</AlertDialogDescriptionComponent>
                </AlertDialogHeader>
                 <div className="flex items-center space-x-2 my-4">
                    <Checkbox id="include-balance-receipt-sms" checked={includeBalance} onCheckedChange={(checked) => setIncludeBalance(!!checked)} />
                    <Label htmlFor="include-balance-receipt-sms">পূর্বের বকেয়াসহ</Label>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button onClick={() => onSend('bn', includeBalance)}>Send Bengali</Button>
                    <Button onClick={() => onSend('en', includeBalance)}>Send English</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};


const SendSmsDialog = ({ party, appSettings, onSend }: { party: Party | null, appSettings: AppSettings | null, onSend: (to: string, message: string) => Promise<void> }) => {
    const defaultBusinessName = appSettings?.businessProfiles?.[0]?.name || 'our company';
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isSmsLangDialogOpen, setIsSmsLangDialogOpen] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if(party){
             setMessage(`Dear ${party.name}, your current due is BDT ${formatAmount(Math.abs(party.balance || 0), false)}. Please clear your dues as soon as possible. Thank you. - ${defaultBusinessName}`);
        }
    }, [party, defaultBusinessName]);


    const generateSmsMessage = (lang: 'en' | 'bn', includeBalance: boolean): string => {
        if (!party) return '';
        const amountStr = formatAmount(Math.abs(party.balance || 0), false);
        const businessName = defaultBusinessName;

        let baseMessage: string;
        if (lang === 'bn') {
            baseMessage = `প্রিয় ${party.name}, আপনার বর্তমান বকেয়া ${amountStr}। অনুগ্রহ করে দ্রুত বকেয়া পরিশোধ করুন। ধন্যবাদ, ${businessName}`;
        } else {
            baseMessage = `Dear ${party.name}, your current due is BDT ${amountStr}. Please clear your dues as soon as possible. Thank you. - ${businessName}`;
        }
        
        return `${baseMessage}`;
    };


    const handleSendSms = (lang: 'en' | 'bn', includeBalance: boolean) => {
        if (!party || !party.phone) {
            toast({ variant: 'destructive', title: 'Cannot send SMS', description: 'Party phone number is missing.'});
            return;
        }
        const generatedMessage = generateSmsMessage(lang, includeBalance);
        setMessage(generatedMessage);
        setIsSmsLangDialogOpen(false);
    };

    const handleFinalSend = async () => {
        if (!party || !party.phone) return;
        setIsSending(true);
        await onSend(party.phone, message);
        setIsSending(false);
    };
    
    if (!party) return null;

    return (
        <>
        <SmsLanguageDialog open={isSmsLangDialogOpen} onOpenChange={setIsSmsLangDialogOpen} onSend={handleSendSms} />
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Send SMS to {party.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
                <div>
                    <Label>Phone Number</Label>
                    <Input value={party.phone} readOnly />
                </div>
                <div>
                    <Label>Message</Label>
                    <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} />
                </div>
                 <Button variant="outline" size="sm" onClick={() => setIsSmsLangDialogOpen(true)}>
                    Generate Message
                </Button>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button onClick={handleFinalSend} disabled={isSending}>
                    {isSending ? <Loader2 className="animate-spin mr-2" /> : <MessageSquarePlus className="mr-2 h-4 w-4" />}
                    Send SMS
                </Button>
            </DialogFooter>
        </DialogContent>
        </>
    )
};


const ResendSmsDialog = ({ log, open, onOpenChange, onResend }: { log: SmsLog | null, open: boolean, onOpenChange: (open: boolean) => void, onResend: (to: string, message: string) => Promise<void> }) => {
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);

    useEffect(() => {
        if (log) {
            setMessage(log.message);
        }
    }, [log]);

    if (!log) return null;

    const handleResend = async () => {
        setIsSending(true);
        await onResend(log.to, message);
        setIsSending(false);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Resend SMS to {log.partyName}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <Label>Phone Number</Label>
                        <Input value={log.to} readOnly />
                    </div>
                    <div>
                        <Label>Message</Label>
                        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={8} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleResend} disabled={isSending}>
                        {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                        Resend SMS
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export default function SmsReminderPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [selectedParty, setSelectedParty] = useState<(Party & { balance: number }) | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [amountFilter, setAmountFilter] = useState('');

  const [selectedTemplateType, setSelectedTemplateType] = useState<SmsTemplate['type']>('creditSale');
  const [editedTemplates, setEditedTemplates] = useState<Record<string, string>>({});
  
  const [resendingLog, setResendingLog] = useState<SmsLog | null>(null);
  
  const defaultMessages: Partial<Record<SmsTemplate['type'], string>> = {
    creditSaleWithPartPayment: "Dear {partyName}, Your Previous Due {previousDue} Tk, Todays Bill {amount} Tk Inv No- {invoiceNumber} Date {date}, Your Current Balance {currentBalance} Tk.Thank You - {businessName}",
    cashSaleWithOverpayment: "Dear {partyName}, Your Bill {amount} Tk Inv No- {invoiceNumber}. Previous Due {previousDue} Tk, You Paid {paidAmount} Tk. Current Balance {currentBalance} Tk. Thank You - {businessName}",
  };

  useEffect(() => {
    const unsubParties = subscribeToParties(setParties, (err) => toast({ variant: 'destructive', title: 'Error fetching parties', description: err.message }));
    const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: err.message }));
    
    const unsubSmsLogs = subscribeToSmsLogs((logs) => {
        setSmsLogs(logs);
        const hasUnreadFailedLogs = logs.some(log => log.status === 'failed' && !log.isRead);
        if (hasUnreadFailedLogs) {
             markFailedLogsAsRead(logs.filter(l => l.status === 'failed' && !l.isRead).map(l => l.id));
        }
    }, (err) => toast({ variant: 'destructive', title: 'Error fetching SMS logs', description: err.message }));
    
    async function loadSettings() {
      try {
        const mainSettings = await getAppSettings();
        setAppSettings(mainSettings);

      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error loading settings', description: error.message });
      } finally {
        setLoading(false);
      }
    }

    loadSettings();

    return () => {
      unsubParties();
      unsubTransactions();
      unsubSmsLogs();
    };
  }, [toast]);
  
  const currentMessage = useMemo(() => {
    if (editedTemplates[selectedTemplateType] !== undefined) {
      return editedTemplates[selectedTemplateType];
    }
    const template = appSettings?.smsTemplates?.find(t => t.type === selectedTemplateType);
    return template?.message || defaultMessages[selectedTemplateType] || '';
  }, [selectedTemplateType, editedTemplates, appSettings, defaultMessages]);
  
  const handleCurrentMessageChange = (value: string) => {
    setEditedTemplates(prev => ({
      ...prev,
      [selectedTemplateType]: value
    }));
  };

  const handleSaveTemplates = async () => {
    if (!appSettings) return;

    const currentTemplates = Array.isArray(appSettings.smsTemplates) ? appSettings.smsTemplates : [];
    const templateMap = new Map(currentTemplates.map(t => [t.type, t]));

    for (const [type, message] of Object.entries(editedTemplates)) {
        if (templateMap.has(type as SmsTemplate['type'])) {
            templateMap.get(type as SmsTemplate['type'])!.message = message;
        } else {
            templateMap.set(type as SmsTemplate['type'], { id: type, type: type as SmsTemplate['type'], message });
        }
    }
    
    const updatedTemplates = Array.from(templateMap.values());
    
    try {
      await saveAppSettings({ ...appSettings, smsTemplates: updatedTemplates });
      setAppSettings(prev => ({...prev!, smsTemplates: updatedTemplates}));
      setEditedTemplates({}); // Clear edits after saving
      toast({ title: 'Success', description: 'SMS templates saved!' });
    } catch(e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save templates.' });
    }
  };

  const partyBalances = useMemo(() => {
    const balances: { [partyId: string]: number } = {};
    for (const tx of transactions) {
      if (tx.partyId && tx.enabled) {
        if (!balances[tx.partyId]) balances[tx.partyId] = 0;
        balances[tx.partyId] += getPartyBalanceEffect(tx, false);
      }
    }
    return balances;
  }, [transactions]);
  
  const receivableParties = useMemo(() => {
    return parties
      .map(party => ({
        ...party,
        balance: partyBalances[party.id] || 0,
      }))
      .filter(party => {
          const balance = party.balance;
          const isReceivable = balance < 0;
          const nameMatch = searchTerm ? party.name.toLowerCase().includes(searchTerm.toLowerCase()) : true;
          const amountMatch = amountFilter ? Math.abs(balance) >= parseFloat(amountFilter) : true;
          return isReceivable && nameMatch && amountMatch;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [parties, partyBalances, searchTerm, amountFilter]);


  const handleSendSms = async (to: string, message: string) => {
    try {
        const result = await sendSmsAction(to, message);
        if (result.success) {
            toast({ title: 'Success', description: 'SMS has been sent.' });
        } else {
            throw new Error(result.error || 'An unknown error occurred.');
        }
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'SMS Failed', description: error.message });
    }
  };

  const isSmsServiceEnabled = appSettings?.smsServiceEnabled ?? true; // Default to true if not set

  const handleSmsServiceToggle = async (enabled: boolean) => {
    if (!appSettings) return;
    try {
        const newSettings = { ...appSettings, smsServiceEnabled: enabled };
        await saveAppSettings(newSettings);
        setAppSettings(newSettings); // Update local state to reflect change instantly
        toast({ title: `SMS Service ${enabled ? 'Enabled' : 'Disabled'}` });
    } catch(error: any) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not update settings.' });
    }
  };
  
   const handleSmsProviderChange = async (provider: 'twilio' | 'smsq' | 'pushbullet') => {
    if (!appSettings) return;
    try {
      const newSettings = { ...appSettings, smsProvider: provider };
      await saveAppSettings(newSettings);
      setAppSettings(newSettings);
      toast({ title: 'SMS Provider Updated', description: `Now using ${provider.toUpperCase()}.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update SMS provider.' });
    }
  };

  const placeholders = [
    { value: '{partyName}', description: 'গ্রাহকের নাম' },
    { value: '{amount}', description: 'বর্তমান বিল' },
    { value: '{PartPaymentAmount}', description: 'আংশিক জমা'},
    { value: '{invoiceNumber}', description: 'চালান নম্বর' },
    { value: '{businessName}', description: 'আপনার ব্যবসার নাম' },
    { value: '{date}', description: 'লেনদেনের তারিখ' },
    { value: '{previousDue}', description: 'পূর্বের বকেয়া' },
    { value: '{currentBalance}', description: 'মোট বকেয়া' }
  ];

  const addPlaceholder = (placeholder: string) => {
    handleCurrentMessageChange(currentMessage + placeholder);
  };
  
  const [newSmsPackage, setNewSmsPackage] = useState<Omit<SmsPackage, 'id'>>({ provider: 'Twilio', purchaseDate: format(new Date(), 'yyyy-MM-dd'), quantity: 0, cost: 0, expiryDate: '' });
  const [editingSmsPackage, setEditingSmsPackage] = useState<SmsPackage | null>(null);
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
  
  const [alertSettings, setAlertSettings] = useState({ lowBalanceThreshold: 500, expiryWarningDays: 7 });

  useEffect(() => {
    if (appSettings?.smsAlertSettings) {
        setAlertSettings(appSettings.smsAlertSettings);
    }
  }, [appSettings]);

  const handleSaveSmsPackage = async (pkg: Omit<SmsPackage, 'id'>) => {
    if (!appSettings) return;

    let updatedPackages: SmsPackage[];

    if (editingSmsPackage) {
        updatedPackages = (appSettings.smsPackages || []).map(p => p.id === editingSmsPackage.id ? { ...editingSmsPackage, ...pkg } : p);
    } else {
        const newPackage: SmsPackage = { ...pkg, id: `pkg-${Date.now()}` };
        updatedPackages = [...(appSettings.smsPackages || []), newPackage];
    }
    
    await saveAppSettings({ ...appSettings, smsPackages: updatedPackages });
    toast({ title: 'Success', description: `SMS package ${editingSmsPackage ? 'updated' : 'added'}.` });
    setNewSmsPackage({ provider: 'Twilio', purchaseDate: format(new Date(), 'yyyy-MM-dd'), quantity: 0, cost: 0, expiryDate: '' });
    setEditingSmsPackage(null);
    setIsPackageDialogOpen(false);
  };
  
  const handleDeleteSmsPackage = async (packageId: string) => {
    if (!appSettings) return;
    const updatedPackages = (appSettings.smsPackages || []).filter(pkg => pkg.id !== packageId);
    try {
        await saveAppSettings({ ...appSettings, smsPackages: updatedPackages });
        setAppSettings(prev => ({...prev!, smsPackages: updatedPackages}));
        toast({ title: 'Success', description: 'SMS package removed.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };
  
  const openEditPackageDialog = (pkg: SmsPackage) => {
    setEditingSmsPackage(pkg);
    setNewSmsPackage(pkg);
    setIsPackageDialogOpen(true);
  };
  
  const openNewPackageDialog = () => {
    setEditingSmsPackage(null);
    setNewSmsPackage({ provider: 'Twilio', purchaseDate: format(new Date(), 'yyyy-MM-dd'), quantity: 0, cost: 0, expiryDate: '' });
    setIsPackageDialogOpen(true);
  };


  const handleSaveAlerts = async () => {
     if (!appSettings) return;
     await saveAppSettings({ ...appSettings, smsAlertSettings: alertSettings });
     toast({ title: 'Success', description: 'Alert settings updated.'});
  };

  const smsStatsByProvider = useMemo(() => {
    const providers: Array<SmsPackage['provider']> = ['Twilio', 'SMSQ', 'Pushbullet'];
    const stats: Record<string, { remaining: number; totalSent: number; expiryDate: Date | null; daysUntilExpiry: number | null }> = {};
  
    providers.forEach(provider => {
        const lowerCaseProvider = provider.toLowerCase();
        
        const packagesForProvider = (appSettings?.smsPackages || []).filter(pkg => pkg.provider.toLowerCase() === lowerCaseProvider);
        const totalPurchased = packagesForProvider.reduce((sum, pkg) => sum + (pkg.quantity || 0), 0);
        
        const totalSent = smsLogs.filter(log => log.provider.toLowerCase() === lowerCaseProvider).reduce((sum, log) => sum + (log.segments || 0), 0);

        const remaining = totalPurchased - totalSent;

        const latestPackage = [...packagesForProvider].sort((a,b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime())[0];
        const expiryDate = latestPackage?.expiryDate ? parseISO(latestPackage.expiryDate) : null;
        const daysUntilExpiry = expiryDate ? differenceInDays(expiryDate, new Date()) : null;

        stats[provider] = { 
            remaining: isNaN(remaining) ? 0 : remaining, 
            totalSent: isNaN(totalSent) ? 0 : totalSent, 
            expiryDate, 
            daysUntilExpiry 
        };
    });

    return stats;
  }, [appSettings?.smsPackages, smsLogs]);


  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <MessageSquareWarning/> SMS Reminder 
            <span className="text-muted-foreground text-lg font-medium">/</span> 
            <History className="h-7 w-7 text-muted-foreground"/> 
            <span className="text-muted-foreground text-2xl font-semibold">SMS Log</span>
        </h1>
        <p className="text-muted-foreground mt-1">Manage receivable reminders, configure your SMS service, and view sent message history.</p>
      </div>
      
       <Dialog open={!!selectedParty} onOpenChange={(open) => !open && setSelectedParty(null)}>
        {selectedParty && <SendSmsDialog party={selectedParty} appSettings={appSettings} onSend={handleSendSms} />}
      </Dialog>
      
      <ResendSmsDialog
        log={resendingLog}
        open={!!resendingLog}
        onOpenChange={() => setResendingLog(null)}
        onResend={handleSendSms}
      />
      
      <Tabs defaultValue="sender">
        <TabsList>
            <TabsTrigger value="sender">SMS Sender</TabsTrigger>
            <TabsTrigger value="templates">SMS Templates</TabsTrigger>
            <TabsTrigger value="log">SMS Log</TabsTrigger>
            <TabsTrigger value="count">SMS Count & Recharge</TabsTrigger>
        </TabsList>
        <TabsContent value="sender" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card>
                  <CardHeader>
                    <CardTitle>Party Receivables</CardTitle>
                    <CardDescription>List of parties from whom you have to collect money.</CardDescription>
                     <div className="flex flex-col sm:flex-row gap-2 pt-2">
                        <div className="relative flex-grow">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
                            <Input placeholder="Search by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9"/>
                        </div>
                        <div className="relative flex-grow">
                            <Label htmlFor="amount-filter" className="sr-only">Amount greater than</Label>
                            <Input id="amount-filter" type="number" placeholder="Amount greater than..." value={amountFilter} onChange={e => setAmountFilter(e.target.value)} />
                        </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="flex justify-center items-center h-48"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>
                    ) : (
                      <div className="rounded-md border h-96 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Party Name</TableHead>
                              <TableHead className="text-right">Amount Due</TableHead>
                              <TableHead className="text-center">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {receivableParties.length > 0 ? receivableParties.map(party => (
                              <TableRow key={party.id}>
                                <TableCell className="font-medium">{party.name}</TableCell>
                                <TableCell className={cn("text-right font-mono", party.balance < 0 ? 'text-green-600' : 'text-red-600')}>
                                  {formatAmount(Math.abs(party.balance))}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Dialog>
                                    <DialogTrigger asChild>
                                       <Button size="sm" variant="outline" disabled={!party.phone || !isSmsServiceEnabled} onClick={() => setSelectedParty(party)}>
                                        <MessageSquarePlus className="mr-2 h-4 w-4"/> Send SMS
                                       </Button>
                                    </DialogTrigger>
                                    {selectedParty && selectedParty.id === party.id && (
                                        <SendSmsDialog party={selectedParty} appSettings={appSettings} onSend={handleSendSms} />
                                    )}
                                  </Dialog>
                                </TableCell>
                              </TableRow>
                            )) : (
                              <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center">No receivables found.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Cog/> SMS Service Configuration</CardTitle>
                    <CardDescription>Configure how SMS messages are sent from your application.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Switch 
                          id="sms-service-toggle" 
                          checked={isSmsServiceEnabled}
                          onCheckedChange={handleSmsServiceToggle}
                        />
                        <Label htmlFor="sms-service-toggle">Enable SMS Service</Label>
                      </div>

                      {!isSmsServiceEnabled && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>SMS Service Disabled</AlertTitle>
                          <AlertDescription>
                            The SMS sending feature is currently turned off. Enable it to send reminders.
                          </AlertDescription>
                        </Alert>
                      )}
                        <div className="space-y-2">
                            <Label>Active SMS Provider</Label>
                            <RadioGroup 
                                value={appSettings?.smsProvider || 'twilio'} 
                                onValueChange={(value) => handleSmsProviderChange(value as 'twilio' | 'smsq' | 'pushbullet')}
                                className="grid grid-cols-3 gap-4"
                            >
                                <div>
                                    <RadioGroupItem value="twilio" id="twilio" className="peer sr-only" />
                                    <Label htmlFor="twilio" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                        Twilio
                                    </Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="smsq" id="smsq" className="peer sr-only" />
                                    <Label htmlFor="smsq" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                        SMSQ
                                    </Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="pushbullet" id="pushbullet" className="peer sr-only" />
                                    <Label htmlFor="pushbullet" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                        Pushbullet
                                    </Label>
                                </div>
                            </RadioGroup>
                       </div>
                        <div className="space-y-2">
                             <Button variant="outline" asChild>
                                <Link href="/settings">Configure Credentials</Link>
                            </Button>
                       </div>
                  </CardContent>
                </Card>
            </div>
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
             <Card>
                <CardHeader>
                    <CardTitle>SMS Templates</CardTitle>
                    <CardDescription>
                       Customize messages for different transaction types.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="template-type">Template Type</Label>
                        <Select value={selectedTemplateType} onValueChange={(v) => setSelectedTemplateType(v as SmsTemplate['type'])}>
                            <SelectTrigger id="template-type">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="creditSale">Credit Sale</SelectItem>
                                <SelectItem value="creditSaleWithPartPayment">Credit Sale With Part Payment</SelectItem>
                                <SelectItem value="cashSale">Cash Sale</SelectItem>
                                <SelectItem value="cashSaleWithOverpayment">Cash Sale With Overpayment</SelectItem>
                                <SelectItem value="receivePayment">Payment Received</SelectItem>
                                <SelectItem value="givePayment">Payment Given</SelectItem>
                                <SelectItem value="paymentReminder">Payment Reminder</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="template-message">Message Template</Label>
                        <Textarea
                            id="template-message"
                            value={currentMessage}
                            onChange={(e) => handleCurrentMessageChange(e.target.value)}
                            rows={5}
                            placeholder="Type your SMS template here..."
                        />
                    </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Click to add placeholders:</Label>
                        <div className="flex flex-wrap gap-2">
                            {placeholders.map(p => (
                                <Button key={p.value} type="button" size="sm" variant="outline" className="h-auto flex flex-col items-start p-2" onClick={() => addPlaceholder(p.value)}>
                                    <span className="font-mono text-xs">{p.value}</span>
                                    <span className="text-xs text-muted-foreground">{p.description}</span>
                                </Button>
                            ))}
                        </div>
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={handleSaveTemplates}>Save Templates</Button>
                </CardFooter>
            </Card>
        </TabsContent>
        <TabsContent value="log">
            <Card>
                <CardHeader>
                    <CardTitle>Sent SMS Log</CardTitle>
                    <CardDescription>History of all SMS messages sent from the system.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border h-[60vh] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>To</TableHead>
                                    <TableHead>Message</TableHead>
                                    <TableHead>Provider</TableHead>
                                    <TableHead>Segments</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {smsLogs.length > 0 ? smsLogs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell>{format(parseISO(log.createdAt), 'dd/MM/yy p')}</TableCell>
                                        <TableCell>{log.partyName} ({log.to})</TableCell>
                                        <TableCell className="text-xs">{log.message}</TableCell>
                                        <TableCell><Badge variant="outline">{log.provider}</Badge></TableCell>
                                        <TableCell className="text-center">{log.segments}</TableCell>
                                        <TableCell>
                                            {log.status === 'success' ? (
                                                <Badge className="bg-green-100 text-green-700"><CheckCircle className="mr-1 h-3 w-3"/> Success</Badge>
                                            ) : (
                                                <Badge variant="destructive" className="bg-red-100 text-red-700"><AlertCircle className="mr-1 h-3 w-3" />Failed</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => setResendingLog(log)}>
                                                Resend
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow><TableCell colSpan={7} className="h-24 text-center">No SMS logs found.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
         <TabsContent value="count" className="mt-4">
            <div className="space-y-4">
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Object.entries(smsStatsByProvider).map(([provider, stats]) => (
                        <Card key={provider}>
                            <CardHeader className="pb-2"><CardTitle className="text-lg font-semibold">{provider}</CardTitle></CardHeader>
                            <CardContent>
                                <div className="space-y-1 text-sm">
                                    <div className="flex justify-between"><span>Remaining:</span> <span className="font-bold">{stats.remaining || 0}</span></div>
                                    <div className="flex justify-between"><span>Sent:</span> <span className="font-bold">{stats.totalSent || 0}</span></div>
                                    <div className="flex justify-between"><span>Expiry:</span> <span className="font-bold">{stats.expiryDate ? formatDate(stats.expiryDate.toISOString()) : 'N/A'}</span></div>
                                    {stats.daysUntilExpiry !== null && <p className="text-xs text-muted-foreground">{stats.daysUntilExpiry} days remaining</p>}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Add/Edit SMS Package</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <div className="space-y-1"><Label>Provider</Label>
                                <Select value={newSmsPackage.provider} onValueChange={v => setNewSmsPackage(p => ({ ...p, provider: v as any }))}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Twilio">Twilio</SelectItem>
                                        <SelectItem value="SMSQ">SMSQ</SelectItem>
                                        <SelectItem value="Pushbullet">Pushbullet</SelectItem>
                                    </SelectContent>
                                </Select>
                             </div>
                            <div className="space-y-1"><Label>Purchase Date</Label><Input type="date" value={newSmsPackage.purchaseDate} onChange={e => setNewSmsPackage(p => ({ ...p, purchaseDate: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>SMS Quantity</Label><Input type="number" value={newSmsPackage.quantity || ''} onChange={e => setNewSmsPackage(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} placeholder="e.g., 10000" /></div>
                            <div className="space-y-1"><Label>Total Cost (BDT)</Label><Input type="number" value={newSmsPackage.cost || ''} onChange={e => setNewSmsPackage(p => ({ ...p, cost: parseFloat(e.target.value) || 0 }))} placeholder="e.g., 3500" /></div>
                            <div className="space-y-1"><Label>Expiry Date</Label><Input type="date" value={newSmsPackage.expiryDate} onChange={e => setNewSmsPackage(p => ({ ...p, expiryDate: e.target.value }))} /></div>
                        </CardContent>
                        <CardFooter>
                            <Button onClick={() => handleSaveSmsPackage(newSmsPackage)}><Package className="mr-2 h-4 w-4"/> Save Package</Button>
                        </CardFooter>
                    </Card>
                     <Card>
                        <CardHeader><CardTitle>Notification Settings</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                             <div className="space-y-2">
                                <Label>Low Balance Threshold</Label>
                                <Input type="number" value={alertSettings.lowBalanceThreshold} onChange={e => setAlertSettings(s => ({...s, lowBalanceThreshold: parseInt(e.target.value) || 0}))} />
                                <p className="text-xs text-muted-foreground">Notify when balance is below this number.</p>
                            </div>
                            <div className="space-y-2">
                                <Label>Expiry Warning (Days)</Label>
                                <Input type="number" value={alertSettings.expiryWarningDays} onChange={e => setAlertSettings(s => ({...s, expiryWarningDays: parseInt(e.target.value) || 0}))} />
                                <p className="text-xs text-muted-foreground">Notify this many days before expiry.</p>
                            </div>
                        </CardContent>
                         <CardFooter>
                            <Button onClick={handleSaveAlerts}>Save Alert Settings</Button>
                        </CardFooter>
                    </Card>
                </div>
                 <Card>
                    <CardHeader><CardTitle>Purchase History</CardTitle></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>Purchase Date</TableHead><TableHead>Quantity</TableHead><TableHead>Cost</TableHead><TableHead>Expiry Date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {(appSettings?.smsPackages || []).sort((a,b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()).map(pkg => (
                                    <TableRow key={pkg.id}>
                                        <TableCell><Badge variant="outline">{pkg.provider}</Badge></TableCell>
                                        <TableCell>{formatDate(pkg.purchaseDate)}</TableCell>
                                        <TableCell>{pkg.quantity}</TableCell>
                                        <TableCell>{formatAmount(pkg.cost)}</TableCell>
                                        <TableCell>{formatDate(pkg.expiryDate)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => openEditPackageDialog(pkg)}><Edit className="h-4 w-4"/></Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleDeleteSmsPackage(pkg.id)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}