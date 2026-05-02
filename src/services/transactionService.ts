
'use client';

import { db } from '@/lib/firebase';
import { Transaction, Party, Account, VerificationResult } from '@/types';
import { 
  collection, addDoc, doc, updateDoc, deleteDoc, 
  query, onSnapshot, where, orderBy, getDocs, 
  runTransaction, serverTimestamp, Timestamp, writeBatch, limit, getDoc, setDoc
} from 'firebase/firestore';
import { format as formatFns, parseISO, isValid } from 'date-fns';
import { getEffectiveAmount, getPartyBalanceEffect, cleanUndefined, formatAmount } from '@/lib/utils';
import { handleSmsNotification } from './possmsnotificationService';

const getTransactionsCollection = () => db ? collection(db, 'transactions') : null;

/**
 * Deeply converts Firestore special types (like Timestamp) to plain values
 * so they can be passed to Server Functions without serialization errors.
 */
const serializeForServer = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    
    if (obj instanceof Timestamp) return obj.toDate().toISOString();
    if (typeof obj === 'object' && obj.seconds !== undefined && obj.nanoseconds !== undefined) {
        try {
            return new Date(obj.seconds * 1000 + obj.nanoseconds / 1000000).toISOString();
        } catch (e) {
            return obj;
        }
    }

    if (Array.isArray(obj)) return obj.map(serializeForServer);
    
    if (typeof obj === 'object' && obj.constructor === Object) {
        const clean: any = {};
        Object.keys(obj).forEach(key => {
            clean[key] = serializeForServer(obj[key]);
        });
        return clean;
    }
    
    return obj;
};

export function subscribeToAllTransactions(
  onUpdate: (transactions: Transaction[]) => void,
  onError: (error: Error) => void
) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef) return () => {};

  return onSnapshot(collectionRef, (snapshot) => {
    const transactions = snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
      } as Transaction;
    });

    // RULES.md: Sort by Date (Primary) then CreatedAt (Secondary) - Oldest First
    transactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB; 
        
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
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

        // AS PER RULES.md: Oldest transactions at top, newest at bottom
        transactions.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateA - dateB;
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        });

        onUpdate(transactions);
    }, (error) => onError(error as Error));
}

export async function addTransaction(transactionData: Omit<Transaction, 'id'>): Promise<string> {
  if (!db) throw new Error('Firebase not configured');
  
  const involvedAccounts = new Set<string>();
  if (transactionData.accountId) involvedAccounts.add(transactionData.accountId);
  if (transactionData.fromAccountId) involvedAccounts.add(transactionData.fromAccountId);
  if (transactionData.toAccountId) involvedAccounts.add(transactionData.toAccountId);
  if (transactionData.payments) {
    transactionData.payments.forEach(p => involvedAccounts.add(p.accountId));
  }

  let previousDue = 0;
  let partyDataForSms: Party | null = null;

  if (transactionData.sendSms && transactionData.partyId) {
      try {
          const partyRef = doc(db, 'parties', transactionData.partyId);
          const [partySnap, txsSnap] = await Promise.all([
              getDoc(partyRef),
              getDocs(query(collection(db, 'transactions'), where('partyId', '==', transactionData.partyId)))
          ]);
          
          if (partySnap.exists()) {
              partyDataForSms = serializeForServer({ id: partySnap.id, ...partySnap.data() });
              previousDue = txsSnap.docs.reduce((sum, d) => {
                  const tx = d.data() as Transaction;
                  return tx.enabled ? sum + getPartyBalanceEffect(tx, false) : sum;
              }, 0);
          }
      } catch (e) {
          console.error("Error gathering data for SMS:", e);
      }
  }

  const cleanData = cleanUndefined({
    ...transactionData,
    involvedAccounts: Array.from(involvedAccounts),
    createdAt: serverTimestamp(),
    enabled: transactionData.enabled ?? true,
    adminNotified: transactionData.adminNotified ?? false,
  });

  const docRef = await addDoc(collection(db, 'transactions'), cleanData);
  
  if (transactionData.partyId) recalculatePartyBalance(transactionData.partyId);
  involvedAccounts.forEach(accId => recalculateAccountBalance(accId));

  if (transactionData.sendSms && partyDataForSms) {
      const paidAmount = transactionData.type === 'receive' ? transactionData.amount : 
                        (transactionData.payments?.reduce((s,p) => s + p.amount, 0) || 0);
      
      const savedTxForSms = serializeForServer({ 
        ...transactionData, 
        id: docRef.id,
        createdAt: new Date().toISOString()
      });

      handleSmsNotification(savedTxForSms, partyDataForSms, paidAmount, previousDue).catch(console.error);
  }

  return docRef.id;
}

export async function updateTransaction(id: string, updates: Partial<Transaction>): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const txRef = doc(db, 'transactions', id);
  const oldSnap = await getDoc(txRef);
  if (!oldSnap.exists()) throw new Error('Transaction not found');
  const oldData = oldSnap.data() as Transaction;

  const involvedAccounts = new Set<string>();
  const currentAccountId = updates.accountId !== undefined ? updates.accountId : oldData.accountId;
  const currentPayments = updates.payments !== undefined ? updates.payments : oldData.payments;

  if (currentAccountId) involvedAccounts.add(currentAccountId);
  if (currentPayments) currentPayments.forEach(p => involvedAccounts.add(p.accountId));

  await updateDoc(txRef, cleanUndefined({ ...updates, involvedAccounts: Array.from(involvedAccounts) }));

  const partiesToSync = new Set([oldData.partyId, updates.partyId].filter(Boolean) as string[]);
  const accountsToSync = new Set([...(oldData.involvedAccounts || []), ...Array.from(involvedAccounts)].filter(Boolean) as string[]);

  partiesToSync.forEach(pId => recalculatePartyBalance(pId));
  accountsToSync.forEach(aId => recalculateAccountBalance(aId));
}

export async function deleteTransaction(id: string): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const txRef = doc(db, 'transactions', id);
  const snap = await getDoc(txRef);
  if (!snap.exists()) return;
  const data = snap.data() as Transaction;

  await deleteDoc(txRef);

  if (data.partyId) recalculatePartyBalance(data.partyId);
  if (data.involvedAccounts) data.involvedAccounts.forEach(recalculateAccountBalance);
}

export async function recalculateAccountBalance(accountId: string): Promise<void> {
    if (!db || !accountId) return;
    const accountRef = doc(db, 'accounts', accountId);
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
    await updateDoc(accountRef, { balance });
}

export async function recalculatePartyBalance(partyId: string): Promise<void> {
    if (!db || !partyId || partyId === 'walkin') return;
    const partyRef = doc(db, 'parties', partyId);
    const txsSnap = await getDocs(query(collection(db, 'transactions'), where('partyId', '==', partyId)));
    let balance = 0;
    txsSnap.docs.forEach(doc => {
        const tx = doc.data() as Transaction;
        if (tx.enabled) balance += getPartyBalanceEffect(tx, false);
    });
    await updateDoc(partyRef, { balance });
}

export async function recalculateBalancesFromTransaction(startDate?: string): Promise<void> {
    if (!db) return;
    const [txSnap, accSnap, partiesSnap] = await Promise.all([
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'accounts')),
        getDocs(collection(db, 'parties'))
    ]);

    const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    const accountBalances: Record<string, number> = {};
    accSnap.docs.forEach(d => accountBalances[d.id] = 0);
    const partyBalances: Record<string, number> = {};
    partiesSnap.docs.forEach(d => partyBalances[d.id] = 0);

    transactions.forEach(tx => {
        if (!tx.enabled) return;
        if (tx.type === 'transfer') {
            if (tx.fromAccountId) accountBalances[tx.fromAccountId] -= tx.amount;
            if (tx.toAccountId) accountBalances[tx.toAccountId] += tx.amount;
        } else if (tx.payments) {
            tx.payments.forEach(p => accountBalances[p.accountId] += p.amount);
        } else if (tx.accountId) {
            accountBalances[tx.accountId] += getEffectiveAmount(tx);
        }
        if (tx.partyId && partyBalances[tx.partyId] !== undefined) {
            partyBalances[tx.partyId] += getPartyBalanceEffect(tx, false);
        }
    });

    const batch = writeBatch(db);
    Object.entries(accountBalances).forEach(([id, balance]) => batch.update(doc(db, 'accounts', id), { balance }));
    Object.entries(partyBalances).forEach(([id, balance]) => batch.update(doc(db, 'parties', id), { balance }));
    await batch.commit();
}

export function subscribeToPendingPayments(onUpdate: (transactions: Transaction[]) => void, onError: (error: Error) => void) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef) return () => {};
  const q = query(collectionRef, where('paymentStatus', '==', 'pending'), where('enabled', '==', true));
  return onSnapshot(q, (snapshot) => {
    onUpdate(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
  }, onError as any);
}

export function subscribeToNewOnlineOrders(onUpdate: (transactions: Transaction[]) => void, onError: (error: Error) => void) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef) return () => {};
  const q = query(collectionRef, where('adminNotified', '==', false), where('enabled', '==', true));
  return onSnapshot(q, (snapshot) => {
    const orders = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Transaction))
        .filter(t => t.description?.includes('Purchase from Online Store'));
    onUpdate(orders);
  }, onError as any);
}

export async function markOnlineOrdersAsNotified(orderIds: string[]) {
    if (!db) return;
    const batch = writeBatch(db);
    orderIds.forEach(id => {
        batch.update(doc(db, 'transactions', id), { adminNotified: true });
    });
    await batch.commit();
}

export async function deleteFilteredTransactions(ids: string[]) {
    if (!db) return;
    const batch = writeBatch(db);
    const partiesToSync = new Set<string>();
    const accountsToSync = new Set<string>();
    for (const id of ids) {
        const txRef = doc(db, 'transactions', id);
        const snap = await getDoc(txRef);
        if (snap.exists()) {
            const data = snap.data() as Transaction;
            if (data.partyId) partiesToSync.add(data.partyId);
            if (data.involvedAccounts) data.involvedAccounts.forEach(a => accountsToSync.add(a));
            batch.update(txRef, { enabled: false });
        }
    }
    await batch.commit();
    partiesToSync.forEach(recalculatePartyBalance);
    accountsToSync.forEach(recalculateAccountBalance);
}

export async function toggleTransaction(id: string, enabled: boolean) {
    await updateTransaction(id, { enabled });
}

export async function getAllTransactions(): Promise<Transaction[]> {
    if (!db) return [];
    const snap = await getDocs(collection(db, 'transactions'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
}

export async function recalculateAllPartyBalances(): Promise<number> {
    if (!db) return 0;
    const partiesSnap = await getDocs(collection(db, 'parties'));
    for (const partyDoc of partiesSnap.docs) {
        await recalculatePartyBalance(partyDoc.id);
    }
    return partiesSnap.size;
}

export function subscribeToTransactionsForPartyIds(partyIds: string[], onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef || partyIds.length === 0) return () => {};
    return onSnapshot(collectionRef, (snapshot) => {
        const txs = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Transaction))
            .filter(t => t.partyId && partyIds.includes(t.partyId));
        onUpdate(txs);
    }, onError as any);
}

export function subscribeToTransactionsForVerification(staffId: string, onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef) return () => {};
    const q = query(collectionRef, where('paymentStatus', '==', 'pending'));
    return onSnapshot(q, (snapshot) => {
        onUpdate(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, onError as any);
}

export async function attemptAutoVerification(txRef: string, trxId: string, channels: any[], amount: number): Promise<VerificationResult> {
    return { isVerified: false };
}

export async function markTransactionsAsReviewed(ids: string[], note: string) {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => {
        batch.update(doc(db, 'transactions', id), { suspicionReviewed: true, suspicionReviewNote: note });
    });
    await batch.commit();
}

export async function recalculateAllFifoAndProfits(): Promise<{ updatedTransactions: number; updatedItems: number }> {
    return { updatedTransactions: 0, updatedItems: 0 };
}

export async function restoreData(data: any): Promise<void> {
    if (!db || !data) return;
    const batch = writeBatch(db);
    const txs = data.transactions || [];
    for (const tx of txs) {
        const { id, ...txData } = tx;
        if (!id) continue;
        const ref = doc(collection(db, 'transactions'), id);
        batch.set(ref, txData);
    }
    await batch.commit();
}
