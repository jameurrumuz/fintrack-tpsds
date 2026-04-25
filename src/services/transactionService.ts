'use client';

import { db } from '@/lib/firebase';
import { Transaction, Party, InventoryItem, Account } from '@/types';
import { 
  collection, addDoc, doc, updateDoc, deleteDoc, 
  query, onSnapshot, where, orderBy, getDocs, 
  runTransaction, serverTimestamp, Timestamp, writeBatch, limit, getDoc, setDoc
} from 'firebase/firestore';
import { format as formatFns, parseISO, isValid } from 'date-fns';
import { getEffectiveAmount, getPartyBalanceEffect, cleanUndefined } from '@/lib/utils';
import { sendSmsViaSmsq } from './smsqService';
import { sendSmsViaTwilio } from './twilioService';
import { sendSmsViaPushbullet } from './pushbulletService';
import { getAppSettings } from './settingsService';

const getTransactionsCollection = () => db ? collection(db, 'transactions') : null;

export function subscribeToAllTransactions(
  onUpdate: (transactions: Transaction[]) => void,
  onError: (error: Error) => void
) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef) return () => {};

  // Simple query to avoid composite index requirements. Sorting is handled on the client side.
  const q = query(collectionRef);
  
  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
      } as Transaction;
    });

    // Client-side sorting: date descending, then createdAt descending
    transactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
    });

    onUpdate(transactions);
  }, (error) => {
      console.error("Subscription error:", error);
      onError(error as Error);
  });
}

export function subscribeToTransactionsForParty(
    partyId: string,
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef) return () => {};

    const q = query(collectionRef, where('partyId', '==', partyId));

    return onSnapshot(q, (snapshot) => {
        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
            } as Transaction;
        });

        // Client-side sorting
        transactions.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateB - dateA;
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
        });

        onUpdate(transactions);
    }, (error) => onError(error as Error));
}

export function subscribeToTransactionsForPartyIds(
    partyIds: string[],
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef || partyIds.length === 0) {
        onUpdate([]);
        return () => {};
    }

    const chunks = [];
    for (let i = 0; i < partyIds.length; i += 30) {
        chunks.push(partyIds.slice(i, i + 30));
    }

    const unsubscribes = chunks.map(chunk => {
        const q = query(collectionRef, where('partyId', 'in', chunk));
        return onSnapshot(q, (snapshot) => {
            const transactions = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
                } as Transaction;
            });
            onUpdate(transactions);
        }, (error) => onError(error as Error));
    });

    return () => unsubscribes.forEach(unsub => unsub());
}

export function subscribeToTransactionsForVerification(
    staffId: string,
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef) return () => {};

    const q = query(collectionRef, where('paymentStatus', '==', 'pending'));

    return onSnapshot(q, (snapshot) => {
        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
            } as Transaction;
        });
        onUpdate(transactions);
    }, (error) => onError(error as Error));
}

export function subscribeToPendingPayments(onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const coll = getTransactionsCollection();
    if (!coll) return () => {};
    const q = query(coll, where('paymentStatus', '==', 'pending'));
    return onSnapshot(q, (snap) => onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))), onError);
}

export function subscribeToNewOnlineOrders(onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const coll = getTransactionsCollection();
    if (!coll) return () => {};
    const q = query(coll, where('status', '==', 'pending'), where('adminNotified', '==', false));
    return onSnapshot(q, (snap) => onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))), onError);
}

export async function addTransaction(transactionData: Omit<Transaction, 'id'>): Promise<string> {
  if (!db) throw new Error('Firebase not configured');
  
  const cleanData = cleanUndefined({
    ...transactionData,
    createdAt: serverTimestamp(),
  });

  const docRef = await addDoc(collection(db, 'transactions'), cleanData);
  
  if (transactionData.partyId) {
    await recalculatePartyBalance(transactionData.partyId);
  }
  if (transactionData.accountId) {
    await recalculateAccountBalance(transactionData.accountId);
  }
  if (transactionData.involvedAccounts) {
    for (const accId of transactionData.involvedAccounts) {
        await recalculateAccountBalance(accId);
    }
  }

  return docRef.id;
}

export async function updateTransaction(id: string, updates: Partial<Transaction>): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const txRef = doc(db, 'transactions', id);
  const oldSnap = await getDoc(txRef);
  if (!oldSnap.exists()) throw new Error('Transaction not found');
  const oldData = oldSnap.data() as Transaction;

  const cleanUpdates = cleanUndefined(updates);
  await updateDoc(txRef, cleanUpdates);

  const partiesToSync = new Set([oldData.partyId, updates.partyId].filter(Boolean) as string[]);
  const accountsToSync = new Set([
      oldData.accountId, updates.accountId, 
      oldData.fromAccountId, updates.fromAccountId,
      oldData.toAccountId, updates.toAccountId,
      ...(oldData.involvedAccounts || []),
      ...(updates.involvedAccounts || [])
  ].filter(Boolean) as string[]);

  for (const pId of partiesToSync) await recalculatePartyBalance(pId);
  for (const aId of accountsToSync) await recalculateAccountBalance(aId);
}

export async function deleteTransaction(id: string): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const txRef = doc(db, 'transactions', id);
  const snap = await getDoc(txRef);
  if (!snap.exists()) return;
  const data = snap.data() as Transaction;

  await deleteDoc(txRef);

  if (data.partyId) await recalculatePartyBalance(data.partyId);
  if (data.accountId) await recalculateAccountBalance(data.accountId);
  if (data.involvedAccounts) {
    for (const accId of data.involvedAccounts) {
        await recalculateAccountBalance(accId);
    }
  }
}

export async function toggleTransaction(id: string, enabled: boolean): Promise<void> {
    await updateTransaction(id, { enabled });
}

export async function recalculateAccountBalance(accountId: string): Promise<void> {
    if (!db) return;
    const txsSnap = await getDocs(query(collection(db, 'transactions'), where('involvedAccounts', 'array-contains', accountId)));
    
    let balance = 0;
    txsSnap.docs.forEach(doc => {
        const tx = doc.data() as Transaction;
        if (!tx.enabled) return;

        if (tx.type === 'transfer') {
            if (tx.fromAccountId === accountId) balance -= tx.amount;
            if (tx.toAccountId === accountId) balance += tx.amount;
        } else if (tx.payments) {
            const p = tx.payments.find(pay => pay.accountId === accountId);
            if (p) balance += p.amount;
        } else if (tx.accountId === accountId) {
            balance += getEffectiveAmount(tx);
        }
    });

    await updateDoc(doc(db, 'accounts', accountId), { balance });
}

export async function recalculatePartyBalance(partyId: string): Promise<void> {
    if (!db) return;
    const txsSnap = await getDocs(query(collection(db, 'transactions'), where('partyId', '==', partyId)));
    
    let balance = 0;
    txsSnap.docs.forEach(doc => {
        const tx = doc.data() as Transaction;
        balance += getPartyBalanceEffect(tx, false);
    });

    await updateDoc(doc(db, 'parties', partyId), { balance });
}

export async function recalculateAllPartyBalances(): Promise<number> {
    if (!db) return 0;
    const partiesSnap = await getDocs(collection(db, 'parties'));
    for (const pDoc of partiesSnap.docs) {
        await recalculatePartyBalance(pDoc.id);
    }
    return partiesSnap.size;
}

export async function recalculateBalancesFromTransaction(startDate?: string): Promise<void> {
    if (!db) return;
    const accountsSnap = await getDocs(collection(db, 'accounts'));
    for (const aDoc of accountsSnap.docs) {
        await recalculateAccountBalance(aDoc.id);
    }
    await recalculateAllPartyBalances();
}

function calculateFifoCost(queue: { cost: number, quantity: number }[], sellQty: number) {
    let remainingToSell = sellQty;
    let totalCost = 0;

    while (remainingToSell > 0 && queue.length > 0) {
        const batch = queue[0];
        if (batch.quantity <= remainingToSell) {
            totalCost += batch.quantity * batch.cost;
            remainingToSell -= batch.quantity;
            queue.shift(); 
        } else {
            totalCost += remainingToSell * batch.cost;
            batch.quantity -= remainingToSell;
            remainingToSell = 0;
        }
    }

    return { totalCost, remainingToSell };
}

export async function recalculateAllFifoAndProfits(): Promise<{ updatedTransactions: number, updatedItems: number }> {
    if (!db) throw new Error("Firebase not configured");

    const batchSize = 450;
    let updatedTransactionsCount = 0;
    let updatedItemsCount = 0;

    const inventorySnap = await getDocs(collection(db, 'inventory'));
    const allTransactionsSnap = await getDocs(query(collection(db, 'transactions')));
    
    const inventory = inventorySnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));
    const allTransactionsList = allTransactionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));

    // Sort transactions oldest first for FIFO
    allTransactionsList.sort((a,b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
    });

    const itemQueues: Map<string, { cost: number, quantity: number, date: string }[]> = new Map();
    
    inventory.forEach(item => {
        itemQueues.set(item.id, []);
    });

    const txUpdates: { id: string, items: Transaction['items'] }[] = [];

    allTransactionsList.forEach(tx => {
        if (!tx.enabled || !tx.items) return;

        const isPurchase = ['purchase', 'credit_purchase', 'sale_return'].includes(tx.type);
        const isSale = ['sale', 'credit_sale', 'purchase_return'].includes(tx.type);

        if (isPurchase) {
            tx.items.forEach(item => {
                const queue = itemQueues.get(item.id) || [];
                queue.push({ cost: item.price, quantity: item.quantity, date: tx.date });
                itemQueues.set(item.id, queue);
            });
        } else if (isSale) {
            const updatedTxItems = tx.items.map(item => {
                const queue = itemQueues.get(item.id) || [];
                const costResult = calculateFifoCost(queue, item.quantity);
                
                if (costResult.totalCost > 0) {
                    return { ...item, cost: costResult.totalCost / item.quantity };
                }
                return item;
            });

            if (JSON.stringify(tx.items) !== JSON.stringify(updatedTxItems)) {
                txUpdates.push({ id: tx.id, items: updatedTxItems });
            }
        }
    });

    for (let i = 0; i < txUpdates.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = txUpdates.slice(i, i + batchSize);
        chunk.forEach(update => {
            batch.update(doc(db, 'transactions', update.id), { items: update.items });
            updatedTransactionsCount++;
        });
        await batch.commit();
    }

    for (let i = 0; i < inventory.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = inventory.slice(i, i + batchSize);
        chunk.forEach(item => {
            const queue = itemQueues.get(item.id) || [];
            batch.update(doc(db, 'inventory', item.id), { 
                costHistory: queue,
            });
            updatedItemsCount++;
        });
        await batch.commit();
    }

    return { updatedTransactions: updatedTransactionsCount, updatedItems: updatedItemsCount };
}

export async function markOnlineOrdersAsNotified(ids: string[]) {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'transactions', id), { adminNotified: true }));
    await batch.commit();
}

export async function deleteFilteredTransactions(ids: string[]): Promise<void> {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'transactions', id), { enabled: false }));
    await batch.commit();
}

export async function generateInvoiceNumber(): Promise<string> {
    return `INV-${Date.now()}`;
}

export async function createTransaction(tx: Omit<Transaction, 'id'>) {
    return addTransaction(tx);
}

export async function attemptAutoVerification(txRef: string, trxId: string, channels: any[], amount: number) {
    return { isVerified: false };
}

export async function handleSmsNotification(
    transaction: Transaction,
    party: Party,
    paidAmount: number = 0,
    previousDue: number
) {
    if (!party.phone || !db) return;

    try {
        const appSettings = await getAppSettings();
        if (!appSettings?.smsServiceEnabled || !Array.isArray(appSettings.smsTemplates)) return;
        
        let templateType: 'cashSale' | 'creditSale' | 'receivePayment' | 'givePayment' | 'creditSaleWithPartPayment' | 'cashSaleWithOverpayment' | undefined;
        
        switch (transaction.type) {
            case 'sale':
                templateType = 'cashSale';
                break;
            case 'credit_sale':
                templateType = paidAmount > 0 ? 'creditSaleWithPartPayment' : 'creditSale';
                break;
            case 'receive':
                templateType = 'receivePayment';
                break;
            case 'give':
            case 'spent':
                templateType = 'givePayment';
                break;
        }
        
        if (!templateType) return;

        let template = appSettings.smsTemplates.find(t => t.type === templateType);

        if (!template && templateType === 'creditSaleWithPartPayment') {
            template = appSettings.smsTemplates.find(t => t.type === 'creditSale');
        }

        if (!template || !template.message) return;
        
        let currentBalance;
        if (transaction.type === 'credit_sale') {
            currentBalance = previousDue - transaction.amount + paidAmount;
        } else {
             currentBalance = previousDue + getPartyBalanceEffect(transaction, false);
        }

        const businessName = appSettings.businessProfiles.find(p => p.name === transaction.via)?.name || appSettings.businessProfiles[0]?.name || 'our company';
        
        const partyBalanceText = (balance: number) => {
            if (balance > 0.01) return `+${formatAmount(balance, false)}`; 
            if (balance < -0.01) return `-${formatAmount(Math.abs(balance), false)}`; 
            return formatAmount(0, false);
        };

        const previousBalanceStr = partyBalanceText(previousDue);
        const currentBalanceStr = partyBalanceText(currentBalance);
        
        const safeFormatDate = (dateStr: string) => {
            try {
                if (!dateStr) return '';
                const isoDate = parseISO(dateStr);
                if (isValid(isoDate)) return formatFns(isoDate, "dd/MM/yyyy");
                return dateStr;
            } catch (e) {
                return dateStr;
            }
        };

        const paymentAmountForSms = transaction.type === 'receive' ? transaction.amount : paidAmount;

        let message = template.message
            .replace(/{partyName}/g, party.name)
            .replace(/{amount}/g, formatAmount(transaction.amount, false))
            .replace(/{date}/g, safeFormatDate(transaction.date))
            .replace(/{businessName}/g, businessName)
            .replace(/{invoiceNumber}/g, transaction.invoiceNumber?.replace('INV-', '') || '')
            .replace(/{previousDue}/g, previousBalanceStr)
            .replace(/{currentBalance}/g, currentBalanceStr)
            .replace(/{PartPaymentAmount}/g, formatAmount(paymentAmountForSms, false));

        const smsProvider = appSettings.smsProvider || 'twilio';
        
        if (smsProvider === 'smsq' && appSettings.smsqApiKey && appSettings.smsqClientId && appSettings.smsqSenderId) {
            await sendSmsViaSmsq(party.phone!, message, appSettings.smsqApiKey, appSettings.smsqClientId, appSettings.smsqSenderId);
        } else if (smsProvider === 'twilio' && appSettings.twilioAccountSid && appSettings.twilioAuthToken && appSettings.twilioMessagingServiceSid) {
            await sendSmsViaTwilio(party.phone!, message, appSettings.twilioAccountSid, appSettings.twilioAuthToken, appSettings.twilioMessagingServiceSid);
        } else if (smsProvider === 'pushbullet' && appSettings.pushbulletAccessToken) {
            await sendSmsViaPushbullet(party.phone!, message, appSettings.pushbulletAccessToken, appSettings.pushbulletDeviceId);
        }
        
    } catch (err) {
        console.warn(`Could not prepare SMS for transaction. Error: `, err);
    }
}

export async function getAllTransactions(): Promise<Transaction[]> {
    if (!db) return [];
    const snap = await getDocs(collection(db, 'transactions'));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
}

export async function restoreData(data: any): Promise<void> {
    const { restoreAllData } = await import('./backupService');
    return restoreAllData(data);
}
