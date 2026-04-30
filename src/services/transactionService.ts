
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

        // AS PER RULES.md: Oldest transactions at top, newest at bottom for Party Ledger
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

export function subscribeToTransactionsForPartyIds(
  partyIds: string[],
  onUpdate: (transactions: Transaction[]) => void,
  onError: (error: Error) => void
) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef || partyIds.length === 0) return () => {};

  const q = query(collectionRef, where('partyId', 'in', partyIds.slice(0, 10)));

  return onSnapshot(q, (snapshot) => {
      const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      onUpdate(transactions);
  }, (error) => onError(error as Error));
}

export function subscribeToPendingPayments(
  onUpdate: (transactions: Transaction[]) => void,
  onError: (error: Error) => void
) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef) return () => {};

  const q = query(collectionRef, where('paymentStatus', '==', 'pending'));
  
  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
    onUpdate(transactions);
  }, (error) => onError(error as Error));
}

export function subscribeToNewOnlineOrders(
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef) return () => {};

    const q = query(
        collectionRef, 
        where('type', 'in', ['sale', 'credit_sale'])
    );

    return onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Transaction))
            .filter(t => !t.adminNotified && t.description?.startsWith('Purchase from Online Store'));
        onUpdate(orders);
    }, (error) => onError(error as Error));
}

export async function markOnlineOrdersAsNotified(ids: string[]): Promise<void> {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => {
        batch.update(doc(db, 'transactions', id), { adminNotified: true });
    });
    await batch.commit();
}

export function subscribeToTransactionsForVerification(
    staffId: string,
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef) return () => {};

    const q = query(collectionRef, where('verifiableBy', 'array-contains', staffId));

    return onSnapshot(q, (snapshot) => {
        const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
        onUpdate(transactions);
    }, (error) => onError(error as Error));
}

const serializeForServer = (obj: any): any => {
    if (!obj) return obj;
    const clean = { ...obj };
    Object.keys(clean).forEach(key => {
        if (clean[key] instanceof Timestamp) {
            clean[key] = clean[key].toDate().toISOString();
        } else if (typeof clean[key] === 'object' && clean[key] !== null) {
            clean[key] = serializeForServer(clean[key]);
        }
    });
    return clean;
};

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
  let party: Party | null = null;
  if (transactionData.sendSms && transactionData.partyId) {
      try {
          const partyRef = doc(db, 'parties', transactionData.partyId);
          const [partySnap, txsSnap] = await Promise.all([
              getDoc(partyRef),
              getDocs(query(collection(db, 'transactions'), where('partyId', '==', transactionData.partyId)))
          ]);
          
          if (partySnap.exists()) {
              const partyData = partySnap.data();
              party = serializeForServer({ id: partySnap.id, ...partyData });

              previousDue = txsSnap.docs.reduce((sum, d) => {
                  const tx = d.data() as Transaction;
                  return tx.enabled ? sum + getPartyBalanceEffect(tx, false) : sum;
              }, 0);
          }
      } catch (e) {
          console.error("Error fetching data for SMS:", e);
      }
  }

  const cleanData = cleanUndefined({
    ...transactionData,
    involvedAccounts: Array.from(involvedAccounts),
    createdAt: serverTimestamp(),
  });

  const docRef = await addDoc(collection(db, 'transactions'), cleanData);
  
  if (transactionData.partyId) {
    recalculatePartyBalance(transactionData.partyId);
  }
  
  involvedAccounts.forEach(accId => {
    recalculateAccountBalance(accId);
  });

  if (transactionData.sendSms && party) {
      const paidAmount = transactionData.type === 'receive' ? transactionData.amount : 
                        (transactionData.payments?.reduce((s,p) => s + p.amount, 0) || 0);
      
      const savedTx = serializeForServer({ 
        ...transactionData, 
        id: docRef.id,
        createdAt: new Date().toISOString()
      });

      handleSmsNotification(savedTx, party, paidAmount, previousDue).catch(err => {
          console.error("SMS notification failed in addTransaction:", err);
      });
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
  const currentFromAccountId = updates.fromAccountId !== undefined ? updates.fromAccountId : oldData.fromAccountId;
  const currentToAccountId = updates.toAccountId !== undefined ? updates.toAccountId : oldData.toAccountId;
  const currentPayments = updates.payments !== undefined ? updates.payments : oldData.payments;

  if (currentAccountId) involvedAccounts.add(currentAccountId);
  if (currentFromAccountId) involvedAccounts.add(currentFromAccountId);
  if (currentToAccountId) involvedAccounts.add(currentToAccountId);
  if (currentPayments) {
    currentPayments.forEach(p => involvedAccounts.add(p.accountId));
  }

  const cleanUpdates = cleanUndefined({
    ...updates,
    involvedAccounts: Array.from(involvedAccounts)
  });
  
  await updateDoc(txRef, cleanUpdates);

  const partiesToSync = new Set([oldData.partyId, updates.partyId].filter(Boolean) as string[]);
  const accountsToSync = new Set([
      ...(oldData.involvedAccounts || []),
      ...Array.from(involvedAccounts)
  ].filter(Boolean) as string[]);

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
  if (data.involvedAccounts) {
    data.involvedAccounts.forEach(accId => {
        recalculateAccountBalance(accId);
    });
  }
}

export async function toggleTransaction(id: string, enabled: boolean): Promise<void> {
    await updateTransaction(id, { enabled });
}

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => {
        batch.update(doc(db, 'transactions', id), { enabled: false });
    });
    await batch.commit();
    recalculateBalancesFromTransaction();
}

export async function bulkRestoreTransactions(ids: string[]): Promise<void> {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => {
        batch.update(doc(db, 'transactions', id), { enabled: true });
    });
    await batch.commit();
    recalculateBalancesFromTransaction();
}

export async function markTransactionsAsReviewed(ids: string[], note: string): Promise<void> {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => {
        batch.update(doc(db, 'transactions', id), { 
            suspicionReviewed: true, 
            suspicionReviewNote: note 
        });
    });
    await batch.commit();
}

export async function recalculateAccountBalance(accountId: string): Promise<void> {
    if (!db || !accountId) return;
    if (accountId === 'walkin' || accountId === 'walkin-customer' || accountId === 'none') return;

    const accountRef = doc(db, 'accounts', accountId);
    const accountSnap = await getDoc(accountRef);
    if (!accountSnap.exists()) return;

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
    if (!db || !partyId || partyId === 'walkin' || partyId === 'walkin-customer' || partyId === 'none') return;

    const partyRef = doc(db, 'parties', partyId);
    const partySnap = await getDoc(partyRef);
    if (!partySnap.exists()) return;

    const txsSnap = await getDocs(query(collection(db, 'transactions'), where('partyId', '==', partyId)));
    
    let balance = 0;
    txsSnap.docs.forEach(doc => {
        const tx = doc.data() as Transaction;
        balance += getPartyBalanceEffect(tx, false);
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
    const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() } as Account));
    const parties = partiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Party));

    const accountBalances: Record<string, number> = {};
    accounts.forEach(acc => accountBalances[acc.id] = 0);

    const partyBalances: Record<string, number> = {};
    parties.forEach(p => partyBalances[p.id] = 0);

    transactions.forEach(tx => {
        if (!tx.enabled) return;

        if (tx.type === 'transfer') {
            if (tx.fromAccountId && accountBalances[tx.fromAccountId] !== undefined) {
                accountBalances[tx.fromAccountId] -= tx.amount;
            }
            if (tx.toAccountId && accountBalances[tx.toAccountId] !== undefined) {
                accountBalances[tx.toAccountId] += tx.amount;
            }
        } else if (tx.payments && tx.payments.length > 0) {
            tx.payments.forEach(p => {
                if (accountBalances[p.accountId] !== undefined) {
                    accountBalances[p.accountId] += p.amount;
                }
            });
        } else if (tx.accountId && accountBalances[tx.accountId] !== undefined) {
            accountBalances[tx.accountId] += getEffectiveAmount(tx);
        }

        if (tx.partyId && partyBalances[tx.partyId] !== undefined) {
            partyBalances[tx.partyId] += getPartyBalanceEffect(tx, false);
        }
    });

    const batch = writeBatch(db);
    
    Object.entries(accountBalances).forEach(([id, balance]) => {
        batch.update(doc(db, 'accounts', id), { balance });
    });
    
    Object.entries(partyBalances).forEach(([id, balance]) => {
        batch.update(doc(db, 'parties', id), { balance });
    });

    await batch.commit();
}

export async function recalculateAllFifoAndProfits(): Promise<{ updatedTransactions: number; updatedItems: number }> {
    return { updatedTransactions: 0, updatedItems: 0 };
}

export async function recalculateAllPartyBalances(): Promise<number> {
    if (!db) return 0;
    await recalculateBalancesFromTransaction();
    return 1;
}

export async function attemptAutoVerification(txRef: string, trxId: string, depositChannels: any[], amount: number): Promise<VerificationResult> {
    return { isVerified: false };
}

export async function deleteFilteredTransactions(ids: string[]): Promise<void> {
    await bulkDeleteTransactions(ids);
}

export async function restoreData(data: any): Promise<void> {
    return;
}

export async function createTransaction(data: any) {
    return await addTransaction(data);
}

export async function generateInvoiceNumber(): Promise<string> {
    return `INV-${Date.now()}`;
}

export async function deleteTransactionByDetails(details: string) {
    if (!db) return;
    const q = query(collection(db, 'transactions'), where('description', '==', details));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
}

export async function updateTransactionByDetails(oldDetails: string, updates: Partial<Transaction>) {
    if (!db) return;
    const q = query(collection(db, 'transactions'), where('description', '==', oldDetails));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.forEach(d => batch.update(d.ref, updates));
    await batch.commit();
}

export async function markOnlineOrdersAsReviewed(ids: string[], note: string) {
    return markTransactionsAsReviewed(ids, note);
}
