/**
 * Company (overhead) expenses, not linked to any project. Sheet total ₹1,04,223.
 * - The sheet's "Notes" become Paid To when they name a vendor; anything else stays in notes.
 * - Month-only dates ("Jan 2026") are stored as the 1st of that month and flagged.
 */
export interface CompanyExpense {
  sno: number;
  date: string; // YYYY-MM-DD
  monthOnly?: boolean;
  name: string;
  category: string;
  amount: number;
  paidTo?: string;
  notes?: string;
}

export const COMPANY_EXPENSES: CompanyExpense[] = [
  { sno: 1, date: '2026-01-01', monthOnly: true, name: 'Laptop', category: 'Equipment', amount: 15000, paidTo: 'Kishan (JKKM)' },
  { sno: 2, date: '2026-02-01', monthOnly: true, name: 'Airtel Wi-Fi', category: 'Wi-Fi', amount: 1500, paidTo: 'Airtel' },
  { sno: 3, date: '2026-04-01', monthOnly: true, name: 'Meta Ads (Free Websites)', category: 'Marketing', amount: 800, paidTo: 'Meta', notes: 'Meta Ad Account' },
  { sno: 4, date: '2026-04-01', monthOnly: true, name: 'MD Table', category: 'Furniture', amount: 6000, paidTo: 'Jegan Metal Mart' },
  { sno: 5, date: '2026-04-01', monthOnly: true, name: 'MD Chair', category: 'Furniture', amount: 5000, paidTo: 'Flipkart' },
  { sno: 6, date: '2026-04-01', monthOnly: true, name: '3 Developer Tables', category: 'Furniture', amount: 6600, paidTo: 'Jegan Metal Mart' },
  { sno: 7, date: '2026-04-01', monthOnly: true, name: '3 Developer Chairs', category: 'Furniture', amount: 10500, paidTo: 'Jegan Metal Mart' },
  { sno: 8, date: '2026-04-01', monthOnly: true, name: 'Ceiling Fan', category: 'Equipment', amount: 1800, paidTo: 'Saravana Electricals' },
  { sno: 9, date: '2026-04-01', monthOnly: true, name: '2 Junction Boxes', category: 'Office Supplies', amount: 900, paidTo: 'Amman Mill Stores' },
  { sno: 10, date: '2026-04-01', monthOnly: true, name: '2 Ring Spanners', category: 'Office Supplies', amount: 100, paidTo: 'Amman Mill Stores' },
  { sno: 11, date: '2026-04-01', monthOnly: true, name: 'Instagram Boost (Course Platform)', category: 'Marketing', amount: 220, paidTo: 'Instagram', notes: 'https://www.instagram.com/p/DXFv8lUgT6a/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==' },
  { sno: 12, date: '2026-04-01', monthOnly: true, name: 'Meta Ads (Course Platform)', category: 'Marketing', amount: 600, paidTo: 'Meta', notes: 'EdTech platform' },
  { sno: 13, date: '2026-04-01', monthOnly: true, name: 'Google Ads', category: 'Marketing', amount: 2000, paidTo: 'Google', notes: 'Running ads using the website' },
  { sno: 14, date: '2026-04-01', monthOnly: true, name: 'Meta Ads (₹1999 Website)', category: 'Marketing', amount: 1000, paidTo: 'Meta', notes: 'Websites carousel' },
  { sno: 15, date: '2026-04-01', monthOnly: true, name: 'Instagram Boost (₹1999 Website)', category: 'Marketing', amount: 200, paidTo: 'Instagram', notes: 'https://www.instagram.com/p/DXRjA2zmuzy/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==' },
  { sno: 16, date: '2026-04-01', monthOnly: true, name: 'Water Dispensing Can with Tap', category: 'Office Supplies', amount: 200, paidTo: 'Shop' },
  { sno: 17, date: '2026-04-01', monthOnly: true, name: 'Screwdriver and Bolt-Nut for MD Chair', category: 'Office Supplies', amount: 60, paidTo: 'Amman Mill Stores' },
  { sno: 18, date: '2026-05-01', monthOnly: true, name: 'GitHub Copilot', category: 'Software Subscription', amount: 990, paidTo: 'Google Play', notes: 'Account: vigneshsivakspm0' },
  { sno: 19, date: '2026-05-04', name: 'Air Cooler', category: 'Equipment', amount: 11400, paidTo: 'Poorvika Appliances' },
  { sno: 20, date: '2026-05-06', name: 'Laptop Screen Protector', category: 'Equipment', amount: 300, paidTo: 'Flipkart' },
  { sno: 21, date: '2026-05-10', name: 'Office Advance (Deposit)', category: 'Office Rent', amount: 5000, paidTo: 'Panthakarakka' },
  { sno: 22, date: '2026-05-10', name: 'Office Rent', category: 'Office Rent', amount: 1200, paidTo: 'Panthakarakka' },
  { sno: 23, date: '2026-06-02', name: 'Claude Subscription', category: 'Software Subscription', amount: 2300, paidTo: 'Anthropic (Claude)' },
  { sno: 24, date: '2026-06-06', name: 'Wall Sticker', category: 'Office Supplies', amount: 300, paidTo: 'Flipkart' },
  { sno: 25, date: '2026-06-27', name: 'Wi-Fi Bill', category: 'Wi-Fi', amount: 1035, paidTo: 'Airtel' },
  { sno: 26, date: '2026-06-10', name: 'Office Rent', category: 'Office Rent', amount: 1200, paidTo: 'Panthakarakka' },
  { sno: 27, date: '2026-07-01', name: 'Meta Ads', category: 'Marketing', amount: 2500, paidTo: 'Meta' },
  { sno: 28, date: '2026-07-10', name: 'Youngster Times Award', category: 'Events & Awards', amount: 2000 },
  { sno: 29, date: '2026-07-11', name: 'Meta Ads', category: 'Marketing', amount: 300, paidTo: 'Meta', notes: 'For learning platform' },
  { sno: 30, date: '2026-08-04', name: 'Copilot Subscription', category: 'Software Subscription', amount: 990, paidTo: 'GitHub Copilot' },
  { sno: 31, date: '2026-08-04', name: 'Claude Subscription', category: 'Software Subscription', amount: 2400, paidTo: 'Anthropic (Claude)' },
  { sno: 32, date: '2026-08-08', name: 'Wi-Fi Bill', category: 'Wi-Fi', amount: 608, paidTo: 'Airtel' },
  { sno: 33, date: '2026-08-14', name: 'Proprietor Seal', category: 'Office Supplies', amount: 350 },
  { sno: 34, date: '2026-08-20', name: 'Youngster Times Awards', category: 'Events & Awards', amount: 3000 },
  { sno: 35, date: '2026-08-16', name: 'Office Rent', category: 'Office Rent', amount: 1200, paidTo: 'Panthakarakka' },
  { sno: 36, date: '2026-08-25', name: 'Poster Meta Ad', category: 'Marketing', amount: 1000, paidTo: 'Meta' },
  { sno: 37, date: '2026-08-31', name: 'Mohan College Project (Pending Payout)', category: 'Other', amount: 1500, paidTo: 'Mohan', notes: 'Written as "Mohan Clg Project Pending" in the sheet' },
  { sno: 38, date: '2026-08-31', name: 'ChatGPT Subscription', category: 'Software Subscription', amount: 2000, paidTo: 'OpenAI (ChatGPT)' },
  { sno: 39, date: '2026-09-01', name: 'Wi-Fi Bill', category: 'Wi-Fi', amount: 650, paidTo: 'Airtel' },
  { sno: 40, date: '2026-09-09', name: 'Claude Subscription', category: 'Software Subscription', amount: 2300, paidTo: 'Anthropic (Claude)' },
  { sno: 41, date: '2026-09-15', name: 'Certificate Printout', category: 'Printing & Certificates', amount: 320 },
  { sno: 42, date: '2026-09-15', name: 'Office Rent', category: 'Office Rent', amount: 1200, paidTo: 'Panthakarakka' },
  { sno: 43, date: '2026-09-15', name: 'Appa Expenses', category: 'Other', amount: 800, notes: 'Personal / family expense' },
  { sno: 44, date: '2026-09-15', name: 'Maligai (Groceries)', category: 'Office Supplies', amount: 300 },
  { sno: 45, date: '2026-10-01', name: 'ChatGPT Subscription', category: 'Software Subscription', amount: 2000, paidTo: 'OpenAI (ChatGPT)' },
  { sno: 46, date: '2026-10-01', name: 'Claude Subscription', category: 'Software Subscription', amount: 2000, paidTo: 'Anthropic (Claude)' },
  { sno: 47, date: '2026-10-02', name: 'Airtel Wi-Fi', category: 'Wi-Fi', amount: 600, paidTo: 'Airtel' },
];
