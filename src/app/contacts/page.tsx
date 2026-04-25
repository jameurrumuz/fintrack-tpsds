
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Phone, Plus, Save, Delete, PhoneOutgoing, User, Search, Keyboard, MessageSquare, ArrowUp, ArrowDown, Notebook, Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { subscribeToParties, addParty } from '@/services/partyService';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { subscribeToNotes, addNote, updateNote, deleteNote } from '@/services/noteService';
import { subscribeToReminders } from '@/services/reminderService';
import type { Party, AppSettings, Transaction, Note, Reminder } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { PartyFormDialog } from '@/components/PartyManager'; 
import { getAppSettings } from '@/services/settingsService';
import { uploadImage } from '@/services/storageService';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnimatePresence, motion } from 'framer-motion';
import { getPartyBalanceEffect, formatAmount } from '@/lib/utils';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const DialPadButton = ({ number, letters, onClick }: { number: string; letters?: string; onClick: (num: string) => void }) => (
  <button onClick={() => onClick(number)} className="flex flex-col items-center justify-center h-16 rounded-full bg-muted/50 hover:bg-muted transition-colors">
    <span className="text-2xl font-light">{number}</span>
    {letters && <span className="text-xs tracking-widest text-muted-foreground">{letters}</span>}
  </button>
);

export default function ContactsPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [pinnedPartyIds, setPinnedPartyIds] = useState<string[]>([]);
  const [displayNumber, setDisplayNumber] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDialpad, setShowDialpad] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsubParties = subscribeToParties(setParties, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও' }));
    const unsubNotes = subscribeToNotes(setNotes, (err) => toast({ variant: 'destructive', title: 'Error fetching notes' }));
    const unsubReminders = subscribeToReminders(setReminders, (err) => {
        const pinned = err.message.split(',').filter(Boolean); // Assuming error message is a comma-separated list of IDs for now
        setPinnedPartyIds(pinned);
    });

    getAppSettings().then(setAppSettings);
    
    // Load pinned parties from local storage as a fallback/initial state
    const savedPinned = localStorage.getItem('pinnedContactIds');
    if (savedPinned) {
      setPinnedPartyIds(JSON.parse(savedPinned));
    }
    
    return () => {
      unsubParties();
      unsubTransactions();
      unsubNotes();
      unsubReminders();
    };
  }, [toast]);
  
  const partyBalances = useMemo(() => {
    const balances: { [partyId: string]: number } = {};
    for (const tx of transactions) {
        if (tx.partyId) {
            if (!balances[tx.partyId]) {
                balances[tx.partyId] = 0;
            }
            balances[tx.partyId] += getPartyBalanceEffect(tx, false);
        }
    }
    return balances;
  }, [transactions]);

  const handleDial = (num: string) => {
    setDisplayNumber(prev => prev + num);
  };

  const handleDelete = () => {
    setDisplayNumber(prev => prev.slice(0, -1));
  };

  const handleCall = () => {
    if (displayNumber) {
      window.location.href = `tel:${displayNumber}`;
    }
  };

  const handleSave = async (data: any, party: Party | null, imageFile: File | null) => {
    setIsSaving(true);
    let imageUrl = '';
    try {
        if (imageFile) {
            imageUrl = await uploadImage(imageFile, `party-images/${Date.now()}_${imageFile.name}`);
        }
        
        const finalData = { ...data, phone: displayNumber, imageUrl };
        await addParty(finalData as any);
        toast({ title: 'Success', description: 'Contact saved successfully.' });
        setDisplayNumber('');
        setIsDialogOpen(false);
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
        setIsSaving(false);
    }
  };
  
  const handleOpenWhatsApp = (phone: string | undefined) => {
    if (!phone) {
        toast({variant: 'destructive', title: 'No phone number available.'});
        return;
    }
    const whatsappUrl = `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;
    window.open(whatsappUrl, '_blank');
  };

  const togglePin = (partyId: string) => {
    const newPinnedIds = pinnedPartyIds.includes(partyId)
      ? pinnedPartyIds.filter(id => id !== partyId)
      : [...pinnedPartyIds, partyId];
    setPinnedPartyIds(newPinnedIds);
    localStorage.setItem('pinnedContactIds', JSON.stringify(newPinnedIds));
    // Here you would also save this to a remote service if needed
    // For example: savePinnedParties(newPinnedIds);
  };


  const filteredParties = useMemo(() => {
    return parties.filter(party => {
        const searchMatch = searchTerm 
            ? party.name.toLowerCase().includes(searchTerm.toLowerCase()) || party.phone?.includes(searchTerm)
            : true;
        return searchMatch;
    }).sort((a, b) => {
        const isAPinned = pinnedPartyIds.includes(a.id);
        const isBPinned = pinnedPartyIds.includes(b.id);
        if (isAPinned !== isBPinned) return isAPinned ? -1 : 1;
        return a.name.localeCompare(b.name)
    });
}, [parties, searchTerm, pinnedPartyIds]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PartyFormDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        onSave={handleSave} 
        party={null} 
        appSettings={appSettings} 
        allParties={parties} 
      />
      
      <div className="space-y-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
              placeholder="Search contacts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
          />
        </div>
         <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
           <Input 
              placeholder="Dial or enter a number..."
              value={displayNumber}
              onChange={(e) => setDisplayNumber(e.target.value)}
              className="pl-10 text-center text-lg font-semibold"
          />
        </div>
      </div>

      <ScrollArea className="flex-grow">
        <div className="space-y-2">
            {filteredParties.map(party => {
                 const balance = partyBalances[party.id] || 0;
                 const isReceivable = balance < 0;
                 const isPayable = balance > 0;
                 const isPinned = pinnedPartyIds.includes(party.id);
                
                return (
                    <Card key={party.id} className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Avatar>
                                <AvatarImage src={party.imageUrl} alt={party.name} />
                                <AvatarFallback>{party.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="font-semibold">{party.name}</p>
                                <p className="text-sm text-muted-foreground">{party.phone}</p>
                                 {(isReceivable || isPayable) && (
                                     <p className={cn("text-xs font-semibold flex items-center gap-1", isReceivable ? 'text-green-600' : 'text-red-600')}>
                                        {isReceivable ? <ArrowDown className="h-3 w-3"/> : <ArrowUp className="h-3 w-3"/>}
                                        {formatAmount(balance)}
                                     </p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button asChild size="icon" variant="ghost" className="text-blue-600 hover:text-blue-700">
                                <Link href={`/notes?partyId=${party.id}`}><Notebook className="h-5 w-5" /></Link>
                            </Button>
                            <Button onClick={() => togglePin(party.id)} size="icon" variant="ghost">
                                {isPinned ? <PinOff className="h-5 w-5 text-primary" /> : <Pin className="h-5 w-5" />}
                            </Button>
                            <Button onClick={() => handleOpenWhatsApp(party.phone)} size="icon" variant="ghost" className="text-green-600 hover:text-green-700">
                                <MessageSquare className="h-5 w-5" />
                            </Button>
                            {party.phone && (
                                <Button asChild size="icon" variant="ghost" className="text-green-600 hover:text-green-700">
                                <a href={`tel:${party.phone}`}><Phone className="h-5 w-5"/></a>
                                </Button>
                            )}
                        </div>
                    </Card>
                )
            })}
        </div>
      </ScrollArea>
      
       <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-sm border-t">
          <AnimatePresence>
            {showDialpad && (
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 50 }}
              >
                  <Card className="max-w-sm mx-auto shadow-lg mb-4">
                      <CardContent className="p-2 space-y-2">
                           <div className="grid grid-cols-3 gap-2">
                              <DialPadButton number="1" letters=" " onClick={handleDial} />
                              <DialPadButton number="2" letters="ABC" onClick={handleDial} />
                              <DialPadButton number="3" letters="DEF" onClick={handleDial} />
                              <DialPadButton number="4" letters="GHI" onClick={handleDial} />
                              <DialPadButton number="5" letters="JKL" onClick={handleDial} />
                              <DialPadButton number="6" letters="MNO" onClick={handleDial} />
                              <DialPadButton number="7" letters="PQRS" onClick={handleDial} />
                              <DialPadButton number="8" letters="TUV" onClick={handleDial} />
                              <DialPadButton number="9" letters="WXYZ" onClick={handleDial} />
                              <DialPadButton number="*" onClick={handleDial} />
                              <DialPadButton number="0" letters="+" onClick={handleDial} />
                              <DialPadButton number="#" onClick={handleDial} />
                          </div>
                      </CardContent>
                  </Card>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="grid grid-cols-3 gap-2 items-center max-w-sm mx-auto">
              <Button variant="ghost" onClick={() => setIsDialogOpen(true)} disabled={!displayNumber}>
                  <Save className="h-5 w-5" />
              </Button>
              <Button onClick={handleCall} className="h-16 w-16 rounded-full bg-green-600 hover:bg-green-700">
                  <Phone className="h-6 w-6"/>
              </Button>
              <div className="flex justify-between items-center">
                <Button variant="ghost" onClick={handleDelete}><Delete className="h-5 w-5" /></Button>
                <Button variant="ghost" onClick={() => setShowDialpad(!showDialpad)}><Keyboard className="h-5 w-5" /></Button>
              </div>
          </div>
       </div>
    </div>
  );
}
