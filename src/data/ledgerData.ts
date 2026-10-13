/**
 * Business ledgers, cleaned for import.
 *   Sheet "25": earlier ledger (≈ 2025 → April 2026, many rows undated)
 *   Sheet "26": project ledger 20/04/2026 → 02/10/2026
 *
 * Cleaning decisions (nothing from the sheets is dropped):
 * - One client per person, grouped by name + phone. Typos merged: Harish G "Nikalush/Niklaus",
 *   phone 63806 16533 → 63805 16533; Govindarajan 86110 40229 → 86109 40229;
 *   "Gowri Sankar" / "Gowrishankar" / Poeage / Poeage Hub → one client.
 * - Karthikeyan (ME Project, 86675 23799) is a different person from Karthikeyan Analysis.
 * - GV Sir and Rajesh Sir share the JKKM phone but are separate contacts.
 * - Project names have spelling fixed (Vedio → Video, Marketting → Marketing, …).
 * - Logins/passwords are kept exactly as written, in the admin-only Access & Credentials store.
 *   Where the sheet lists several passwords without saying which is which, they are kept verbatim.
 * - Domain cost, expenses and commission become expense records; the sheet's own "Profit" figure
 *   is kept in the project notes whenever it differs from amount − costs.
 * - Undated rows keep an empty date; `approx` (from their position in the sheet) only orders them.
 */

export interface LedgerClient {
  key: string;
  contact: string; // client name (contact person)
  company: string;
  phone: string; // 10 digits, or '' when the sheet has none
  email?: string;
  notes?: string;
}

export interface LedgerCost {
  amount: number;
  name: string;
  category: 'Hosting' | 'Marketing' | 'Printing & Certificates' | 'Commission';
  paidTo?: string;
}

export interface LedgerCredential {
  label: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
}

export interface LedgerRow {
  sheet: '25' | '26';
  sno: number;
  date: string; // DD/MM/YYYY, '' when the sheet has no date
  approx?: string; // YYYY-MM-DD used only for ordering undated rows
  client: string; // LedgerClient.key
  project: string;
  service: string;
  budget: number;
  received: number;
  /** When the sheet shows split payments (e.g. "12500+8500") */
  payments?: number[];
  status: 'Completed' | 'In Progress' | 'Maintenance';
  domain?: string;
  costs?: LedgerCost[];
  credentials?: LedgerCredential[];
  sheetProfit?: number;
  notes?: string;
  /** Not a row of either sheet (added on request) */
  extra?: boolean;
}

export const LEDGER_SERVICES: { name: string; description: string; pricingType: string }[] = [
  { name: 'Website Development', description: 'Custom responsive web design & development.', pricingType: 'Fixed Price' },
  { name: 'Software Development', description: 'Custom web applications, portals & business software.', pricingType: 'Milestone' },
  { name: 'Android App Development', description: 'Native & cross-platform mobile apps.', pricingType: 'Milestone' },
  { name: 'Digital Marketing', description: 'Social media, ads & organic marketing.', pricingType: 'Monthly Retainer' },
  { name: 'SEO', description: 'Search engine optimisation.', pricingType: 'Monthly Retainer' },
  { name: 'Branding', description: 'Logos and brand identity.', pricingType: 'One-Time' },
  { name: 'Internship Training', description: 'Student internship programmes with certificates.', pricingType: 'Per Unit' },
  { name: 'Certificates & Printing', description: 'Certificate design and printing.', pricingType: 'Per Unit' },
  // Ledger rows marked "Graphic Design" / "Video Editing" are imported as Media Works (see LEGACY_SERVICE_MAP)
  { name: 'Media Works', description: 'Videos, posters, PDFs and audio produced for clients.', pricingType: 'Per Unit' },
  { name: 'Academic Projects', description: 'College / final-year / ME project development.', pricingType: 'Fixed Price' },
  { name: 'IT Consulting & Staffing', description: 'Project management and consulting retainers.', pricingType: 'Monthly Retainer' },
];

export const LEDGER_CLIENTS: LedgerClient[] = [
  // --- clients from the 2026 sheet ---
  { key: 'karthikeyan', contact: 'Karthikeyan', company: 'Karthikeyan Analysis', phone: '8489995308' },
  { key: 'sahana', contact: 'Sahana Sundar', company: 'Spark Igniting Minds', phone: '8050023212', notes: 'Also Spark Tuitions, Spark Books and Spark Writers Retreat.' },
  { key: 'harish', contact: 'Harish G', company: 'Niklaus Solutions', phone: '6380516533' },
  { key: 'gv', contact: 'GV Sir', company: 'JKKM (AIML)', phone: '9789456707' },
  { key: 'saranya', contact: 'Saranya Mam', company: 'SVHPC (ECE)', phone: '6381055273' },
  { key: 'mathi', contact: 'Mathi Sir', company: 'SVHPC (CSE & AIML)', phone: '8072582882', notes: 'Also coordinates JKKM certificates.' },
  { key: 'gowrishankar', contact: 'Gowrishankar', company: 'Poeage', phone: '8056889616', notes: 'Also Poeage Hub (written as "Gowri Sankar" in the older ledger).' },
  { key: 'rajesh', contact: 'Rajesh Sir', company: 'JKKM (CSE)', phone: '9789456707' },
  { key: 'vishnu', contact: 'Vishnu Bro', company: 'LMV Tech', phone: '7010951339' },
  { key: 'punith', contact: 'Punith', company: 'Omnifincon', phone: '9000169752', notes: 'Also TrainArch Fitness.' },
  { key: 'mugesh', contact: 'Mugesh (Jeyaram)', company: 'SNS College', phone: '9629913466' },
  { key: 'suresh', contact: 'Suresh Anna', company: 'Nesam Tours & Travels', phone: '8531970197' },
  { key: 'vijay', contact: 'Vijay S', company: 'YouPeak', phone: '6383653475', notes: 'Also Vibe Media Networks.' },
  { key: 'govindarajan', contact: 'Govindarajan', company: 'GS Distributors', phone: '8610940229' },
  { key: 'karthikeyan-me', contact: 'Karthikeyan (ME Project)', company: 'ME Project', phone: '8667523799' },
  { key: 'azarudeen', contact: 'Mohammed Azarudeen', company: 'Valan Taxi', phone: '7538833550' },
  { key: 'priyadharshini', contact: 'Priyadharshini', company: 'ME Project', phone: '6381551481' },
  { key: 'gowtham', contact: 'Gowtham Mohan', company: 'PaviiSunn', phone: '9944173412', notes: 'Also Shiva Engineering Works.' },
  { key: 'chandru', contact: 'Chandru', company: '', phone: '9342183007' },
  { key: 'rames', contact: 'Rames S', company: 'Salem Business', phone: '9655030405' },
  { key: 'rajmohan', contact: 'Rajmohan', company: 'Sree Aadithya Siddha & Dental', phone: '9688225291' },
  // --- additional clients from the older sheet (no phone numbers recorded) ---
  { key: 'kothandan', contact: 'K S Kothandan', company: 'Kali Traders', phone: '' },
  { key: 'gopalakrishnan', contact: 'Gopalakrishnan', company: '', phone: '', notes: 'College project client.' },
  { key: 'sneha', contact: 'Sneha', company: '', phone: '', notes: 'College project client.' },
  { key: 'zamzam', contact: 'Zam Zam Bakery', company: 'Zam Zam Bakery & Sweets', phone: '' },
  { key: 'royal', contact: 'Royal Photography', company: 'Royal Photography', phone: '' },
  { key: 'ase', contact: 'ASE Protact', company: 'ASE Protact', phone: '' },
  { key: 'santhiya', contact: 'Santhiya', company: '', phone: '', notes: 'Referral: Gowtham (2nd year CSE).' },
  { key: 'vignesh', contact: 'Vignesh R', company: 'Sri Amman Smart Store', phone: '' },
  { key: 'ragil', contact: 'Ragil Rajan', company: 'Primetel Solutions FZE', phone: '' },
  { key: 'reboot', contact: 'Reboot', company: 'Reboot', phone: '' },
  { key: 'sabari', contact: 'Sabari Cars', company: 'Sabari Cars', phone: '' },
  { key: 'kavin', contact: 'Kavin Kspm', company: 'Offora Private Limited', phone: '' },
  { key: 'gowtham-balaji', contact: 'Gowtham Balaji', company: 'Velvet Luxury Salon', phone: '' },
  { key: 'harish-friend', contact: "Harish's Friend (Gift Shop)", company: 'Gift Shop', phone: '', notes: 'Written as "Harish Frd" in the ledger.' },
  { key: 'ajkksapt', contact: 'AJKKSAPT', company: 'AJKKSAPT', phone: '' },
  { key: 'gobi-arts', contact: 'Gobi Arts', company: 'Gobi Arts', phone: '' },
  { key: 'svhpc', contact: 'SVHPC', company: 'SVHPC', phone: '', notes: 'College project for the institution (contact person not recorded).' },
  { key: 'coga', contact: 'COGA', company: 'COGA', phone: '' },
  { key: 'ratnaka', contact: 'Ratnaka', company: 'Eco Solar Enterprises', phone: '' },
];

const cert = (amount: number, name = 'Certificates (₹30 per student)'): LedgerCost => ({ amount, name, category: 'Printing & Certificates' });
const commission = (amount: number, name = 'Commission', paidTo?: string): LedgerCost => ({ amount, name, category: 'Commission', paidTo });
const domainCost = (amount: number): LedgerCost => ({ amount, name: 'Domain', category: 'Hosting' });
const gmail = (username: string, password: string, notes?: string): LedgerCredential => ({ label: 'Gmail / Google account', username, password, notes });

const zamzamLogins: LedgerCredential[] = [
  gmail('zamzambakeryandsweets@gmail.com', 'Suhail2002'),
  { label: 'GitHub', username: 'ZamZamBakery', password: 'zamzambakerySuhail2002', url: 'https://github.com/ZamZamBakery' },
];

/** Older sheet: dates are often missing; `approx` follows the row order between dated rows. */
const S25: Omit<LedgerRow, 'sheet'>[] = [
  { sno: 1, date: '', approx: '2025-06-01', client: 'kothandan', project: 'Kali Traders – Website', service: 'Website Development', budget: 1000, received: 1000, status: 'Completed', domain: 'kalitraders.in', costs: [domainCost(500)], credentials: [gmail('kalitradersksk@gmail.com', 'Kalitraders@123')] },
  { sno: 2, date: '', approx: '2025-06-01', client: 'punith', project: 'TrainArch Fitness – Website', service: 'Website Development', budget: 3000, received: 3000, status: 'Completed', domain: 'trainarch.in', costs: [domainCost(500)], credentials: [gmail('trainarchfitness@gmail.com', 'Punith#123')] },
  { sno: 3, date: '', approx: '2025-06-01', client: 'punith', project: 'Android App', service: 'Android App Development', budget: 12000, received: 12000, status: 'Completed' },
  {
    sno: 4, date: '', approx: '2025-06-01', client: 'gowtham', project: 'PaviiSunn – Website', service: 'Website Development', budget: 2500, received: 2500, status: 'Completed', domain: 'paviisunn.in', notes: 'Amount in sheet: 1000 + 1500.',
    credentials: [
      gmail('shivaengg8@gmail.com', 'Pavi@0744'),
      { label: 'Facebook', username: 'info@paviisunn.in', password: 'i4?QJ[d?/ba2&U!' },
      { label: 'Instagram', username: 'paviisunn_solar', password: 'aZak*q8zEuC%A!x', url: 'https://instagram.com/paviisunn_solar' },
    ],
  },
  { sno: 5, date: '', approx: '2025-06-01', client: 'gopalakrishnan', project: 'Plant Disease Identifier (College Project)', service: 'Academic Projects', budget: 500, received: 500, status: 'Completed' },
  { sno: 6, date: '', approx: '2025-06-01', client: 'sneha', project: 'Disaster Management System (College Project)', service: 'Academic Projects', budget: 6000, received: 6000, status: 'Completed', costs: [commission(2000)] },
  { sno: 7, date: '', approx: '2025-06-01', client: 'gowtham', project: 'Shiva Engineering – Website', service: 'Website Development', budget: 2000, received: 2000, status: 'Completed', domain: 'shivaengineering.com', credentials: [gmail('shivaaengg8@gmail.com', 'Pavi@0744', 'Email written as "shivaaengg8" (double a) in the sheet.')] },
  { sno: 8, date: '', approx: '2025-06-01', client: 'zamzam', project: 'Zam Zam Bakery – Android App', service: 'Android App Development', budget: 15000, received: 15000, status: 'Completed', costs: [commission(5000)], sheetProfit: 15000, credentials: zamzamLogins },
  { sno: 9, date: '', approx: '2025-06-01', client: 'zamzam', project: 'Zam Zam Bakery – Website', service: 'Website Development', budget: 5000, received: 4000, status: 'Completed', sheetProfit: 5000, credentials: zamzamLogins },
  { sno: 10, date: '12/06/2025', client: 'royal', project: 'Royal Photography – Website', service: 'Website Development', budget: 7000, received: 7000, status: 'Completed', domain: 'royalphotography.org', costs: [domainCost(800), commission(1000)], credentials: [gmail('royalgroupphotography@gmail.com', 'Royal@sony@1')] },
  { sno: 11, date: '15/06/2025', client: 'gowrishankar', project: 'Poeage Hub – Android App', service: 'Android App Development', budget: 21000, received: 21000, payments: [12500, 8500], status: 'Completed', sheetProfit: 30000, credentials: [gmail('poeagehub@gmail.com', 'Poeage@26')] },
  {
    sno: 12, date: '16/06/2025', client: 'ase', project: 'ASE Protact – SEO', service: 'SEO', budget: 1000, received: 1000, status: 'Completed', domain: 'aseprotact.com',
    credentials: [{ label: 'GitHub & Hostinger', username: 'GitHub: Gowri0016 · Hostinger: poeage.site@gmail.com', password: 'Poeage@26, Gowri@12_', notes: 'The sheet lists both passwords together without saying which is for which account.' }],
  },
  { sno: 13, date: '10/07/2025', client: 'santhiya', project: 'College Project', service: 'Academic Projects', budget: 2000, received: 1000, status: 'Completed', sheetProfit: 2000, notes: 'Referred by Gowtham (2nd year CSE).' },
  {
    sno: 14, date: '10/07/2025', client: 'vignesh', project: 'Sri Amman Smart Store – E-commerce Website', service: 'Website Development', budget: 28000, received: 27500, status: 'Completed', domain: 'sriammansmartstore.in', sheetProfit: 20000,
    credentials: [{ label: 'Gmail & GitHub', username: 'sriammansmartstore@gmail.com · GitHub: sriammansmartstore', password: 'Viki889@@@, Sass@2025, Srimans@2025', url: 'https://github.com/sriammansmartstore', notes: 'The sheet lists three passwords without saying which account each is for.' }],
  },
  {
    sno: 15, date: '', approx: '2025-07-20', client: 'ragil', project: 'Primetel Solutions FZE – Website', service: 'Website Development', budget: 13000, received: 13000, status: 'Completed', domain: 'primetelsolutionsfze.com', costs: [domainCost(2000)], sheetProfit: 11500,
    credentials: [gmail('primetelsolutionsfze@gmail.com', 'Primetel@fze$'), { label: 'Formspree', username: 'primetelsolutionsfze@gmail.com', password: 'Primetel@fze$4', url: 'https://formspree.io', notes: 'Username assumed to be the Gmail address.' }],
  },
  { sno: 16, date: '', approx: '2025-07-27', client: 'reboot', project: 'Reboot – Website', service: 'Website Development', budget: 3500, received: 3500, status: 'Completed' },
  { sno: 17, date: '', approx: '2025-08-03', client: 'ragil', project: 'Primetel Solutions FZE – Logo', service: 'Branding', budget: 500, received: 500, status: 'Completed' },
  { sno: 18, date: '', approx: '2025-08-10', client: 'sabari', project: 'Sabari Cars – Website + Application', service: 'Software Development', budget: 15000, received: 15000, status: 'Completed' },
  { sno: 19, date: '', approx: '2025-08-17', client: 'gowrishankar', project: 'Sabari Cars – Firebase Storage', service: 'Software Development', budget: 1000, received: 1000, status: 'Completed' },
  { sno: 20, date: '', approx: '2025-08-24', client: 'gowrishankar', project: 'Tamil Lead Data', service: 'Digital Marketing', budget: 1000, received: 1000, status: 'Completed', notes: 'Amount column empty in the sheet; value taken from Received (₹1,000).' },
  { sno: 21, date: '', approx: '2025-08-31', client: 'gowtham', project: '2 Websites Order', service: 'Website Development', budget: 5500, received: 5500, status: 'Completed' },
  { sno: 22, date: '', approx: '2025-09-07', client: 'sahana', project: 'Spark Tuitions – Website', service: 'Website Development', budget: 2700, received: 2700, status: 'Completed', domain: 'sparktuitions.in', costs: [domainCost(650)], sheetProfit: 2100, credentials: [gmail('sundarsahana.19@gmail.com', 'Spark_25')] },
  { sno: 23, date: '', approx: '2025-09-14', client: 'sahana', project: 'Spark Books – Website', service: 'Website Development', budget: 7000, received: 7000, status: 'Completed', domain: 'sparkbooks.com', sheetProfit: 3500 },
  { sno: 24, date: '', approx: '2025-09-21', client: 'sahana', project: 'Spark Writers Retreat – Website', service: 'Website Development', budget: 1500, received: 1500, status: 'Completed', domain: 'sparkwritersretreat.com' },
  { sno: 25, date: '', approx: '2025-09-28', client: 'gowtham', project: 'PaviiSunn – Logo', service: 'Branding', budget: 500, received: 500, status: 'Completed' },
  { sno: 26, date: '', approx: '2025-10-05', client: 'gowtham', project: 'PaviiSunn – Contact Form (EmailJS)', service: 'Website Development', budget: 1000, received: 1000, status: 'Completed' },
  { sno: 27, date: '', approx: '2025-10-12', client: 'kavin', project: 'Offora – Website', service: 'Website Development', budget: 20000, received: 20000, status: 'Completed', domain: 'offora.in', credentials: [gmail('offoraprivatelimited@gmail.com', 'Offora@2025')] },
  { sno: 28, date: '', approx: '2025-10-19', client: 'gowrishankar', project: 'Poeage Hub – Seller & Admin Panels', service: 'Software Development', budget: 21000, received: 21000, status: 'Completed' },
  { sno: 29, date: '', approx: '2025-10-26', client: 'gowrishankar', project: 'UI Enhancement', service: 'Software Development', budget: 0, received: 0, status: 'Completed', notes: 'No amount recorded in the sheet ("-").' },
  { sno: 30, date: '', approx: '2025-10-26', client: 'gowrishankar', project: 'My Orders APK', service: 'Android App Development', budget: 0, received: 0, status: 'Completed', notes: 'No amount recorded in the sheet ("-").' },
  { sno: 31, date: '', approx: '2025-11-02', client: 'gowtham', project: 'Logo', service: 'Branding', budget: 500, received: 500, status: 'Completed' },
  { sno: 32, date: '', approx: '2025-11-02', client: 'gowtham', project: 'Image Editing', service: 'Graphic Design', budget: 1000, received: 1000, status: 'Completed' },
  { sno: 33, date: '', approx: '2025-11-02', client: 'gowtham', project: 'PaviiSunn – Contact Form', service: 'Website Development', budget: 1000, received: 1000, status: 'Completed', notes: 'Listed separately from the earlier "Contact Form (EmailJS)" entry.' },
  { sno: 34, date: '', approx: '2025-11-09', client: 'gowtham-balaji', project: 'Velvet Luxury Salon – Website', service: 'Website Development', budget: 13000, received: 13000, status: 'Completed', domain: 'velvetluxurysalon.in' },
  { sno: 35, date: '', approx: '2025-11-16', client: 'harish', project: 'Niklaus Solutions – Website', service: 'Website Development', budget: 8000, received: 8000, status: 'Completed', domain: 'niklaussolutions.com' },
  { sno: 36, date: '', approx: '2025-11-23', client: 'gowtham', project: 'Email Validator', service: 'Software Development', budget: 8000, received: 8000, status: 'Completed' },
  { sno: 37, date: '', approx: '2025-11-30', client: 'harish-friend', project: 'Gift Shop', service: 'Website Development', budget: 18000, received: 18000, status: 'Completed' },
  { sno: 38, date: '', approx: '2025-12-07', client: 'ajkksapt', project: 'College Project', service: 'Academic Projects', budget: 8000, received: 8000, status: 'Completed' },
  { sno: 39, date: '', approx: '2025-12-14', client: 'gobi-arts', project: 'College Project', service: 'Academic Projects', budget: 38500, received: 38500, status: 'Completed' },
  { sno: 40, date: '', approx: '2025-12-21', client: 'svhpc', project: 'College Project', service: 'Academic Projects', budget: 28500, received: 18700, status: 'Completed' },
  { sno: 41, date: '01/01/2026', client: 'gowrishankar', project: 'Project Manager Salary – January 2026', service: 'IT Consulting & Staffing', budget: 28000, received: 28000, status: 'Completed', notes: 'Month only in the sheet (January).' },
  { sno: 42, date: '', approx: '2026-01-15', client: 'coga', project: 'COGA – Website Contract Updates', service: 'Website Development', budget: 5000, received: 5000, status: 'Completed' },
  { sno: 43, date: '', approx: '2026-01-15', client: 'coga', project: 'COGA – Order Management Android App', service: 'Android App Development', budget: 2500, received: 2500, status: 'Completed' },
  { sno: 44, date: '', approx: '2026-01-15', client: 'kavin', project: 'Offora – Updates (Second Quotation)', service: 'Website Development', budget: 1750, received: 1000, status: 'Completed' },
  { sno: 45, date: '', approx: '2026-01-15', client: 'gowtham', project: 'Email Validator – Public View Updates', service: 'Software Development', budget: 10000, received: 10000, status: 'Completed' },
  { sno: 46, date: '', approx: '2026-01-15', client: 'gowtham-balaji', project: 'Velvet Luxury Salon – Updates', service: 'Website Development', budget: 5000, received: 5000, status: 'Completed' },
  { sno: 47, date: '', approx: '2026-01-15', client: 'gowtham-balaji', project: 'WhatsApp API Integration', service: 'Software Development', budget: 1000, received: 1000, status: 'Completed' },
  { sno: 48, date: '', approx: '2026-01-15', client: 'harish', project: 'Niklaus Solutions – Updates', service: 'Website Development', budget: 3500, received: 3500, status: 'Completed' },
  { sno: 49, date: '', approx: '2026-01-15', client: 'sahana', project: 'Spark Book Selling', service: 'Website Development', budget: 15000, received: 10000, status: 'Completed' },
  { sno: 50, date: '01/02/2026', client: 'gowrishankar', project: 'Project Manager Salary – February 2026', service: 'IT Consulting & Staffing', budget: 28000, received: 28000, status: 'Completed', notes: 'Month only in the sheet (February).' },
  { sno: 51, date: '01/03/2026', client: 'sahana', project: 'Spark Books – Maintenance', service: 'Website Development', budget: 2600, received: 2600, status: 'Completed', notes: 'Month only in the sheet (March).' },
  { sno: 52, date: '01/03/2026', client: 'gowrishankar', project: 'Project Manager Salary – March 2026', service: 'IT Consulting & Staffing', budget: 30000, received: 30000, status: 'Completed', notes: 'Month only in the sheet (March).' },
  { sno: 53, date: '', approx: '2026-03-20', client: 'harish', project: 'Zero Day RAT Copy (Dashboard Only)', service: 'Software Development', budget: 10000, received: 10000, status: 'Completed' },
  { sno: 54, date: '', approx: '2026-03-20', client: 'harish', project: 'File Sharing Update (Niklaus)', service: 'Software Development', budget: 2500, received: 2500, status: 'Completed' },
  { sno: 55, date: '', approx: '2026-03-20', client: 'ratnaka', project: 'Eco Solar Enterprises – Website', service: 'Website Development', budget: 2000, received: 2000, status: 'Completed', costs: [domainCost(650)] },
  { sno: 56, date: '01/04/2026', client: 'gowrishankar', project: 'Project Manager Salary – April 2026', service: 'IT Consulting & Staffing', budget: 25000, received: 25000, status: 'Completed', notes: 'Month only in the sheet (April).' },
];

const S26: Omit<LedgerRow, 'sheet'>[] = [
  { sno: 1, date: '20/04/2026', client: 'karthikeyan', project: 'File Sharing System (Firebase + React)', service: 'Software Development', budget: 10000, received: 10000, status: 'Completed', costs: [{ amount: 1000, name: 'Firebase', category: 'Hosting' }], notes: 'File sharing for students.', credentials: [gmail('onlineclass.ka2026@gmail.com', 'Karthik@1997')] },
  { sno: 2, date: '26/04/2026', client: 'karthikeyan', project: 'Website Renovation (WordPress to React)', service: 'Website Development', budget: 8000, received: 8000, status: 'Completed', domain: 'karthikeyananalysis.in' },
  { sno: 3, date: '28/04/2026', client: 'karthikeyan', project: 'Meta Ads', service: 'Digital Marketing', budget: 1250, received: 1250, status: 'Completed', costs: [{ amount: 750, name: 'Ad budget', category: 'Marketing' }] },
  { sno: 4, date: '01/05/2026', client: 'sahana', project: 'YouTube Channel Maintenance', service: 'Digital Marketing', budget: 8000, received: 8000, status: 'Maintenance', credentials: [{ label: 'YouTube channel (Google account)', username: 'sahansundar19@gmail.com', password: '123Sah@@@', url: 'https://studio.youtube.com' }] },
  { sno: 5, date: '05/05/2026', client: 'karthikeyan', project: 'Test Module', service: 'Software Development', budget: 6750, received: 6750, status: 'Completed', costs: [commission(500, 'Discount allowed')] },
  { sno: 6, date: '05/05/2026', client: 'harish', project: 'File Sharing System (Firebase)', service: 'Software Development', budget: 10000, received: 10000, status: 'Completed', notes: 'File sharing system for another company.' },
  { sno: 7, date: '06/05/2026', client: 'gv', project: 'Internship – 9 Students (AIML)', service: 'Internship Training', budget: 5400, received: 5400, status: 'Completed', costs: [cert(320)], notes: '₹600 per student.' },
  { sno: 8, date: '08/05/2026', client: 'saranya', project: 'Internship – 28 Students (ECE)', service: 'Internship Training', budget: 16800, received: 15600, status: 'Completed', costs: [cert(900), commission(5200)], notes: '₹600 per student. Received from 26 of 28 students.' },
  { sno: 9, date: '08/05/2026', client: 'mathi', project: 'Internship – 26 Students (CSE & AIML)', service: 'Internship Training', budget: 10000, received: 10000, status: 'Completed', costs: [cert(1000, 'Certificate PDF (Arunkumar Sir) + certificates ₹30 per student'), commission(2600)], notes: '₹400 per student. Received from 26 students.' },
  { sno: 10, date: '10/05/2026', client: 'gowrishankar', project: 'Project Manager Salary – May 2026', service: 'IT Consulting & Staffing', budget: 25000, received: 25000, status: 'Completed' },
  { sno: 11, date: '11/05/2026', client: 'harish', project: 'Zero Day RAT (Second Payment)', service: 'Software Development', budget: 10000, received: 10000, status: 'Completed' },
  { sno: 12, date: '12/05/2026', client: 'rajesh', project: 'Internship – 12 Students (CSE)', service: 'Internship Training', budget: 7200, received: 7200, status: 'Completed', costs: [cert(360)], notes: '₹600 per student.' },
  { sno: 13, date: '08/06/2026', client: 'gowrishankar', project: 'Project Manager Salary – June 2026', service: 'IT Consulting & Staffing', budget: 19000, received: 19000, status: 'Completed' },
  { sno: 14, date: '08/06/2026', client: 'vishnu', project: 'EATZ Food Delivery App', service: 'Android App Development', budget: 10000, received: 10000, status: 'Completed' },
  { sno: 15, date: '09/06/2026', client: 'vishnu', project: 'Muthu Electricals – Google Business Profile + Website', service: 'Website Development', budget: 5000, received: 5000, status: 'Completed' },
  { sno: 16, date: '11/06/2026', client: 'karthikeyan', project: 'Website Update (Profiles, Cart, Wishlist, ST Courier Tracking)', service: 'Website Development', budget: 4000, received: 4000, status: 'Completed', domain: 'karthikeyananalysis.in' },
  { sno: 17, date: '12/06/2026', client: 'vishnu', project: 'Internship – 13 Students', service: 'Internship Training', budget: 7800, received: 7800, status: 'Completed' },
  { sno: 18, date: '27/06/2026', client: 'harish', project: 'Employee Tracking System', service: 'Software Development', budget: 30000, received: 30000, status: 'Completed' },
  { sno: 19, date: '25/06/2026', client: 'gowrishankar', project: 'Certificates', service: 'Certificates & Printing', budget: 1500, received: 1500, status: 'Completed', costs: [cert(1000, 'Certificates')] },
  { sno: 20, date: '30/06/2026', client: 'punith', project: 'Website + SEO', service: 'Website Development', budget: 6000, received: 2500, status: 'In Progress', costs: [{ amount: 1000, name: 'Firebase', category: 'Hosting' }] },
  { sno: 21, date: '07/07/2026', client: 'karthikeyan', project: 'Student Portal Login Control', service: 'Software Development', budget: 1000, received: 1000, status: 'Completed' },
  { sno: 22, date: '16/07/2026', client: 'harish', project: 'Employee Tracking – New Updates', service: 'Software Development', budget: 10000, received: 10000, status: 'Completed' },
  { sno: 23, date: '17/07/2026', client: 'harish', project: 'Employee Tracking – EXE Build', service: 'Software Development', budget: 5000, received: 5000, status: 'Completed' },
  { sno: 24, date: '20/07/2026', client: 'karthikeyan', project: 'Video Platform & Meta Ads', service: 'Software Development', budget: 9000, received: 9000, status: 'Completed', costs: [{ amount: 1000, name: 'Ad budget', category: 'Marketing' }] },
  { sno: 25, date: '28/07/2026', client: 'gowrishankar', project: 'Project Manager Salary – June & July (Mid)', service: 'IT Consulting & Staffing', budget: 42000, received: 42000, status: 'Completed' },
  { sno: 26, date: '31/07/2026', client: 'karthikeyan', project: 'Automated Book & Question Bank Publishing Suite – 3', service: 'Software Development', budget: 12000, received: 12000, status: 'Completed' },
  { sno: 27, date: '06/08/2026', client: 'mathi', project: 'Certificates – Batch 3 (JKKM)', service: 'Certificates & Printing', budget: 1500, received: 1000, status: 'Completed', costs: [cert(30, 'Certificates'), commission(750)], notes: '₹500 per student.' },
  { sno: 28, date: '06/08/2026', client: 'mugesh', project: 'Certificates – Batch 2', service: 'Certificates & Printing', budget: 1000, received: 0, status: 'Completed', costs: [cert(60, 'Certificates')], notes: '₹500 per student.' },
  { sno: 29, date: '24/08/2026', client: 'suresh', project: 'Taxi Booking System (Web + App)', service: 'Software Development', budget: 85000, received: 10000, status: 'In Progress', domain: '6 domains (names not listed in the sheet)' },
  { sno: 30, date: '24/08/2026', client: 'vijay', project: 'Video Platform with Admin Panel', service: 'Software Development', budget: 50000, received: 30000, status: 'In Progress', domain: 'youpeak.app, youpeak.in' },
  { sno: 31, date: '26/08/2026', client: 'govindarajan', project: 'Monthly Posters', service: 'Graphic Design', budget: 999, received: 999, status: 'Completed' },
  { sno: 32, date: '27/08/2026', client: 'govindarajan', project: 'Group Images (40)', service: 'Graphic Design', budget: 800, received: 800, status: 'Completed' },
  { sno: 33, date: '28/08/2026', client: 'karthikeyan-me', project: 'Cyber Security (ME Project)', service: 'Academic Projects', budget: 10000, received: 2500, status: 'In Progress' },
  { sno: 34, date: '06/09/2026', client: 'azarudeen', project: 'Digital & Organic Marketing', service: 'Digital Marketing', budget: 6000, received: 6000, status: 'Completed', sheetProfit: 5412 },
  { sno: 35, date: '08/09/2026', client: 'priyadharshini', project: 'Emotional Analysis (ME Project)', service: 'Academic Projects', budget: 10000, received: 5000, status: 'In Progress' },
  { sno: 36, date: '25/09/2026', client: 'gowtham', project: 'PaviiSunn – Website Recreate', service: 'Website Development', budget: 2000, received: 1000, status: 'In Progress' },
  { sno: 37, date: '25/09/2026', client: 'gowtham', project: 'Shiva Engineering Works – Website Recreate + Images', service: 'Website Development', budget: 2500, received: 1500, status: 'In Progress' },
  { sno: 38, date: '27/09/2026', client: 'chandru', project: 'Video Editing – 20 Videos', service: 'Video Editing', budget: 6000, received: 2000, status: 'In Progress', costs: [commission(500, 'Commission', 'Vasanth')] },
  { sno: 39, date: '28/09/2026', client: 'vijay', project: 'YouPeak – Landing Page', service: 'Website Development', budget: 9800, received: 9800, status: 'Completed' },
  { sno: 40, date: '28/09/2026', client: 'vijay', project: 'Vibe Media Networks – Landing Page', service: 'Website Development', budget: 2000, received: 2000, status: 'Completed' },
  { sno: 41, date: '29/09/2026', client: 'rames', project: 'Posters / Flex / Video', service: 'Graphic Design', budget: 2000, received: 2000, status: 'Completed' },
  { sno: 42, date: '29/09/2026', client: 'karthikeyan', project: 'Video Editing', service: 'Video Editing', budget: 1000, received: 1000, status: 'Completed' },
  { sno: 43, date: '01/10/2026', client: 'suresh', project: 'Digital & Organic Marketing', service: 'Digital Marketing', budget: 5000, received: 0, status: 'In Progress' },
  { sno: 44, date: '01/10/2026', client: 'vijay', project: 'Digital & Organic Marketing', service: 'Digital Marketing', budget: 5000, received: 0, status: 'In Progress' },
  { sno: 45, date: '01/10/2026', client: 'rajmohan', project: 'Digital & Organic Marketing', service: 'Digital Marketing', budget: 6000, received: 0, status: 'In Progress' },
  { sno: 46, date: '01/10/2026', client: 'rajmohan', project: 'Website & Booking System', service: 'Website Development', budget: 35000, received: 0, status: 'In Progress', costs: [commission(14000, 'Commission', 'Vasanth')] },
  { sno: 47, date: '02/10/2026', client: 'azarudeen', project: 'Landing Page + Video', service: 'Website Development', budget: 7428, received: 0, status: 'In Progress', costs: [domainCost(588)] },
  { sno: 48, date: '02/10/2026', client: 'vijay', project: 'Landing Page SEO', service: 'SEO', budget: 5000, received: 0, status: 'In Progress' },
  // Re-created from the earlier "Student Portal" record (not in either sheet; value to be filled in)
  { sno: 49, date: '26/04/2026', client: 'karthikeyan', project: 'Student Portal', service: 'Software Development', budget: 0, received: 0, status: 'Maintenance', extra: true, notes: 'Not in the ledger sheets: set the project value and check the start date.' },
];

export const LEDGER_ROWS: LedgerRow[] = [
  ...S25.map((r) => ({ ...r, sheet: '25' as const })),
  ...S26.map((r) => ({ ...r, sheet: '26' as const })),
];
