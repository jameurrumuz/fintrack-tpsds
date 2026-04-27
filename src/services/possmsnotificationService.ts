'use server';

import { Party, Transaction, AppSettings, SmsTemplate } from '@/types';
import { getAppSettings } from './settingsService';
import { formatAmount } from '@/lib/utils';
import { format as formatFns, parseISO, parse, isValid } from 'date-fns';
import { sendSmsViaSmsq } from './smsqService';
import { sendSmsViaTwilio } from './twilioService';
import { sendSmsViaPushbullet } from './pushbulletService';
import { getPartyBalanceEffect } from '@/lib/utils';

export async function handleSmsNotification(
    transaction: Transaction,
    party: Party,
    paidAmount: number = 0,
    previousDue: number
) {
    if (!party.phone) {
        console.warn("SMS ignored: Party phone number missing.");
        return;
    }

    try {
        const appSettings = await getAppSettings();
        if (!appSettings?.smsServiceEnabled) {
            console.warn("SMS ignored: Service disabled in settings.");
            return;
        }

        const templates = Array.isArray(appSettings.smsTemplates) ? appSettings.smsTemplates : [];
        let templateType: SmsTemplate['type'] | undefined;
        
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

        let template = templates.find(t => t.type === templateType);

        // Fallbacks as per rules
        if (!template && templateType === 'creditSaleWithPartPayment') {
            template = templates.find(t => t.type === 'creditSale');
        }

        const businessName = appSettings.businessProfiles.find(p => p.name === transaction.via)?.name || appSettings.businessProfiles[0]?.name || 'Rushaib Traders';
        
        // Accurate Balance Calculation for SMS
        let currentBalance;
        if (transaction.type === 'credit_sale') {
            currentBalance = previousDue - transaction.amount + paidAmount;
        } else {
             currentBalance = previousDue + getPartyBalanceEffect(transaction, false);
        }

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
        
        let message = "";
        if (template && template.message) {
            message = template.message
                .replace(/{partyName}/g, party.name)
                .replace(/{amount}/g, formatAmount(transaction.amount, false))
                .replace(/{billAmount}/g, formatAmount(transaction.amount, false))
                .replace(/{date}/g, safeFormatDate(transaction.date))
                .replace(/{businessName}/g, businessName)
                .replace(/{invoiceNumber}/g, transaction.invoiceNumber?.replace('INV-', '') || '')
                .replace(/{invoiceNo}/g, transaction.invoiceNumber?.replace('INV-', '') || '')
                .replace(/{previousDue}/g, previousBalanceStr)
                .replace(/{currentBalance}/g, currentBalanceStr)
                .replace(/{PartPaymentAmount}/g, formatAmount(paymentAmountForSms, false))
                .replace(/{paidAmount}/g, formatAmount(paymentAmountForSms, false));
        } else {
            // Hard fallback if no template is defined
            message = `Dear ${party.name}, ${transaction.type.replace('_', ' ')} of ${formatAmount(transaction.amount, false)} recorded on ${safeFormatDate(transaction.date)}. Current Bal: ${currentBalanceStr}. Thanks, ${businessName}`;
        }

        const smsProvider = appSettings.smsProvider || 'pushbullet';
        
        if (smsProvider === 'pushbullet' && appSettings.pushbulletAccessToken) {
            await sendSmsViaPushbullet(party.phone!, message, appSettings.pushbulletAccessToken, appSettings.pushbulletDeviceId);
        } else if (smsProvider === 'smsq' && appSettings.smsqApiKey && appSettings.smsqClientId && appSettings.smsqSenderId) {
            await sendSmsViaSmsq(party.phone!, message, appSettings.smsqApiKey, appSettings.smsqClientId, appSettings.smsqSenderId);
        } else if (smsProvider === 'twilio' && appSettings.twilioAccountSid && appSettings.twilioAuthToken && appSettings.twilioMessagingServiceSid) {
            await sendSmsViaTwilio(party.phone!, message, appSettings.twilioAccountSid, appSettings.twilioAuthToken, appSettings.twilioMessagingServiceSid);
        } else {
             console.warn("SMS Provider missing credentials.");
        }
        
    } catch (err) {
        console.error("SMS Logic Error: ", err);
    }
}