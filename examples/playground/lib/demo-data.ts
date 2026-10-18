/**
 * Ridgeline's own fake data. Nothing here touches HelpWell — it is the product
 * the support desk is installed into, and it exists so the widget has a real
 * page to sit on top of.
 */

export type ExpenseStatus = 'Draft' | 'Pending' | 'Approved' | 'Exported' | 'Reimbursed';

export interface Expense {
  id: string;
  merchant: string;
  category: string;
  person: string;
  date: string;
  amount: number;
  status: ExpenseStatus;
  receipt: boolean;
  flag?: string;
}

export const EXPENSES: Expense[] = [
  {
    id: 'EX-2841',
    merchant: 'Caledonian Sleeper',
    category: 'Travel',
    person: 'Ada Okafor',
    date: '12 Sep',
    amount: 189.5,
    status: 'Pending',
    receipt: true,
  },
  {
    id: 'EX-2840',
    merchant: 'Figma',
    category: 'Software',
    person: 'Tom Alvarez',
    date: '12 Sep',
    amount: 45.0,
    status: 'Approved',
    receipt: true,
  },
  {
    id: 'EX-2839',
    merchant: 'The Wolseley',
    category: 'Meals',
    person: 'Ada Okafor',
    date: '11 Sep',
    amount: 246.8,
    status: 'Pending',
    receipt: true,
    flag: 'Over £150 — needs Finance',
  },
  {
    id: 'EX-2838',
    merchant: 'Uber',
    category: 'Travel',
    person: 'Nina Kowalski',
    date: '11 Sep',
    amount: 23.4,
    status: 'Approved',
    receipt: true,
  },
  {
    id: 'EX-2837',
    merchant: 'Pret a Manger',
    category: 'Meals',
    person: 'Tom Alvarez',
    date: '10 Sep',
    amount: 8.95,
    status: 'Approved',
    receipt: false,
    flag: 'No receipt',
  },
  {
    id: 'EX-2836',
    merchant: 'Mileage — Leeds to York',
    category: 'Mileage',
    person: 'Hassan Mir',
    date: '10 Sep',
    amount: 21.6,
    status: 'Exported',
    receipt: false,
  },
  {
    id: 'EX-2835',
    merchant: 'Notion Labs',
    category: 'Software',
    person: 'Ada Okafor',
    date: '9 Sep',
    amount: 320.0,
    status: 'Exported',
    receipt: true,
  },
  {
    id: 'EX-2834',
    merchant: 'Premier Inn Bristol',
    category: 'Travel',
    person: 'Priya Raman',
    date: '8 Sep',
    amount: 112.0,
    status: 'Reimbursed',
    receipt: true,
  },
  {
    id: 'EX-2833',
    merchant: 'Kings Cross Parking',
    category: 'Travel',
    person: 'Nina Kowalski',
    date: '8 Sep',
    amount: 34.0,
    status: 'Draft',
    receipt: false,
    flag: 'Possible duplicate of EX-2829',
  },
  {
    id: 'EX-2832',
    merchant: 'Amazon Business',
    category: 'Supplies',
    person: 'Marco Bellini',
    date: '7 Sep',
    amount: 78.15,
    status: 'Reimbursed',
    receipt: true,
  },
];

export const SUMMARY = [
  { label: 'Waiting on you', value: '2', detail: 'oldest is 3 days old' },
  { label: 'This period', value: '£1,079.40', detail: 'across 10 expenses' },
  { label: 'Unmatched card lines', value: '3', detail: 'Amex Business •••• 4417' },
  { label: 'Period closes', value: 'Fri 19 Sep', detail: 'September 2026' },
];

export const money = (amount: number): string =>
  `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
